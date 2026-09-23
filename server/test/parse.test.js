import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { parseDocx, parsePlainText, indexClauses, verifyCitations } from '../src/parse/docx.js';

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data');

const load = async (name, id) => parseDocx(await readFile(join(dataDir, name)), id);

test('нумерованные пункты разбираются со стабильными идентификаторами', () => {
  const { clauses } = parsePlainText(
    ['3.4. БВА состоит из следующих структурных подразделений:', 'а. Департамент операционного аудита (ДОА).'].join('\n'),
    'red9',
  );
  assert.equal(clauses[0].id, 'red9#3.4');
  assert.equal(clauses[1].id, 'red9#3.4а');
  assert.equal(clauses[1].parent, 'red9#3.4');
});

test('слипшиеся в один абзац пункты разделяются обратно', () => {
  const { clauses } = parsePlainText('3.9. Рабочие места в филиалах. 3.10.Работники могут выполнять функции вне офиса.', 'red9');
  assert.equal(clauses.length, 2);
  assert.equal(clauses[1].number, '3.10');
});

test('оглавление в конце документа не создаёт дублей разделов', async () => {
  const doc = await load('polozhenie_red9_after.docx', 'red9');
  const numbers = doc.sections.map((s) => s.number);
  assert.deepEqual(numbers, [...new Set(numbers)], 'номера разделов не должны повторяться');
});

test('реальные документы разбираются и содержат состав подразделений', async () => {
  const before = await load('polozhenie_red8_before.docx', 'red8');
  const after = await load('polozhenie_red9_after.docx', 'red9');

  assert.ok(before.clauses.length > 400, `ожидалось >400 пунктов, получено ${before.clauses.length}`);
  assert.ok(after.clauses.length > 400, `ожидалось >400 пунктов, получено ${after.clauses.length}`);

  const units = (doc) => doc.clauses.filter((c) => c.number && /^3\.4[а-я]$/.test(c.number)).map((c) => c.text);

  assert.equal(units(before).length, 2, 'в редакции 8 у БВА два департамента');
  assert.equal(units(after).length, 4, 'в редакции 9 у БВА четыре департамента');
  assert.ok(units(after).some((t) => t.includes('ДИТААД')), 'ДИТААД создан в редакции 9');
  assert.ok(units(after).some((t) => t.includes('ДОА')), 'ДОА создан в редакции 9');
});

test('ссылка на несуществующий пункт отбраковывается', async () => {
  const before = await load('polozhenie_red8_before.docx', 'red8');
  const after = await load('polozhenie_red9_after.docx', 'red9');
  const index = indexClauses(before, after);

  const { valid, invalid } = verifyCitations(['red9#3.4а', 'red8#5.4.4', 'red9#99.99'], index);
  assert.equal(valid.length, 2);
  assert.deepEqual(invalid, ['red9#99.99']);
});
