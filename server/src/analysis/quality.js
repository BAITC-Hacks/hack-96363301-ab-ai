import { extractOwners } from './units.js';

const childOf = (number, parent) => number !== parent &&
  (number.startsWith(`${parent}.`) || (number.startsWith(parent) && /^[а-яё]$/u.test(number.slice(parent.length))));
const cite = (clause) => ({ ref: clause.id, docId: clause.docId, number: clause.number, text: clause.text });

/** Counts describe recognized structure, never an invented completeness percentage. */
export function describeCoverage(doc, units, functions, name) {
  const warnings = [];
  const byId = new Map(doc.clauses.map((c) => [c.id, c]));
  const functionRefs = new Set(functions.map((f) => f.ref));
  const owners = extractOwners(doc, units);
  const unassigned = new Set();
  for (const header of owners.values()) {
    const children = doc.clauses.filter((c) => c.number && childOf(c.number, header.number) &&
      /[а-яёa-z]/iu.test(c.text) && !owners.has(c.number) &&
      [...owners.keys()].filter((n) => childOf(c.number, n)).sort((a, b) => b.length - a.length)[0] === header.number);
    if (!children.length) continue;
    const source = byId.get(header.ref);
    if (!header.units.length) {
      const included = children.filter((c) => functionRefs.has(c.id));
      if (included.length) warnings.push({ code: 'role_owner', title: `Сопоставлено по роли руководителя: ${included.length} пунктов`,
        detail: `Блок «${header.title}» не связан с отдельным подразделением в распознанном составе. Обязанности включены в сравнение с владельцем «Роль: ${header.title}». Это не создание подразделения; проверьте связь роли с организационной структурой.`,
        evidence: [source, ...included].filter(Boolean).map(cite) });
      const excluded = children.filter((c) => !functionRefs.has(c.id));
      if (!excluded.length) continue;
      excluded.forEach((c) => unassigned.add(c.id));
      warnings.push({ code: 'unresolved_owner', title: `Не определено подразделение: ${excluded.length} пунктов`,
        detail: `Блок «${header.title}» не сопоставлен с распознанным составом подразделений. Эти пункты не включены в сравнение функций; проверьте владельца и структуру документа.`,
        evidence: [source, ...excluded].filter(Boolean).map(cite) });
    } else if (header.generic) {
      warnings.push({ code: 'generic_owner', title: 'Владельцы определены по общему заголовку',
        detail: `Блок «${header.title}» отнесён ко всем распознанным подразделениям: ${header.units.join(', ')}. Проверьте применимость общего заголовка к каждому из них.`,
        evidence: [source].filter(Boolean).map(cite) });
    }
  }
  for (const diagnostic of doc.diagnostics || []) {
    const source = byId.get(diagnostic.ref);
    if (!source) throw new Error('Диагностика разбора ссылается на отсутствующий фрагмент документа.');
    if (diagnostic.code === 'missing_function_owner') unassigned.add(source.id);
    warnings.push({ code: diagnostic.code, title: 'Функция без указанного подразделения', detail: diagnostic.detail, evidence: [cite(source)] });
  }
  return {
    document: { docId: doc.docId, name, clauses: doc.clauses.length, units: units.length,
      functionClauses: functionRefs.size, ownerBindings: functions.length, unassignedClauses: unassigned.size },
    warnings,
  };
}

export function buildCoverage(inputs) {
  const results = inputs.map(({ doc, units, functions, name }) => describeCoverage(doc, units, functions, name));
  return { documents: results.map((r) => r.document), warnings: results.flatMap((r) => r.warnings), checkedReferences: 0, uniqueSources: 0 };
}
