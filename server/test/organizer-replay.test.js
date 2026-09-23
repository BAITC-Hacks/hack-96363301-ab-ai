import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

process.env.OPENAI_API_KEY = ' ';
process.env.OPENAI_MODEL = 'gpt-4.1-mini';
process.env.OPENAI_SEMANTIC_MODEL = 'gpt-4.1';
const { analyze } = await import('../src/pipeline.js');

test('Записи контрольного комплекта с исходными именами воспроизводятся без API, кандидаты остаются гипотезами', async () => {
  const report = await analyze({
    beforeBuffer: await readFile(new URL('../../data/polozhenie_red8_before.docx', import.meta.url)),
    beforeName: 'Положение_о_внутреннем_аудите_редакция_8_обезличено.docx',
    afterBuffer: await readFile(new URL('../../data/polozhenie_red9_after.docx', import.meta.url)),
    afterName: 'Положение_о_внутреннем_аудите_редакция_9_обезличено.docx',
  });
  assert.equal(report.meta.mode, 'demo');
  const modelSteps = report.trace.filter(step => step.kind === 'llm');
  assert.equal(modelSteps.length, 2);
  assert.ok(modelSteps.every(step => step.source === 'fixture' && step.citationsRejected === 0));
  assert.equal(report.semanticReview.reviewed, 7);
  assert.equal(report.semanticReview.items.filter(item => item.status === 'candidate').length, 5);
  assert.equal(report.semanticReview.items.filter(item => item.status === 'not_found').length, 2);
  const lost = report.functions.filter(item => item.change === 'lost');
  assert.equal(lost.length, 7);
  assert.ok(lost.every(item => item.evidenceAfter.length === 0));
  assert.ok(report.quality.checkedReferences > 0);
});
