import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { parseDocx, indexClauses } from '../src/parse/docx.js';
import { extractUnits, extractFunctions, diffUnits } from '../src/analysis/units.js';
import { diffFunctions, findDuplicates, findNormativeGaps } from '../src/analysis/diff.js';

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data');

/** Один разбор на весь файл — парсинг двух .docx занимает ~150 мс. */
const analysis = await (async () => {
  const before = await parseDocx(await readFile(join(dataDir, 'polozhenie_red8_before.docx')), 'red8');
  const after = await parseDocx(await readFile(join(dataDir, 'polozhenie_red9_after.docx')), 'red9');
  const clauseIndex = indexClauses(before, after);
  const unitsBefore = extractUnits(before);
  const unitsAfter = extractUnits(after);
  const functionsBefore = extractFunctions(before, unitsBefore);
  const functionsAfter = extractFunctions(after, unitsAfter);
  return {
    clauseIndex,
    units: diffUnits(unitsBefore, unitsAfter, clauseIndex),
    functions: diffFunctions(functionsBefore, functionsAfter, clauseIndex),
    duplicates: findDuplicates(functionsAfter, clauseIndex),
    gaps: findNormativeGaps(diffUnits(unitsBefore, unitsAfter, clauseIndex), functionsAfter, clauseIndex),
  };
})();

const find = (change, number) =>
  analysis.functions.find(
    (f) => f.change === change && [...f.evidenceBefore, ...f.evidenceAfter].some((e) => e.number === number),
  );

test('must have 1: созданные и сохранённые подразделения определены верно', () => {
  const byAbbr = Object.fromEntries(analysis.units.map((u) => [u.abbr, u.status]));
  assert.equal(byAbbr.ДИТААД, 'created');
  assert.equal(byAbbr.ДОА, 'created');
  assert.equal(byAbbr.ДНМ, 'kept');
  assert.equal(byAbbr.ДККМ, 'kept');
  assert.equal(analysis.units.length, 4);
});

test('must have 2: перенос функции «Карта гарантий» от ДНМ к ДИТААД/ДОА', () => {
  const moved = find('moved', '5.4.4б');
  assert.ok(moved, 'перенос п. 5.4.4б не обнаружен');
  assert.equal(moved.ownerBefore, 'ДНМ');
  assert.equal(moved.ownerAfter, 'ДИТААД, ДОА');
  assert.match(moved.text, /Карты гарантий/);
  assert.equal(moved.evidenceAfter[0].number, '5.3.3б');
});

test('must have 2: перенос функций от ДККМ к ДНМ определён как перенос, а не потеря', () => {
  for (const number of ['5.5.4', '5.5.10']) {
    const moved = find('moved', number);
    assert.ok(moved, `п. ${number} должен быть классифицирован как moved`);
    assert.equal(moved.ownerBefore, 'ДККМ');
    assert.equal(moved.ownerAfter, 'ДНМ');
  }
});

test('отрицательный тест: сквозная перенумерация не порождает ложных потерь', () => {
  // В редакции 9 исчез пункт 5.11, а блоки 5.6 и 5.7 объединены в один.
  // Сравнение по номерам дало бы 14+ «потерь»; сравнение по тексту — единицы.
  const lost = analysis.functions.filter((f) => f.change === 'lost');
  assert.ok(lost.length <= 6, `ожидалось не более 6 потерь, получено ${lost.length}`);

  // Права директоров переехали в общий пункт 5.6 и потерями считаться не должны.
  for (const number of ['5.6.4', '5.6.6', '5.7.3', '5.7.4']) {
    assert.equal(find('lost', number), undefined, `п. ${number} ошибочно помечен как потерянный`);
  }
});

test('must have 3: дублирование между подразделениями обнаружено', () => {
  assert.ok(analysis.duplicates.length >= 5, `ожидалось >=5 групп дублирования, получено ${analysis.duplicates.length}`);

  const vnd = analysis.duplicates.find((d) => /разработке ВНД/i.test(d.text));
  assert.ok(vnd, 'дублирование «участвуют в разработке ВНД БВА» не обнаружено');
  assert.ok(vnd.owners.length >= 2, 'дублирование должно затрагивать разные подразделения');
});

test('дублированием не считается один пункт, закреплённый за двумя подразделениями', () => {
  // Пункт 5.3.x относится сразу к ДИТААД и ДОА — это оформление документа.
  for (const dup of analysis.duplicates) {
    const refs = new Set(dup.evidence.map((e) => e.ref));
    assert.ok(refs.size >= 2, `группа дублирования должна ссылаться на разные пункты: ${dup.text.slice(0, 40)}`);
  }
});

test('находка сверх ТЗ: функции созданных департаментов нормативно не закреплены', () => {
  const titles = analysis.gaps.map((g) => g.title).join(' | ');
  assert.match(titles, /ДИТААД/);
  assert.match(titles, /ДОА/);
});

test('ограничение п. 9 ТЗ: каждый вывод имеет подтверждающий источник', () => {
  for (const f of analysis.functions) {
    const all = [...f.evidenceBefore, ...f.evidenceAfter];
    assert.ok(all.length > 0, 'вывод без источника недопустим');
    for (const e of all) {
      assert.ok(analysis.clauseIndex.has(e.ref), `ссылка ${e.ref} не существует в документах`);
      assert.equal(e.text, analysis.clauseIndex.get(e.ref).text, 'текст цитаты должен браться из парсера');
    }
  }
});
