import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ExcelJS from 'exceljs';
import { AnalysisReport } from '../src/types.js';
import { listenTestServer } from '../test-support/http-server.js';

// A nonempty whitespace value also prevents dotenv from loading a local key.
// The checked-in recordings use these explicit models; no request may go live.
process.env.OPENAI_API_KEY = ' ';
process.env.OPENAI_MODEL = 'gpt-4.1-mini';
process.env.OPENAI_SEMANTIC_MODEL = 'gpt-4.1';
const { analyze } = await import('../src/pipeline.js');
const { app } = await import('../src/index.js');

const datasets = [
  { dataset: 'semantic-example', prefix: 'semantic', name: 'Поиск переформулировок' },
  { dataset: 'semantic-holdout', prefix: 'semantic_holdout', name: 'Независимая смысловая проверка' },
  { dataset: 'semantic-blind', prefix: 'semantic_blind', name: 'Отложенная смысловая проверка' },
];

for (const set of datasets) {
  test(`Записанный смысловой проход ${set.dataset} воспроизводится через полный пайплайн без изменения lost`, async () => {
    const report = await analyze({
      beforeBuffer: await readFile(new URL(`../../data/${set.prefix}_before.xlsx`, import.meta.url)), beforeName: `${set.name} — до.xlsx`,
      afterBuffer: await readFile(new URL(`../../data/${set.prefix}_after.xlsx`, import.meta.url)), afterName: `${set.name} — после.xlsx`,
    });
    const validated = AnalysisReport.parse(report);
    assert.deepEqual(validated.semanticReview, report.semanticReview, 'the contract must retain semantic fields');
    const review = validated.semanticReview;
    assert.equal(review.status, 'completed');
    assert.equal(review.source, 'fixture');
    assert.equal(review.model, 'gpt-4.1');
    assert.equal(review.totalLost, 8);
    assert.equal(review.reviewed, 8);
    assert.equal(review.items.length, 8);
    assert.equal(review.limited, false);
    assert.equal(review.afterConsidered, review.afterTotal);
    const lost = report.functions.filter((item) => item.change === 'lost');
    assert.equal(lost.length, 8);
    assert.ok(lost.every((item) => item.evidenceAfter.length === 0), 'semantic candidates must not alter deterministic evidence');

    // This checks replay consistency with the recorded live run, not agreement
    // with expected labels or accuracy on unseen corporate documents.
    const recording = JSON.parse(await readFile(new URL('../../docs/semantic-evaluation.json', import.meta.url), 'utf8'));
    const recorded = recording.results.find((item) => item.dataset === set.dataset);
    assert.ok(recorded, 'the final evaluation must include this recording');
    for (const item of review.items) {
      const actual = recorded.cases.find((candidate) => candidate.beforeRef === item.beforeRef);
      assert.ok(actual);
      assert.equal(item.status, actual.actualStatus);
      assert.equal(item.evidenceAfter?.ref || null, actual.actualAfter);
      const original = lost.find((candidate) => candidate.evidenceBefore.some((e) => e.ref === item.beforeRef));
      assert.ok(original);
      assert.equal(item.ownerBefore, original.ownerBefore);
      assert.deepEqual(item.evidenceBefore, original.evidenceBefore.find((e) => e.ref === item.beforeRef));
      if (item.evidenceAfter) {
        const target = report.functions.find((candidate) => candidate.evidenceAfter.some((e) => e.ref === item.evidenceAfter.ref));
        assert.ok(target, 'the hypothesis must cite a real after-side function');
        assert.equal(item.ownerAfter, target.ownerAfter);
        assert.deepEqual(item.evidenceAfter, target.evidenceAfter.find((e) => e.ref === item.evidenceAfter.ref));
        assert.ok(item.beforeFragment && item.evidenceBefore.text.includes(item.beforeFragment));
        assert.ok(item.afterFragment && item.evidenceAfter.text.includes(item.afterFragment));
        assert.ok(['candidate', 'meaning_changed'].includes(item.status));
      } else {
        assert.equal(item.status, 'not_found');
        assert.equal(item.ownerAfter, null);
        assert.equal(item.beforeFragment, null);
        assert.equal(item.afterFragment, null);
        assert.equal(item.similarity, null);
        assert.deepEqual(item.materialChanges, []);
      }
    }
    const semanticTrace = report.trace.find((step) => step.kind === 'llm' && step.step.startsWith('Смысловой поиск соответствий'));
    assert.equal(semanticTrace?.source, 'fixture');
    assert.equal(semanticTrace?.model, 'gpt-4.1');
    assert.equal(semanticTrace?.inputSize, 8);
  });
}

test('HTTP: смысловой пример, скачивание XLSX и экспорт гипотез содержат проверяемые источники', async (t) => {
  const server = await listenTestServer(app);
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;

  for (const side of ['before', 'after']) {
    const download = await fetch(`${base}/api/examples/semantic/${side}.xlsx`);
    assert.equal(download.status, 200);
    assert.match(download.headers.get('content-type'), /spreadsheetml/u);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(await download.arrayBuffer()));
    assert.ok(workbook.worksheets.length > 0 && workbook.worksheets[0].rowCount > 1);
  }

  const response = await fetch(`${base}/api/analyze/semantic`, { method: 'POST' });
  assert.equal(response.status, 200);
  const report = AnalysisReport.parse(await response.json());
  assert.match(report.meta.reportId, /^[a-f\d-]{36}$/u);
  assert.equal(report.semanticReview.source, 'fixture');
  assert.equal(report.semanticReview.reviewed, 8);
  const pairIndex = report.semanticReview.items.findIndex((item) => item.evidenceAfter);
  assert.ok(pairIndex >= 0, 'recorded demo must contain a pair for the export check');
  const pair = report.semanticReview.items[pairIndex];

  const exportResponse = await fetch(`${base}/api/plan/export`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reportId: report.meta.reportId, decisions: [] }),
  });
  assert.equal(exportResponse.status, 200);
  assert.match(exportResponse.headers.get('content-type'), /spreadsheetml/u);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(await exportResponse.arrayBuffer()));
  const sheet = workbook.getWorksheet('Смысловая проверка');
  assert.ok(sheet);
  assert.equal(sheet.rowCount, report.semanticReview.items.length + 1);
  const row = sheet.getRow(pairIndex + 2);
  assert.equal(row.getCell(4).text, pair.beforeFragment);
  assert.equal(row.getCell(5).text, pair.afterFragment);
  assert.equal(row.getCell(10).text, 'fixture');
  assert.equal(row.getCell(11).text, 'gpt-4.1');
  for (const [column, evidence, fragment] of [[6, pair.evidenceBefore, pair.beforeFragment], [7, pair.evidenceAfter, pair.afterFragment]]) {
    const link = row.getCell(column).value;
    assert.equal(link.text, evidence.ref);
    const target = /^#'Источники'!A(\d+)$/u.exec(link.hyperlink);
    assert.ok(target);
    const source = workbook.getWorksheet('Источники').getRow(Number(target[1]));
    assert.equal(source.getCell(1).text, evidence.ref);
    assert.equal(source.getCell(2).text, evidence.fileName);
    assert.equal(source.getCell(4).text, evidence.text);
    assert.ok(source.getCell(4).text.includes(fragment));
  }
});
