import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import OpenAI from 'openai';

const fail = (code, message) => ({ ok: false, source: 'none', error: { code, message } });
const invalid = () => fail('invalid_response', 'Ответ OpenAI не прошёл проверку формата, модели или учёта токенов.');

function sanitizedError(error) {
  if (error?.status === 401) return fail('unauthorized', 'OpenAI отклонил API-ключ (401). Проверьте OPENAI_API_KEY.');
  if (error?.status === 403) return fail('forbidden', 'Нет доступа к модели или проекту OpenAI (403).');
  if (error?.status === 429) return fail('quota_or_rate_limit', 'OpenAI сообщил об ограничении запросов или доступной квоты (429). Проверьте кредиты и лимиты проекта.');
  if (['APIConnectionTimeoutError', 'TimeoutError', 'AbortError'].includes(error?.name)) return fail('timeout', 'OpenAI не ответил за 20 секунд. Повторный запрос автоматически не выполнялся.');
  if (error?.name === 'APIConnectionError') return fail('network', 'Не удалось соединиться с OpenAI. Проверьте сетевой доступ.');
  if ([400, 404].includes(error?.status)) return fail('request_rejected', 'OpenAI отклонил запрос. Проверьте доступность указанной модели и параметры проверки.');
  return fail('api_error', 'Проверка OpenAI завершилась ошибкой. Ответ API и технические подробности не публикуются.');
}

/** Только синтетический запрос; функция не читает .env, документы и фикстуры. */
export async function checkOpenAI({ apiKey, model = 'gpt-4.1-mini', createClient = (options) => new OpenAI(options) } = {}) {
  if (typeof apiKey !== 'string' || !apiKey.trim()) return fail('missing_key', 'Задайте OPENAI_API_KEY в окружении или server/.env. Запрос не отправлен.');
  const key = apiKey.trim();
  try {
    const client = createClient({ apiKey: key, baseURL: 'https://api.openai.com/v1', maxRetries: 0, timeout: 20_000, logLevel: 'off' });
    const response = await client.chat.completions.create({
      model, n: 1, max_completion_tokens: 128, store: false,
      messages: [{ role: 'user', content: 'Synthetic connection test. Return exactly {"status":"ok"}.' }],
      response_format: { type: 'json_schema', json_schema: {
        name: 'connection_check', strict: true,
        schema: { type: 'object', additionalProperties: false, required: ['status'], properties: { status: { type: 'string', enum: ['ok'] } } },
      } },
    });
    if (!Array.isArray(response?.choices) || response.choices.length !== 1) return invalid();
    const choice = response.choices[0];
    if (choice.message?.refusal || choice.finish_reason === 'content_filter') return fail('refusal', 'Модель отказалась выполнить синтетическую проверку. Проверка не пройдена.');
    if (choice.finish_reason === 'length') return fail('truncated', 'Ответ ограничен лимитом 128 токенов. Проверка не пройдена; повторного запроса не было.');
    if (choice.finish_reason !== 'stop' || typeof choice.message?.content !== 'string') return invalid();
    let value;
    try { value = JSON.parse(choice.message.content); } catch { return invalid(); }
    if (!value || Array.isArray(value) || value.status !== 'ok' || Object.keys(value).length !== 1) return invalid();
    if (typeof response.model !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,149}$/u.test(response.model) || response.model.includes(key)) return invalid();
    const prompt = response.usage?.prompt_tokens, completion = response.usage?.completion_tokens;
    if (![prompt, completion].every((count) => Number.isSafeInteger(count) && count >= 0)) return invalid();
    return { ok: true, source: 'api', model: response.model, usage: { prompt_tokens: prompt, completion_tokens: completion } };
  } catch (error) { return sanitizedError(error); }
}

// Импорт в тесты не загружает .env и не выполняет сетевых запросов.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.env.DOTENV_CONFIG_QUIET = 'true';
  await import('dotenv/config');
  const result = await checkOpenAI({ apiKey: process.env.OPENAI_API_KEY, model: process.env.OPENAI_MODEL?.trim() || 'gpt-4.1-mini' });
  (result.ok ? console.log : console.error)(JSON.stringify(result, null, 2));
  process.exitCode = result.ok ? 0 : 1;
}
