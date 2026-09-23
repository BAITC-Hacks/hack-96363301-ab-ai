import mammoth from 'mammoth';
import { sourceEvidence } from './evidence.js';

/**
 * Разбор .docx в пронумерованные пункты.
 *
 * Зачем так: по ТЗ (п. 9 «Ограничения») для каждого существенного вывода должна
 * сохраняться прослеживаемость до источника. Поэтому документ разбирается не в
 * сплошной текст, а в список пунктов со стабильными идентификаторами вида
 * `red9#5.3.3`. Дальше модель обязана ссылаться именно на эти идентификаторы, а
 * мы проверяем каждую ссылку на существование — см. verifyCitations.
 */

// «2.4.13.» / «5.3.» / «10.» — номер пункта в начале строки
const CLAUSE_RE = /^(\d+(?:\.\d+)*)(?:[.)]\s*|\s+)/;
// «а.» / «б)» — буквенный подпункт
const LETTER_RE = /^([а-яё])[.)]\s+/i;
// Номер пункта, слипшийся с концом предыдущего абзаца: «...филиалах Общества. 3.10.Работники»
const GLUED_RE = /(?<=[.;:»)])\s+(?=\d+\.\d+\.\s*[А-ЯЁ])/g;

/**
 * Склейки вида «3.9. текст 3.10.Работники...» встречаются в выданных
 * документах регулярно — Word хранит это одним абзацем. Режем их обратно.
 */
function splitGlued(line) {
  return line
    .split(GLUED_RE)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Строка оглавления: «ОБЩИЕ ПОЛОЖЕНИЯ 1», «ТЕРМИНЫ И ОПРЕДЕЛЕНИЯ 34».
 * Признак — заголовок капсом, оканчивающийся номером страницы.
 */
function isTocEntry(text) {
  return /\s\d{1,3}$/.test(text) && text === text.toUpperCase();
}

function normalize(text) {
  return text
    .replace(/ /g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/**
 * @param {Buffer} buffer содержимое .docx
 * @param {string} docId короткий идентификатор документа, например `red9`
 * @returns {Promise<{docId: string, clauses: Array, sections: Array}>}
 */
export async function parseDocx(buffer, docId) {
  const { value } = await mammoth.extractRawText({ buffer });
  return parsePlainText(value, docId);
}

/**
 * Вынесено отдельно, чтобы парсер можно было прогнать на обычном тексте —
 * это делает его тестируемым без бинарных файлов.
 */
export function parsePlainText(raw, docId) {
  const lines = raw
    .split(/\r?\n/)
    .flatMap(splitGlued)
    .map(normalize)
    .filter(Boolean);

  const clauses = [];
  const sections = [];
  const seenSections = new Set();
  const seenNumbers = new Set();
  const letterOccurrences = new Map();

  let currentSection = null;
  let lastNumbered = null;
  let lastClause = null;
  let inTableOfContents = false;

  for (const line of lines) {
    if (/^(оглавление|содержание)$/iu.test(line)) {
      inTableOfContents = true;
      continue;
    }
    const clauseMatch = line.match(CLAUSE_RE);
    if (inTableOfContents) {
      if (isTocEntry(clauseMatch ? line.slice(clauseMatch[0].length).trim() : line)) continue;
      inTableOfContents = false;
    }

    if (clauseMatch) {
      const number = clauseMatch[1];
      const text = line.slice(clauseMatch[0].length).trim();
      const depth = number.split('.').length;

      // Only an exact repetition of a known section title followed by a page
      // number is a clear TOC entry. An uppercase duty ending in a number is not.
      const knownSection = sections.find((section) => section.number === number);
      if (depth === 1 && knownSection && isTocEntry(text)
        && normalize(text.replace(/\s\d{1,3}$/, '')).toUpperCase() === normalize(knownSection.title).toUpperCase()) continue;
      if (seenNumbers.has(number)) {
        throw new Error(`В документе ${docId} повторяется номер пункта ${number}. Уточните нумерацию разделов или приложений: одинаковые номера нельзя безопасно использовать как источники.`);
      }
      seenNumbers.add(number);

      // Верхний уровень («3. Структура и организация работы») — заголовок раздела.
      // В конце документа идёт оглавление, где те же номера повторяются с
      // номерами страниц. Второе вхождение номера — это оглавление, а не раздел.
      if (depth === 1 && !seenSections.has(number) && !isTocEntry(text)) {
        seenSections.add(number);
        currentSection = { number, title: text.split(/\s{2,}/)[0] || text };
        sections.push({ ...currentSection, docId });
      }

      const clause = {
        id: `${docId}#${number}`,
        docId,
        number,
        depth,
        section: currentSection ? currentSection.number : null,
        sectionTitle: currentSection ? currentSection.title : null,
        text,
      };
      clauses.push(clause);
      lastNumbered = clause;
      lastClause = clause;
      continue;
    }

    const letterMatch = line.match(LETTER_RE);
    if (letterMatch && lastNumbered) {
      const letter = letterMatch[1].toLowerCase();
      const originalId = `${lastNumbered.id}${letter}`;
      const occurrence = (letterOccurrences.get(originalId) || 0) + 1;
      letterOccurrences.set(originalId, occurrence);
      // One numbered paragraph may contain several separate lettered lists.
      // Keep each source occurrence instead of overwriting the previous list.
      const clause = {
        id: occurrence === 1 ? originalId : `${lastNumbered.id}.r${occurrence}${letter}`,
        docId,
        number: `${lastNumbered.number}${letter}`,
        depth: lastNumbered.depth + 1,
        section: lastNumbered.section,
        sectionTitle: lastNumbered.sectionTitle,
        text: line.slice(letterMatch[0].length).trim(),
        parent: lastNumbered.id,
      };
      clauses.push(clause);
      lastClause = clause;
      continue;
    }

    // Абзац без номера: приложение к предыдущему пункту, а не отдельная единица.
    if (lastClause) {
      lastClause.text = `${lastClause.text} ${line}`.trim();
    } else {
      // Преамбула до первого номера — титульный лист, гриф утверждения.
      clauses.push({
        id: `${docId}#preamble.${clauses.length}`,
        docId,
        number: null,
        depth: 0,
        section: null,
        sectionTitle: 'Преамбула',
        text: line,
      });
    }
  }

  return { docId, clauses, sections };
}

/**
 * Индекс пунктов по идентификатору — основа проверки ссылок.
 */
export function indexClauses(...parsedDocs) {
  const index = new Map();
  for (const doc of parsedDocs) {
    for (const clause of doc.clauses) {
      if (index.has(clause.id)) throw new Error(`Повторная ссылка на источник ${clause.id}: индекс документов должен содержать уникальные пункты.`);
      index.set(clause.id, clause);
    }
  }
  return index;
}

/**
 * Проверка ссылок, которые вернула модель.
 *
 * Требование ТЗ: «Агент не должен формировать утверждения, не подтверждённые
 * предоставленными документами». Поэтому ссылка на несуществующий пункт — это
 * не мелочь, а признак галлюцинации: такой вывод помечается и не показывается
 * как подтверждённый.
 *
 * @returns {{valid: Array, invalid: Array}}
 */
export function verifyCitations(citations, index) {
  const valid = [];
  const invalid = [];
  for (const ref of citations || []) {
    const clause = index.get(ref);
    if (clause) valid.push(sourceEvidence(clause));
    else invalid.push(ref);
  }
  return { valid, invalid };
}
