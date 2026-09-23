import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import ExcelJS from 'exceljs';

const reports = new Map();
const TTL = 2 * 60 * 60 * 1000;
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const uniqueEvidence = (items) => [...new Map(items.map((e) => [e.ref, e])).values()];
export const ACTIONS = {
  assign: 'Предложить ответственного', confirm: 'Подтвердить передачу', accept: 'Оставить совместное участие',
  escalate: 'Передать на согласование', dismiss: 'Отклонить находку',
};
const OPTIONS = {
  lost: ['assign', 'escalate', 'dismiss'], duplicate: ['assign', 'accept', 'escalate', 'dismiss'],
  conflict: ['escalate', 'dismiss'], gap: ['assign', 'escalate', 'dismiss'], moved: ['confirm', 'escalate', 'dismiss'],
};
export const PlanRequest = z.object({
  reportId: z.string().uuid(),
  decisions: z.array(z.object({
    caseId: z.string().max(100), action: z.enum(['assign', 'confirm', 'accept', 'escalate', 'dismiss']),
    owner: z.string().max(300).default(''), note: z.string().trim().min(10).max(2000),
    refs: z.array(z.string().max(100)).min(1).max(100),
  })).max(2000).default([]),
});

// План всегда строится по результату серверного анализа, а не по присланному отчёту.
export function rememberReport(report) {
  for (const [id, entry] of reports) if (entry.expires <= Date.now()) reports.delete(id);
  while (reports.size >= 20) reports.delete(reports.keys().next().value);
  const reportId = randomUUID();
  const saved = { ...report, meta: { ...report.meta, reportId } };
  reports.set(reportId, { report: saved, expires: Date.now() + TTL });
  return saved;
}
export function storedReport(id) {
  const entry = reports.get(id);
  if (!entry || entry.expires <= Date.now()) {
    reports.delete(id);
    const error = new Error('Сессия отчёта истекла. Повторите анализ; сохранённый в браузере план можно восстановить для того же комплекта.');
    error.status = 404;
    throw error;
  }
  return entry.report;
}

export function buildCases(report) {
  const cases = [];
  const add = (kind, title, evidence, candidates = [], currentOwners = []) => {
    const refs = uniqueEvidence(evidence);
    cases.push({ id: `${kind}-${digest([title, refs.map((e) => e.ref)]).slice(0, 20)}`, kind, title,
      evidence: refs, candidates, currentOwners, actions: OPTIONS[kind] });
  };
  for (const f of report.functions.filter((f) => f.change === 'lost'))
    add('lost', f.text, f.evidenceBefore, f.reviewCandidates || [], f.ownerBefore ? [f.ownerBefore] : []);
  for (const c of report.conflicts) add('conflict', c.title, c.evidence, [], c.owners);
  for (const d of report.duplicates) add('duplicate', d.text, d.evidence, [], d.owners);
  for (const g of report.gaps) add('gap', g.title, g.evidence);
  for (const f of report.functions.filter((f) => f.change === 'moved'))
    add('moved', f.text, [...f.evidenceBefore, ...f.evidenceAfter], [], [f.ownerBefore, f.ownerAfter].filter(Boolean));
  return cases;
}

export function buildPlan(report, decisions = []) {
  const cases = buildCases(report);
  const byId = new Map(cases.map((c) => [c.id, c]));
  const owners = report.units.filter((u) => u.status !== 'removed').map((u) => ({ id: u.abbr || u.name, name: u.name }));
  const seen = new Set();
  const checked = decisions.map((d) => {
    const item = byId.get(d.caseId);
    if (!item || seen.has(d.caseId)) throw new Error('Решение относится к неизвестной или повторяющейся находке.');
    seen.add(d.caseId);
    if (!item.actions.includes(d.action)) throw new Error('Это действие не подходит для выбранной находки.');
    if (d.action === 'assign' && !owners.some((u) => u.id === d.owner)) throw new Error('Выберите существующее подразделение новой редакции.');
    const allowed = new Set([...item.evidence, ...item.candidates.map((c) => c.evidence)].map((e) => e.ref));
    if (!d.refs.length || d.refs.some((r) => !allowed.has(r))) throw new Error('Решение ссылается на источник вне выбранной находки.');
    if (d.action === 'confirm' && !['red8', 'red9'].every((docId) => d.refs.some((r) => r.startsWith(`${docId}#`))))
      throw new Error('Для подтверждения передачи выберите источники обеих редакций.');
    if (d.note.trim().length < 10) throw new Error('Добавьте содержательное обоснование решения.');
    let proposal = null;
    if (d.action === 'assign') proposal = item.kind === 'gap'
      ? `Предлагается поручить подразделению «${d.owner}» подготовить уточнение описания функций. Основание: ${d.note}`
      : `Проект решения: закрепить ответственность за подразделением «${d.owner}» по обязанности «${item.title}». Обоснование: ${d.note}`;
    return { ...d, owner: d.action === 'assign' ? d.owner : '', refs: [...new Set(d.refs)], proposal };
  });
  const escalated = checked.filter((d) => d.action === 'escalate').length;
  return {
    fingerprint: digest({ before: report.meta.before, after: report.meta.after, cases, owners,
      functions: report.functions.map((f) => [f.change, f.ownerBefore, f.ownerAfter, f.evidenceBefore, f.evidenceAfter]) }),
    cases, owners, decisions: checked,
    stats: { total: cases.length, reviewed: checked.length, pending: cases.length - checked.length,
      escalated, unresolved: cases.length - checked.length + escalated, proposed: checked.filter((d) => d.action === 'assign').length },
    notice: 'Это рабочий план пользователя. Решения и проекты формулировок не изменяют исходные документы и не подтверждают устранение рисков. Требуется согласование.',
  };
}

