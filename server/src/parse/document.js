import { extname } from 'node:path';
import { parseDocx, parsePlainText } from './docx.js';

export function decodeFileName(name) {
  if (!name || [...name].some((c) => c.codePointAt(0) > 255)) return name;
  const decoded = Buffer.from(name, 'latin1').toString('utf8');
  return decoded.includes('\uFFFD') ? name : decoded;
}

export async function parseDocument(buffer, docId, name) {
  const extension = extname(name).toLowerCase();
  if (extension === '.docx') return parseDocx(buffer, docId);
  if (extension === '.pdf') {
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const task = getDocument({ data: new Uint8Array(buffer), useSystemFonts: true, isEvalSupported: false });
    try {
      const pdf = await task.promise;
      const pages = [];
      for (let n = 1; n <= pdf.numPages; n++) {
        const page = await pdf.getPage(n);
        const { items } = await page.getTextContent();
        let lastY = null;
        let text = '';
        for (const item of items) {
          if (!('str' in item)) continue;
          const y = item.transform[5];
          if (lastY !== null && Math.abs(lastY - y) > 3) text += '\n';
          text += item.str + (item.hasEOL ? '\n' : ' ');
          lastY = y;
        }
        pages.push(text);
      }
      if (!pages.join('').trim()) throw new Error('PDF не содержит текстового слоя. Распознайте скан (OCR) и загрузите повторно.');
      return parsePlainText(pages.join('\n'), docId);
    } finally { await task.destroy(); }
  }
  if (extension === '.xlsx') {
    const { default: ExcelJS } = await import('exceljs');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const clauses = [];
    const diagnostics = [];
    workbook.eachSheet((sheet, sheetId) => {
      let columns = null;
      let previousOwner = '';
      sheet.eachRow((row, rowNumber) => {
        const cells = [];
        row.eachCell({ includeEmpty: true }, (cell, col) => { cells[col] = cell.text.trim(); });
        const unitColumn = cells.findIndex((s) => /^(подразделение|департамент|отдел)$/iu.test(s || ''));
        const functionColumn = cells.findIndex((s) => /^(функция|функции|обязанности|задача)$/iu.test(s || ''));
        if (unitColumn > 0 && functionColumn > 0) { columns = { unitColumn, functionColumn }; previousOwner = ''; return; }
        if (!columns) return;
        const owner = cells[columns.unitColumn] || previousOwner;
        previousOwner = owner;
        const number = `${sheet.name}, строка ${rowNumber}`;
        const id = `${docId}#s${sheetId}.r${rowNumber}`;
        const text = cells[columns.functionColumn];
        if (!owner) {
          if (text) {
            clauses.push({ id, docId, number, text, unassignedFunction: true });
            diagnostics.push({ code: 'missing_function_owner', ref: id, detail: `В строке «${number}» указана функция, но не определено подразделение. Строка сохранена как источник и не включена в сопоставление функций.` });
          }
          return;
        }
        clauses.push({ id: `${id}.u`, docId, number, text: owner, unitDefinition: owner });
        if (text) clauses.push({ id, docId, number, text, functionOwner: owner });
      });
    });
    if (!clauses.some((c) => c.unitDefinition || c.functionOwner || c.unassignedFunction)) throw new Error('В XLSX нужны столбцы «Подразделение» и «Функция» (или «Функции», «Обязанности», «Задача»).');
    return { docId, clauses, sections: [], diagnostics };
  }
  throw new Error('Поддерживаются DOCX, PDF с текстовым слоем и XLSX. Сохраните старый Word/Excel в новом формате.');
}
