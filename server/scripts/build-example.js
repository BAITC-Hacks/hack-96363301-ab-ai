import ExcelJS from 'exceljs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
for (const [source, prefix] of [['independent-example', 'example'], ['countercheck-example', 'countercheck']]) {
  const fixture = JSON.parse(await readFile(new URL(`../../fixtures/${source}.json`, import.meta.url), 'utf8'));
  for (const side of ['before', 'after']) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'OrgDiff — синтетический учебный пример';
    workbook.created = new Date('2026-09-23T00:00:00Z');
    workbook.modified = workbook.created;
    const sheet = workbook.addWorksheet('Функции');
    sheet.columns = [{ header: 'Подразделение', key: 'unit', width: 40 }, { header: 'Функция', key: 'function', width: 85 }];
    sheet.addRows(fixture[side]);
    sheet.getRow(1).font = { bold: true };
    sheet.eachRow((row) => { row.alignment = { wrapText: true, vertical: 'top' }; row.height = 32; });
    await workbook.xlsx.writeFile(fileURLToPath(new URL(`../../data/${prefix}_${side}.xlsx`, import.meta.url)));
  }
}
