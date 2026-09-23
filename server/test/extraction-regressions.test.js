import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ExcelJS from 'exceljs';
import { parseDocx, parsePlainText, indexClauses } from '../src/parse/docx.js';
import { parseDocument } from '../src/parse/document.js';
import { extractUnits, extractOwners, extractFunctions } from '../src/analysis/units.js';
import { ClauseRef } from '../src/types.js';

test('Repeated numbered duties are rejected before an owner or quote can be overwritten', () => {
  for (const repeatedText of ['Проверяет договоры.', 'Формирует план внутреннего аудита.']) {
    assert.throws(() => parsePlainText(`1. Отдел контроля (ОК).
2. Начальник отдела контроля (ОК) обязан:
2.1. Проверяет договоры.
2.1. ${repeatedText}`, 'red8'), /повторяется номер пункта 2\.1/u);
  }
  assert.throws(() => parsePlainText('1. Отдел контроля (ОК).\n1. Отдел аудита (ОА).', 'red8'), /повторяется номер пункта 1/u);
});

test('Only clear repeated section titles in a table of contents are skipped', () => {
  const doc = parsePlainText('1. Общие положения\n1.1. Проверяет отчёты.\n1. ОБЩИЕ ПОЛОЖЕНИЯ 1', 'red8');
  assert.equal(doc.clauses.length, 2);
  assert.equal(indexClauses(doc).get('red8#1').text, 'Общие положения');
  assert.throws(() => parsePlainText('1. Общие положения\n1. ПРОВЕРЯЕТ ДАННЫЕ СИСТЕМЫ 1', 'red8'), /повторяется номер/u);
  const duty = parsePlainText('1. ПРОВЕРЯЕТ ДАННЫЕ СИСТЕМЫ 1', 'red8');
  assert.equal(duty.clauses[0].text, 'ПРОВЕРЯЕТ ДАННЫЕ СИСТЕМЫ 1');
});

