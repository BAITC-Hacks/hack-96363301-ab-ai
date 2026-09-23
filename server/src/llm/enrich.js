import { callModel, MODEL, hasApiKey } from './client.js';
import { LlmClassification, LlmConclusion } from '../types.js';
import { verifyCitations } from '../parse/docx.js';

/**
 * LLM-слой: объяснение находок и итоговое заключение.
 *
 * Разделение ответственности, на котором держится достоверность:
 *  - ЧТО изменилось — считает детерминированное ядро (analysis/*);
 *  - ПОЧЕМУ это важно — объясняет модель, но только про уже найденное.
 *
 * Модель не ищет изменения сама и не придумывает ссылки: она получает
 * закрытый список допустимых идентификаторов пунктов и обязана выбирать
 * только из него. Всё, что вне списка, отбрасывается на бэкенде и
 * попадает в счётчик citationsRejected, видимый в интерфейсе.
 */

const SYSTEM = `Ты — методолог внутреннего аудита. Анализируешь изменения между двумя редакциями положения о подразделении.

Жёсткие правила:
1. Опирайся ТОЛЬКО на переданные фрагменты. Не додумывай факты, которых нет в тексте.
2. Ссылайся только на идентификаторы пунктов из переданного списка допустимых ссылок. Любой другой идентификатор недопустим.
3. Если данных для вывода недостаточно — так и напиши, не выдумывай.
4. Выводы носят рекомендательный характер и требуют проверки ответственным сотрудником.
5. Пиши по-русски, деловым языком, коротко и по существу.`;

const CLASSIFICATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'change', 'rationale', 'citations'],
        properties: {
          id: { type: 'string' },
          change: { type: 'string', enum: ['lost', 'moved', 'added', 'reworded', 'kept'] },
          rationale: { type: 'string' },
          citations: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
};

const CONCLUSION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'findings', 'recommendations'],
  properties: {
    summary: { type: 'string' },
    findings: { type: 'array', items: { type: 'string' } },
    recommendations: { type: 'array', items: { type: 'string' } },
  },
};

const DISCLAIMER =
  'Выводы носят рекомендательный характер и требуют проверки ответственным сотрудником. ' +
  'Каждый вывод сопровождается ссылкой на пункт исходного документа — проверьте формулировку по первоисточнику.';

/** Значимые для пользователя изменения — их и объясняем. Остальное шум. */
function notable(functions) {
  return functions.filter((f) => f.change === 'lost' || f.change === 'moved');
}

/**
 * Шаг 1: объяснение изменений функций.
 * Возвращает те же diff-объекты, но с заполненным rationale.
 */
export async function explainChanges(functions, clauseIndex) {
  const items = notable(functions);
  if (items.length === 0) {
    return { functions, step: null };
  }

  const allowed = [...new Set(items.flatMap((f) => [...f.evidenceBefore, ...f.evidenceAfter].map((e) => e.ref)))];

  const payload = items.map((f, i) => ({
    id: `f${i}`,
    change: f.change,
    text: f.text,
    ownerBefore: f.ownerBefore,
    ownerAfter: f.ownerAfter,
    refsBefore: f.evidenceBefore.map((e) => e.ref),
    refsAfter: f.evidenceAfter.map((e) => e.ref),
  }));

  const user = [
    'Ниже изменения функций подразделений, найденные сопоставлением текста двух редакций.',
    'Для каждого объясни в одном-двух предложениях, чем изменение значимо для распределения ответственности.',
    '',
    `Допустимые идентификаторы ссылок: ${allowed.join(', ')}`,
    '',
    JSON.stringify(payload, null, 2),
  ].join('\n');

  const result = await callModel({
    name: 'explain-changes',
    system: SYSTEM,
    user,
    schema: CLASSIFICATION_SCHEMA,
    validator: LlmClassification,
  });

  let returned = 0;
  let rejected = 0;

  if (result.data) {
    const byId = new Map(result.data.items.map((it) => [it.id, it]));
    items.forEach((f, i) => {
      const it = byId.get(`f${i}`);
      if (!it) return;
      const { invalid } = verifyCitations(it.citations, clauseIndex);
      returned += it.citations.length;
      rejected += invalid.length;
      // Ссылки на несуществующие пункты не показываем и объяснение помечаем.
      f.rationale = invalid.length
        ? `${it.rationale} [часть ссылок модели не подтверждена документом и отброшена]`
        : it.rationale;
    });
  }

  return {
    functions,
    step: {
      step: 'Объяснение изменений функций',
      kind: 'llm',
      model: MODEL,
      source: result.source === 'none' ? 'fixture' : result.source,
      durationMs: result.durationMs,
      inputSize: items.length,
      citationsReturned: returned,
      citationsRejected: rejected,
    },
  };
}

