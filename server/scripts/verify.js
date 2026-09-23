#!/usr/bin/env node
/**
 * Автопроверка по контрольному набору — п. 11 ТЗ «Простая проверка решения».
 *
 * ТЗ предлагает демонстрировать решение на комплекте, где изменения известны
 * заранее, и смотреть, нашёл ли агент эти случаи и указал ли корректные
 * источники. Этот скрипт делает ровно это, только автоматически: прогоняет
 * пайплайн на выданном комплекте и сверяет результат с fixtures/ground-truth.json.
 *
 * Запуск: cd server && npm run verify
 * Ключ API не нужен — проверяются детерминированные выводы.
 * Код возврата 1 при любом расхождении, поэтому годится и для CI.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { analyze } from '../src/pipeline.js';
import { parseDocx, indexClauses } from '../src/parse/docx.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const GREEN = '[32m';
const RED = '[31m';
const DIM = '[2m';
const RESET = '[0m';

const refsOf = (item) => [
  ...(item.evidenceBefore || []),
  ...(item.evidenceAfter || []),
  ...(item.evidence || []),
].map((e) => e.ref);

function runCheck(check, report, clauseIndex) {
  switch (check.type) {
    case 'not-conflict': {
      const bad = report.conflicts.some((c) => refsOf(c).includes(check.ref));
      return { ok: !bad, detail: bad ? 'ложный конфликт' : 'декларирование не посчитано конфликтом' };
    }
    case 'unit': {
      const unit = report.units.find((u) => u.abbr === check.abbr);
      if (!unit) return { ok: false, detail: `подразделение ${check.abbr} не найдено` };
      if (unit.status !== check.status) return { ok: false, detail: `статус ${unit.status}, ожидался ${check.status}` };
      return { ok: true, detail: `${check.abbr}: ${unit.status}` };
    }

    case 'function': {
      const match = report.functions.find(
        (f) => f.change === check.change && refsOf(f).includes(check.refBefore),
      );
      if (!match) return { ok: false, detail: `нет изменения ${check.change} с источником ${check.refBefore}` };
      if (check.refAfter && !refsOf(match).includes(check.refAfter))
        return { ok: false, detail: `не указан пункт «после» ${check.refAfter}` };
      if (check.ownerBefore && match.ownerBefore !== check.ownerBefore)
        return { ok: false, detail: `владелец «до» ${match.ownerBefore}, ожидался ${check.ownerBefore}` };
      if (check.ownerAfter && match.ownerAfter !== check.ownerAfter)
        return { ok: false, detail: `владелец «после» ${match.ownerAfter}, ожидался ${check.ownerAfter}` };
      return { ok: true, detail: `${check.refBefore} → ${refsOf(match).filter((r) => r !== check.refBefore).join(', ') || '—'}` };
    }

    case 'duplicate': {
      const match = report.duplicates.find(
        (d) => d.text.toLowerCase().includes(check.textMatch.toLowerCase()) && d.owners.length >= (check.minOwners || 2),
      );
      return match
        ? { ok: true, detail: `владельцы: ${match.owners.join(', ')}` }
        : { ok: false, detail: `нет группы дублирования по «${check.textMatch}»` };
    }

    case 'conflict': {
      const match = report.conflicts.find((c) =>
        check.refIncludes ? refsOf(c).includes(check.refIncludes) : c.title.includes(check.titleMatch),
      );
      return match ? { ok: true, detail: match.title.slice(0, 60) } : { ok: false, detail: 'конфликт не обнаружен' };
    }

    case 'gap': {
      const titles = report.gaps.map((g) => g.title).join(' | ');
      const missing = check.mentions.filter((m) => !titles.includes(m));
      return missing.length
        ? { ok: false, detail: `не отмечены: ${missing.join(', ')}` }
        : { ok: true, detail: `пробелов: ${report.gaps.length}` };
    }

    case 'count': {
      const n = report[check.collection].length;
      return n >= check.min ? { ok: true, detail: `${n} >= ${check.min}` } : { ok: false, detail: `${n} < ${check.min}` };
    }

    case 'max-count': {
      const n = report[check.collection].filter((x) => !check.change || x.change === check.change).length;
      return n <= check.max ? { ok: true, detail: `${n} <= ${check.max}` } : { ok: false, detail: `${n} > ${check.max}` };
    }

    case 'lost-sources': {
      const actual = report.functions.filter((f) => f.change === 'lost').flatMap((f) => f.evidenceBefore.map((e) => e.ref)).sort();
      const expected = [...check.refs].sort();
      const ok = JSON.stringify(actual) === JSON.stringify(expected);
      return { ok, detail: ok ? `Точные адреса ${actual.length} кандидатов совпали с ручной проверкой` : `Не совпали адреса кандидатов: ${actual.join(', ')}` };
    }

    case 'not-lost': {
      const bad = report.functions.find((f) => f.change === 'lost' && refsOf(f).includes(check.ref));
      return bad ? { ok: false, detail: `${check.ref} ошибочно помечен как потерянный` } : { ok: true, detail: `${check.ref} не в потерях` };
    }

    case 'duplicates-distinct-clauses': {
      const bad = report.duplicates.find((d) => new Set(d.evidence.map((e) => e.ref)).size < 2);
      return bad
        ? { ok: false, detail: `группа ссылается на один пункт: ${bad.text.slice(0, 40)}` }
        : { ok: true, detail: `проверено групп: ${report.duplicates.length}` };
    }

    case 'citations-valid': {
      const all = [...report.units, ...report.functions, ...report.duplicates, ...report.conflicts, ...report.gaps,
        ...report.conclusion.findingEvidence.map((evidence) => ({ evidence })),
        ...report.conclusion.recommendationEvidence.map((evidence) => ({ evidence }))];
      let checked = 0;
      for (const item of all) {
        const evidence = [...(item.evidenceBefore || []), ...(item.evidenceAfter || []), ...(item.evidence || [])];
        if (evidence.length === 0) return { ok: false, detail: 'найден вывод без подтверждающего источника' };
        for (const e of evidence) {
          const clause = clauseIndex.get(e.ref);
          if (!clause) return { ok: false, detail: `ссылка ${e.ref} не существует в документах` };
          if (clause.text !== e.text) return { ok: false, detail: `текст цитаты ${e.ref} расходится с документом` };
          checked += 1;
        }
      }
      return { ok: true, detail: `проверено ссылок: ${checked}` };
    }

    case 'conclusion': {
      const c = report.conclusion;
      if (!c.summary || c.findings.length === 0) return { ok: false, detail: 'заключение пустое' };
      if (!c.disclaimer) return { ok: false, detail: 'нет оговорки о рекомендательном характере' };
      return { ok: true, detail: `${c.findings.length} наблюдений, ${c.recommendations.length} рекомендаций` };
    }

    default:
      return { ok: false, detail: `неизвестный тип проверки: ${check.type}` };
  }
}

async function main() {
  const truth = JSON.parse(await readFile(join(repoRoot, 'fixtures', 'ground-truth.json'), 'utf8'));

  const beforeBuffer = await readFile(join(repoRoot, truth.documents.before));
  const afterBuffer = await readFile(join(repoRoot, truth.documents.after));

  const report = await analyze({
    beforeBuffer,
    beforeName: truth.documents.before,
    afterBuffer,
    afterName: truth.documents.after,
  });

  const clauseIndex = indexClauses(
    await parseDocx(beforeBuffer, 'red8'),
    await parseDocx(afterBuffer, 'red9'),
  );

  console.log('');
  console.log('Проверка по контрольному набору (п. 11 ТЗ «Простая проверка решения»)');
  console.log(`Комплект: ${truth.documents.before} → ${truth.documents.after}`);
  console.log(`Режим: ${report.meta.mode === 'demo' ? 'демо (без API-ключа)' : 'живой (с API-ключом)'}`);
  console.log('');

  let passed = 0;
  let failed = 0;

  const section = (title, items) => {
    console.log(`${DIM}${title}${RESET}`);
    for (const item of items) {
      const { ok, detail } = runCheck(item.check, report, clauseIndex);
      if (ok) passed += 1;
      else failed += 1;
      const mark = ok ? `${GREEN}PASS${RESET}` : `${RED}FAIL${RESET}`;
      const req = item.requirement ? ` ${DIM}[${item.requirement}]${RESET}` : '';
      console.log(`  ${mark}  ${item.id.padEnd(7)} ${item.title}${req}`);
      console.log(`         ${DIM}${detail}${RESET}`);
    }
    console.log('');
  };

  section('ОЖИДАЕТСЯ НАЙТИ', truth.positive);
  section('НЕ ДОЛЖНО СРАБАТЫВАТЬ (проверка на ложные выводы)', truth.negative);

  const total = passed + failed;
  console.log(`ИТОГО: ${passed} из ${total} проверок пройдено${failed ? `, ${RED}провалено ${failed}${RESET}` : `${GREEN} — все${RESET}`}`);
  console.log('');

  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(`${RED}Проверка не выполнена:${RESET} ${err.message}`);
  process.exit(1);
});
