import test from 'node:test';
import assert from 'node:assert/strict';
import { diffFunctions, findDuplicates, findNormativeGaps } from '../src/analysis/diff.js';
import { buildPlan } from '../src/planning.js';

const entry = (ref, owner, text, scope = 'unit') => ({ ref, docId: ref.split('#')[0], number: ref.split('#')[1], owner, text, scope });
const indexOf = (entries) => new Map(entries.map((e) => [e.ref, e]));

test('Равные соответствия не оставляют отдельный новый пункт ошибочно добавленным', () => {
  const before = [
    entry('red8#1', 'ОК', 'Подготовка ежеквартальных отчетов для совета директоров.'),
    entry('red8#2', 'ОК', 'Подготовка ежегодных отчетов для совета директоров.'),
  ];
  const after = [
    entry('red9#1', 'ОК', 'Подготовка ежеквартальных отчетов для совета директоров.'),
    entry('red9#2', 'ОК', 'Подготовка годовых отчетов для совета директоров.'),
  ];
  for (const orderedAfter of [after, [...after].reverse()]) {
    const result = diffFunctions(before, orderedAfter, indexOf([...before, ...after]));
    assert.deepEqual(result.map((f) => [f.change, f.evidenceBefore[0].ref, f.evidenceAfter[0].ref]), [
      ['kept', 'red8#1', 'red9#1'], ['reworded', 'red8#2', 'red9#2'],
    ]);
  }
});

test('Объединение двух обязанностей в один пункт не создаёт ложную утрату', () => {
  const before = [
    entry('red8#1', 'ОК', 'Проверяет качество аудиторских работ.'),
    entry('red8#2', 'ОК', 'Контролирует исполнение договоров поставщиками.'),
  ];
  const after = [entry('red9#1', 'ОК', 'Проверяет качество аудиторских работ; контролирует исполнение договоров поставщиками.')];
  const result = diffFunctions(before, after, indexOf([...before, ...after]));
  assert.equal(result.length, 2);
  assert.ok(result.every((f) => f.change === 'reworded'));
  assert.ok(result.every((f) => f.evidenceAfter[0].ref === 'red9#1'));
});

test('Пересечения A–B и B–C сохраняются отдельно без вымышленной связи A–C', () => {
  const entries = [
    entry('red9#1', 'A', 'alpha beta gamma delta'),
    entry('red9#2', 'B', 'alpha beta gamma epsilon'),
    entry('red9#3', 'C', 'beta gamma epsilon zeta'),
  ];
  for (const ordered of [entries, [...entries].reverse()]) {
    const found = findDuplicates(ordered, indexOf(entries));
    assert.deepEqual(found.map((d) => d.evidence.map((e) => e.ref).sort().join(',')).sort(), [
      'red9#1,red9#2', 'red9#2,red9#3',
    ]);
    assert.ok(found.every((d) => d.owners.length === 2 && d.evidence.length === 2));
  }
});

test('Повторные владельцы одного пункта не дублируют ссылки; один владелец не создаёт пересечения', () => {
  const text = 'Проверяет качество исполнения договоров поставщиками.';
  const entries = [entry('red9#1', 'A', text), entry('red9#1', 'B', text), entry('red9#2', 'C', text)];
  const [found] = findDuplicates(entries, indexOf(entries));
  assert.deepEqual(found.evidence.map((e) => e.ref), ['red9#1', 'red9#2']);
  assert.deepEqual(found.owners, ['A', 'B', 'C']);
  assert.deepEqual(findDuplicates(entries.slice(0, 2), indexOf(entries)), []);
  assert.deepEqual(findDuplicates([entry('red9#1', 'A', text), entry('red9#2', 'A', text)], new Map()), []);
});

test('Подразделение без найденных функций можно отправить на согласование с источником создания', () => {
  const creation = { ref: 'red9#1', docId: 'red9', number: '1', text: 'Создать отдел контроля (ОК).' };
  const unit = { name: 'Отдел контроля', abbr: 'ОК', status: 'created', evidence: [creation], note: null };
  const functions = [entry('red9#2', 'Блок', 'Выполняет аудит финансовой отчетности организации.', 'org')];
  const gaps = findNormativeGaps([unit], functions, indexOf(functions));
  assert.equal(gaps.length, 1);
  assert.deepEqual(gaps[0].evidence.map((e) => e.ref), [creation.ref, functions[0].ref]);
  assert.deepEqual(gaps[0].evidence[0], creation);
  assert.match(gaps[0].detail, /не найдены функции/);
  const report = { meta: { before: {}, after: {} }, units: [unit], functions: [], gaps, conflicts: [], duplicates: [] };
  const plan = buildPlan(report);
  const reviewed = buildPlan(report, [{
    caseId: plan.cases[0].id, action: 'escalate', owner: '',
    note: 'Согласовать перечень функций созданного подразделения.', refs: [creation.ref],
  }]);
  assert.equal(reviewed.stats.reviewed, 1);
  assert.equal(reviewed.stats.escalated, 1);
  assert.deepEqual(reviewed.decisions[0].refs, [creation.ref]);
});
