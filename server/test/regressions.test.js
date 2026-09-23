import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ExcelJS from 'exceljs';
import { parsePlainText, indexClauses } from '../src/parse/docx.js';
import { parseDocument, decodeFileName } from '../src/parse/document.js';
import { extractUnits, extractFunctions, diffUnits } from '../src/analysis/units.js';
import { findConflicts } from '../src/analysis/diff.js';
import { applyModelExplanations } from '../src/llm/enrich.js';
import { analyze } from '../src/pipeline.js';
import { app } from '../src/index.js';
import { listenTestServer } from '../test-support/http-server.js';

process.env.OPENAI_API_KEY = ''; // Все проверки автономны, без сетевых вызовов модели.
const sample = `8. Структура
8.2. Состав подразделений:
а. Отдел контроля (ОК).
12. Обязанности
12.7. Начальник отдела контроля:
12.7.1. Выполняет проверку качества выполненных аудиторских работ.
12.7.2. Формирует ежегодный план проверок предприятия.`;

test('Номера разделов не влияют на извлечение подразделений и функций', () => {
  const doc = parsePlainText(sample, 'red8');
  const units = extractUnits(doc);
  assert.equal(units[0].abbr, 'ОК');
  const functions = extractFunctions(doc, units);
  assert.equal(functions.length, 2);
  assert.ok(functions.every((f) => f.owner === 'ОК'));
});

test('Переименование, слияние и разделение имеют источники; несвязанные подразделения не объединяются', () => {
  const before = parsePlainText('1. Отдел контроля (ОК).\n2. Отдел рисков (ОР).', 'red8');
  const after = parsePlainText('7. Отдел аудита (ОА).\n8. Объединить ОК и ОР в ОА.', 'red9');
  const index = indexClauses(before, after);
  const result = diffUnits(extractUnits(before), extractUnits(after), index);
  assert.equal(result.length, 1);
  assert.equal(result[0].status, 'reorganized');
  assert.equal(result[0].evidence.length, 4);
  const split = diffUnits(extractUnits(after), extractUnits(before), indexClauses(after,
    parsePlainText('1. Отдел контроля (ОК).\n2. Отдел рисков (ОР).\n3. Разделить ОА на ОК и ОР.', 'red8')));
  assert.deepEqual(split.map((u) => u.status), ['reorganized', 'reorganized']);
  const renamed = parsePlainText('1. Отдел контроля качества (ОК).', 'red9');
  assert.equal(diffUnits(extractUnits(before), extractUnits(renamed), indexClauses(before, renamed))[0].status, 'reorganized');
  const unrelated = parsePlainText('1. Отдел продаж (ОП).', 'red9');
  assert.deepEqual(diffUnits(extractUnits(before), extractUnits(unrelated), indexClauses(before, unrelated)).map((u) => u.status), ['created', 'removed', 'removed']);
});

test('Требование декларирования не считается конфликтом интересов', () => {
  const before = parsePlainText('1. Общие положения.', 'red8');
  const after = parsePlainText('1. Работники обязаны декларировать конфликт интересов.', 'red9');
  assert.deepEqual(findConflicts(before, after, [], indexClauses(before, after)), []);
});

test('Пустые, чужие, частичные и вымышленные ссылки модели отклоняются вместе с объяснением', () => {
  const before = { ref: 'red8#1', docId: 'red8', number: '1', text: 'Проверка качества' };
  const after = { ...before, ref: 'red9#2', docId: 'red9', number: '2' };
  const index = new Map([[before.ref, before], [after.ref, after], ['red9#3', { text: 'Чужой пункт' }]]);
  for (const citations of [[], ['red8#1'], ['red8#1', 'red9#3'], ['red8#1', 'red9#999']]) {
    const f = { change: 'moved', ownerBefore: 'А', ownerAfter: 'Б', evidenceBefore: [before], evidenceAfter: [after], rationale: null };
    const stats = applyModelExplanations([f], { items: [{ id: 'f0', change: 'moved', rationale: 'Неподтверждённый факт', citations }] }, index);
    assert.equal(f.rationale, null);
    assert.equal(stats.accepted, 0);
  }
  const f = { change: 'moved', ownerBefore: 'А', ownerAfter: 'Б', evidenceBefore: [before], evidenceAfter: [after], rationale: null };
  applyModelExplanations([f], { items: [{ id: 'f0', change: 'moved', rationale: 'Неподтверждённый факт', citations: [before.ref, after.ref] }] }, index);
  assert.match(f.rationale, /А → Б/);
  assert.doesNotMatch(f.rationale, /Неподтверждённый/);
});