/**
 * Детерминированное заключение — используется, когда модель недоступна и
 * фикстуры нет. Покрывает must have 5 без единого обращения к API.
 */
export function deterministicConclusion({ units, functions, duplicates, conflicts, gaps }) {
  const created = units.filter((u) => u.status === 'created');
  const kept = units.filter((u) => u.status === 'kept');
  const removed = units.filter((u) => u.status === 'removed');
  const lost = functions.filter((f) => f.change === 'lost');
  const moved = functions.filter((f) => f.change === 'moved');

  const findings = [];
  if (created.length)
    findings.push(
      `Создано подразделений: ${created.length} — ${created.map((u) => u.abbr || u.name).join(', ')}.`,
    );
  if (kept.length) findings.push(`Сохранено подразделений: ${kept.length} — ${kept.map((u) => u.abbr || u.name).join(', ')}.`);
  if (removed.length) findings.push(`Отсутствуют в редакции «после»: ${removed.map((u) => u.abbr || u.name).join(', ')}.`);
  if (moved.length) findings.push(`Функций сменили владельца: ${moved.length}. Формулировки сохранены, ответственность перераспределена.`);
  if (lost.length) findings.push(`Функций без соответствия в редакции «после»: ${lost.length}. Требуют проверки на утрату.`);
  if (duplicates.length) findings.push(`Групп пересекающегося функционала между подразделениями: ${duplicates.length}.`);
  if (conflicts.length) findings.push(`Отмечено признаков конфликта интересов: ${conflicts.length}.`);
  for (const gap of gaps) findings.push(gap.title + '.');

  const recommendations = [];
  if (lost.length) recommendations.push('Подтвердить у владельцев процессов, что функции без соответствия действительно упразднены, а не утрачены при переносе.');
  if (duplicates.length) recommendations.push('Закрепить пересекающиеся функции за одним подразделением либо развести зоны ответственности формулировками.');
  if (gaps.length) recommendations.push('Дополнить раздел «Цели, задачи и функции» описанием задач созданных подразделений.');
  if (conflicts.length) recommendations.push('Проверить совмещение контрольных и планирующих функций на соответствие требованиям независимости.');
  if (recommendations.length === 0) recommendations.push('Существенных отклонений не выявлено; рекомендуется выборочная проверка формулировок.');

  return {
    summary:
      `Сопоставлены две редакции положения. Подразделений в редакции «после»: ${units.filter((u) => u.status !== 'removed').length}, ` +
      `из них создано ${created.length}. Изменений функционала, требующих внимания: ${lost.length + moved.length}. ` +
      `Пересечений функционала между подразделениями: ${duplicates.length}.`,
    findings,
    recommendations,
    disclaimer: DISCLAIMER,
  };
}

/**
 * Шаг 2: итоговое аналитическое заключение (must have 5).
 * При недоступной модели возвращает детерминированный вариант.
 */
export async function buildConclusion(report) {
  const fallback = deterministicConclusion(report);

  const payload = {
    units: report.units.map((u) => ({ unit: u.abbr || u.name, status: u.status })),
    lost: report.functions.filter((f) => f.change === 'lost').map((f) => ({ text: f.text, owner: f.ownerBefore })),
    moved: report.functions
      .filter((f) => f.change === 'moved')
      .map((f) => ({ text: f.text, from: f.ownerBefore, to: f.ownerAfter })),
    duplicates: report.duplicates.map((d) => ({ text: d.text, owners: d.owners })),
    gaps: report.gaps.map((g) => g.title),
  };

  const result = await callModel({
    name: 'conclusion',
    system: SYSTEM,
    user: [
      'Составь итоговое аналитическое заключение по результатам сопоставления двух редакций положения.',
      'summary — 2-3 предложения. findings — ключевые наблюдения списком. recommendations — что сделать ответственному сотруднику.',
      '',
      JSON.stringify(payload, null, 2),
    ].join('\n'),
    schema: CONCLUSION_SCHEMA,
    validator: LlmConclusion,
  });

  const conclusion = result.data ? { ...result.data, disclaimer: DISCLAIMER } : fallback;

  return {
    conclusion,
    step: {
      step: 'Итоговое заключение',
      kind: result.data ? 'llm' : 'deterministic',
      model: result.data ? MODEL : null,
      source: result.data ? (result.source === 'none' ? 'fixture' : result.source) : 'fixture',
      durationMs: result.durationMs,
      inputSize: null,
      citationsReturned: null,
      citationsRejected: null,
    },
  };
}

export { hasApiKey };
