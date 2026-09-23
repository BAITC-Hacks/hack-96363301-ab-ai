import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';

import { analyze, hasApiKey } from './pipeline.js';
import { decodeFileName } from './parse/document.js';
import { MAX_FILES_PER_SIDE, MAX_FILE_BYTES } from './parse/collection.js';
import { rememberReport, storedReport, PlanRequest, buildPlan, exportPlan } from './planning.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const DATA_DIR = join(repoRoot, 'data');
const WEB_DIST = join(repoRoot, 'web', 'dist');

const DEMO_SET = {
  before: { file: 'polozhenie_red8_before.docx', name: 'Положение о внутреннем аудите, редакция 8 (до).docx' },
  after: { file: 'polozhenie_red9_after.docx', name: 'Положение о внутреннем аудите, редакция 9 (после).docx' },
};

/**
 * Имя файла в multipart приходит байтами UTF-8, которые multer по стандарту
 * RFC 7578 трактует как latin1. Русские имена превращаются в «ÐŸÐ¾Ð»Ð¾Ð¶...».
 * Возвращаем байты обратно и читаем как UTF-8; если имя было чистым ASCII,
 * преобразование ничего не меняет.
 */
export const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES_PER_SIDE * 2 } });

app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    // Эксперту важно сразу видеть, в каком режиме работает сервер.
    mode: hasApiKey() ? 'live' : 'demo',
    hint: hasApiKey()
      ? 'API-ключ найден: доступна дополнительная проверка сопоставлений моделью.'
      : 'API-ключ не задан: анализ и заключение рассчитываются локально по документам.',
  });
});

/** Предзагруженный комплект — главный путь для проверяющего. */
app.post('/api/analyze/demo', async (_req, res) => {
  try {
    const report = await analyze({
      beforeBuffer: await readFile(join(DATA_DIR, DEMO_SET.before.file)),
      beforeName: DEMO_SET.before.name,
      afterBuffer: await readFile(join(DATA_DIR, DEMO_SET.after.file)),
      afterName: DEMO_SET.after.name,
    });
    res.json(rememberReport(report));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Свои документы: multipart с полями before и after. */
app.post('/api/analyze/example', async (_req, res) => {
  try {
    res.json(rememberReport(await analyze({
      beforeBuffer: await readFile(join(DATA_DIR, 'example_before.xlsx')), beforeName: 'Учебный пример — до.xlsx',
      afterBuffer: await readFile(join(DATA_DIR, 'example_after.xlsx')), afterName: 'Учебный пример — после.xlsx',
    })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});
for (const side of ['before', 'after']) {
  app.get(`/api/examples/${side}.xlsx`, (_req, res) => res.download(join(DATA_DIR, `example_${side}.xlsx`)));
  app.get(`/api/examples/countercheck/${side}.xlsx`, (_req, res) => res.download(join(DATA_DIR, `countercheck_${side}.xlsx`)));
  app.get(`/api/examples/semantic/${side}.xlsx`, (_req, res) => res.download(join(DATA_DIR, `semantic_${side}.xlsx`)));
}

app.post('/api/analyze/semantic', async (_req, res) => {
  try {
    res.json(rememberReport(await analyze({
      beforeBuffer: await readFile(join(DATA_DIR, 'semantic_before.xlsx')), beforeName: 'Поиск переформулировок — до.xlsx',
      afterBuffer: await readFile(join(DATA_DIR, 'semantic_after.xlsx')), afterName: 'Поиск переформулировок — после.xlsx',
    })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/analyze/countercheck', async (_req, res) => {
  try {
    res.json(rememberReport(await analyze({
      beforeBuffer: await readFile(join(DATA_DIR, 'countercheck_before.xlsx')), beforeName: 'Контрпроверка — учебный пример до.xlsx',
      afterBuffer: await readFile(join(DATA_DIR, 'countercheck_after.xlsx')), afterName: 'Контрпроверка — учебный пример после.xlsx',
    })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/analyze', upload.fields([{ name: 'before', maxCount: MAX_FILES_PER_SIDE }, { name: 'after', maxCount: MAX_FILES_PER_SIDE }]), async (req, res) => {
  const before = req.files?.before;
  const after = req.files?.after;

  if (!before || !after) {
    res.status(400).json({ error: 'Нужен минимум один файл в каждой редакции: поля before и after (DOCX, PDF, XLSX).' });
    return;
  }

  try {
    const report = await analyze({
      beforeFiles: before.map((file) => ({ buffer: file.buffer, name: decodeFileName(file.originalname) })),
      afterFiles: after.map((file) => ({ buffer: file.buffer, name: decodeFileName(file.originalname) })),
    });
    res.json(rememberReport(report));
  } catch (err) {
    res.status(422).json({ error: err.message });
  }
});

for (const endpoint of ['/api/plan', '/api/plan/export']) {
  app.post(endpoint, async (req, res) => {
    try {
      const input = PlanRequest.safeParse(req.body);
      if (!input.success) return res.status(400).json({ error: 'Проверьте решение: нужно обоснование от 10 символов и хотя бы один источник.' });
      const report = storedReport(input.data.reportId);
      const plan = buildPlan(report, input.data.decisions);
      if (endpoint.endsWith('/export')) {
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="OrgDiff-plan.xlsx"');
        res.send(Buffer.from(await exportPlan(report, plan)));
      } else res.json(plan);
    } catch (err) { res.status(err.status || 400).json({ error: err.message }); }
  });
}

app.use((err, _req, res, _next) => {
  res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Максимальный размер файла — 20 МБ.' :
    ['LIMIT_FILE_COUNT', 'LIMIT_UNEXPECTED_FILE'].includes(err.code) ? 'Допустимо до 5 файлов в каждой редакции, в полях before и after.' : err.message });
});

// Собранный фронтенд отдаётся тем же процессом: одна команда запуска,
// один порт, никакого CORS в продакшене.
app.use(express.static(WEB_DIST));
app.get(/^(?!\/api\/).*/, (_req, res) => {
  res.sendFile(join(WEB_DIST, 'index.html'), (err) => {
    if (err) res.status(404).send('Фронтенд не собран. Выполните: cd web && npm run build');
  });
});

const PORT = process.env.PORT || 3000;
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) app.listen(PORT, () => {
  console.log(`[orgdiff] http://localhost:${PORT}  режим: ${hasApiKey() ? 'live (есть OPENAI_API_KEY)' : 'demo (фикстуры)'}`);
});
