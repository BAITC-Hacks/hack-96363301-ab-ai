import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';

import { analyze, hasApiKey } from './pipeline.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const DATA_DIR = join(repoRoot, 'data');
const WEB_DIST = join(repoRoot, 'web', 'dist');

const DEMO_SET = {
  before: { file: 'polozhenie_red8_before.docx', name: 'Положение о внутреннем аудите, редакция 8 (до)' },
  after: { file: 'polozhenie_red9_after.docx', name: 'Положение о внутреннем аудите, редакция 9 (после)' },
};

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

app.use(cors());
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    // Эксперту важно сразу видеть, в каком режиме работает сервер.
    mode: hasApiKey() ? 'live' : 'demo',
    hint: hasApiKey()
      ? 'API-ключ найден: объяснения генерируются моделью и записываются в fixtures/llm.'
      : 'API-ключ не задан: работает демо-режим на записанных фикстурах, сценарий проходится полностью.',
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
    res.json(report);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Свои документы: multipart с полями before и after. */
app.post('/api/analyze', upload.fields([{ name: 'before', maxCount: 1 }, { name: 'after', maxCount: 1 }]), async (req, res) => {
  const before = req.files?.before?.[0];
  const after = req.files?.after?.[0];

  if (!before || !after) {
    res.status(400).json({ error: 'Нужны оба файла: поля before и after (.docx)' });
    return;
  }

  try {
    const report = await analyze({
      beforeBuffer: before.buffer,
      beforeName: before.originalname,
      afterBuffer: after.buffer,
      afterName: after.originalname,
    });
    res.json(report);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
app.listen(PORT, () => {
  console.log(`[orgdiff] http://localhost:${PORT}  режим: ${hasApiKey() ? 'live (есть OPENAI_API_KEY)' : 'demo (фикстуры)'}`);
});
