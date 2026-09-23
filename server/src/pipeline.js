import { indexClauses } from './parse/docx.js';
import { parseCollection } from './parse/collection.js';
import { extractUnits, mergeUnits, extractFunctions, diffUnits } from './analysis/units.js';
import { diffFunctions, findDuplicates, findConflicts, findNormativeGaps } from './analysis/diff.js';
import { explainChanges, buildConclusion, hasApiKey } from './llm/enrich.js';
import { AnalysisReport } from './types.js';
import { buildCoverage } from './analysis/quality.js';
import { auditReportEvidence } from './analysis/evidence-audit.js';
import { reviewLostFunctions } from './llm/semantic.js';

/**
 * Пайплайн анализа двух комплектов с сохранением границ исходных файлов.
 * Разбор, сопоставление, заключение и аудит источников работают локально.
 * Дополнительная проверка моделью отражается отдельным шагом трассировки.
 */
export async function analyze({ beforeBuffer, beforeName, afterBuffer, afterName, beforeFiles, afterFiles }) {
  const inputsBefore = beforeFiles ?? [{ buffer: beforeBuffer, name: beforeName }];
  const inputsAfter = afterFiles ?? [{ buffer: afterBuffer, name: afterName }];
  if (!Array.isArray(inputsBefore) || !Array.isArray(inputsAfter)) throw new Error('Комплекты должны быть списками файлов.');
  if ([...inputsBefore, ...inputsAfter].reduce((sum, f) => sum + (f?.buffer?.length || 0), 0) > 100 * 1024 * 1024) {
    throw new Error('Общий размер двух комплектов не должен превышать 100 МБ.');
  }
  const trace = [];
  const timed = async (step, kind, fn) => {
    const started = Date.now();
    const value = await fn();
    trace.push({
      step,
      kind,
      model: null,
      source: 'local',
      durationMs: Date.now() - started,
      inputSize: null,
      citationsReturned: null,
      citationsRejected: null,
    });
    return value;
  };

  const { before, after, clauseIndex } = await timed('Разбор документов и нумерация пунктов', 'deterministic', async () => {
    const b = await parseCollection(inputsBefore, 'red8');
    const a = await parseCollection(inputsAfter, 'red9');
    return { before: b, after: a, clauseIndex: indexClauses(b, a) };
  });

  const { unitsBefore, unitsAfter, units } = await timed('Извлечение подразделений и сопоставление состава', 'deterministic', () => {
    const ub = mergeUnits(before.documents.flatMap(extractUnits));
    const ua = mergeUnits(after.documents.flatMap(extractUnits));
    return { unitsBefore: ub, unitsAfter: ua, units: diffUnits(ub, ua, clauseIndex) };
  });

  const { functionsBefore, functionsAfter, functions } = await timed(
    'Сопоставление функций и контрпроверка изменённых формулировок',
    'deterministic',
    () => {
      const fb = before.documents.flatMap((doc) => extractFunctions(doc, unitsBefore));
      const fa = after.documents.flatMap((doc) => extractFunctions(doc, unitsAfter));
      if (!unitsBefore.length || !unitsAfter.length || !fb.length || !fa.length) {
        throw new Error('Не удалось распознать подразделения и их функции в обоих комплектах. Нужны названия подразделений и нумерованные блоки функций/обязанностей руководителей; для XLSX — столбцы «Подразделение» и «Функция».');
      }
      return { functionsBefore: fb, functionsAfter: fa, functions: diffFunctions(fb, fa, clauseIndex) };
    },
  );

  const { duplicates, conflicts, gaps } = await timed('Поиск дублирования, конфликтов интересов и пробелов', 'deterministic', () => ({
    duplicates: findDuplicates(functionsAfter, clauseIndex),
    conflicts: findConflicts(before, after, functionsAfter, clauseIndex),
    gaps: findNormativeGaps(units, functionsAfter, clauseIndex),
  }));

  const explained = await explainChanges(functions, clauseIndex);
  if (explained.step) trace.push(explained.step);
  const semantic = await reviewLostFunctions({ functions, functionsBefore, functionsAfter, clauseIndex });
  if (semantic.step) trace.push(semantic.step);

  const quality = buildCoverage([
    ...before.documents.map((doc) => ({ doc, units: unitsBefore, functions: functionsBefore.filter((f) => doc.clauses.some((c) => c.id === f.ref)), name: doc.fileName })),
    ...after.documents.map((doc) => ({ doc, units: unitsAfter, functions: functionsAfter.filter((f) => doc.clauses.some((c) => c.id === f.ref)), name: doc.fileName })),
  ]);
  const draft = { units, functions: explained.functions, duplicates, conflicts, gaps, quality, semanticReview: semantic.review };
  const { conclusion, step } = await buildConclusion(draft);
  trace.push(step);

  const sourceAudit = await timed('Проверка всех цитат отчёта и полноты распознанных блоков', 'deterministic',
    () => auditReportEvidence({ ...draft, conclusion, meta: { before: { docId: before.docId }, after: { docId: after.docId } } }, clauseIndex));
  Object.assign(quality, sourceAudit);

  const usedLive = trace.some((t) => t.kind === 'llm' && t.source === 'api');

  const metadata = (collection, side) => ({
    docId: collection.docId,
    name: collection.documents.length === 1 ? collection.documents[0].fileName : `Комплект «${side}» · ${collection.documents.length} файлов`,
    clauses: collection.clauses.length,
    documents: collection.documents.map((doc) => ({ fileId: doc.fileId, name: doc.fileName, clauses: doc.clauses.length })),
  });
  const report = {
    meta: {
      before: metadata(before, 'до'),
      after: metadata(after, 'после'),
      mode: usedLive ? 'live' : 'demo',
      generatedAt: new Date().toISOString(),
    },
    ...draft,
    conclusion,
    trace,
  };

  // Отдаём наружу только то, что прошло собственную схему: контракт с
  // фронтендом должен соблюдаться и при деградации.
  const parsed = AnalysisReport.safeParse(report);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`Отчёт не соответствует схеме: ${issue.path.join('.')} — ${issue.message}`);
  }
  return parsed.data;
}

export { hasApiKey };
