import test from 'node:test';
import assert from 'node:assert/strict';
import { checkOpenAI } from '../scripts/check-openai.js';

const fakeKey = 'sk-fake-secret-must-not-be-printed';
const validResponse = () => ({
  model: 'gpt-4.1-mini-2025-04-14', usage: { prompt_tokens: 18, completion_tokens: 6 },
  choices: [{ finish_reason: 'stop', message: { content: '{"status":"ok"}', refusal: null } }],
});
const mockClient = (response) => () => ({ chat: { completions: { create: async () => response } } });

test('Проверка делает ровно один ограниченный синтетический запрос и возвращает только разрешённые поля', async () => {
  let calls = 0;
  const result = await checkOpenAI({ apiKey: fakeKey, createClient: (options) => {
    assert.deepEqual(options, { apiKey: fakeKey, baseURL: 'https://api.openai.com/v1', maxRetries: 0, timeout: 20000, logLevel: 'off' });
    return { chat: { completions: { create: async (request) => {
      calls++;
      assert.equal(request.model, 'gpt-4.1-mini');
      assert.equal(request.max_completion_tokens, 128);
      assert.equal(request.n, 1);
      assert.equal(request.store, false);
      assert.equal(request.response_format.json_schema.strict, true);
      assert.deepEqual(request.messages, [{ role: 'user', content: 'Synthetic connection test. Return exactly {"status":"ok"}.' }]);
      return { ...validResponse(), private_data: fakeKey };
    } } } };
  } });
  assert.equal(calls, 1);
  assert.deepEqual(result, { ok: true, source: 'api', model: 'gpt-4.1-mini-2025-04-14', usage: { prompt_tokens: 18, completion_tokens: 6 } });
  assert.ok(!JSON.stringify(result).includes(fakeKey));
});

test('Отсутствующий ключ не создаёт клиент и не отправляет запрос', async () => {
  for (const apiKey of [undefined, null, '', '   ']) {
    const result = await checkOpenAI({ apiKey, createClient: () => assert.fail('Клиент не должен создаваться') });
    assert.equal(result.ok, false);
    assert.equal(result.source, 'none');
    assert.equal(result.error.code, 'missing_key');
  }
});

test('401, 403, 429, таймаут, сеть и неизвестные ошибки санитизируются без повторных запросов', async () => {
  for (const [properties, code] of [
    [{ status: 401 }, 'unauthorized'], [{ status: 403 }, 'forbidden'], [{ status: 429 }, 'quota_or_rate_limit'],
    [{ name: 'APIConnectionTimeoutError' }, 'timeout'], [{ name: 'APIConnectionError' }, 'network'],
    [{ status: 400 }, 'request_rejected'], [{ status: 500 }, 'api_error'],
  ]) {
    let calls = 0;
    const result = await checkOpenAI({ apiKey: fakeKey, createClient: () => ({ chat: { completions: { create: async () => {
      calls++;
      throw Object.assign(new Error(`raw-error ${fakeKey}`), properties);
    } } } }) });
    assert.equal(calls, 1);
    assert.equal(result.ok, false);
    assert.equal(result.source, 'none');
    assert.equal(result.error.code, code);
    assert.ok(!JSON.stringify(result).includes(fakeKey));
    assert.ok(!JSON.stringify(result).includes('raw-error'));
  }
});

test('Обрезанный ответ и отказ не выдаются за успешный API-вызов', async () => {
  for (const [finish, refusal, expected] of [['length', null, 'truncated'], ['stop', fakeKey, 'refusal'], ['content_filter', null, 'refusal']]) {
    const response = validResponse();
    response.choices[0].finish_reason = finish;
    response.choices[0].message.refusal = refusal;
    const result = await checkOpenAI({ apiKey: fakeKey, createClient: mockClient(response) });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, expected);
    assert.ok(!JSON.stringify(result).includes(fakeKey));
  }
});

test('Невалидный JSON, лишние поля, отсутствие usage и модели не проходят проверку', async () => {
  const cases = [null, { choices: [] }];
  for (const content of ['not json', 'null', '[]', '{"status":"bad"}', '{"status":"ok","secret":"hidden"}']) {
    const response = validResponse(); response.choices[0].message.content = content; cases.push(response);
  }
  cases.push({ ...validResponse(), usage: undefined }, { ...validResponse(), model: undefined }, { ...validResponse(), model: fakeKey });
  for (const response of cases) {
    const result = await checkOpenAI({ apiKey: fakeKey, createClient: mockClient(response) });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'invalid_response');
    assert.ok(!JSON.stringify(result).includes('hidden'));
    assert.ok(!JSON.stringify(result).includes(fakeKey));
  }
});

test('Указанная модель сохраняется, ошибка создания клиента тоже не раскрывает ключ', async () => {
  let requestedModel;
  const result = await checkOpenAI({ apiKey: fakeKey, model: 'custom-model', createClient: () => ({ chat: { completions: { create: async (request) => {
    requestedModel = request.model; return validResponse();
  } } } }) });
  assert.equal(requestedModel, 'custom-model');
  assert.equal(result.model, 'gpt-4.1-mini-2025-04-14');
  const failed = await checkOpenAI({ apiKey: fakeKey, createClient: () => { throw new Error(fakeKey); } });
  assert.equal(failed.error.code, 'api_error');
  assert.ok(!JSON.stringify(failed).includes(fakeKey));
});
