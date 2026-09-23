import { normalizeText } from './units.js';
import { inspectMaterialChanges } from './material.js';

/**
 * Сопоставление функций между редакциями и поиск дублирования.
 *
 * Сравнение идёт ПО ТЕКСТУ, а не по номеру пункта. В выданных документах
 * нумерация раздела 5 сквозным образом сдвинута (в редакции 9 исчез пункт
 * 5.11, а 5.6 и 5.7 объединены в один), поэтому сравнение по номерам дало бы
 * около двух десятков несуществующих «потерянных функций». Номер нужен только
 * как адрес цитаты.
 */

const MATCH_THRESHOLD = 0.62; // ниже — считаем, что пары нет
const IDENTICAL_THRESHOLD = 0.97; // выше — та же формулировка
const DUPLICATE_THRESHOLD = 0.75; // порог для дублирования внутри редакции

const STOP = new Set([
  'и', 'в', 'на', 'по', 'с', 'а', 'о', 'об', 'для', 'из', 'к', 'до', 'от', 'при',
  'же', 'или', 'что', 'как', 'не', 'то', 'том', 'числе', 'также', 'иных', 'иные',
  'соответствии', 'рамках', 'части', 'целях', 'вопросам', 'которая', 'которые',
]);

function tokens(text) {
  return new Set(
    normalizeText(text)
      .split(' ')
      .filter((w) => w.length > 2 && !STOP.has(w)),
  );
}

/** Коэффициент Дайса по множествам значимых слов. */
export function similarity(a, b) {
  const ta = a instanceof Set ? a : tokens(a);
  const tb = b instanceof Set ? b : tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let common = 0;
  for (const t of ta) if (tb.has(t)) common += 1;
  return (2 * common) / (ta.size + tb.size);
}

/**
 * Одна функция может быть записана в документе один раз, но принадлежать
 * нескольким подразделениям — в редакции 9 заголовок 5.3 покрывает сразу
 * ДИТААД и ДОА. Группируем по пункту, чтобы такие случаи не выглядели
 * дублированием: это один и тот же пункт, а не два разных.
 */
function groupByClause(functions) {
  const byRef = new Map();
  for (const f of functions) {
    const existing = byRef.get(f.ref);
    if (existing) {
      if (!existing.owners.includes(f.owner)) existing.owners.push(f.owner);
      continue;
    }
    byRef.set(f.ref, {
      ref: f.ref,
      number: f.number,
      docId: f.docId,
      text: f.text,
      scope: f.scope,
      owners: [f.owner],
      tokens: tokens(f.text),
    });
  }
  return [...byRef.values()];
}

function evidence(entry, clauseIndex) {
  const clause = clauseIndex.get(entry.ref);
  return [
    {
      ref: entry.ref,
      docId: entry.docId,
      number: entry.number,
      text: clause ? clause.text : entry.text,
    },
  ];
}

/**
 * Сопоставление функций «до» и «после» (must have 2).
 *
 * Классификация:
 *  - `lost`     — в редакции «после» похожей формулировки нет вообще;
 *  - `moved`    — формулировка есть, но владельцы полностью сменились;
 *  - `reworded` — тот же владелец, формулировка изменена;
 *  - `kept`     — тот же владелец, та же формулировка;
 *  - `added`    — есть только в редакции «после».
 */
