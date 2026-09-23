import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { parseCollection, MAX_FILES_PER_SIDE, MAX_FILE_BYTES } from '../src/parse/collection.js';
import { parseDocument } from '../src/parse/document.js';
import { indexClauses } from '../src/parse/docx.js';

const fileIdOf = (buffer) => `f${createHash('sha256').update(buffer).digest('hex').slice(0, 16)}`;
async function xlsx(name, rows) {
  const book = new ExcelJS.Workbook();
  book.addWorksheet('Функции').addRows([['Подразделение', 'Функция'], ...rows]);
  return { name, buffer: Buffer.from(await book.xlsx.writeBuffer()) };
}
async function docx(name, lines) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  const xml = (text) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  zip.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${lines.map((line) => `<w:p><w:r><w:t>${xml(line)}</w:t></w:r></w:p>`).join('')}</w:body></w:document>`);
  return { name, buffer: await zip.generateAsync({ type: 'nodebuffer' }) };
}

test('Два XLSX с одинаковыми адресами строк сохраняют отдельные источники и имена файлов', async () => {
  const files = [
    await xlsx('Контроль.xlsx', [['Отдел контроля', 'Проверяет договоры.']]),
    await xlsx('Аудит.xlsx', [['Отдел аудита', 'Формирует план аудита.']]),
  ];
  const result = await parseCollection(files, 'red8');
  assert.equal(result.documents.length, 2);
  assert.equal(result.clauses.length, 4);
  assert.equal(indexClauses(result).size, 4);
  for (const file of files) {
    const fileId = fileIdOf(file.buffer);
    const parsed = result.documents.find((document) => document.fileId === fileId);
    assert.equal(parsed.fileName, file.name);
    assert.ok(parsed.clauses.every((clause) => clause.id.startsWith(`red8#${fileId}.s1.r2`)));
    assert.ok(parsed.clauses.every((clause) => clause.number === 'Функции, строка 2' && clause.docId === 'red8'));
    assert.ok(parsed.clauses.every((clause) => clause.fileName === file.name && clause.fileId === fileId));
  }
});

test('Порядок загрузки не меняет комплект; переименование не меняет ссылки на содержимое', async () => {
  const files = [await xlsx('Первый.xlsx', [['Отдел контроля', 'Проверяет договоры.']]), await xlsx('Второй.xlsx', [['Отдел аудита', 'Хранит акты.']])];
  const forward = await parseCollection(files, 'red9');
  assert.deepEqual(await parseCollection([...files].reverse(), 'red9'), forward);
  assert.deepEqual(forward.documents.map((document) => document.fileId), files.map((file) => fileIdOf(file.buffer)).sort());
  const renamed = await parseCollection(files.map((file, index) => ({ ...file, name: `Новое имя ${index}.xlsx` })), 'red9');
  assert.deepEqual(renamed.clauses.map((clause) => clause.id), forward.clauses.map((clause) => clause.id));
  assert.notDeepEqual(renamed.documents.map((document) => document.fileName), forward.documents.map((document) => document.fileName));
});

test('Одинаковая нумерация DOCX остаётся внутри своего документа, включая буквенные подпункты', async () => {
  const files = [
    await docx('Контроль.docx', ['1. Отдел контроля (ОК).', '2. Начальник ОК обязан:', '2.1. Выполняет следующие функции:', 'а. Проверяет договоры.']),
    await docx('Аудит.docx', ['1. Отдел аудита (ОА).', '2. Начальник ОА обязан:', '2.1. Выполняет следующие функции:', 'а. Хранит акты.']),
  ];
  const result = await parseCollection(files, 'red8');
  assert.equal(indexClauses(result).size, 8);
  for (const document of result.documents) {
    const original = await parseDocument(files.find((file) => file.name === document.fileName).buffer, 'red8', document.fileName);
    assert.deepEqual(document.clauses.map(({ number, text }) => ({ number, text })), original.clauses.map(({ number, text }) => ({ number, text })));
    const child = document.clauses.find((clause) => clause.number === '2.1а');
    assert.equal(child.parent, `red8#${document.fileId}.2.1`);
    assert.ok(document.clauses.some((clause) => clause.id === child.parent));
    assert.ok(document.sections.every((section) => section.fileId === document.fileId && section.fileName === document.fileName));
  }
  assert.equal(result.sections.length, result.documents.reduce((sum, document) => sum + document.sections.length, 0));
});

test('Один файл сохраняет прежние ссылки, текст и родительские адреса', async () => {
  const files = [await docx('Обязанности.docx', ['5.3. Выполняет следующие функции:', 'а. Проверяет договоры.']), await xlsx('Функции.xlsx', [['Отдел контроля', 'Проверяет договоры.']])];
  for (const file of files) {
    const original = await parseDocument(file.buffer, 'red8', file.name);
    const result = await parseCollection([file], 'red8');
    const metadata = { fileId: fileIdOf(file.buffer), fileName: file.name };
    assert.deepEqual(result.clauses, original.clauses.map((clause) => ({ ...clause, ...metadata })));
    assert.equal(result.documents[0].fileId, metadata.fileId);
  }
});