async function workbookBuffer() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Функции');
  sheet.addRows([['Подразделение', 'Функция'], ['Отдел контроля', 'Проверяет качество аудиторских работ'], ['Отдел рисков', 'Оценивает риски подразделений предприятия']]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

test('XLSX проходит полный анализ, ссылки указывают на лист и строку', async () => {
  const buffer = await workbookBuffer();
  const report = await analyze({ beforeBuffer: buffer, beforeName: 'до.xlsx', afterBuffer: buffer, afterName: 'после.xlsx' });
  assert.equal(report.units.length, 2);
  assert.ok(report.functions.every((f) => f.change === 'kept'));
  assert.match(report.functions[0].evidenceBefore[0].number, /Функции, строка 2/);
  for (const group of [...report.conclusion.findingEvidence, ...report.conclusion.recommendationEvidence]) assert.ok(group.length);
  assert.equal(report.gaps.length, 0);
});

// Минимальный PDF с Unicode CMap: проверяем реальный бинарный вход, без моков PDF.js.
function pdfBuffer(text) {
  const hex = (s) => [...s].map((c) => c.charCodeAt(0).toString(16).padStart(4, '0')).join('');
  const content = `BT /F1 10 Tf 50 780 Td 14 TL ${text.split('\n').map((s) => `<${hex(s)}> Tj T*`).join('\n')} ET`;
  const cmap = '/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def /CMapName /Identity-UCS def /CMapType 2 def 1 begincodespacerange <0000> <FFFF> endcodespacerange 1 beginbfrange <0000> <FFFF> <0000> endbfrange endcmap CMapName currentdict /CMap defineresource pop end end';
  const stream = (s) => `<< /Length ${s.length} >>\nstream\n${s}\nendstream`;
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Font /Subtype /Type0 /BaseFont /Test /Encoding /Identity-H /DescendantFonts [5 0 R] /ToUnicode 7 0 R >>',
    '<< /Type /Font /Subtype /CIDFontType2 /BaseFont /Test /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /DW 500 >>', stream(content), stream(cmap)];
  let pdf = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((o, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((n) => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}

test('Текстовый PDF с кириллицей проходит полный анализ; пустой PDF требует OCR', async () => {
  const buffer = pdfBuffer(sample);
  const report = await analyze({ beforeBuffer: buffer, beforeName: 'до.pdf', afterBuffer: buffer, afterName: 'после.pdf' });
  assert.equal(report.units[0].abbr, 'ОК');
  assert.equal(report.functions.length, 2);
  assert.ok(report.functions.every((f) => f.change === 'kept'));
  await assert.rejects(parseDocument(pdfBuffer(''), 'red8', 'скан.pdf'), /OCR/);
});

test('API: демо, загрузка кириллицы, неподдерживаемые и повреждённые файлы', async (t) => {
  const server = await listenTestServer(app);
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const demo = await fetch(`${base}/api/analyze/demo`, { method: 'POST' });
  assert.equal(demo.status, 200);
  const report = await demo.json();
  assert.equal(report.conflicts.length, 1);
  assert.equal(report.conclusion.findings.length, report.conclusion.findingEvidence.length);
  assert.ok(report.conclusion.findingEvidence.every((items) => items.length));
  const buffer = await readFile(new URL('../../data/polozhenie_red8_before.docx', import.meta.url));
  const form = new FormData();
  form.append('before', new Blob([buffer]), 'Положение до.docx');
  form.append('after', new Blob([buffer]), 'Положение после.docx');
  const upload = await fetch(`${base}/api/analyze`, { method: 'POST', body: form });
  assert.equal(upload.status, 200);
  assert.equal((await upload.json()).meta.before.name, 'Положение до.docx');
  for (const name of ['wrong.txt', 'broken.docx']) {
    const invalid = new FormData();
    invalid.append('before', new Blob(['broken']), name);
    invalid.append('after', new Blob(['broken']), name);
    const response = await fetch(`${base}/api/analyze`, { method: 'POST', body: invalid });
    assert.equal(response.status, 422);
    assert.ok((await response.json()).error);
  }
});

test('Декодирование имён сохраняет Unicode и восстанавливает multipart Latin1', () => {
  for (const name of ['Положение.docx', 'Құжат.xlsx', '文書.pdf', 'audit.docx']) {
    assert.equal(decodeFileName(name), name);
    assert.equal(decodeFileName(Buffer.from(name).toString('latin1')), name);
  }
});
