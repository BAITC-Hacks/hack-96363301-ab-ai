import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewLostFunctions, SEMANTIC_MODEL, SEMANTIC_REVIEW_LIMITS, SEMANTIC_REVIEW_SCHEMA } from '../src/llm/semantic.js';
import { sourceEvidence } from '../src/parse/evidence.js';

const entry = (ref, text, owner = 'ОК', scope = 'unit') => ({ ref, text, owner, scope, docId: ref.split('#')[0], number: ref.split('#')[1] });
function input(before, after) {
  const clauseIndex = new Map([...before, ...after].map((item) => [item.ref, { ...item, id: item.ref,
    fileId: item.docId === 'red8' ? 'faaa' : 'fbbb', fileName: item.docId === 'red8' ? 'До.docx' : 'После.docx',
  }]));
  const uniqueBefore = [...new Map(before.map((item) => [item.ref, item])).values()];
  return {
    functions: uniqueBefore.map((item) => ({ change: 'lost', text: item.text, ownerBefore: item.owner, ownerAfter: null,
      evidenceBefore: [sourceEvidence(clauseIndex.get(item.ref))], evidenceAfter: [], similarity: 0, rationale: null,
    })),
    functionsBefore: before, functionsAfter: after, clauseIndex,
  };
}
const sample = () => input([entry('red8#1', 'Согласовывает закупочные заявки.')], [entry('red9#1', 'Визирует потребности снабжения.', 'ОС')]);
const none = (id) => ({ id, relation: 'none', afterRef: null, beforeFragment: null, afterFragment: null });
const pair = (payload, relation = 'equivalent', beforeIndex = 0, afterIndex = 0) => ({
  id: payload.lost[beforeIndex].id, afterRef: payload.after[afterIndex].evidence.ref, relation,
  beforeFragment: payload.lost[beforeIndex].evidence.text, afterFragment: payload.after[afterIndex].evidence.text,
});
const model = (respond, source = 'api') => async (options) => ({
  data: { items: respond(JSON.parse(options.user), options) }, source, durationMs: 7,
});

test('A deep paraphrase with zero lexical overlap enters the model pool and stays a candidate', async () => {
  const data = sample();
  const original = JSON.stringify({ functions: data.functions, before: data.functionsBefore, after: data.functionsAfter, clauses: [...data.clauseIndex] });
  const { review, step } = await reviewLostFunctions(data, model((payload, options) => {
    assert.equal(options.name, 'semantic-lost-v2');
    assert.equal(options.model, SEMANTIC_MODEL);
    assert.equal(options.maxCompletionTokens, 4096);
    assert.notEqual(options.schema, SEMANTIC_REVIEW_SCHEMA);
    const [paired, noneBranch] = options.schema.properties.items.items.anyOf;
    assert.deepEqual(paired.properties.id.enum, payload.lost.map((item) => item.id));
    assert.deepEqual(paired.properties.afterRef.enum, payload.after.map((item) => item.evidence.ref));
    assert.deepEqual(paired.properties.relation.enum, ['equivalent', 'changed']);
    for (const field of ['afterRef', 'beforeFragment', 'afterFragment']) assert.equal(noneBranch.properties[field].type, 'null');
    assert.equal(payload.after.length, 1);
    return [pair(payload)];
  }));
  assert.equal(review.status, 'completed');
  assert.equal(review.source, 'api');
  assert.equal(review.model, SEMANTIC_MODEL);
  assert.equal(step.model, SEMANTIC_MODEL);
  assert.equal(review.reviewed, 1);
  assert.equal(review.items[0].status, 'candidate');
  assert.equal(review.items[0].similarity, 0);
  assert.equal(review.items[0].ownerAfter, 'ОС');
  assert.equal(review.items[0].evidenceAfter.fileName, 'После.docx');
  assert.equal(review.items[0].evidenceAfter.text, data.clauseIndex.get('red9#1').text);
  assert.equal(step.citationsReturned, 1);
  assert.equal(step.citationsRejected, 0);
  assert.equal(data.functions[0].change, 'lost');
  assert.equal(JSON.stringify({ functions: data.functions, before: data.functionsBefore, after: data.functionsAfter, clauses: [...data.clauseIndex] }), original);
});

test('Local negation detection overrides the model equivalent relation', async () => {
  const data = input([entry('red8#1', 'Отдел не утверждает закупочные планы.')], [entry('red9#1', 'Отдел утверждает закупочные планы.')]);
  const { review } = await reviewLostFunctions(data, model((payload) => [pair(payload)]));
  assert.equal(review.items[0].status, 'meaning_changed');
  assert.equal(review.items[0].materialChanges[0].kind, 'prohibition');
  assert.equal(data.functions[0].change, 'lost');
});

