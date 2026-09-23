import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import { app } from '../src/index.js';

process.env.OPENAI_API_KEY = '';

async function file(name, owner, text) {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet('Функции').addRows([['Подразделение', 'Функция'], [owner, text]]);
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  return { name, owner, text, buffer, fileId: `f${createHash('sha256').update(buffer).digest('hex').slice(0, 16)}` };
}
const before = [
  await file('Договоры — до.xlsx', 'Отдел договоров (ОД)', 'Проверяет исполнение договоров поставщиками.'),
  await file('Архив — до.xlsx', 'Отдел архива (ОАР)', 'Хранит бумажный архив протоколов заседаний комиссии.'),
];
const after = [
  await file('Договоры — после.xlsx', 'Отдел договоров (ОД)', 'Проверяет исполнение договоров поставщиками.'),
  await file('Архив — после.xlsx', 'Отдел архива (ОАР)', 'Планирует закупку серверного оборудования предприятия.'),
];

async function serverFor(t) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  return `http://127.0.0.1:${server.address().port}`;
}
function formFor(beforeFiles, afterFiles) {
  const form = new FormData();
  for (const [side, files] of [['before', beforeFiles], ['after', afterFiles]]) {
    for (const input of files) form.append(side, new Blob([input.buffer]), input.name);
  }
  return form;
}
async function upload(base, beforeFiles = before, afterFiles = after) {
  const response = await fetch(`${base}/api/analyze`, { method: 'POST', body: formFor(beforeFiles, afterFiles) });
  return { status: response.status, body: await response.json() };
}
async function planFor(base, reportId) {
  const response = await fetch(`${base}/api/plan`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reportId, decisions: [] }),
  });
  const result = await response.json();
  assert.equal(response.status, 200, result.error);
  return result;
}
function allEvidence(report) {
  return [
    ...report.units.flatMap((item) => item.evidence),
    ...report.functions.flatMap((item) => [...item.evidenceBefore, ...item.evidenceAfter, ...item.reviewCandidates.map((candidate) => candidate.evidence)]),
    ...[...report.duplicates, ...report.conflicts, ...report.gaps].flatMap((item) => item.evidence),
    ...report.conclusion.findingEvidence.flat(), ...report.conclusion.recommendationEvidence.flat(),
    ...report.quality.warnings.flatMap((item) => item.evidence),
  ];
}

test('HTTP: комплект 2+2 с одинаковыми строками сохраняет четыре файла и точные источники во всём отчёте', async (t) => {
  const base = await serverFor(t);
  const response = await upload(base);
  assert.equal(response.status, 200, response.body.error);
  const report = response.body;
  assert.ok(report.meta.reportId);
  assert.equal(report.meta.before.documents.length, 2);
  assert.equal(report.meta.after.documents.length, 2);
  assert.equal(report.quality.documents.length, 4);
  for (const [side, files, docId] of [['before', before, 'red8'], ['after', after, 'red9']]) {
    assert.deepEqual(report.meta[side].documents.map((document) => document.name).sort(), files.map((input) => input.name).sort());
    assert.equal(report.meta[side].clauses, 4);
    for (const input of files) {
      assert.deepEqual(report.meta[side].documents.find((document) => document.name === input.name), { fileId: input.fileId, name: input.name, clauses: 2 });
      const coverage = report.quality.documents.find((document) => document.docId === docId && document.fileId === input.fileId);
      assert.equal(coverage.name, input.name);
      assert.equal(coverage.functionClauses, 1);
    }
  }
  assert.equal(report.units.length, 2);
  assert.deepEqual(report.functions.map((fn) => fn.change).sort(), ['added', 'kept', 'lost']);
  const evidence = allEvidence(report);
  assert.ok(evidence.length > 0);
  const identities = new Set();
  for (const source of evidence) {
    const files = source.docId === 'red8' ? before : source.docId === 'red9' ? after : [];
    const input = files.find((entry) => entry.fileId === source.fileId);
    assert.ok(input, `Источник должен указывать файл своей редакции: ${source.ref}`);
    assert.equal(source.fileName, input.name);
    assert.equal(source.number, 'Функции, строка 2');
    assert.ok([input.owner, input.text].includes(source.text));
    assert.equal(source.ref, `${source.docId}#${input.fileId}.s1.r2${source.text === input.owner ? '.u' : ''}`);
    identities.add(`${source.docId}:${source.fileId}`);
  }
  assert.equal(identities.size, 4);
  assert.ok(report.quality.checkedReferences >= evidence.length);
});

