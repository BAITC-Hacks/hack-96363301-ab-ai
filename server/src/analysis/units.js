/**
 * Извлечение структурных подразделений и привязка функций к их владельцам.
 *
 * Здесь лежит главное содержательное решение всего проекта.
 *
 * В выданных документах номера пунктов между редакциями сквозным образом
 * сдвинуты: в редакции 8 пункт 5.6 — это «Директор ДККМ обязан…», а в
 * редакции 9 тот же номер занят объединённым «Директоры департаментов
 * обязаны…». Совпадение владельцев 5.4 = ДНМ и 5.5 = ДККМ в обеих редакциях
 * случайно и дальше по разделу ломается.
 *
 * Поэтому подразделения сопоставляются ТОЛЬКО по названию и аббревиатуре, а
 * функции — только по тексту. Номер пункта используется исключительно как
 * адрес цитаты. Сопоставление по номеру дало бы десятки ложных «потерянных
 * функций» — это первое, что заметил бы проверяющий эксперт.
 */

const UNIT_LIST_RE = /^3\.4[а-яё]$/u;
const OWNER_HEADER_RE = /^5\.\d+$/u;
const ORG_FUNCTIONS_RE = /^2\.4(\.\d+)*[а-яё]?$/u;
/** «Директоры департаментов обязаны…» — заголовок, общий для всех департаментов. */
const GENERIC_OWNER_RE = /директор[ыао]*\s+департаментов/iu;

/** «Департамент операционного аудита (ДОА).» -> { name, abbr } */
function parseUnitName(text) {
  const cleaned = text.replace(/\.$/, '').trim();
  const m = cleaned.match(/^(.*?)\s*\(([А-ЯЁA-Z]{2,})\)\s*$/u);
  if (m) return { name: m[1].trim(), abbr: m[2].trim() };
  return { name: cleaned, abbr: null };
}

export function normalizeText(s) {
  return (s || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]+/gu, ' ')
    .trim();
}

/** Значимые слова названия — по ним владелец узнаётся в заголовке пункта. */
function nameKeywords(name) {
  const stop = new Set(['департамент', 'департамента', 'управление', 'отдел', 'системы', 'и', 'по']);
  return normalizeText(name)
    .split(' ')
    .filter((w) => w.length > 3 && !stop.has(w));
}

/**
 * Подразделения из пункта 3.4 «БВА состоит из следующих структурных подразделений».
 * @returns {Array<{name: string, abbr: string|null, ref: string}>}
 */
export function extractUnits(doc) {
  return doc.clauses
    .filter((c) => c.number && UNIT_LIST_RE.test(c.number))
    .map((c) => ({ ...parseUnitName(c.text), ref: c.id, number: c.number }));
}

/**
 * Владельцы функций: заголовки вида «5.4. Директор департамента непрерывного
 * мониторинга…». Возвращает карту «номер заголовка -> владелец».
 *
 * Один заголовок может относиться сразу к нескольким подразделениям — в
 * редакции 9 пункт 5.3 озаглавлен «Директоры департаментов и Директоры
 * направлений ДИТААД и ДОА», и это два владельца, а не один.
 */
export function extractOwners(doc, units) {
  const owners = new Map();

  for (const header of doc.clauses.filter((c) => c.number && OWNER_HEADER_RE.test(c.number))) {
    const norm = normalizeText(header.text);
    const matched = units.filter((u) => {
      // \b в JavaScript опирается на ASCII-\w и с кириллицей не работает:
      // /\bДОА\b/ не находит «ДИТААД и ДОА». Границу задаём явно.
      if (u.abbr && new RegExp(`(^|[^A-Za-zА-ЯЁа-яё])${u.abbr}([^A-Za-zА-ЯЁа-яё]|$)`, 'u').test(header.text)) return true;
      const kw = nameKeywords(u.name);
      return kw.length > 0 && kw.every((w) => norm.includes(w));
    });

    // Обобщённый заголовок без конкретных аббревиатур — «Директоры
    // департаментов обязаны…» — относится ко всем департаментам сразу.
    // В редакции 9 так объединили два отдельных блока прав (Директор ДККМ и
    // Директор ДНМ) из редакции 8. Без этого правила их подпункты остаются
    // без владельца и попадают в отчёт как дюжина несуществующих «потерь».
    const generic = matched.length === 0 && GENERIC_OWNER_RE.test(header.text);

    owners.set(header.number, {
      number: header.number,
      ref: header.id,
      title: header.text.replace(/:$/, '').trim(),
      units: generic ? units.map((u) => u.abbr || u.name) : matched.map((u) => u.abbr || u.name),
      generic,
    });
  }

  return owners;
}