export async function exportPlan(report, plan) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'OrgDiff';
  workbook.created = new Date();
  const overview = workbook.addWorksheet('Обзор');
  overview.columns = [{ header: 'Показатель', width: 38 }, { header: 'Значение', width: 110 }];
  overview.addRows([
    ['Документ до', report.meta.before.name], ['Документ после', report.meta.after.name],
    ['Дата анализа', report.meta.generatedAt], ['Всего находок', plan.stats.total], ['Решений пользователя', plan.stats.reviewed],
    ['Осталось без решения или на согласовании', plan.stats.unresolved], ['Предложений о назначении', plan.stats.proposed],
    ['Статус', 'ПРОЕКТ — требует согласования'], ['Ограничение', plan.notice], ['Идентификатор комплекта', plan.fingerprint],
  ]);
  const sources = workbook.addWorksheet('Источники');
  sources.columns = [{ header: 'Ссылка', width: 25 }, { header: 'Документ', width: 60 }, { header: 'Пункт / строка', width: 30 }, { header: 'Точная цитата', width: 110 }];
  const sourceRows = new Map();
  for (const e of uniqueEvidence([
    ...plan.cases.flatMap((c) => [...c.evidence, ...c.candidates.map((v) => v.evidence)]),
    ...report.functions.flatMap((f) => [...f.evidenceBefore, ...f.evidenceAfter]),
  ])) {
    const row = sources.addRow([e.ref, e.docId === 'red8' ? report.meta.before.name : report.meta.after.name, e.number, e.text.slice(0, 32767)]);
    sourceRows.set(e.ref, row.number);
  }
  const decisions = new Map(plan.decisions.map((d) => [d.caseId, d]));
  const sheet = workbook.addWorksheet('План решений');
  sheet.columns = [
    { header: 'ID', width: 28 }, { header: 'Тип', width: 25 }, { header: 'Находка', width: 90 },
    { header: 'Решение пользователя', width: 32 }, { header: 'Предлагаемый ответственный', width: 35 },
    { header: 'Обоснование', width: 80 }, { header: 'Источники решения', width: 45 },
    { header: 'Открыть первый источник', width: 28 }, { header: 'Проект формулировки', width: 110 },
  ];
  const labels = { lost: 'Возможная утрата', duplicate: 'Пересечение', conflict: 'Потенциальный конфликт', gap: 'Описание функций', moved: 'Передача' };
  for (const c of plan.cases) {
    const d = decisions.get(c.id);
    const refs = d?.refs || c.evidence.map((e) => e.ref);
    sheet.addRow([c.id, labels[c.kind], c.title.slice(0, 32767), d ? ACTIONS[d.action] : 'Не рассмотрено', d?.owner || '',
      d?.note || '', refs.join(', '), refs.length ? { text: refs[0], hyperlink: `#'Источники'!A${sourceRows.get(refs[0])}` } : '', d?.proposal || '']);
  }
  const functions = workbook.addWorksheet('Сопоставление функций');
  functions.columns = [{ header: 'Изменение', width: 25 }, { header: 'Функция', width: 110 }, { header: 'Владелец до', width: 35 }, { header: 'Владелец после', width: 35 }, { header: 'Источники', width: 60 }];
  for (const f of report.functions) functions.addRow([f.change, f.text.slice(0, 32767), f.ownerBefore || '', f.ownerAfter || '', [...f.evidenceBefore, ...f.evidenceAfter].map((e) => e.ref).join(', ')]);
  workbook.eachSheet((s) => {
    s.views = [{ state: 'frozen', ySplit: 1 }];
    s.autoFilter = { from: { row: 1, column: 1 }, to: { row: s.rowCount, column: s.columnCount } };
    s.eachRow((row, n) => {
      row.alignment = { vertical: 'top', wrapText: true };
      row.height = n === 1 ? 32 : 60;
      if (n === 1) { row.font = { bold: true, color: { argb: 'FFFFFFFF' } }; row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF172B4D' } }; }
    });
  });
  return workbook.xlsx.writeBuffer();
}