test('HTTP: порядок файлов не меняет функции и отпечаток рабочего плана', async (t) => {
  const base = await serverFor(t);
  const original = await upload(base);
  const reversed = await upload(base, [...before].reverse(), [...after].reverse());
  assert.equal(original.status, 200, original.body.error);
  assert.equal(reversed.status, 200, reversed.body.error);
  assert.notEqual(original.body.meta.reportId, reversed.body.meta.reportId);
  assert.deepEqual(original.body.functions, reversed.body.functions);
  const firstPlan = await planFor(base, original.body.meta.reportId);
  const secondPlan = await planFor(base, reversed.body.meta.reportId);
  assert.ok(firstPlan.cases.some((item) => item.kind === 'lost'), 'проверяем отпечаток непустой очереди находок');
  assert.equal(firstPlan.fingerprint, secondPlan.fingerprint);
  assert.deepEqual(firstPlan.cases, secondPlan.cases);
});

test('HTTP: повтор того же файла под новым именем отклоняется с 422 и обоими именами', async (t) => {
  const base = await serverFor(t);
  for (const side of ['before', 'after']) {
    const original = (side === 'before' ? before : after)[0];
    const duplicate = { name: `Повтор ${side}.xlsx`, buffer: Buffer.from(original.buffer) };
    const response = await upload(base, side === 'before' ? [original, duplicate] : before, side === 'after' ? [original, duplicate] : after);
    assert.equal(response.status, 422);
    assert.ok(response.body.error.includes(original.name));
    assert.ok(response.body.error.includes(duplicate.name));
    assert.match(response.body.error, /повторяет файл/);
    assert.equal(response.body.meta, undefined);
  }
});

test('HTTP: шестой файл в любой редакции отклоняется с 400 до разбора комплектов', async (t) => {
  const base = await serverFor(t);
  const six = Array.from({ length: 6 }, (_, index) => ({ name: `Приложение ${index + 1}.xlsx`, buffer: before[0].buffer }));
  for (const side of ['before', 'after']) {
    const response = await upload(base, side === 'before' ? six : before, side === 'after' ? six : after);
    assert.equal(response.status, 400);
    assert.match(response.body.error, /до 5 файлов/);
    assert.equal(response.body.meta, undefined);
  }
});

test('HTTP: повреждённый второй файл прерывает весь анализ и указан в ошибке 422', async (t) => {
  const base = await serverFor(t);
  for (const side of ['before', 'after']) {
    const invalid = { name: `Повреждённое приложение ${side}.xlsx`, buffer: Buffer.from('not-an-xlsx') };
    const response = await upload(base, side === 'before' ? [before[0], invalid] : before, side === 'after' ? [after[0], invalid] : after);
    assert.equal(response.status, 422);
    assert.ok(response.body.error.includes(invalid.name));
    assert.equal(response.body.meta, undefined, 'нельзя выдавать частичный успешный отчёт');
    assert.equal(response.body.functions, undefined);
  }
});

test('HTTP: нельзя анализировать комплект без файлов обязательной стороны', async (t) => {
  const base = await serverFor(t);
  for (const [beforeFiles, afterFiles] of [[[], after], [before, []], [[], []]]) {
    const response = await upload(base, beforeFiles, afterFiles);
    assert.equal(response.status, 400);
    assert.match(response.body.error, /минимум один файл в каждой редакции/);
    assert.equal(response.body.meta, undefined);
  }
});