test('A model-proposed meaning change remains visible even without a local wording rule', async () => {
  const { review } = await reviewLostFunctions(sample(), model((payload) => [pair(payload, 'changed')]));
  assert.equal(review.items[0].status, 'meaning_changed');
  assert.deepEqual(review.items[0].materialChanges, []);
});

test('Repeated references are grouped with every owner and quotes always come from the parser', async () => {
  const first = entry('red9#1', 'Визирует потребности снабжения.', 'ОС');
  const data = input([entry('red8#1', 'Согласовывает закупочные заявки.')], [first, { ...first, owner: 'ОА' }]);
  data.functionsAfter[0].text = 'Неистинный текст из промежуточного объекта.';
  const { review } = await reviewLostFunctions(data, model((payload) => {
    assert.equal(payload.after.length, 1);
    assert.deepEqual(payload.after[0].owners, ['ОС', 'ОА']);
    assert.equal(payload.after[0].evidence.text, 'Визирует потребности снабжения.');
    return [pair(payload)];
  }));
  assert.equal(review.afterTotal, 1);
  assert.equal(review.items[0].ownerAfter, 'ОС, ОА');
  assert.equal(review.items[0].evidenceAfter.text, 'Визирует потребности снабжения.');
});

test('A valid after reference from the wrong scope is rejected for that before item', async () => {
  const data = input([
    entry('red8#1', 'Согласовывает закупочные заявки.'), entry('red8#2', 'Осуществляет стратегическое планирование.', 'БВА', 'org'),
  ], [entry('red9#1', 'Визирует потребности снабжения.'), entry('red9#2', 'Формирует долгосрочные цели организации.', 'БВА', 'org')]);
  const { review, step } = await reviewLostFunctions(data, model((payload) => [pair(payload, 'equivalent', 0, 1), none(payload.lost[1].id)]));
  assert.equal(review.afterTotal, 2);
  assert.equal(review.items[0].status, 'unreviewed');
  assert.equal(review.items[1].status, 'not_found');
  assert.equal(step.citationsRejected, 1);
});

test('Unrelated scopes are not part of the search coverage', async () => {
  const data = sample();
  const foreign = entry('red9#2', 'Формирует стратегию развития компании.', 'БВА', 'org');
  data.functionsAfter.push(foreign);
  data.clauseIndex.set(foreign.ref, { ...foreign, id: foreign.ref });
  const { review } = await reviewLostFunctions(data, model((payload) => {
    assert.equal(payload.after.length, 1);
    return [pair(payload)];
  }));
  assert.equal(review.afterTotal, 1);
  assert.equal(review.limited, false);
});

test('Unknown refs, before-side refs, forged fragments and insufficient fragments cannot become evidence', async () => {
  const patches = [
    { afterRef: 'red9#999' }, { afterRef: 'red8#1' }, { afterRef: 'null', relation: 'none' },
    { beforeFragment: 'Фрагмент другого исходного документа' },
    { afterFragment: 'Фрагмент другого нового документа' },
    { beforeFragment: 'заявки' }, { afterFragment: 'снаб' },
  ];
  for (const patch of patches) {
    const { review, step } = await reviewLostFunctions(sample(), model((payload) => [{ ...pair(payload), ...patch }]));
    assert.equal(review.status, 'completed');
    assert.equal(review.reviewed, 0);
    assert.equal(review.items[0].status, 'unreviewed');
    assert.equal(review.items[0].evidenceAfter, null);
    assert.equal(step.citationsReturned, 1);
    assert.equal(step.citationsRejected, 1);
  }
});

test('A crossed before fragment is rejected even if it exists elsewhere in the supplied document', async () => {
  const data = input([entry('red8#1', 'Согласовывает закупочные заявки.'), entry('red8#2', 'Хранит бумажные протоколы заседаний.')],
    [entry('red9#1', 'Визирует потребности снабжения.')]);
  const { review } = await reviewLostFunctions(data, model((payload) => [{ ...pair(payload), beforeFragment: payload.lost[1].evidence.text }]));
  assert.deepEqual(review.items.map((item) => item.status), ['unreviewed', 'unreviewed']);
});