export function diffFunctions(functionsBefore, functionsAfter, clauseIndex) {
  const before = groupByClause(functionsBefore);
  const after = groupByClause(functionsAfter);
  const usedAfter = new Set();
  const results = [];

  for (const b of before) {
    let best = null;
    let bestScore = 0;
    let bestOwnerOverlap = -1;
    for (const a of after) {
      // Функции блока в целом (раздел 2.4) и функции подразделений
      // (раздел 5) живут в разных плоскостях — не смешиваем.
      if (a.scope !== b.scope) continue;
      const score = similarity(b.tokens, a.tokens);
      const ownerOverlap = b.owners.filter((o) => a.owners.includes(o)).length;
      // При равном качестве предпочитаем ещё не сопоставленный пункт. Повторное
      // использование остаётся допустимым, когда функции действительно объединены.
      const betterTie = ownerOverlap > bestOwnerOverlap ||
        (ownerOverlap === bestOwnerOverlap && usedAfter.has(best?.ref) && !usedAfter.has(a.ref));
      if (score > bestScore || (score === bestScore && betterTie)) {
        bestScore = score;
        best = a;
        bestOwnerOverlap = ownerOverlap;
      }
    }

    if (!best || bestScore < MATCH_THRESHOLD) {
      results.push({
        change: 'lost',
        text: b.text,
        ownerBefore: b.owners.join(', '),
        ownerAfter: null,
        similarity: Number(bestScore.toFixed(3)),
        evidenceBefore: evidence(b, clauseIndex),
        evidenceAfter: [],
        reviewCandidates: after.filter((a) => a.scope === b.scope)
          .map((a) => ({ evidence: evidence(a, clauseIndex)[0], similarity: Number(similarity(b.tokens, a.tokens).toFixed(3)), owner: a.owners.join(', ') }))
          .filter((a) => a.similarity >= 0.3)
          .sort((a, b) => b.similarity - a.similarity).slice(0, 3),
        rationale: null,
      });
      continue;
    }

    usedAfter.add(best.ref);
    const sameOwners = b.owners.length === best.owners.length && b.owners.every((o) => best.owners.includes(o));
    const materialChanges = inspectMaterialChanges(b.text, best.text);

    let change;
    if (!sameOwners) change = 'moved';
    else if (bestScore >= IDENTICAL_THRESHOLD && !materialChanges.length) change = 'kept';
    else change = 'reworded';

    results.push({
      change,
      text: best.text,
      ownerBefore: b.owners.join(', '),
      ownerAfter: best.owners.join(', '),
      similarity: Number(bestScore.toFixed(3)),
      evidenceBefore: evidence(b, clauseIndex),
      evidenceAfter: evidence(best, clauseIndex),
      materialChanges,
      rationale: null,
    });
  }

  for (const a of after) {
    if (usedAfter.has(a.ref)) continue;
    const bestScore = Math.max(0, ...before.filter((b) => b.scope === a.scope).map((b) => similarity(b.tokens, a.tokens)));
    results.push({
      change: 'added',
      text: a.text,
      ownerBefore: null,
      ownerAfter: a.owners.join(', '),
      similarity: Number(bestScore.toFixed(3)),
      evidenceBefore: [],
      evidenceAfter: evidence(a, clauseIndex),
      rationale: null,
    });
  }

  return results;
}

/**
 * Дублирование функций между подразделениями внутри одной редакции
 * (must have 3).
 *
 * Дублированием считается близкий текст в РАЗНЫХ пунктах у РАЗНЫХ владельцев.
 * Один пункт, закреплённый сразу за двумя подразделениями, дублированием не
 * является — это оформление документа, и репортить его значило бы шуметь.
 */
export function findDuplicates(functions, clauseIndex) {
  const entries = groupByClause(functions).filter((e) => e.scope === 'unit');
  const duplicates = [];

  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      if (similarity(entries[i].tokens, entries[j].tokens) < DUPLICATE_THRESHOLD) continue;
      const pair = [entries[i], entries[j]];
      const owners = [...new Set(pair.flatMap((entry) => entry.owners))];
      if (owners.length < 2) continue;

      // Сходство нетранзитивно: A–B и B–C не означают A–C. Сохраняем каждую
      // непосредственную пару, чтобы не потерять B–C и не приписать связь A–C.
      duplicates.push({
        text: entries[i].text,
        owners,
        evidence: [...new Map(pair.flatMap((entry) => evidence(entry, clauseIndex)).map((e) => [e.ref, e])).values()],
        rationale: pair.some((entry) => /участв|содейств|в зоне|зоне ответственности/iu.test(entry.text))
          ? 'Формулировка описывает участие или работу в своей зоне ответственности. Это может быть совместная обязанность; избыточное дублирование не установлено. Уточните роли и границы процессов.'
          : 'Похожие обязанности закреплены в разных пунктах у нескольких подразделений. Проверьте, совпадают ли объекты работы и границы ответственности, прежде чем считать это избыточным дублированием.',
      });
    }
  }

  return duplicates;
}

