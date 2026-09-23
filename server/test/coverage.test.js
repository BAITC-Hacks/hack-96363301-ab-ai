import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ExcelJS from 'exceljs';
import { parsePlainText } from '../src/parse/docx.js';
import { extractUnits, extractFunctions } from '../src/analysis/units.js';
import { describeCoverage } from '../src/analysis/quality.js';
import { analyze } from '../src/pipeline.js';
import { buildPlan, exportPlan } from '../src/planning.js';
process.env.OPENAI_API_KEY = '';

test('Явная роль без подразделения участвует в сравнении и видна в паспорте с источниками', () => {
  const doc = parsePlainText(`1. Состав
1.1. Отдел контроля (ОК).
2. Обязанности
2.1. Начальник ОК:
2.1.1. Согласует договоры.
2.2. Руководитель неизвестного подразделения:
2.2.1. Проводит проверку договоров с поставщиками.
2.2.2. Оценивает финансовые риски исполнения договоров.`, 'red8');
  const units = extractUnits(doc);
  const functions = extractFunctions(doc, units);
  const result = describeCoverage(doc, units, functions, 'до.docx');
  assert.equal(result.document.functionClauses, 3);
  assert.equal(result.document.unassignedClauses, 0);
  assert.equal(result.warnings[0].code, 'role_owner');
  assert.equal(units.length, 1);
  assert.ok(functions.filter((f) => f.ref.startsWith('red8#2.2.')).every((f) => f.owner.startsWith('Роль: ')));
  assert.deepEqual(result.warnings[0].evidence.map((e) => e.ref), ['red8#2.2', 'red8#2.2.1', 'red8#2.2.2']);
});

test('Общая обязанность нескольких подразделений считается одним пунктом и явно отмечена', () => {
  const doc = parsePlainText(`1. Состав
1.1. Департамент аудита (ДА).
1.2. Департамент контроля (ДК).
2. Обязанности
2.1. Директоры департаментов обязаны:
2.1.1. Вести реестр договоров.`, 'red9');
  const units = extractUnits(doc);
  const result = describeCoverage(doc, units, extractFunctions(doc, units), 'после.docx');
  assert.equal(result.document.functionClauses, 1);
  assert.equal(result.document.ownerBindings, 2);
  assert.equal(result.document.unassignedClauses, 0);
  assert.equal(result.warnings[0].code, 'generic_owner');
});

test('Потерянная при разборе Excel строка не маскируется: предупреждение, заключение и экспорт', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Функции');
  sheet.addRows([['Подразделение', 'Функция'], ['', 'Хранит архив протоколов заседаний комиссии.'], ['Отдел контроля (ОК)', 'Проверяет соблюдение требований качества.']]);
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const report = await analyze({ beforeBuffer: buffer, beforeName: 'до.xlsx', afterBuffer: buffer, afterName: 'после.xlsx' });
  assert.equal(report.functions.length, 1);
  assert.equal(report.quality.documents[0].unassignedClauses, 1);
  assert.ok(report.quality.checkedReferences >= report.quality.uniqueSources);
  assert.match(report.conclusion.summary, /часть пунктов не включена/);
  assert.equal(report.quality.warnings[0].evidence[0].ref, 'red8#s1.r2');
  assert.equal(report.quality.warnings[0].evidence[0].text, 'Хранит архив протоколов заседаний комиссии.');
  const changedSource = structuredClone(report);
  changedSource.quality.warnings[0].evidence[0].text = 'Хранит оригиналы договоров.';
  assert.notEqual(buildPlan(changedSource).fingerprint, buildPlan(report).fingerprint);
  const exported = new ExcelJS.Workbook();
  await exported.xlsx.load(await exportPlan(report, buildPlan(report)));
  const quality = exported.getWorksheet('Качество анализа');
  const sources = exported.getWorksheet('Источники');
  let found = false;
  quality.eachRow((row) => {
    if (row.getCell(2).text !== 'missing_function_owner') return;
    const link = row.getCell(6).value;
    const sourceRow = Number(link.hyperlink.match(/!A(\d+)$/)[1]);
    assert.equal(sources.getCell(`A${sourceRow}`).text, link.text);
    assert.equal(sources.getCell(`D${sourceRow}`).text, 'Хранит архив протоколов заседаний комиссии.');
    found = true;
  });
  assert.ok(found);
});

test('Обычный учебный комплект проходит аудит всех цитат и отражает шесть/шесть исходных строк', async () => {
  const report = await analyze({
    beforeBuffer: await readFile(new URL('../../data/countercheck_before.xlsx', import.meta.url)), beforeName: 'до.xlsx',
    afterBuffer: await readFile(new URL('../../data/countercheck_after.xlsx', import.meta.url)), afterName: 'после.xlsx',
  });
  assert.deepEqual(report.quality.documents.map((d) => d.functionClauses), [6, 6]);
  assert.deepEqual(report.quality.warnings, []);
  assert.ok(report.quality.checkedReferences > 0);
  assert.ok(report.trace.some((s) => /Проверка всех цитат/.test(s.step)));
});

test('Все 20 обязанностей прежней роли организатора включены без вымышленного подразделения', async () => {
  const report = await analyze({
    beforeBuffer: await readFile(new URL('../../data/polozhenie_red8_before.docx', import.meta.url)), beforeName: 'до.docx',
    afterBuffer: await readFile(new URL('../../data/polozhenie_red9_after.docx', import.meta.url)), afterName: 'после.docx',
  });
  assert.equal(report.units.length, 4);
  assert.ok(report.units.every((u) => !u.name.startsWith('Роль:')));
  const role = report.functions.filter((f) => f.ownerBefore?.startsWith('Роль: Директор направления внутреннего аудита'));
  assert.equal(role.length, 20);
  assert.ok(role.every((f) => f.evidenceBefore[0].ref.startsWith('red8#5.3.')));
  assert.deepEqual(role.filter((f) => f.change === 'lost').map((f) => f.evidenceBefore[0].number), ['5.3.3', '5.3.4', '5.3.11']);
  assert.ok(report.quality.warnings.some((w) => w.code === 'role_owner' && w.evidence[0].ref === 'red8#5.3'));
});