test('Duplicate IDs and unknown IDs are rejected and their reference claims are counted', async () => {
  const { review, step } = await reviewLostFunctions(sample(), model((payload) => [pair(payload), pair(payload), { ...pair(payload), id: 'invented' }]));
  assert.equal(review.reviewed, 0);
  assert.equal(review.items[0].status, 'unreviewed');
  assert.equal(step.citationsReturned, 3);
  assert.equal(step.citationsRejected, 3);
});

test('Only explicit none with all null fields becomes not_found; absent results remain unreviewed', async () => {
  const valid = await reviewLostFunctions(sample(), model((payload) => [none(payload.lost[0].id)]));
  assert.equal(valid.review.items[0].status, 'not_found');
  assert.equal(valid.review.reviewed, 1);
  assert.equal(valid.review.items[0].evidenceAfter, null);
  assert.equal(valid.step.citationsReturned, 0);
  for (const respond of [() => [], (payload) => [{ ...none(payload.lost[0].id), afterRef: payload.after[0].evidence.ref }],
    (payload) => [{ ...none(payload.lost[0].id), beforeFragment: payload.lost[0].evidence.text }]]) {
    const { review } = await reviewLostFunctions(sample(), model(respond));
    assert.equal(review.status, 'completed');
    assert.equal(review.items[0].status, 'unreviewed');
    assert.equal(review.reviewed, 0);
  }
});

test('Unavailable calls preserve lost rows without leaking provider errors, while fixtures preserve provenance', async () => {
  for (const mock of [async () => ({ data: null, source: 'none', durationMs: 1, error: 'sensitive-provider-message' }),
    async () => { throw new Error('sensitive-provider-message'); }]) {
    const result = await reviewLostFunctions(sample(), mock);
    assert.equal(result.review.status, 'unavailable');
    assert.equal(result.review.items[0].status, 'unreviewed');
    assert.equal(result.step.source, 'none');
    assert.doesNotMatch(JSON.stringify(result), /sensitive-provider-message/u);
  }
  const fixture = await reviewLostFunctions(sample(), model((payload) => [pair(payload)], 'fixture'));
  assert.equal(fixture.review.status, 'completed');
  assert.equal(fixture.review.source, 'fixture');
  assert.equal(fixture.step.source, 'fixture');
});

test('Malformed response schema and free model prose are never published', async () => {
  const { review } = await reviewLostFunctions(sample(), async () => ({ source: 'api', durationMs: 1,
    data: { items: [], rationale: 'Untrusted conclusion' },
  }));
  assert.equal(review.status, 'unavailable');
  assert.equal(review.items[0].status, 'unreviewed');
  assert.doesNotMatch(JSON.stringify(review), /Untrusted/u);
});

test('Data with no valid response source cannot be marked completed', async () => {
  for (const source of ['none', 'invented']) {
    const { review, step } = await reviewLostFunctions(sample(), model((payload) => [pair(payload)], source));
    assert.equal(review.status, 'unavailable');
    assert.equal(review.items[0].status, 'unreviewed');
    assert.equal(review.reviewed, 0);
    assert.equal(step.source, 'none');
  }
  const result = await reviewLostFunctions(sample(), async (options) => ({ data: { items: [pair(JSON.parse(options.user))] } }));
  assert.equal(result.review.status, 'unavailable');
  assert.equal(result.review.reviewed, 0);
});

test('A real empty same-scope pool can only yield a valid explicit none, without borrowing another scope', async () => {
  const data = input([entry('red8#1', 'Согласовывает закупочные заявки.')],
    [entry('red9#1', 'Формирует стратегию развития компании.', 'БВА', 'org')]);
  const { review } = await reviewLostFunctions(data, model((payload, options) => {
    assert.equal(payload.after.length, 0);
    assert.equal(options.schema.properties.items.items.properties.afterRef.type, 'null');
    assert.deepEqual(options.schema.properties.items.items.properties.relation.enum, ['none']);
    return [none(payload.lost[0].id)];
  }));
  assert.equal(review.status, 'completed');
  assert.equal(review.items[0].status, 'not_found');
  assert.equal(review.afterTotal, 0);
  assert.equal(review.limited, false);
});

test('No lost rows means no model call and no trace step', async () => {
  const data = sample();
  data.functions[0].change = 'kept';
  const result = await reviewLostFunctions(data, async () => { assert.fail('unexpected model call'); });
  assert.equal(result.review.status, 'not_needed');
  assert.equal(result.review.totalLost, 0);
  assert.equal(result.step, null);
});

