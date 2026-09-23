import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ExcelJS from 'exceljs';
import { analyze } from '../src/pipeline.js';
import { buildPlan, exportPlan, rememberReport, storedReport, PlanRequest } from '../src/planning.js';
import { app } from '../src/index.js';
process.env.OPENAI_API_KEY = '';
const report = await analyze({
  beforeBuffer: await readFile(new URL('../../data/example_before.xlsx', import.meta.url)), beforeName: 'before.xlsx',
  afterBuffer: await readFile(new URL('../../data/example_after.xlsx', import.meta.url)), afterName: 'after.xlsx',
});
const empty = buildPlan(report);
const lost = empty.cases.find((c) => c.kind === 'lost');
const decision = { caseId: lost.id, action: 'assign', owner: 'ОА', note: 'Предлагается передать хранение архива отделу аналитики после согласования.', refs: lost.evidence.map((e) => e.ref) };

test('План не изменяет отчёт; назначения остаются предложениями, эскалация открыта', () => {
  const original = JSON.stringify(report);
  const plan = buildPlan(report, [decision]);
  assert.equal(plan.stats.proposed, 1);
  assert.equal(plan.stats.unresolved, empty.stats.total - 1);
  assert.match(plan.decisions[0].proposal, /Проект решения/);
  assert.equal(JSON.stringify(report), original);
  const escalated = buildPlan(report, [{ ...decision, action: 'escalate', owner: '' }]);
  assert.equal(escalated.stats.reviewed, 1);
  assert.equal(escalated.stats.escalated, 1);
  assert.equal(escalated.stats.unresolved, empty.stats.total);
});

test('Отбрасываются неизвестные находки, владельцы, чужие источники и повторные решения', () => {
  assert.throws(() => buildPlan(report, [{ ...decision, caseId: 'fake' }]));
  assert.throws(() => buildPlan(report, [{ ...decision, owner: 'ОС' }]));
  assert.throws(() => buildPlan(report, [{ ...decision, refs: ['red9#999'] }]));
  assert.throws(() => buildPlan(report, [{ ...decision, action: 'confirm' }]));
  assert.throws(() => buildPlan(report, [decision, decision]));
  assert.equal(PlanRequest.safeParse({ reportId: 'bad', decisions: [] }).success, false);
  const moved = empty.cases.find((c) => c.kind === 'moved');
  assert.throws(() => buildPlan(report, [{ ...decision, caseId: moved.id, action: 'confirm', refs: [moved.evidence[0].ref] }]));
});

test('Отпечаток комплекта устойчив к повторному анализу, но меняется при изменении источников', () => {
  assert.equal(buildPlan({ ...report, meta: { ...report.meta, generatedAt: 'another-date' } }).fingerprint, empty.fingerprint);
  const changed = structuredClone(report);
  changed.functions.find((f) => f.change === 'lost').evidenceBefore[0].text += ' Дополнение.';
  assert.notEqual(buildPlan(changed).fingerprint, empty.fingerprint);
});

test('Excel содержит решения, источник, гиперссылку и проект; строки не становятся формулами', async () => {
  const plan = buildPlan(report, [{ ...decision, note: '=HYPERLINK("https://example.invalid", "plain text")' }]);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await exportPlan(report, plan));
  assert.deepEqual(workbook.worksheets.map((s) => s.name), ['Обзор', 'Источники', 'План решений', 'Сопоставление функций']);
  const sheet = workbook.getWorksheet('План решений');
  assert.equal(sheet.getCell('E2').text, 'ОА');
  assert.equal(typeof sheet.getCell('F2').value, 'string');
  assert.match(sheet.getCell('H2').value.hyperlink, /^#'Источники'!A/);
  assert.match(sheet.getCell('I2').text, /Проект решения/);
  const source = workbook.getWorksheet('Источники');
  assert.equal(source.getCell('D2').text, lost.evidence[0].text);
});

test('Хранилище ограничено; клиент не может подменить отчёт в запросе плана', async (t) => {
  const first = rememberReport(report);
  for (let i = 0; i < 20; i++) rememberReport(report);
  assert.throws(() => storedReport(first.meta.reportId), /Сессия/);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const analyzed = await (await fetch(`${base}/api/analyze/example`, { method: 'POST' })).json();
  const input = { reportId: analyzed.meta.reportId, decisions: [decision], report: { functions: [] } };
  const response = await fetch(`${base}/api/plan`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).stats.total, empty.stats.total);
  const download = await fetch(`${base}/api/plan/export`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  assert.equal(download.status, 200);
  assert.match(download.headers.get('content-type'), /spreadsheetml/);
  assert.ok((await download.arrayBuffer()).byteLength > 3000);
  const stale = await fetch(`${base}/api/plan`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reportId: first.meta.reportId, decisions: [] }) });
  assert.equal(stale.status, 404);
});
