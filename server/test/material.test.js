import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectMaterialChanges } from '../src/analysis/material.js';

function inspect(before, after) {
  const result = inspectMaterialChanges(before, after);
  for (const finding of result) {
    assert.ok(before.includes(finding.beforeFragment), 'before fragment must be an exact source substring');
    assert.ok(after.includes(finding.afterFragment), 'after fragment must be an exact source substring');
    assert.ok(finding.beforeFragment && finding.afterFragment, 'both versions must supply evidence');
  }
  return result;
}

test('Adding or removing negation is visible even when the rest of a long function is identical', () => {
  const before = 'Департамент не осуществляет согласование договоров с поставщиками в рамках закупочных процедур Общества.';
  const after = 'Департамент осуществляет согласование договоров с поставщиками в рамках закупочных процедур Общества.';
  assert.deepEqual(inspect(before, after).map((item) => item.kind), ['prohibition']);
  assert.match(inspect(after, before)[0].afterFragment, /^не осуществляет/u);
});

test('Plural and singular predicate forms retain their action identity', () => {
  const result = inspect('Отдел не утверждает результаты проверки качества.', 'Отделы утверждают результаты проверки качества.');
  assert.equal(result.length, 1);
  assert.equal(result[0].kind, 'prohibition');
  const withInfinitive = inspect('Не допускается самостоятельно подписывать акты.', 'Допускается самостоятельно подписывать акты.');
  assert.deepEqual(withInfinitive.map((item) => item.kind), ['prohibition']);
});

test('An existing unchanged negation does not create a warning on unrelated wording changes', () => {
  assert.deepEqual(inspect('Отдел не согласовывает договоры поставщиков.', 'Отдел не согласовывает договоры новых поставщиков.'), []);
});

test('Comparative and additive не phrases never become prohibitions', () => {
  for (const phrase of ['не позднее', 'не реже', 'не только', 'не менее']) {
    const result = inspect(`Отдел ${phrase} осуществляет контроль исполнения договоров.`, 'Отдел осуществляет контроль исполнения договоров.');
    assert.ok(!result.some((item) => item.kind === 'prohibition'), phrase);
  }
});

test('Negation in a separate sentence must not attach to the next predicate', () => {
  assert.deepEqual(inspect('Ответ: не. Проводит проверку исполнения договоров.', 'Ответ: да. Проводит проверку исполнения договоров.'), []);
});

test('Modal obligation reduced to permission is anchored to the same action', () => {
  const result = inspect('Отдел обязан предоставлять отчёт о рисках Совету.', 'Отдел вправе предоставлять отчёт о рисках Совету.');
  assert.equal(result.length, 1);
  assert.equal(result[0].kind, 'obligation');
  assert.match(result[0].beforeFragment, /^обязан предоставлять/u);
  assert.match(result[0].afterFragment, /^вправе предоставлять/u);
});

test('Plural obligation/permission and negated obligation are compared', () => {
  assert.equal(inspect('Отделы должны проверять акты.', 'Отделы могут проверять акты.')[0].kind, 'obligation');
  assert.equal(inspect('Отделы обязаны проверять акты.', 'Отделы не обязаны проверять акты.')[0].kind, 'obligation');
  const changedNegativeDuty = inspect('Отделы не обязаны проверять акты.', 'Отделы не должны проверять акты.');
  assert.deepEqual(changedNegativeDuty.map((item) => item.kind), ['obligation']);
  assert.equal(changedNegativeDuty[0].beforeFragment, 'не обязаны проверять акты');
  assert.equal(changedNegativeDuty[0].afterFragment, 'не должны проверять акты');
});

test('A prohibition expressed by a required negative infinitive stays the same when permission is denied', () => {
  const before = 'Отдел обязан не предоставлять документы комиссии.';
  const after = 'Отдел не вправе предоставлять документы комиссии.';
  assert.deepEqual(inspect(before, after), []);
  assert.deepEqual(inspect(after, before), []);
});

test('Negating a required infinitive creates one warning with complete modal evidence', () => {
  const before = 'Отдел обязан предоставлять документы комиссии.';
  const after = 'Отдел обязан не предоставлять документы комиссии.';
  const result = inspect(before, after);
  assert.deepEqual(result.map((item) => item.kind), ['prohibition']);
  assert.equal(result[0].beforeFragment, 'обязан предоставлять документы комиссии');
  assert.equal(result[0].afterFragment, 'обязан не предоставлять документы комиссии');
  assert.equal(inspect(after, before).length, 1);
});

test('Equivalent modal words and different actions are not treated as weakened obligations', () => {
  assert.deepEqual(inspect('Отдел должен проверять акты.', 'Отдел обязан проверять акты.'), []);
  assert.deepEqual(inspect('Отдел обязан проверять акты.', 'Отдел вправе подписывать акты.'), []);
});

test('Explicit prohibition versus permission and passive negation are detected', () => {
  assert.equal(inspect('Запрещается самостоятельно подписывать акты.', 'Разрешается самостоятельно подписывать акты.')[0].kind, 'prohibition');
  const result = inspect('Совмещение функций не допускается.', 'Совмещение функций допускается.');
  assert.equal(result.length, 1);
  assert.equal(result[0].kind, 'prohibition');
});

test('Monthly, quarterly and yearly periods are compared in either direction without a risk claim', () => {
  for (const [before, after] of [['ежемесячно', 'ежегодно'], ['ежегодно', 'ежеквартально'], ['ежеквартально', 'ежемесячно']]) {
    const result = inspect(`Отдел ${before} направляет отчёт о рисках.`, `Отдел ${after} направляет отчёт о рисках.`);
    assert.equal(result.length, 1);
    assert.equal(result[0].kind, 'frequency');
    assert.equal(result[0].beforeFragment, before);
    assert.equal(result[0].afterFragment, after);
    assert.ok(!/риск|ухудш|улучш/u.test(result[0].detail));
  }
});