test('The 12/80 limits expose complete coverage counts and keep excluded lost rows unreviewed', async () => {
  const data = input(Array.from({ length: 13 }, (_, index) => entry(`red8#${index + 1}`, `Проверяет договорные обязательства категории ${index}.`)),
    Array.from({ length: 81 }, (_, index) => entry(`red9#${index + 1}`, `Контролирует исполнение соглашений категории ${index}.`)));
  const { review, step } = await reviewLostFunctions(data, model((payload, options) => {
    assert.equal(payload.lost.length, 12);
    assert.equal(payload.after.length, 80);
    assert.ok(options.user.length <= SEMANTIC_REVIEW_LIMITS.maxInputChars);
    return payload.lost.map((item) => none(item.id));
  }));
  assert.equal(review.totalLost, 13);
  assert.equal(review.reviewed, 12);
  assert.equal(review.afterTotal, 81);
  assert.equal(review.afterConsidered, 80);
  assert.equal(review.limited, true);
  assert.equal(review.items.at(-1).status, 'unreviewed');
  assert.equal(step.inputSize, 12);
});

test('Oversized quotes are never truncated; smaller full quotes can still be reviewed', async () => {
  const huge = 'Сверхдлинная функция '.repeat(4000);
  const data = input([entry('red8#1', huge), entry('red8#2', 'Согласовывает закупочные заявки.')],
    [entry('red9#1', huge), entry('red9#2', 'Визирует потребности снабжения.')]);
  const { review } = await reviewLostFunctions(data, model((payload, options) => {
    assert.ok(options.user.length <= 64000);
    assert.equal(payload.lost.length, 1);
    assert.equal(payload.lost[0].evidence.text, data.functionsBefore[1].text);
    assert.equal(payload.after.length, 1);
    assert.equal(payload.after[0].evidence.text, data.functionsAfter[1].text);
    return [pair(payload)];
  }));
  assert.equal(review.totalLost, 2);
  assert.equal(review.reviewed, 1);
  assert.equal(review.afterConsidered, 1);
  assert.equal(review.afterTotal, 2);
  assert.equal(review.limited, true);
  assert.deepEqual(review.items.map((item) => item.status), ['unreviewed', 'candidate']);
});

test('A scope with no after quotes fitting the prompt is not called or falsely marked not_found', async () => {
  const data = input([entry('red8#1', 'Согласовывает закупочные заявки.')], [entry('red9#1', 'Визирует потребности снабжения. '.repeat(4000))]);
  const { review, step } = await reviewLostFunctions(data, async () => { assert.fail('empty artificial candidate pool must not trigger a call'); });
  assert.equal(review.status, 'unavailable');
  assert.equal(review.items[0].status, 'unreviewed');
  assert.equal(review.afterConsidered, 0);
  assert.equal(review.afterTotal, 1);
  assert.equal(review.limited, true);
  assert.equal(step.source, 'none');
});

test('A large before quote cannot starve a smaller complete before/after pair', async () => {
  const large = 'А'.repeat(62000);
  const small = 'Б'.repeat(50);
  const candidate = 'В'.repeat(2000);
  const data = input([entry('red8#1', large), entry('red8#2', small)], [entry('red9#1', candidate)]);
  let calls = 0;
  const { review, step } = await reviewLostFunctions(data, model((payload, options) => {
    calls += 1;
    assert.ok(options.user.length <= 64000);
    assert.deepEqual(payload.lost.map((item) => item.evidence.text), [small]);
    assert.deepEqual(payload.after.map((item) => item.evidence.text), [candidate]);
    return [pair(payload)];
  }));
  assert.equal(calls, 1);
  assert.equal(review.status, 'completed');
  assert.equal(review.totalLost, 2);
  assert.equal(review.reviewed, 1);
  assert.equal(review.afterConsidered, 1);
  assert.equal(review.afterTotal, 1);
  assert.equal(review.limited, true);
  assert.deepEqual(review.items.map((item) => item.status), ['unreviewed', 'candidate']);
  assert.equal(step.inputSize, 1);
});

test('An after reference outside the bounded supplied pool cannot be accepted', async () => {
  const data = input([entry('red8#1', 'Согласовывает закупочные заявки.')],
    Array.from({ length: 81 }, (_, index) => entry(`red9#${index + 1}`, `Визирует потребности снабжения номер ${index}.`)));
  const { review, step } = await reviewLostFunctions(data, model((payload) => [{ ...pair(payload),
    afterRef: 'red9#81', afterFragment: data.functionsAfter[80].text,
  }]));
  assert.equal(review.items[0].status, 'unreviewed');
  assert.equal(review.reviewed, 0);
  assert.equal(step.citationsRejected, 1);
});
