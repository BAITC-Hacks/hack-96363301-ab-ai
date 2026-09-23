import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { callModel, fixtureKey, FIXTURES_DIR } from '../src/llm/client.js';
import { listenTestServer } from '../test-support/http-server.js';

test('Повторный живой ответ не переписывает запись; лимит ответа передаётся в SDK', async t => {
  const requests = [];
  const server = await listenTestServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    requests.push(JSON.parse(body));
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ value: requests.length }) } }] }));
  });
  const previous = { key: process.env.OPENAI_API_KEY, url: process.env.OPENAI_BASE_URL };
  process.env.OPENAI_API_KEY = 'local-test-key';
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${server.address().port}/v1`;
  const opts = { name: `client-test-${randomUUID()}`, system: 'Synthetic transport test', user: 'Return a number',
    schema: { type: 'object', properties: { value: { type: 'number' } }, required: ['value'], additionalProperties: false },
    validator: z.object({ value: z.number() }), maxCompletionTokens: 128, model: 'synthetic-model-a' };
  const payload = { system: opts.system, user: opts.user };
  assert.notEqual(fixtureKey(opts.name, payload, opts.model), fixtureKey(opts.name, payload, 'synthetic-model-b'));
  const path = join(FIXTURES_DIR, `${fixtureKey(opts.name, payload, opts.model)}.json`);
  t.after(async () => {
    if (previous.key === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previous.key;
    if (previous.url === undefined) delete process.env.OPENAI_BASE_URL; else process.env.OPENAI_BASE_URL = previous.url;
    await unlink(path).catch(error => { if (error.code !== 'ENOENT') throw error; });
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  });
  const first = await callModel(opts);
  const second = await callModel(opts);
  assert.equal(first.source, 'api');
  assert.deepEqual(first.data, { value: 1 });
  assert.equal(second.source, 'api');
  assert.deepEqual(second.data, { value: 2 });
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), { value: 1 });
  process.env.OPENAI_API_KEY = '';
  const replay = await callModel(opts);
  assert.equal(replay.source, 'fixture');
  assert.deepEqual(replay.data, { value: 1 });
  assert.equal(requests.length, 2);
  assert.ok(requests.every(request => request.max_completion_tokens === 128 && request.store === false && request.model === opts.model));
});