/**
 * Функции с владельцами.
 *
 * Берём два источника:
 *  - раздел 2.4 — функции БВА как блока в целом (владелец «БВА»);
 *  - раздел 5 — обязанности по каждому руководителю, владелец определяется
 *    ближайшим сверху заголовком 5.N.
 *
 * Подпункты с буквами («а.», «б.») учитываются наравне с нумерованными: в
 * выданных документах именно в них лежит содержательная часть, включая
 * переносимую функцию про Карту гарантий.
 */
export function extractFunctions(doc, units) {
  const owners = extractOwners(doc, units);
  const out = [];

  for (const clause of doc.clauses) {
    if (!clause.number) continue;

    // Слишком короткие фрагменты — не функции, а артефакты разметки
    // (в редакции 8 встречается пустой пункт «5.5.3. ;»).
    const meaningful = clause.text.replace(/[^а-яёa-z]/giu, '').length > 25;

    if (ORG_FUNCTIONS_RE.test(clause.number)) {
      if (!meaningful) continue;
      out.push({
        ref: clause.id,
        number: clause.number,
        docId: clause.docId,
        text: clause.text,
        owner: 'БВА',
        ownerTitle: 'Блок внутреннего аудита (в целом)',
        scope: 'org',
      });
      continue;
    }

    const headerNumber = clause.number.match(/^(5\.\d+)\./u)?.[1];
    if (!headerNumber) continue;
    const owner = owners.get(headerNumber);
    if (!owner || owner.units.length === 0) continue;
    if (!meaningful) continue;

    for (const unit of owner.units) {
      out.push({
        ref: clause.id,
        number: clause.number,
        docId: clause.docId,
        text: clause.text,
        owner: unit,
        ownerTitle: owner.title,
        scope: 'unit',
      });
    }
  }

  return out;
}

/**
 * Сопоставление подразделений между редакциями (must have 1).
 * Только по аббревиатуре и названию — см. комментарий в шапке файла.
 */
export function diffUnits(unitsBefore, unitsAfter, clauseIndex) {
  const key = (u) => (u.abbr ? u.abbr.toLowerCase() : normalizeText(u.name));
  const beforeMap = new Map(unitsBefore.map((u) => [key(u), u]));
  const afterMap = new Map(unitsAfter.map((u) => [key(u), u]));
  const result = [];

  // Текст цитаты берётся из индекса парсера, а не пересобирается здесь:
  // источник истины для формулировки — всегда исходный документ.
  const cite = (unit) => {
    if (!unit) return null;
    const clause = clauseIndex?.get(unit.ref);
    return {
      ref: unit.ref,
      docId: unit.ref.split('#')[0],
      number: unit.number,
      text: clause ? clause.text : unit.name,
    };
  };

  for (const [k, after] of afterMap) {
    const before = beforeMap.get(k);
    result.push({
      name: after.name,
      abbr: after.abbr,
      status: before ? 'kept' : 'created',
      evidence: [cite(before), cite(after)].filter(Boolean),
      note: before
        ? null
        : 'Подразделение отсутствует в редакции «до» — создано при реорганизации.',
    });
  }

  for (const [k, before] of beforeMap) {
    if (afterMap.has(k)) continue;
    result.push({
      name: before.name,
      abbr: before.abbr,
      status: 'removed',
      evidence: [cite(before)],
      note: 'Подразделение отсутствует в редакции «после».',
    });
  }

  return result;
}