test('Повтор содержимого в одной редакции отклоняется даже с новым именем', async () => {
  const file = await xlsx('Оригинал.xlsx', [['Отдел контроля', 'Проверяет договоры.']]);
  await assert.rejects(parseCollection([file, { name: 'Копия.xlsx', buffer: Buffer.from(file.buffer) }], 'red8'), /Копия\.xlsx.*Оригинал\.xlsx.*повторную копию/);
  const before = await parseCollection([file], 'red8');
  const after = await parseCollection([file], 'red9');
  assert.equal(before.documents[0].fileId, after.documents[0].fileId);
  assert.notEqual(before.clauses[0].id, after.clauses[0].id);
});

test('Число и размер файлов проверяются до разбора', async () => {
  assert.equal(MAX_FILES_PER_SIDE, 5);
  assert.equal(MAX_FILE_BYTES, 20 * 1024 * 1024);
  for (const files of [null, {}, [], Array.from({ length: MAX_FILES_PER_SIDE + 1 }, () => ({ name: 'Файл.xlsx', buffer: Buffer.from('x') }))]) {
    await assert.rejects(parseCollection(files, 'red8'), /от 1 до 5 файлов/);
  }
  await assert.rejects(parseCollection([{ name: 'Слишком большой.xlsx', buffer: Buffer.alloc(MAX_FILE_BYTES + 1) }], 'red8'), /Слишком большой\.xlsx.*превышает 20 МБ/);
});

test('Некорректный вход отклоняется с понятной диагностикой', async () => {
  for (const file of [null, {}, { name: '' }, { name: ' ' }]) await assert.rejects(parseCollection([file], 'red8'), /не указано имя/);
  await assert.rejects(parseCollection([{ name: 'Не буфер.xlsx', buffer: new Uint8Array([1]) }], 'red8'), /Не буфер\.xlsx.*не передано содержимое/);
  await assert.rejects(parseCollection([{ name: 'Пустой.docx', buffer: Buffer.alloc(0) }], 'red8'), /Пустой\.docx.*файл пуст/);
  for (const docId of [null, '', ' ', 'red8#bad']) await assert.rejects(parseCollection([], docId), /идентификатор редакции/);
});

test('Ошибка отдельного файла не скрывается за успешными файлами и содержит его имя', async () => {
  const good = await xlsx('Исправный.xlsx', [['Отдел контроля', 'Проверяет договоры.']]);
  await assert.rejects(parseCollection([good, { name: 'Повреждённый.xlsx', buffer: Buffer.from('broken') }], 'red8'), /Файл «Повреждённый\.xlsx»:/);
  await assert.rejects(parseCollection([{ name: 'Неизвестный.txt', buffer: Buffer.from('text') }], 'red9'), /Неизвестный\.txt.*Поддерживаются DOCX/);
});

test('Пустой разобранный файл отклоняется, отдельный состав подразделений и преамбула сохраняются', async () => {
  await assert.rejects(parseCollection([await docx('Без текста.docx', [])], 'red8'), /Без текста\.docx.*ни одного текстового фрагмента/);
  for (const lines of [['1. Отдел контроля (ОК).'], ['Документ без нумерации']]) {
    const result = await parseCollection([await docx('Состав.docx', lines)], 'red8');
    assert.equal(result.clauses.length, 1);
    assert.equal(result.documents.length, 1);
  }
});

test('Диагностика потерянного владельца ссылается на перенумерованный источник своего XLSX', async () => {
  const orphan = await xlsx('Без владельца.xlsx', [['', 'Хранит архив протоколов.'], ['Отдел контроля', 'Проверяет договоры.']]);
  const other = await xlsx('Аудит.xlsx', [['Отдел аудита', 'Готовит отчёты.']]);
  const result = await parseCollection([orphan, other], 'red9');
  assert.equal(result.diagnostics.length, 1);
  const diagnostic = result.diagnostics[0];
  assert.equal(diagnostic.ref, `red9#${fileIdOf(orphan.buffer)}.s1.r2`);
  assert.equal(diagnostic.fileName, orphan.name);
  assert.equal(diagnostic.fileId, fileIdOf(orphan.buffer));
  assert.equal(indexClauses(result).get(diagnostic.ref).text, 'Хранит архив протоколов.');
  assert.equal(result.documents.find((document) => document.fileName === orphan.name).diagnostics[0].ref, diagnostic.ref);
});

test('Комплект допускает разные поддерживаемые форматы и сохраняет обе исходные структуры', async () => {
  const file = await docx('Структура.docx', ['1. Отдел контроля (ОК).']);
  const table = await xlsx('Обязанности.xlsx', [['Отдел контроля (ОК)', 'Проверяет договоры.']]);
  const result = await parseCollection([file, table], 'red8');
  assert.equal(result.documents.length, 2);
  assert.equal(result.clauses.length, 3);
  assert.ok(result.clauses.some((clause) => clause.unitDefinition === 'Отдел контроля (ОК)'));
  assert.ok(result.clauses.some((clause) => clause.number === '1' && clause.fileName === file.name));
  assert.equal(indexClauses(result).size, 3);
});