/**
 * Потенциальные конфликты интересов (must have 3).
 *
 * Структурный признак: одно подразделение контролирует качество аудита
 * и формирует план работ. Это основание для проверки независимости,
 * а не доказательство состоявшегося конфликта.
 */
export function findConflicts(_beforeDoc, _afterDoc, functionsAfter, clauseIndex) {
  const conflicts = [];

  // Новое требование декларирования — мера контроля, а не факт конфликта.

  const byOwner = new Map();
  for (const entry of groupByClause(functionsAfter).filter((e) => e.scope === 'unit')) {
    for (const owner of entry.owners) {
      if (!byOwner.has(owner)) byOwner.set(owner, []);
      byOwner.get(owner).push(entry);
    }
  }

  // Внимание: \w в JavaScript опирается на ASCII и кириллицу не покрывает —
  // /контрол\w* качества/ не находит «контроль качества». Классы явные.
  const CONTROLS_RE = /контрол[а-яё]* качества/iu;
  const PLANS_RE = /(формир[а-яё]*|консолидир[а-яё]*)[^.;]*план[а-яё]* работ/iu;

  for (const [owner, entries] of byOwner) {
    const controls = entries.filter((e) => CONTROLS_RE.test(e.text));
    const plans = entries.filter((e) => PLANS_RE.test(e.text));
    if (controls.length === 0 || plans.length === 0) continue;

    conflicts.push({
      title: `Совмещение контрольной и планирующей функций у подразделения «${owner}»`,
      owners: [owner],
      evidence: [...controls.slice(0, 1), ...plans.slice(0, 1)].flatMap((e) => evidence(e, clauseIndex)),
      rationale: null,
    });
  }

  return conflicts;
}

/**
 * Пробелы нормативного закрепления — находка сверх обязательных требований.
 *
 * Подразделение создано в редакции «после», но в разделе «Цели, задачи и
 * функции» о нём ничего не появилось: его функции существуют только как
 * обязанности директора. Для аудита это реальный дефект документа.
 */
export function findNormativeGaps(unitDiff, functionsAfter, clauseIndex) {
  const orgFunctions = functionsAfter.filter((f) => f.scope === 'org');
  if (!orgFunctions.length) return []; // Нет раздела для проверки, например в таблице функций.
  const gaps = [];

  for (const unit of unitDiff.filter((u) => u.status === 'created')) {
    const token = (unit.abbr || unit.name).toLowerCase();
    const mentioned = orgFunctions.some((f) => f.text.toLowerCase().includes(token));
    if (mentioned) continue;

    const own = functionsAfter.filter((f) => f.owner === (unit.abbr || unit.name));
    gaps.push({
      title: `Требуется проверить описание функций подразделения «${unit.abbr || unit.name}»`,
      detail:
        `Подразделение создано в редакции «после», однако раздел «Цели, задачи и функции внутреннего аудита» ` +
        `его не упоминает. ` + (own.length
          ? `Функции прослеживаются только через обязанности руководителя (${own.length} пунктов). `
          : 'В извлечённом перечне не найдены функции этого подразделения. ') +
        `Требуется проверить полноту закрепления задач; отсутствие названия в разделе само по себе не доказывает нарушение.`,
      evidence: own.length ? own.slice(0, 3).map((f) => {
        const clause = clauseIndex.get(f.ref);
        return { ref: f.ref, docId: f.docId, number: f.number, text: clause ? clause.text : f.text };
      }) : [...new Map(unit.evidence.map((e) => [e.ref, e])).values()],
    });
  }

  return gaps;
}
