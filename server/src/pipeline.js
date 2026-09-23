import { parseDocx, indexClauses } from './parse/docx.js';
import { extractUnits, extractFunctions, diffUnits } from './analysis/units.js';
import { diffFunctions, findDuplicates, findConflicts, findNormativeGaps } from './analysis/diff.js';
import { explainChanges, buildConclusion, hasApiKey } from './llm/enrich.js';
import { AnalysisReport } from './types.js';

/**
 * Пайплайн анализа: от пары .docx до готового отчёта.
 *
 * Пять шагов, каждый попадает в trace и виден в интерфейсе. Детерминированные
 * шаги (1-4) работают всегда и ни от чего внешнего не зависят; шаг 5 —
 * объяснения модели, при недоступном API берётся из фикстур, а при их
 * отсутствии деградирует до детерминированного заключения.
 */
export async function analyze({ beforeBuffer, beforeName, afterBuffer, afterName }) {
  const trace = [];
  const timed = async (step, kind, fn) => {
    const started = Date.now();
    const value = await fn();
    trace.push({
      step,
      kind,
      model: null,
      source: 'api',
      durationMs: Date.now() - started,
      inputSize: null,
      citationsReturned: null,
      citationsRejected: null,
    });
    return value;
  };

  const { before, after, clauseIndex } = await timed('Разбор документов и нумерация пунктов', 'deterministic', async () => {
    const b = await parseDocx(beforeBuffer, 'red8');
    const a = await parseDocx(afterBuffer, 'red9');
    return { before: b, after: a, clauseIndex: indexClauses(b, a) };
  });

  const { unitsBefore, unitsAfter, units } = await timed('Извлечение подразделений и сопоставление состава', 'deterministic', () => {
    const ub = extractUnits(before);
    const ua = extractUnits(after);
    return { unitsBefore: ub, unitsAfter: ua, units: diffUnits(ub, ua, clauseIndex) };
  });

  const { functionsBefore, functionsAfter, functions } = await timed(
    'Привязка функций к владельцам и сопоставление по тексту',
    'deterministic',
    () => {
      const fb = extractFunctions(before, unitsBefore);
      const fa = extractFunctions(after, unitsAfter);
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

  const draft = { units, functions: explained.functions, duplicates, conflicts, gaps };
  const { conclusion, step } = await buildConclusion(draft);
  trace.push(step);

  const usedLive = trace.some((t) => t.kind === 'llm' && t.source === 'api');

  const report = {
    meta: {
      before: { docId: 'red8', name: beforeName, clauses: before.clauses.length },
      after: { docId: 'red9', name: afterName, clauses: after.clauses.length },
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
