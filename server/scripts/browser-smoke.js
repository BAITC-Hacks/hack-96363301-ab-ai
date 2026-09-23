// Запуск: сервер на :3000, отдельный Chrome с --remote-debugging-port=9333.
// Использует встроенные fetch/WebSocket Node, без библиотек автоматизации.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import ExcelJS from 'exceljs';
const appUrl = process.env.ORGDIFF_TEST_URL || 'http://localhost:3000';
const target = await (await fetch('http://127.0.0.1:9333/json/new?about:blank', { method: 'PUT' })).json();
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let sequence = 0;
const pending = new Map();
const errors = [];
let exportStatus = null;
let uploadResponse = null;
let exampleResponse = null;
let semanticResponse = null;
socket.onmessage = ({ data }) => {
  const message = JSON.parse(data);
  if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
  if (message.method === 'Network.responseReceived' && message.params.response.url.endsWith('/api/plan/export')) exportStatus = message.params.response.status;
  if (message.method === 'Network.responseReceived' && message.params.response.url.endsWith('/api/analyze')) uploadResponse = { requestId: message.params.requestId, status: message.params.response.status };
  if (message.method === 'Network.responseReceived' && message.params.response.url.endsWith('/api/analyze/example')) exampleResponse = { requestId: message.params.requestId, status: message.params.response.status };
  if (message.method === 'Network.responseReceived' && message.params.response.url.endsWith('/api/analyze/semantic')) semanticResponse = { requestId: message.params.requestId, status: message.params.response.status };
  const callback = pending.get(message.id);
  if (callback) { pending.delete(message.id); message.error ? callback.reject(message.error) : callback.resolve(message.result); }
};
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
  return response.result.value;
}
async function until(expression) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Ожидание интерфейса истекло: ${expression}`);
}
try {
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Browser.setDownloadBehavior', { behavior: 'deny' });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: appUrl });
  await until(`location.origin === ${JSON.stringify(new URL(appUrl).origin)} && [...document.querySelectorAll('button')].some(b => b.textContent.includes('Проверить учебный пример'))`);
  await evaluate(`Object.keys(localStorage).filter(k => k.startsWith('orgdiff.plan.')).forEach(k => localStorage.removeItem(k))`);
  await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('Проверить учебный пример')).click()`);
  await until(`!!document.querySelector('[aria-label="Краткие итоги"]')`);
  assert.ok(await evaluate(`!!document.querySelector('[aria-label="Полнота анализа"]')`));
  assert.equal(await evaluate(`document.querySelectorAll('#functions tbody tr').length`), 4);
  assert.equal(await evaluate(`document.querySelector('#trace').open`), false);
  assert.equal(exampleResponse?.status, 200);
  const exampleBody = await send('Network.getResponseBody', { requestId: exampleResponse.requestId });
  const exampleReport = JSON.parse(exampleBody.base64Encoded ? Buffer.from(exampleBody.body, 'base64').toString('utf8') : exampleBody.body);
  const answers = exampleReport.trace.filter(step => step.kind === 'llm' && ['api', 'fixture'].includes(step.source));
  const liveAnswers = answers.filter(step => step.source === 'api').length;
  const expectedTrace = `ответов модели: ${answers.length} (API: ${liveAnswers})`;
  assert.equal(exampleReport.meta.mode, liveAnswers ? 'live' : 'demo');
  assert.ok(await evaluate(`document.querySelector('#trace').textContent.includes(${JSON.stringify(expectedTrace)})`));
  await until(`document.querySelector('[aria-label="Прогресс рассмотрения"]')?.textContent.includes('Находок')`);
  await evaluate(`document.querySelector('#reorganization-lab svg [role="button"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
  assert.ok(await evaluate(`document.querySelector('#map-panel').textContent.includes('Проверить переход по источникам')`));
  if (process.argv.includes('--screenshots')) {
    await evaluate(`document.querySelector('#reorganization-lab').scrollIntoView({behavior:'instant'})`);
    const screenshot = await send('Page.captureScreenshot', { format: 'png' });
    await writeFile(new URL('../../docs/screenshots/07-responsibility-map.png', import.meta.url), Buffer.from(screenshot.data, 'base64'));
  }
  await evaluate(`document.querySelector('#decisions-tab').click()`);
  await until(`!!document.querySelector('select[aria-label="Ответственное подразделение"]')`);
  await evaluate(`(() => {
    const owner = document.querySelector('select[aria-label="Ответственное подразделение"]');
    owner.value = 'ОА'; owner.dispatchEvent(new Event('change', { bubbles: true }));
    const note = document.querySelector('textarea[aria-label="Обоснование решения"]');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(note, 'Предлагается передать хранение бумажного архива отделу аналитики. Сроки передачи согласовать с владельцем процесса.');
    note.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await until(`[...document.querySelectorAll('button')].some(b => b.textContent === 'Сохранить решение' && !b.disabled)`);
  await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent === 'Сохранить решение').click()`);
  await until(`document.querySelector('#decisions-panel').textContent.includes('Проект решения:')`);
  assert.ok(await evaluate(`document.querySelector('[aria-label="Прогресс рассмотрения"]').textContent.includes('1Решений пользователя')`));
  await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('Выгрузить план в Excel')).click()`);
  await until(`document.querySelector('#reorganization-lab').textContent.includes('Excel сформирован:')`);
  assert.equal(exportStatus, 200);
  if (process.argv.includes('--screenshots')) {
    await evaluate(`document.querySelector('#reorganization-lab').scrollIntoView({behavior:'instant'})`);
    const screenshot = await send('Page.captureScreenshot', { format: 'png' });
    await writeFile(new URL('../../docs/screenshots/08-decision-workbench.png', import.meta.url), Buffer.from(screenshot.data, 'base64'));
  }
  await evaluate(`[...document.querySelectorAll('#functions button')].find(b => b.textContent.includes('Все (')).click()`);
  await until(`document.querySelectorAll('#functions tbody tr').length === 6`);
  await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('Проверить учебный пример')).click()`);
  await until(`document.querySelector('#reorganization-lab')?.textContent.includes('Восстановлен план')`);
  assert.ok(await evaluate(`document.querySelector('[aria-label="Прогресс рассмотрения"]').textContent.includes('1Решений пользователя')`));
  await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('Проанализировать демо-комплект')).click()`);
  await until(`!!document.querySelector('[aria-label="Краткие итоги"]') && document.body.textContent.includes('редакция 8 (до).docx')`);
  assert.ok(await evaluate(`document.querySelector('#functions').textContent.includes('Похожие пункты для ручной проверки')`));
  assert.ok(await evaluate(`document.querySelector('#conclusion').querySelectorAll('details').length > 0`));
  if (process.argv.includes('--screenshots')) {
    await until(`!!document.querySelector('[aria-label="Прогресс рассмотрения"]')`);
    await evaluate(`document.querySelector('#map-tab').click()`);
    await evaluate(`document.querySelector('#reorganization-lab').scrollIntoView({behavior:'instant'})`);
    const screenshot = await send('Page.captureScreenshot', { format: 'png' });
    await writeFile(new URL('../../docs/screenshots/09-organizer-map.png', import.meta.url), Buffer.from(screenshot.data, 'base64'));
  }
  await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('Найти скрытые изменения')).click()`);
  await until(`document.querySelectorAll('#countercheck-panel article').length === 4`);
  await until(`[...document.querySelectorAll('#countercheck-panel button')].some(b => b.textContent === 'Рассмотреть в плане')`);
  assert.ok(await evaluate(`document.querySelector('#countercheck-panel').textContent.includes('100%')`));
  assert.equal(await evaluate(`document.querySelectorAll('#countercheck-panel article mark').length`), 8);
  assert.equal(await evaluate(`document.querySelectorAll('#functions tbody tr').length`), 4);
  await evaluate(`[...document.querySelectorAll('#countercheck-panel button')].find(b => b.textContent.includes('Сроки и периодичность')).click()`);
  await until(`document.querySelectorAll('#countercheck-panel article').length === 1`);
  assert.ok(await evaluate(`document.querySelector('#countercheck-panel article').textContent.includes('ежеквартально')`));
  await evaluate(`[...document.querySelectorAll('#countercheck-panel button')].find(b => b.textContent.includes('Все сигналы')).click()`);
  if (process.argv.includes('--screenshots')) {
    await evaluate(`document.documentElement.style.scrollBehavior = 'auto'; window.scrollTo({top:0,behavior:'instant'}); document.querySelector('#countercheck-panel').scrollIntoView({behavior:'instant'})`);
    await new Promise((resolve) => setTimeout(resolve, 400));
    const screenshot = await send('Page.captureScreenshot', { format: 'png' });
    await writeFile(new URL('../../docs/screenshots/10-countercheck.png', import.meta.url), Buffer.from(screenshot.data, 'base64'));
  }
  await evaluate(`[...document.querySelectorAll('#countercheck-panel button')].find(b => b.textContent === 'Рассмотреть в плане').click()`);
  await until(`document.querySelector('#decisions-panel')?.textContent.includes('Изменена формулировка запрета')`);
  assert.equal(await evaluate(`document.querySelector('select[aria-label="Решение пользователя"]').value`), 'escalate');
  await evaluate(`(() => {
    const note = document.querySelector('textarea[aria-label="Обоснование решения"]');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(note, 'Уточнить намеренность запрета согласования договоров по обеим редакциям.');
    note.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await evaluate(`document.querySelector('#decisions-panel input[type="checkbox"]').click()`);
  assert.ok(await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent === 'Сохранить решение').disabled`));
  await evaluate(`document.querySelector('#decisions-panel input[type="checkbox"]').click()`);
  await until(`[...document.querySelectorAll('button')].some(b => b.textContent === 'Сохранить решение' && !b.disabled)`);
  await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent === 'Сохранить решение').click()`);
  await until(`document.querySelector('[aria-label="Прогресс рассмотрения"]').textContent.includes('1Решений пользователя')`);
  assert.ok(await evaluate(`document.querySelector('[aria-label="Прогресс рассмотрения"]').textContent.includes('4Без решения / на согласовании')`));
  await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('Выгрузить план в Excel')).click()`);
  await until(`document.querySelector('#reorganization-lab').textContent.includes('Excel сформирован:')`);
  assert.equal(exportStatus, 200);
  // Реальная загрузка пары XLSX через файловые поля, включая нераспознанного владельца.
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet('Функции').addRows([['Подразделение', 'Функция'], ['', 'Хранит архив протоколов комиссии.'], ['Отдел контроля (ОК)', 'Согласует договоры.']]);
  const uploadBase64 = Buffer.from(await workbook.xlsx.writeBuffer()).toString('base64');
  await evaluate(`(() => {
    const inputs = [...document.querySelectorAll('input[type="file"]')];
    inputs[0].closest('details').open = true;
    const bytes = Uint8Array.from(atob('${uploadBase64}'), c => c.charCodeAt(0));
    inputs.forEach((input, i) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], i ? 'Проверка полноты после.xlsx' : 'Проверка полноты до.xlsx', {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
      input.files = transfer.files; input.dispatchEvent(new Event('change', {bubbles:true}));
    });
  })()`);
  await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent === 'Проанализировать загруженные документы').click()`);
  await until(`document.querySelector('[aria-label="Полнота анализа"]')?.textContent.includes('Хранит архив протоколов комиссии.')`);
  assert.equal(await evaluate(`document.querySelector('[aria-label="Полнота анализа"]').open`), true);
  assert.ok(await evaluate(`document.querySelector('#conclusion').textContent.includes('часть пунктов не включена')`));
  assert.ok(await evaluate(`document.querySelector('[aria-label="Полнота анализа"]').textContent.includes('Проверено ссылок в отчёте')`));
  if (process.argv.includes('--screenshots')) {
    await evaluate(`document.documentElement.style.scrollBehavior = 'auto'; document.querySelector('[aria-label="Полнота анализа"]').scrollIntoView({behavior:'instant'})`);
    await new Promise((resolve) => setTimeout(resolve, 400));
    const screenshot = await send('Page.captureScreenshot', { format: 'png' });
    await writeFile(new URL('../../docs/screenshots/11-analysis-coverage.png', import.meta.url), Buffer.from(screenshot.data, 'base64'));
  }

  // Полный сценарий комплектов: повторные multipart-поля, одинаковые адреса
  // строк в разных книгах, редактирование списка и точное имя каждого источника.
  const collectionSpecs = [
    { side: 0, name: 'Договоры — до.xlsx', owner: 'Отдел договоров (ОД)', text: 'Проверяет исполнение договоров поставщиками.' },
    { side: 0, name: 'Архив — до.xlsx', owner: 'Отдел архива (ОАР)', text: 'Хранит бумажный архив протоколов заседаний комиссии.' },
    { side: 1, name: 'Договоры — после.xlsx', owner: 'Отдел договоров (ОД)', text: 'Проверяет исполнение договоров поставщиками.' },
    { side: 1, name: 'Архив — после.xlsx', owner: 'Отдел архива (ОАР)', text: 'Хранит электронный архив протоколов заседаний комиссии.' },
  ];
  const collectionUploads = await Promise.all(collectionSpecs.map(async (spec, index) => {
    const book = new ExcelJS.Workbook();
    book.addWorksheet('Функции').addRows([['Подразделение', 'Функция'], [spec.owner, spec.text]]);
    return { ...spec, lastModified: 1700000000000 + index, base64: Buffer.from(await book.xlsx.writeBuffer()).toString('base64') };
  }));
  const expectedNames = [0, 1].map((side) => collectionSpecs.filter((file) => file.side === side).map((file) => file.name));
  const selectedNames = `[...document.querySelectorAll('input[type="file"]')].map(input => [...input.parentElement.querySelectorAll('ul > li > div > p:first-child')].map(p => p.textContent))`;
  await evaluate(`(() => {
    document.querySelector('input[type="file"]').closest('details').open = true;
    [...document.querySelectorAll('button[aria-label^="Убрать "]')].forEach(button => button.click());
  })()`);
  await until(`${selectedNames}.every(names => names.length === 0)`);
  assert.equal(await evaluate(`document.querySelectorAll('input[type="file"][multiple]').length`), 2);
  await evaluate(`(() => {
    const files = ${JSON.stringify(collectionUploads)};
    [...document.querySelectorAll('input[type="file"]')].forEach((input, side) => {
      const transfer = new DataTransfer();
      files.filter(file => file.side === side).forEach(file => {
        const bytes = Uint8Array.from(atob(file.base64), c => c.charCodeAt(0));
        transfer.items.add(new File([bytes], file.name, {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', lastModified:file.lastModified}));
      });
      input.files = transfer.files; input.dispatchEvent(new Event('change', {bubbles:true}));
    });
  })()`);
  await until(`${selectedNames}.every(names => names.length === 2)`);
  assert.deepEqual(await evaluate(selectedNames), expectedNames);
  await evaluate(`[...document.querySelectorAll('button[aria-label]')].find(button => button.getAttribute('aria-label').startsWith(${JSON.stringify(`Убрать ${collectionSpecs[1].name} —`)})).click()`);
  await until(`${selectedNames}[0].length === 1`);
  assert.deepEqual(await evaluate(selectedNames), [[expectedNames[0][0]], expectedNames[1]]);
  await evaluate(`(() => {
    const file = ${JSON.stringify(collectionUploads[1])};
    const transfer = new DataTransfer();
    const bytes = Uint8Array.from(atob(file.base64), c => c.charCodeAt(0));
    transfer.items.add(new File([bytes], file.name, {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', lastModified:file.lastModified}));
    const input = document.querySelector('input[type="file"]');
    input.files = transfer.files; input.dispatchEvent(new Event('change', {bubbles:true}));
  })()`);
  await until(`${selectedNames}.every(names => names.length === 2)`);
  assert.deepEqual(await evaluate(selectedNames), expectedNames);
  assert.ok(await evaluate(`document.querySelector('input[type="file"]').closest('details').textContent.includes('Всего файлов: 4')`));
  uploadResponse = null;
  await evaluate(`[...document.querySelectorAll('button')].find(button => button.textContent === 'Проанализировать загруженные документы').click()`);
  await until(`document.querySelector('#analysis-quality')?.querySelectorAll('section > h3').length === 4 && document.querySelector('#analysis-quality').textContent.includes(${JSON.stringify(collectionSpecs[0].name)})`);
  assert.equal(uploadResponse?.status, 200);
  const responseBody = await send('Network.getResponseBody', { requestId: uploadResponse.requestId });
  const collectionReport = JSON.parse(responseBody.base64Encoded ? Buffer.from(responseBody.body, 'base64').toString('utf8') : responseBody.body);
  assert.deepEqual(collectionReport.meta.before.documents.map((document) => document.name).sort(), [...expectedNames[0]].sort());
  assert.deepEqual(collectionReport.meta.after.documents.map((document) => document.name).sort(), [...expectedNames[1]].sort());
  assert.equal(collectionReport.quality.documents.length, 4);
  assert.deepEqual(collectionReport.quality.documents.map((document) => document.name).sort(), collectionSpecs.map((file) => file.name).sort());
  assert.equal(collectionReport.functions.length, 2);
  assert.equal(collectionReport.units.length, 2);
  const citations = collectionReport.functions.flatMap((fn) => [...fn.evidenceBefore, ...fn.evidenceAfter]);
  assert.equal(new Set(citations.map((source) => source.ref)).size, 4);
  for (const source of citations) {
    const file = collectionSpecs.find((spec) => spec.name === source.fileName);
    assert.ok(file, `У цитаты должно быть точное имя файла: ${source.ref}`);
    assert.equal(source.text, file.text);
    assert.equal(source.number, 'Функции, строка 2');
    assert.equal(source.docId, file.side ? 'red9' : 'red8');
    assert.ok(source.ref.startsWith(`${source.docId}#${source.fileId}.`));
  }
  await evaluate(`document.querySelector('#analysis-quality').open = true; [...document.querySelectorAll('#functions button')].find(button => button.textContent.includes('Все (')).click()`);
  await until(`document.querySelectorAll('#functions tbody tr').length === 2`);
  await evaluate(`document.querySelectorAll('#functions details').forEach(details => { details.open = true; })`);
  for (const file of collectionSpecs) {
    assert.ok(await evaluate(`[...document.querySelectorAll('#functions li')].some(li => li.textContent.includes(${JSON.stringify(file.name)}) && [...li.querySelectorAll('blockquote')].some(quote => quote.textContent === ${JSON.stringify(`«${file.text}»`)}))`), `Имя и цитата должны отображаться вместе: ${file.name}`);
    assert.ok(await evaluate(`document.querySelector('#analysis-quality').textContent.includes(${JSON.stringify(file.name)})`));
    assert.ok(await evaluate(`document.querySelector('[aria-label="Документы отчёта"]')?.textContent.includes(${JSON.stringify(file.name)})`), `Метаданные должны показывать файл: ${file.name}`);
  }
  await until(`[...document.querySelectorAll('button')].some(button => button.textContent.includes('Выгрузить план в Excel') && !button.disabled)`);
  exportStatus = null;
  await evaluate(`[...document.querySelectorAll('button')].find(button => button.textContent.includes('Выгрузить план в Excel')).click()`);
  await until(`document.querySelector('#reorganization-lab').textContent.includes('Excel сформирован:')`);
  assert.equal(exportStatus, 200);
  if (process.argv.includes('--screenshots')) {
    await evaluate(`document.documentElement.style.scrollBehavior = 'auto'; document.querySelector('[aria-label="Документы отчёта"]').scrollIntoView({behavior:'instant'})`);
    await new Promise((resolve) => setTimeout(resolve, 400));
    const screenshot = await send('Page.captureScreenshot', { format: 'png' });
    await writeFile(new URL('../../docs/screenshots/12-document-collection.png', import.meta.url), Buffer.from(screenshot.data, 'base64'));
  }
  await evaluate(`document.querySelector('input[type="file"]').closest('details').open = true; [...document.querySelectorAll('button')].find(button => button.textContent === 'Найти переформулировки').click()`);
  await until(`document.querySelector('#semantic-review')?.dataset.status === 'completed'`);
  assert.equal(semanticResponse?.status, 200);
  const semanticBody = await send('Network.getResponseBody', { requestId: semanticResponse.requestId });
  const semanticReport = JSON.parse(semanticBody.base64Encoded ? Buffer.from(semanticBody.body, 'base64').toString('utf8') : semanticBody.body);
  const review = semanticReport.semanticReview;
  const proposals = review.items.filter(item => ['candidate', 'meaning_changed'].includes(item.status));
  assert.ok(proposals.length > 0, 'Учебный комплект должен дать пары для просмотра');
  assert.equal(await evaluate(`document.querySelector('#semantic-review').dataset.source`), review.source);
  assert.equal(await evaluate(`Number(document.querySelector('[data-semantic-metric="proposals"]').textContent)`), proposals.length);
  assert.equal(semanticReport.functions.filter(item => item.change === 'lost').length, 8, 'Гипотезы не скрывают исходные кандидаты на утрату');
  for (const item of proposals) {
    const selector = `[data-before-ref="${item.beforeRef}"]`;
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(selector)}).dataset.semanticStatus`), item.status);
    for (const fragment of [item.beforeFragment, item.afterFragment])
      assert.ok(await evaluate(`document.querySelector(${JSON.stringify(selector)}).textContent.includes(${JSON.stringify(fragment)})`));
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).querySelector('details').open = true`);
    for (const evidence of [item.evidenceBefore, item.evidenceAfter])
      assert.ok(await evaluate(`document.querySelector(${JSON.stringify(selector)}).textContent.includes(${JSON.stringify(evidence.text)})`));
  }
  await evaluate(`document.querySelectorAll('#semantic-review details').forEach(details => { details.open = false; })`);
  const changed = proposals.filter(item => item.status === 'meaning_changed');
  if (changed.length) {
    await evaluate(`[...document.querySelectorAll('#semantic-review button')].find(button => button.textContent.includes('Признаки изменения смысла')).click()`);
    assert.equal(await evaluate(`document.querySelectorAll('#semantic-review [data-semantic-status="candidate"]').length`), 0);
    assert.equal(await evaluate(`document.querySelectorAll('#semantic-review [data-semantic-status="meaning_changed"]').length`), changed.length);
    await evaluate(`[...document.querySelectorAll('#semantic-review button')].find(button => button.textContent.includes('Все предложения')).click()`);
  }
  await until(`[...document.querySelectorAll('button')].some(button => button.textContent.includes('Выгрузить план в Excel') && !button.disabled)`);
  exportStatus = null;
  await evaluate(`[...document.querySelectorAll('button')].find(button => button.textContent.includes('Выгрузить план в Excel')).click()`);
  await until(`document.querySelector('#reorganization-lab').textContent.includes('Excel сформирован:')`);
  assert.equal(exportStatus, 200);
  for (const side of ['before', 'after']) {
    const download = await fetch(new URL(`/api/examples/semantic/${side}.xlsx`, appUrl));
    assert.equal(download.status, 200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(await download.arrayBuffer()));
    assert.equal(workbook.worksheets[0].rowCount, 9);
  }
  for (const [width, height, name] of [[1440, 1100, '13-semantic-review.png'], [390, 844, '14-semantic-mobile.png']]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 500 });
    await evaluate(`document.documentElement.style.scrollBehavior = 'auto'; document.querySelector('#semantic-review').scrollIntoView({behavior:'instant'})`);
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.ok(await evaluate(`document.querySelector('#semantic-review').getBoundingClientRect().right <= innerWidth`));
    assert.ok(await evaluate(`document.querySelector('#semantic-review').scrollWidth <= document.querySelector('#semantic-review').clientWidth + 1`));
    const layout = await evaluate(`({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth,
      overflow: [...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > document.documentElement.clientWidth + 1).slice(0, 12).map(e => ({ tag: e.tagName, id: e.id, className: e.className, right: e.getBoundingClientRect().right })) })`);
    assert.ok(layout.scroll <= layout.width + 1, 'Горизонтальное переполнение: ' + JSON.stringify(layout));
    if (process.argv.includes('--semantic-screenshots') || process.argv.includes('--screenshots')) {
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      await writeFile(new URL(`../../docs/screenshots/${name}`, import.meta.url), Buffer.from(shot.data, 'base64'));
    }
  }
  assert.deepEqual(errors, []);
  console.log('PASS: карта, решения, восстановление, демо, контрпроверка, источники и экспорт; загрузка XLSX, паспорт неполного анализа; комплекты 2+2 и имена цитат; смысловой поиск, фильтры, обе цитаты, Excel, загрузка примеров, экран 390 px. Ошибок JavaScript нет.');
} finally {
  await fetch(`http://127.0.0.1:9333/json/close/${target.id}`);
  socket.close();
}
