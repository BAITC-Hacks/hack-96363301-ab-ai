import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { parsePlainText, indexClauses } from '../src/parse/docx.js';
import { extractUnits, mergeUnits, extractOwners, extractFunctions } from '../src/analysis/units.js';
import { findNormativeGaps } from '../src/analysis/diff.js';
import { describeCoverage } from '../src/analysis/quality.js';
import { analyze } from '../src/pipeline.js';
process.env.OPENAI_API_KEY = '';

function doc(fileId, text) {
  const parsed = parsePlainText(text, 'red9');
  return { ...parsed, fileId, fileName: `${fileId}.docx`, clauses: parsed.clauses.map((c) => ({ ...c, id: c.id.replace('#', `#${fileId}.`), fileId, fileName: `${fileId}.docx` })) };
}
async function xlsx(name, rows) {
  const book = new ExcelJS.Workbook();
  book.addWorksheet('Функции').addRows([['Подразделение', 'Функция'], ...rows]);
  return { name, buffer: Buffer.from(await book.xlsx.writeBuffer()) };
}

test('Состав из разных файлов объединяется с сохранением всех определений и полной аббревиатуры', () => {
  const first = doc('f1', '1. Отдел контроля.');
  const second = doc('f2', '1. Отдел контроля (ОК).\n2. Отдел аудита (ОА).');
  const units = mergeUnits([first, second].flatMap(extractUnits));
  assert.equal(units.length, 2);
  assert.equal(units[0].abbr, 'ОК');
  assert.deepEqual(units[0].refs, ['red9#f1.1', 'red9#f2.1']);
});

test('Противоречивые определения внутри редакции не схлопываются в одно подразделение', () => {
  for (const texts of [
    ['1. Отдел контроля (ОК).', '1. Отдел качества (ОК).'],
    ['1. Отдел контроля (ОК).', '1. Отдел контроля (ДК).'],
  ]) assert.throws(() => mergeUnits(texts.flatMap((text, i) => extractUnits(doc(`f${i}`, text)))), /Неоднозначное подразделение.*файле/);
});

test('Общий заголовок ограничен составом своего файла, явное имя разрешается через весь комплект', () => {
  const first = doc('f1', '1. Департамент аудита (ДА).\n2. Директоры департаментов обязаны:\n2.1. Согласует договоры.');
  const second = doc('f2', '1. Департамент контроля (ДК).\n2. Директор ДК:\n2.1. Хранит архив.');
  const third = doc('f3', '2. Директор ДК:\n2.1. Проверяет отчётность.');
  const units = mergeUnits([first, second, third].flatMap(extractUnits));
  assert.deepEqual(extractOwners(first, units).get('2').units, ['ДА']);
  assert.deepEqual(extractOwners(third, units).get('2').units, ['ДК']);
  const functions = [first, second, third].flatMap((d) => extractFunctions(d, units));
  assert.deepEqual(functions.map((f) => f.owner), ['ДА', 'ДК', 'ДК']);
  assert.equal(new Set(functions.map((f) => f.ref)).size, 3);
  const coverage = describeCoverage(third, units, extractFunctions(third, units), third.fileName);
  assert.equal(coverage.document.units, 0);
  assert.equal(coverage.document.functionClauses, 1);
});

test('Общий заголовок без локального состава сохраняет роль с предупреждением вместо чужих владельцев', () => {
  const first = doc('f1', '1. Департамент аудита (ДА).');
  const second = doc('f2', '2. Директоры департаментов обязаны:\n2.1. Согласует договоры.');
  const units = extractUnits(first);
  const functions = extractFunctions(second, units);
  assert.ok(functions[0].owner.startsWith('Роль:'));
  assert.equal(describeCoverage(second, units, functions, second.fileName).warnings[0].code, 'role_owner');
});

test('Общие функции чужого положения не создают нормативный пробел', () => {
  const definitions = doc('f1', '1. Отдел контроля (ОК).\n2. Начальник ОК:\n2.1. Согласует договоры.');
  const unrelated = doc('f2', '1. Функции организации:\n1.1. Формирует отчётность.');
  const units = extractUnits(definitions);
  const index = indexClauses(definitions, unrelated);
  const clause = definitions.clauses[0];
  const unitDiff = [{ ...units[0], status: 'created', evidence: [{ ...clause, ref: clause.id }] }];
  const functions = [definitions, unrelated].flatMap((d) => extractFunctions(d, units));
  assert.deepEqual(findNormativeGaps(unitDiff, functions, index), []);
});

test('Таблица состава без функций допустима как отдельное приложение комплекта', async () => {
  const structure = await xlsx('Состав.xlsx', [['Отдел контроля (ОК)', '']]);
  const duties = await xlsx('Обязанности.xlsx', [['Отдел контроля', 'Согласует договоры.']]);
  const report = await analyze({ beforeFiles: [structure, duties], afterFiles: [duties, structure] });
  assert.equal(report.units.length, 1);
  assert.equal(report.units[0].abbr, 'ОК');
  assert.equal(report.units[0].evidence.length, 4);
  assert.equal(report.functions.length, 1);
  assert.equal(report.functions[0].ownerAfter, 'ОК');
  assert.equal(report.functions[0].evidenceAfter[0].fileName, 'Обязанности.xlsx');
  assert.equal(report.quality.documents.length, 4);
});

test('Неиспользованные адресуемые файлы видны в паспорте, файл без адресов не маскируется', () => {
  const extra = doc('f1', '1. Приказ вступает в силу с даты подписания.');
  assert.equal(describeCoverage(extra, [], [], extra.fileName).warnings[0].code, 'unrecognized_document');
  const unnumbered = doc('f2', 'Приложение без нумерованных пунктов.');
  assert.throws(() => describeCoverage(unnumbered, [], [], unnumbered.fileName), /f2.docx.*не найдены адресуемые/);
});

test('Общий лимит обоих комплектов проверяется до разбора', async () => {
  const oversized = { name: 'test.xlsx', buffer: Buffer.alloc(18 * 1024 * 1024) };
  await assert.rejects(analyze({ beforeFiles: Array(3).fill(oversized), afterFiles: Array(3).fill(oversized) }), /Общий размер.*100 МБ/);
});

test('Аббревиатура в отдельной таблице обязанностей разрешается в полное определение без потери источников', async () => {
  const structure = await xlsx('Состав.xlsx', [['Отдел контроля (ОК)', '']]);
  const duties = await xlsx('Обязанности.xlsx', [['ОК', 'Согласует договоры.']]);
  for (const files of [[structure, duties], [duties, structure]]) {
    const report = await analyze({ beforeFiles: files, afterFiles: files });
    assert.equal(report.units.length, 1);
    assert.equal(report.units[0].name, 'Отдел контроля');
    assert.equal(report.units[0].abbr, 'ОК');
    assert.equal(report.units[0].evidence.length, 4);
    assert.deepEqual(new Set(report.units[0].evidence.map((e) => e.fileName)), new Set(['Состав.xlsx', 'Обязанности.xlsx']));
    assert.equal(report.functions[0].ownerAfter, 'ОК');
  }
});

test('Явная аббревиатура и более полное название исключают вложенное название чужого владельца', () => {
  const units = extractUnits(doc('f1', '1. Отдел контроля (ОК).\n2. Отдел контроля качества (ОКК).'));
  for (const title of ['Начальник отдела контроля качества (ОКК) обязан:', 'Начальник отдела контроля качества обязан:']) {
    const duties = doc('f2', `1. ${title}\n1.1. Согласует договоры.`);
    assert.deepEqual(extractFunctions(duties, units).map((f) => f.owner), ['ОКК']);
  }
});
