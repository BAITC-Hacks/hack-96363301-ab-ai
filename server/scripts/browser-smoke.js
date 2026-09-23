// Запуск: сервер на :3000, отдельный Chrome с --remote-debugging-port=9333.
// Использует встроенные fetch/WebSocket Node, без библиотек автоматизации.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
const target = await (await fetch('http://127.0.0.1:9333/json/new?about:blank', { method: 'PUT' })).json();
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let sequence = 0;
const pending = new Map();
const errors = [];
let exportStatus = null;
socket.onmessage = ({ data }) => {
  const message = JSON.parse(data);
  if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
  if (message.method === 'Network.responseReceived' && message.params.response.url.endsWith('/api/plan/export')) exportStatus = message.params.response.status;
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
  await send('Page.navigate', { url: 'http://localhost:3000/' });
  await until(`location.origin === 'http://localhost:3000' && [...document.querySelectorAll('button')].some(b => b.textContent.includes('Проверить учебный пример'))`);
  await evaluate(`Object.keys(localStorage).filter(k => k.startsWith('orgdiff.plan.')).forEach(k => localStorage.removeItem(k))`);
  await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('Проверить учебный пример')).click()`);
  await until(`!!document.querySelector('[aria-label="Краткие итоги"]')`);
  assert.equal(await evaluate(`document.querySelectorAll('#functions tbody tr').length`), 4);
  assert.equal(await evaluate(`document.querySelector('#trace').open`), false);
  assert.ok(await evaluate(`document.querySelector('#trace').textContent.includes('ответов модели: 0 (API: 0)')`));
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
  assert.deepEqual(errors, []);
  console.log('PASS: карта, решения, восстановление плана, демо, контрпроверка 4 изменений, подсветка цитат, фильтры, обязательные источники обеих редакций, эскалация и экспорт; ошибок JavaScript нет.');
} finally {
  await fetch(`http://127.0.0.1:9333/json/close/${target.id}`);
  socket.close();
}
