import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { analyze } from '../src/pipeline.js';
import { diffFunctions } from '../src/analysis/diff.js';
import { parsePlainText } from '../src/parse/docx.js';
import { extractFunctions, extractUnits } from '../src/analysis/units.js';

process.env.OPENAI_API_KEY = '';
test('Независимый XLSX-комплект: точные статусы, передача, утрата и новая дублирующая обязанность', async () => {
  const fixture = JSON.parse(await readFile(new URL('../../fixtures/independent-example.json', import.meta.url), 'utf8'));
  const report = await analyze({
    beforeBuffer: await readFile(new URL('../../data/example_before.xlsx', import.meta.url)), beforeName: 'before.xlsx',
    afterBuffer: await readFile(new URL('../../data/example_after.xlsx', import.meta.url)), afterName: 'after.xlsx',
  });
  assert.deepEqual(Object.fromEntries(report.units.map((u) => [u.abbr, u.status])), fixture.expected.units);
  assert.deepEqual(report.functions.reduce((counts, f) => { counts[f.change] = (counts[f.change] || 0) + 1; return counts; }, {}), fixture.expected.functions);
  assert.equal(report.duplicates.length, fixture.expected.duplicates);
  assert.equal(report.conflicts.length, fixture.expected.conflicts);
  const moved = report.functions.find((f) => f.change === 'moved');
  assert.equal(moved.ownerBefore, 'ОД');
  assert.equal(moved.ownerAfter, 'ОК');
  assert.equal(moved.evidenceBefore[0].number, 'Функции, строка 3');
  assert.equal(moved.evidenceAfter[0].number, 'Функции, строка 3');
  assert.match(report.functions.find((f) => f.change === 'lost').text, /бумажный архив/);
  assert.deepEqual(report.duplicates[0].owners, ['ОК', 'ОА']);
});

const entry = (ref, owner, text = 'Проверяет качество исполнения договоров поставщиками.') => ({ ref, docId: ref.split('#')[0], number: ref.split('#')[1], owner, text, scope: 'unit' });
const indexOf = (entries) => new Map(entries.map((e) => [e.ref, { ...e, id: e.ref }]));

test('Одинаковый текст сопоставляется с прежним владельцем независимо от порядка строк', () => {
  const b = entry('red8#1', 'А'), first = entry('red9#1', 'Б'), second = entry('red9#2', 'А');
  const result = diffFunctions([b], [first, second], indexOf([b, first, second]));
  assert.equal(result[0].change, 'kept');
  assert.equal(result[0].ownerAfter, 'А');
  assert.equal(result[1].change, 'added');
  assert.equal(result[1].ownerAfter, 'Б');
});

test('Частичное изменение владельцев не скрывается как неизменённая функция', () => {
  const b = [entry('red8#1', 'А'), entry('red8#1', 'Б')];
  const a = [entry('red9#1', 'А'), entry('red9#1', 'В')];
  assert.equal(diffFunctions(b, a, indexOf([...b, ...a]))[0].change, 'moved');
});

test('Вводная к списку исключается, самостоятельное действие в составном пункте сохраняется', () => {
  const doc = parsePlainText(`1. Отдел контроля (ОК).
2. Начальник отдела контроля:
2.1. Взаимодействует с подразделениями предприятия в части:
а. Проверяет качество исполнения договоров поставщиками.
2.2. Готовит план проверок, взаимодействует с подразделениями в части:
а. Запрашивает документы для проведения аудиторских проверок.`, 'red8');
  const functions = extractFunctions(doc, extractUnits(doc));
  assert.ok(!functions.some((f) => f.number === '2.1'));
  assert.ok(functions.some((f) => f.number === '2.1а'));
  assert.ok(functions.some((f) => f.number === '2.2'));
});

test('Кандидаты на соответствие не превращаются в подтверждённые источники передачи', () => {
  const b = entry('red8#1', 'А', 'Участвует в разработке проектов документации, регламентирующей работу БВА.');
  const a = entry('red9#1', 'А', 'Участвует в разработке ВНД БВА.');
  const [result] = diffFunctions([b], [a], indexOf([b, a]));
  assert.equal(result.change, 'lost');
  assert.deepEqual(result.evidenceAfter, []);
  assert.equal(result.reviewCandidates[0].evidence.ref, a.ref);
});
