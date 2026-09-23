import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// По умолчанию повторяем записанные ответы без сети, даже если ключ задан в shell.
const live = process.argv.includes('--live');
if (live) (await import('dotenv')).config({ quiet: true });
else process.env.OPENAI_API_KEY = '';
if (live && !process.env.OPENAI_API_KEY?.trim()) throw new Error('Для --live нужен OPENAI_API_KEY.');
const { analyze } = await import('../src/pipeline.js');
const sets = [
  { fixture: 'semantic-example', prefix: 'semantic', name: 'Поиск переформулировок' },
  { fixture: 'semantic-holdout', prefix: 'semantic_holdout', name: 'Независимая смысловая проверка' },
  { fixture: 'semantic-blind', prefix: 'semantic_blind', name: 'Отложенная смысловая проверка' },
];
const results = [];
for (const set of sets) {
  const fixture = JSON.parse(await readFile(new URL(`../../fixtures/${set.fixture}.json`, import.meta.url), 'utf8'));
  const beforeBuffer = await readFile(new URL(`../../data/${set.prefix}_before.xlsx`, import.meta.url));
  const afterBuffer = await readFile(new URL(`../../data/${set.prefix}_after.xlsx`, import.meta.url));
  const report = await analyze({ beforeBuffer, beforeName: `${set.name} — до.xlsx`, afterBuffer, afterName: `${set.name} — после.xlsx` });
  const review = report.semanticReview;
  const cases = fixture.expected.map(expected => {
    const actual = review.items.find(item => item.beforeRef === expected.beforeRef);
    const local = report.functions.find(item => item.evidenceBefore.some(e => e.ref === expected.beforeRef));
    return {
      case: expected.case, beforeRef: expected.beforeRef,
      expectedStatus: expected.status, expectedAfter: expected.afterRef,
      actualStatus: actual?.status || 'missing', actualAfter: actual?.evidenceAfter?.ref || null,
      lexicalSimilarity: actual?.similarity ?? null, localChange: local?.change,
      correct: actual?.status === expected.status && (actual?.evidenceAfter?.ref || null) === expected.afterRef,
    };
  });
  const byStatus = status => {
    const expected = cases.filter(item => item.expectedStatus === status);
    return { correct: expected.filter(item => item.correct).length, total: expected.length };
  };
  results.push({
    dataset: set.fixture, source: review.source, status: review.status,
    inputHashes: { before: createHash('sha256').update(beforeBuffer).digest('hex'), after: createHash('sha256').update(afterBuffer).digest('hex') },
    total: cases.length, correct: cases.filter(item => item.correct).length,
    candidates: byStatus('candidate'), changedMeaning: byStatus('meaning_changed'), noMatch: byStatus('not_found'),
    falseEquivalent: cases.filter(item => item.actualStatus === 'candidate' && !item.correct).length,
    reviewed: review.reviewed, afterConsidered: review.afterConsidered, afterTotal: review.afterTotal, limited: review.limited,
    trace: report.trace.filter(step => step.kind === 'llm'), cases,
  });
}
const output = { generatedAt: new Date().toISOString(), mode: live ? 'live' : 'offline',
  limitation: '24 синтетических случая: 16 регрессионных и 8 размеченных отдельно без чтения промпта. Все использовались при сравнении моделей; это не независимая оценка точности на неизвестных корпоративных документах.',
  total: results.reduce((n, r) => n + r.total, 0), correct: results.reduce((n, r) => n + r.correct, 0), results };
console.log(JSON.stringify(output, null, 2));
const outputArg = process.argv.indexOf('--output');
if (outputArg >= 0) {
  if (!process.argv[outputArg + 1]) throw new Error('Укажите путь после --output.');
  await writeFile(process.argv[outputArg + 1], `${JSON.stringify(output, null, 2)}\n`, 'utf8');
}
if (output.correct !== output.total || results.some(r => r.source !== (live ? 'api' : 'fixture'))) process.exitCode = 1;
