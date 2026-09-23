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
  assert.deepEqual(workbook.worksheets.map((s) => s.name), ['Обзор', 'Комплект документов', 'Источники', 'План решений', 'Сопоставление функций', 'Качество анализа']);
  const sheet = workbook.getWorksheet('План решений');
  assert.equal(sheet.getCell('E2').text, 'ОА');
  assert.equal(typeof sheet.getCell('F2').value, 'string');
  assert.match(sheet.getCell('H2').value.hyperlink, /^#'Источники'!A/);
  assert.match(sheet.getCell('I2').text, /Проект решения/);
  const source = workbook.getWorksheet('Источники');
  assert.equal(source.getCell('D2').text, lost.evidence[0].text);
});

test('Excel сохраняет фактические имена файлов, состав многодокументного комплекта и адреса источников', async () => {
  const multi = structuredClone(report);
  const beforeFiles = [
    { fileId: 'faaa', name: 'Положение об отделах.docx', clauses: 12 },
    { fileId: 'fbbb', name: 'Обязанности руководителей.xlsx', clauses: 8 },
  ];
  const afterFiles = [{ fileId: 'fccc', name: 'Новая структура.xlsx', clauses: 25 }];
  multi.meta.before = { ...multi.meta.before, name: 'Комплект до: 2 файла', documents: beforeFiles };
  multi.meta.after = { ...multi.meta.after, name: 'Комплект после: 1 файл', documents: afterFiles };
  const assigned = new Map();
  const sourceNames = new Map();
  const sideCounts = { red8: 0, red9: 0 };
  const enrich = (value) => {
    if (!value || typeof value !== 'object') return;
    if (value.ref && value.docId && typeof value.text === 'string') {
      const originalRef = value.ref;
      if (!assigned.has(originalRef)) {
        const files = value.docId === 'red8' ? beforeFiles : afterFiles;
        assigned.set(originalRef, files[sideCounts[value.docId]++ % files.length]);
      }
      const file = assigned.get(originalRef);
      value.ref = `${value.docId}#${file.fileId}.${originalRef.split('#')[1]}`;
      value.fileId = file.fileId;
      value.fileName = file.name;
      sourceNames.set(value.ref, { fileId: file.fileId, fileName: file.name });
    }
    for (const item of Object.values(value)) enrich(item);
  };
  enrich(multi);
  multi.quality.documents = [
    ...beforeFiles.map((file) => ({ ...multi.quality.documents[0], ...file, docId: 'red8' })),
    ...afterFiles.map((file) => ({ ...multi.quality.documents.at(-1), ...file, docId: 'red9' })),
  ];
  const warningSource = multi.functions.flatMap((item) => item.evidenceBefore)[0];
  multi.quality.warnings.push({ code: 'file_review', title: 'Проверка области документа', detail: 'Требуется проверить область применения положения.', evidence: [warningSource] });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await exportPlan(multi, buildPlan(multi)));

  const inventory = workbook.getWorksheet('Комплект документов');
  assert.deepEqual([2, 3, 4].map((row) => inventory.getRow(row).values.slice(1)), [
    ['До', beforeFiles[0].name, 'faaa', 12], ['До', beforeFiles[1].name, 'fbbb', 8], ['После', afterFiles[0].name, 'fccc', 25],
  ]);
  const sourceSheet = workbook.getWorksheet('Источники');
  const exportedNames = new Set();
  sourceSheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const expected = sourceNames.get(row.getCell(1).text);
    assert.ok(expected, 'each exported ref must point to an enriched source');
    assert.equal(row.getCell(2).text, expected.fileName);
    assert.equal(row.getCell(5).text, expected.fileId);
    exportedNames.add(row.getCell(2).text);
  });
  assert.deepEqual(exportedNames, new Set([...beforeFiles, ...afterFiles].map((file) => file.name)));
  const exportedRefs = new Set(sourceSheet.getColumn(1).values.filter((value) => typeof value === 'string'));
  assert.ok(multi.units.flatMap((unit) => unit.evidence).every((source) => exportedRefs.has(source.ref)), 'definitions from structure-only files are exported too');
  const quality = workbook.getWorksheet('Качество анализа');
  assert.equal(quality.getCell('B2').text, beforeFiles[0].name);
  assert.equal(quality.getCell('G2').text, beforeFiles[0].fileId);

  let links = 0;
  workbook.eachSheet((sheet) => sheet.eachRow((row) => row.eachCell((cell) => {
    const value = cell.value;
    if (!value || typeof value !== 'object' || !value.hyperlink) return;
    const match = /^#'([^']+)'!(A\d+)$/u.exec(value.hyperlink);
    assert.ok(match, 'links must address a named source sheet, not a shifted sheet index');
    assert.equal(match[1], 'Источники');
    assert.equal(workbook.getWorksheet(match[1]).getCell(match[2]).text, value.text);
    links += 1;
  })));
  assert.ok(links > 0);
});

test('Excel строит состав комплекта для старого отчёта без файловых метаданных', async () => {
  const legacy = structuredClone(report);
  delete legacy.meta.before.documents;
  delete legacy.meta.after.documents;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await exportPlan(legacy, buildPlan(legacy)));
  const inventory = workbook.getWorksheet('Комплект документов');
  assert.equal(inventory.rowCount, 3);
  assert.deepEqual(inventory.getRow(2).values.slice(1), ['До', legacy.meta.before.name, legacy.meta.before.docId, legacy.meta.before.clauses]);
  assert.deepEqual(inventory.getRow(3).values.slice(1), ['После', legacy.meta.after.name, legacy.meta.after.docId, legacy.meta.after.clauses]);
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
