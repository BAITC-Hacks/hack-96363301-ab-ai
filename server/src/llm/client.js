import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import OpenAI from 'openai';

const here = dirname(fileURLToPath(import.meta.url));
export const FIXTURES_DIR = join(here, '..', '..', 'fixtures', 'llm');

export const MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';

/**
 * Слой вызова модели с записью и воспроизведением ответов.
 *
 * Зачем: решение оценивается заочно 24–28 сентября, и у эксперта не будет
 * нашего API-ключа. Поэтому каждый ответ модели, полученный вживую,
 * сохраняется в fixtures/llm/ и коммитится. При пустом OPENAI_API_KEY тот же
 * сценарий проходится целиком на записанных ответах — демо-путь не зависит
 * от наличия ключа.
 *
 * Если ключа нет и фикстуры тоже нет (эксперт загрузил свои документы),
 * вызов возвращает null, а вызывающий код деградирует до детерминированного
 * результата. Пустого экрана не будет ни при каком раскладе.
 */

export function hasApiKey() {
  return Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim());
}

/** Ключ фикстуры — хеш от модели и полезной нагрузки запроса. */
export function fixtureKey(name, payload, model = MODEL) {
  const hash = createHash('sha256').update(JSON.stringify({ name, MODEL: model, payload })).digest('hex').slice(0, 16);
  return `${name}.${hash}`;
}

async function readFixture(key, validator) {
  try {
    const parsed = validator.safeParse(JSON.parse(await readFile(join(FIXTURES_DIR, `${key}.json`), 'utf8')));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function writeFixture(key, data) {
  await mkdir(FIXTURES_DIR, { recursive: true });
  // Фиксируем первый ответ: повторное демо не переписывает доказательство прогона.
  try {
    await writeFile(join(FIXTURES_DIR, `${key}.json`), `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  } catch (error) { if (error.code !== 'EEXIST') throw error; }
}

let client = null;
function getClient() {
  if (!client) client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 45000, maxRetries: 0 });
  return client;
}

/**
 * Вызов модели со строгим structured output.
 *
 * @param {object} opts
 * @param {string} opts.name        имя шага — попадает в имя фикстуры и в лог
 * @param {string} opts.system      системная инструкция
 * @param {string} opts.user        пользовательское сообщение
 * @param {object} opts.schema      JSON Schema ответа (strict)
 * @param {import('zod').ZodTypeAny} opts.validator  zod-схема для проверки
 * @returns {Promise<{data: object|null, source: 'api'|'fixture'|'none', durationMs: number, error: string|null}>}
 */
export async function callModel({ name, system, user, schema, validator, maxCompletionTokens = 8192, model = MODEL }) {
  const key = fixtureKey(name, { system, user }, model);
  const started = Date.now();

  if (!hasApiKey()) {
    const fixture = await readFixture(key, validator);
    return {
      data: fixture,
      source: fixture ? 'fixture' : 'none',
      durationMs: Date.now() - started,
      error: fixture ? null : 'Нет API-ключа и нет записанной фикстуры для этого запроса',
    };
  }

  try {
    const response = await getClient().chat.completions.create({
      model,
      max_completion_tokens: maxCompletionTokens,
      store: false,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: name.replace(/[^a-z0-9_]/gi, '_'), strict: true, schema },
      },
    });

    const raw = JSON.parse(response.choices[0].message.content);
    const parsed = validator.safeParse(raw);
    if (!parsed.success) {
      return {
        data: null,
        source: 'none',
        durationMs: Date.now() - started,
        error: `Ответ модели не прошёл проверку схемы: ${parsed.error.issues[0]?.message}`,
      };
    }

    await writeFixture(key, parsed.data);
    return { data: parsed.data, source: 'api', durationMs: Date.now() - started, error: null };
  } catch (err) {
    // Сеть, лимит, неверный ключ — не роняем пайплайн, деградируем.
    const fixture = await readFixture(key, validator);
    return {
      data: fixture,
      source: fixture ? 'fixture' : 'none',
      durationMs: Date.now() - started,
      error: err.message,
    };
  }
}
