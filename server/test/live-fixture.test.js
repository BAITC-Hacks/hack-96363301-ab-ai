import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { analyze } from '../src/pipeline.js';

process.env.OPENAI_API_KEY = '';

test('Записанный реальный ответ учебного примера воспроизводится без API и не публикует категоричный текст модели', async () => {
  const report = await analyze({
    beforeBuffer: await readFile(new URL('../../data/example_before.xlsx', import.meta.url)), beforeName: 'Учебный пример — до.xlsx',
    afterBuffer: await readFile(new URL('../../data/example_after.xlsx', import.meta.url)), afterName: 'Учебный пример — после.xlsx',
  });
  const step = report.trace.find((item) => item.kind === 'llm');
  assert.equal(report.meta.mode, 'demo');
  assert.equal(step.source, 'fixture');
  assert.equal(step.inputSize, 2);
  assert.match(step.step, /принято 2 из 2/);
  assert.equal(step.citationsReturned, 3);
  assert.equal(step.citationsRejected, 0);
  const moved = report.functions.find((item) => item.change === 'moved');
  assert.deepEqual([...moved.evidenceBefore, ...moved.evidenceAfter].map((item) => item.ref), ['red8#s1.r3', 'red9#s1.r3']);
  const lost = report.functions.find((item) => item.change === 'lost');
  assert.match(lost.rationale, /требуется проверка возможной утраты или переформулировки/);
  assert.ok(!JSON.stringify(report).includes('следовательно была удалена'));
});