test('The source index rejects duplicate refs defensively even when texts match', () => {
  const doc = parsePlainText('1. Общие положения', 'red8');
  assert.throws(() => indexClauses(doc, doc), /Повторная ссылка на источник red8#1/u);
});

test('An explicit table of contents does not overwrite a heading merged with introductory text', () => {
  const doc = parsePlainText('4. Внутренний аудит При взаимодействии применяются следующие правила.\n4.1. Проверяет договоры.\nОглавление\n4. ВНУТРЕННИЙ АУДИТ 9\nПриложения', 'red8');
  assert.equal(doc.clauses.filter((c) => c.number === '4').length, 1);
  assert.match(doc.clauses[0].text, /При взаимодействии/);
});

test('Repeated lettered lists retain each exact source with a unique valid reference', () => {
  const doc = parsePlainText('9.3. План проверки:\nа. цели проверки;\nб. сроки проверки;\nа. цель и задачи объекта аудита;\nб. существенные риски объекта аудита;', 'red8');
  const index = indexClauses(doc);
  assert.equal(index.size, 5);
  assert.equal(index.get('red8#9.3а').text, 'цели проверки;');
  assert.equal(index.get('red8#9.3.r2а').text, 'цель и задачи объекта аудита;');
  assert.equal(index.get('red8#9.3.r2а').number, '9.3а');
  for (const clause of doc.clauses) assert.ok(ClauseRef.safeParse(clause.id).success);
});

test('A paragraph following a lettered duty stays in that duty evidence', () => {
  const doc = parsePlainText('3.1. Выполняет следующие функции:\nа. Согласует договоры.\nПри согласовании проверяет полномочия подписантов.\nб. Формирует отчёт.', 'red8');
  assert.equal(doc.clauses[0].text, 'Выполняет следующие функции:');
  assert.equal(doc.clauses[1].text, 'Согласует договоры. При согласовании проверяет полномочия подписантов.');
  assert.equal(doc.clauses[2].parent, 'red8#3.1');
});

test('Short duties under a known owner remain functions while headings and punctuation do not', () => {
  const doc = parsePlainText(`1. Отдел контроля (ОК).
2. Начальник отдела контроля (ОК) обязан:
2.1. Согласует договоры.
2.2. ;
2.3. Выполняет следующие задачи:
а. Ведёт реестр.
б. Хранит акты.`, 'red8');
  const functions = extractFunctions(doc, extractUnits(doc));
  assert.deepEqual(functions.map((item) => item.text), ['Согласует договоры.', 'Ведёт реестр.', 'Хранит акты.']);
  assert.ok(functions.every((item) => item.owner === 'ОК'));
});

test('A service name in a genitive owner header resolves without an abbreviation', () => {
  for (const title of ['Руководитель службы поддержки обязан:', 'Функции службы поддержки:']) {
    const doc = parsePlainText(`1. Служба поддержки.\n2. ${title}\n2.1. Обрабатывает обращения пользователей.`, 'red8');
    const units = extractUnits(doc);
    assert.deepEqual(extractOwners(doc, units).get('2').units, ['Служба поддержки']);
    assert.equal(extractFunctions(doc, units)[0].owner, 'Служба поддержки');
  }
});

test('Removing the generic service noun does not match an unrelated service', () => {
  const doc = parsePlainText('1. Служба поддержки.\n2. Служба безопасности.\n3. Руководитель службы поддержки обязан:\n3.1. Обрабатывает обращения пользователей.', 'red8');
  const units = extractUnits(doc);
  assert.deepEqual(extractOwners(doc, units).get('3').units, ['Служба поддержки']);
});

test('A generic department director heading does not assign functions to a service', () => {
  const doc = parsePlainText('1. Департамент контроля (ДК).\n2. Служба поддержки.\n3. Директоры департаментов обязаны:\n3.1. Проверять договоры.', 'red8');
  assert.deepEqual(extractOwners(doc, extractUnits(doc)).get('3').units, ['ДК']);
});

test('Repeated XLSX headers start a new owner context', async () => {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet('Функции').addRows([['Подразделение', 'Функция'], ['Отдел контроля', 'Проверяет договоры.'], ['Подразделение', 'Функция'], ['', 'Хранит архив протоколов.']]);
  const doc = await parseDocument(Buffer.from(await workbook.xlsx.writeBuffer()), 'red8', 'пример.xlsx');
  assert.equal(doc.diagnostics[0].ref, 'red8#s1.r4');
  assert.equal(extractFunctions(doc, extractUnits(doc)).length, 1);
});

test('An XLSX function with no owner remains a traceable source and diagnostic, not a guessed assignment', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Функции');
  sheet.addRows([['Подразделение', 'Функция'], ['', 'Обрабатывает обращения пользователей.'], ['Отдел контроля', 'Проверяет договоры.'], ['', 'Согласует акты.']]);
  const doc = await parseDocument(Buffer.from(await workbook.xlsx.writeBuffer()), 'red8', 'пример.xlsx');
  const orphan = indexClauses(doc).get('red8#s1.r2');
  assert.equal(orphan.text, 'Обрабатывает обращения пользователей.');
  assert.equal(orphan.unassignedFunction, true);
  assert.equal(orphan.functionOwner, undefined);
  assert.deepEqual(doc.diagnostics.map(({ code, ref }) => ({ code, ref })), [{ code: 'missing_function_owner', ref: orphan.id }]);
  const functions = extractFunctions(doc, extractUnits(doc));
  assert.deepEqual(functions.map((item) => item.text), ['Проверяет договоры.', 'Согласует акты.']);
  assert.ok(functions.every((item) => item.owner === 'Отдел контроля'));
});

test('Organizer documents preserve all source occurrences and no duplicate references', async () => {
  for (const [name, id] of [['polozhenie_red8_before.docx', 'red8'], ['polozhenie_red9_after.docx', 'red9']]) {
    const doc = await parseDocx(await readFile(new URL(`../../data/${name}`, import.meta.url)), id);
    assert.equal(indexClauses(doc).size, doc.clauses.length);
    assert.ok(doc.clauses.some((clause) => clause.id === `${id}#9.3.r2а`));
    assert.ok(extractFunctions(doc, extractUnits(doc)).length > 50);
  }
});