test('An explicit deadline including working/calendar days supplies full evidence', () => {
  const result = inspect('Предоставляет заключение в течение 5 рабочих дней.', 'Предоставляет заключение в течение 10 календарных дней.');
  assert.equal(result.length, 1);
  assert.equal(result[0].kind, 'frequency');
  assert.equal(result[0].beforeFragment, 'в течение 5 рабочих дней');
  assert.equal(result[0].afterFragment, 'в течение 10 календарных дней');
});

test('Deadline modifiers are preserved, including не позднее which is not a prohibition', () => {
  const result = inspect('Направляет отчёт не позднее 5 дней.', 'Направляет отчёт не позднее 10 дней.');
  assert.deepEqual(result.map((item) => item.kind), ['frequency']);
  assert.equal(result[0].beforeFragment, 'не позднее 5 дней');
});

test('Equivalent expressed periods do not create changes', () => {
  assert.deepEqual(inspect('Предоставляет отчёт ежеквартально.', 'Предоставляет отчёт каждые 3 месяца.'), []);
  assert.deepEqual(inspect('Предоставляет отчёт ежегодно.', 'Предоставляет отчёт раз в 12 месяцев.'), []);
  assert.deepEqual(inspect('Предоставляет отчёт раз в 1 год.', 'Предоставляет отчёт раз в 4 квартала.'), []);
});

test('Random numeric values, clause numbers and percentages are not deadlines', () => {
  assert.deepEqual(inspect('3.4. Проверяет 5 договоров на сумму 100 рублей с охватом 20 процентов.', '3.5. Проверяет 10 договоров на сумму 200 рублей с охватом 30 процентов.'), []);
  assert.deepEqual(inspect('3.4. Проверяет договоры в течение срока.', '5.8. Проверяет договоры в течение срока.'), []);
});

test('A changed frequency on a different action is not paired', () => {
  assert.deepEqual(inspect('Ежемесячно направляет отчёт.', 'Ежеквартально проверяет отчёт.'), []);
});

test('Independent actions with exchanged timing are detected separately', () => {
  const result = inspect('Ежемесячно направляет отчёт. Ежегодно проверяет договоры.', 'Ежегодно направляет отчёт. Ежемесячно проверяет договоры.');
  assert.equal(result.length, 2);
  assert.ok(result.every((item) => item.kind === 'frequency'));
});

test('Ambiguous repeated actions are skipped rather than compared by document order', () => {
  const result = inspect('Ежемесячно направляет отчёт. Ежегодно направляет акт.', 'Ежегодно направляет отчёт. Ежемесячно направляет акт.');
  assert.deepEqual(result, []);
});

test('A single period marker cannot be paired with the same repeated action on a different object', () => {
  const before = 'Ежемесячно направляет отчёт. Направляет акт.';
  const after = 'Направляет отчёт. Ежегодно направляет акт.';
  assert.deepEqual(inspect(before, after), []);
  assert.deepEqual(inspect(after, before), []);
});

test('A single scope marker cannot be transferred between ambiguous repeated actions', () => {
  const before = 'Проверяет все заявки отделов. Проверяет заявки филиалов.';
  const after = 'Проверяет заявки отделов. Проверяет отдельные заявки филиалов.';
  assert.deepEqual(inspect(before, after), []);
  assert.deepEqual(inspect(after, before), []);
});

test('A scope marker is compared only for the same action and immediate object', () => {
  assert.equal(inspect('Проверяет все договоры поставщиков.', 'Проверяет только договоры поставщиков.')[0].kind, 'scope');
  assert.equal(inspect('Проверяет все заявки на доступ.', 'Проверяет отдельные заявки на доступ.')[0].kind, 'scope');
  assert.deepEqual(inspect('Проверяет все договоры поставщиков.', 'Проверяет только акты поставщиков.'), []);
  assert.deepEqual(inspect('Проверяет не только договоры поставщиков.', 'Проверяет все договоры поставщиков.'), []);
});

test('Irregular infinitives preserve the obligation comparison', () => {
  const result = inspect('Подразделение обязано вести единый реестр выявленных нарушений и контролировать сроки их устранения.', 'Подразделение может вести единый реестр выявленных нарушений и контролировать сроки их устранения.');
  assert.deepEqual(result.map((item) => item.kind), ['obligation']);
});

test('Case, ё and whitespace remain exact in returned fragments', () => {
  const result = inspect('НЕ\nОСУЩЕСТВЛЯЕТ согласование проектов.', 'Осуществляет согласование проектов.');
  // A newline can delimit separate list items; the conservative detector skips it.
  assert.deepEqual(result, []);
  const sameLine = inspect('НЕ  ОСУЩЕСТВЛЯЕТ согласование проектов.', 'Осуществляет согласование проектов.');
  assert.equal(sameLine[0].beforeFragment, 'НЕ  ОСУЩЕСТВЛЯЕТ согласование проектов');
});

test('Empty and identical inputs have no findings', () => {
  for (const value of ['', null, undefined, 4]) assert.deepEqual(inspectMaterialChanges(value, 'Проверяет договоры.'), []);
  assert.deepEqual(inspect('Отдел проверяет отчёт.', 'ОТДЕЛ ПРОВЕРЯЕТ ОТЧЕТ.'), []);
});
