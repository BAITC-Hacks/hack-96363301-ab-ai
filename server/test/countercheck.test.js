import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ExcelJS from 'exceljs';
import { analyze } from '../src/pipeline.js';
import { buildPlan, exportPlan } from '../src/planning.js';
import { app } from '../src/index.js';
import { listenTestServer } from '../test-support/http-server.js';
process.env.OPENAI_API_KEY = '';

const beforeBuffer = await readFile(new URL('../../data/countercheck_before.xlsx', import.meta.url));
const afterBuffer = await readFile(new URL('../../data/countercheck_after.xlsx', import.meta.url));
const report = await analyze({ beforeBuffer, beforeName: 'before.xlsx', afterBuffer, afterName: 'after.xlsx' });
const flagged = report.functions.filter((f) => f.materialChanges.length);

test('Контрпроверка проходит полный XLSX-пайплайн, сохраняет точные цитаты и не называет отрицание неизменной функцией', () => {
  assert.equal(report.functions.length, 6);
  assert.equal(flagged.length, 4);
  assert.deepEqual(flagged.flatMap((f) => f.materialChanges.map((s) => s.kind)), ['prohibition', 'obligation', 'frequency', 'scope']);
  assert.equal(report.functions.filter((f) => f.change === 'kept').length, 2);
  assert.equal(flagged[0].similarity, 1);
  assert.equal(flagged[0].change, 'reworded');
  for (const f of flagged) for (const s of f.materialChanges) {
    assert.ok(f.evidenceBefore[0].text.includes(s.beforeFragment));
    assert.ok(f.evidenceAfter[0].text.includes(s.afterFragment));
  }
  const finding = report.conclusion.findings.findIndex((v) => v.includes('Формулировок для контрпроверки: 4'));
  assert.notEqual(finding, -1);
  assert.equal(report.conclusion.findingEvidence[finding].length, 8);
});

test('Контрпроверка требует обеих редакций; передача остаётся самостоятельным вопросом', () => {
  const changedOwner = structuredClone(report);
  changedOwner.functions[0].change = 'moved';
  changedOwner.functions[0].ownerAfter = 'ОА';
  const base = buildPlan(changedOwner);
  assert.equal(base.cases.length, 5);
  assert.equal(base.cases.filter((c) => c.kind === 'material').length, 4);
  assert.equal(base.cases.filter((c) => c.kind === 'moved').length, 1);
  const c = base.cases[0];
  const decision = { caseId: c.id, action: 'escalate', owner: '', note: 'Проверить намеренное изменение полномочий по обеим редакциям.', refs: c.evidence.map((e) => e.ref) };
  assert.throws(() => buildPlan(changedOwner, [{ ...decision, action: 'confirm' }]), /не подходит/);
  assert.throws(() => buildPlan(changedOwner, [{ ...decision, refs: [c.evidence[0].ref] }]), /обеих редакций/);
  const plan = buildPlan(changedOwner, [decision]);
  assert.equal(plan.stats.escalated, 1);
  assert.equal(plan.stats.unresolved, 5);
  const dismissed = buildPlan(changedOwner, [{ ...decision, action: 'dismiss' }]);
  assert.equal(dismissed.stats.pending, 4);
  assert.ok(dismissed.cases.some((c) => c.kind === 'moved' && !dismissed.decisions.some((d) => d.caseId === c.id)));
  const changedSignal = structuredClone(changedOwner);
  changedSignal.functions[0].materialChanges[0].detail += ' Уточнение.';
  assert.notEqual(buildPlan(changedSignal).fingerprint, base.fingerprint);
});

test('Excel выгружает контрпроверку с буквальными фрагментами и ссылками на обе редакции', async () => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await exportPlan(report, buildPlan(report)));
  const checks = workbook.getWorksheet('Контрпроверка');
  assert.equal(checks.rowCount, 5);
  assert.equal(checks.getCell('C2').text, flagged[0].materialChanges[0].beforeFragment);
  assert.equal(checks.getCell('D2').text, flagged[0].materialChanges[0].afterFragment);
  assert.equal(checks.getCell('E2').text, '100%');
  const sources = workbook.getWorksheet('Источники');
  for (const col of ['F', 'G']) {
    const link = checks.getCell(`${col}2`).value;
    const row = Number(link.hyperlink.match(/!A(\d+)$/)[1]);
    assert.equal(sources.getCell(`A${row}`).text, link.text);
  }
});

test('Демонстрация и загрузка тех же скачиваемых документов дают одинаковые находки', async (t) => {
  const server = await listenTestServer(app);
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${base}/api/analyze/countercheck`, { method: 'POST' });
  assert.equal(response.status, 200);
  const demo = await response.json();
  assert.ok(demo.meta.reportId);
  const form = new FormData();
  for (const side of ['before', 'after']) {
    const download = await fetch(`${base}/api/examples/countercheck/${side}.xlsx`);
    assert.equal(download.status, 200);
    form.append(side, new Blob([await download.arrayBuffer()]), demo.meta[side].name);
  }
  const upload = await fetch(`${base}/api/analyze`, { method: 'POST', body: form });
  assert.equal(upload.status, 200);
  assert.deepEqual((await upload.json()).functions, demo.functions);
});
