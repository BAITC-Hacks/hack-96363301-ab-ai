import { createHash } from 'node:crypto';
import { parseDocument } from './document.js';

export const MAX_FILES_PER_SIDE = 5;
export const MAX_FILE_BYTES = 20 * 1024 * 1024;

/**
 * Разбирает комплект одной редакции, сохраняя границы файлов и исходные номера.
 * Хеш содержимого задаёт стабильное пространство ссылок независимо от порядка
 * загрузки. Для одного файла прежние ссылки сохранены для совместимости.
 */
export async function parseCollection(files, docId) {
  if (typeof docId !== 'string' || !docId.trim() || docId.includes('#')) {
    throw new Error('Не задан корректный идентификатор редакции комплекта.');
  }
  if (!Array.isArray(files) || files.length < 1 || files.length > MAX_FILES_PER_SIDE) {
    throw new Error(`Для одной редакции нужно загрузить от 1 до ${MAX_FILES_PER_SIDE} файлов.`);
  }

  const hashes = new Map();
  const fileIds = new Set();
  // Проверяем весь комплект до разбора: повреждённый или повторный файл
  // не должен незаметно исчезнуть из успешно сформированного результата.
  const inputs = files.map((file, index) => {
    if (!file || typeof file.name !== 'string' || !file.name.trim()) {
      throw new Error(`У файла №${index + 1} не указано имя.`);
    }
    const label = `Файл «${file.name}»`;
    if (!Buffer.isBuffer(file.buffer)) throw new Error(`${label}: не передано содержимое файла.`);
    if (!file.buffer.length) throw new Error(`${label}: файл пуст.`);
    if (file.buffer.length > MAX_FILE_BYTES) throw new Error(`${label}: размер превышает 20 МБ.`);
    const hash = createHash('sha256').update(file.buffer).digest('hex');
    if (hashes.has(hash)) {
      throw new Error(`${label}: содержимое повторяет файл «${hashes.get(hash)}» в этой редакции. Удалите повторную копию.`);
    }
    hashes.set(hash, file.name);
    const fileId = `f${hash.slice(0, 16)}`;
    if (fileIds.has(fileId)) throw new Error(`${label}: совпал идентификатор двух разных файлов; комплект нельзя безопасно обработать.`);
    fileIds.add(fileId);
    return { buffer: file.buffer, fileName: file.name, fileId };
  }).sort((a, b) => a.fileId < b.fileId ? -1 : a.fileId > b.fileId ? 1 : 0);

  const documents = [];
  const multiple = inputs.length > 1;
  for (const { buffer, fileName, fileId } of inputs) {
    try {
      const parsed = await parseDocument(buffer, docId, fileName);
      if (!Array.isArray(parsed.clauses) || !parsed.clauses.length) {
        throw new Error('не найдено ни одного текстового фрагмента. Проверьте содержимое документа.');
      }
      const refs = new Map();
      for (const clause of parsed.clauses) {
        if (typeof clause.id !== 'string' || !clause.id.startsWith(`${docId}#`) || refs.has(clause.id)) {
          throw new Error('при разборе получены некорректные или повторные ссылки на пункты.');
        }
        refs.set(clause.id, multiple ? `${docId}#${fileId}.${clause.id.slice(docId.length + 1)}` : clause.id);
      }
      const remap = (ref) => {
        if (!refs.has(ref)) throw new Error(`ссылка «${ref}» не соответствует ни одному пункту этого файла.`);
        return refs.get(ref);
      };
      const metadata = { fileId, fileName };
      const clauses = parsed.clauses.map((clause) => ({
        ...clause, ...metadata, id: remap(clause.id),
        ...(clause.parent ? { parent: remap(clause.parent) } : {}),
      }));
      const sections = (parsed.sections || []).map((section) => ({ ...section, ...metadata }));
      const diagnostics = (parsed.diagnostics || []).map((diagnostic) => ({
        ...diagnostic, ...metadata, ref: remap(diagnostic.ref),
      }));
      documents.push({ ...parsed, ...metadata, clauses, sections, diagnostics });
    } catch (error) {
      throw new Error(`Файл «${fileName}»: ${error instanceof Error ? error.message : 'не удалось разобрать документ.'}`, { cause: error });
    }
  }

  return {
    docId, documents,
    clauses: documents.flatMap((document) => document.clauses),
    sections: documents.flatMap((document) => document.sections),
    diagnostics: documents.flatMap((document) => document.diagnostics),
  };
}
