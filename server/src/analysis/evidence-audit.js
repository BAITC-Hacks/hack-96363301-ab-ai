/**
 * Проверка целостности ссылок перед выдачей отчёта. Сверяет каждый источник
 * с индексом парсера и каждый выделенный фрагмент — с процитированной редакцией.
 * Совпадение цитаты не доказывает правильность интерпретации её смысла.
 */
export function auditReportEvidence(report, clauseIndex) {
  let checkedReferences = 0;
  const sources = new Set();
  const fail = (path, message) => {
    throw new Error(`Проверка источников: ${path} — ${message}.`);
  };
  const array = (value, path) => {
    if (!Array.isArray(value)) fail(path, 'ожидался список');
    return value;
  };

  const evidence = (item, path) => {
    if (!item || typeof item.ref !== 'string' || !item.ref) fail(path, 'не указан идентификатор источника');
    if (!clauseIndex.has(item.ref)) fail(path, `источник «${item.ref}» отсутствует в документах`);
    const original = clauseIndex.get(item.ref);
    if (!original) fail(path, `источник «${item.ref}» не содержит пункта документа`);
    for (const [field, label] of [['docId', 'документ'], ['number', 'номер пункта'], ['text', 'текст цитаты']]) {
      if (typeof item[field] !== 'string' || item[field] !== original[field]) {
        fail(path, `${label} источника «${item.ref}» не совпадает с результатом разбора`);
      }
    }
    checkedReferences += 1;
    sources.add(item.ref);
  };
  const group = (items, path, required = true) => {
    array(items, path);
    if (required && !items.length) fail(path, 'для вывода отсутствует подтверждающий источник');
    items.forEach((item, i) => evidence(item, `${path}[${i}]`));
  };
  const edition = (items, expectedDocId, path) => {
    if (!expectedDocId) return;
    items.forEach((item, i) => {
      if (item.docId !== expectedDocId) fail(`${path}[${i}]`, `источник относится к другой редакции; ожидался документ «${expectedDocId}»`);
    });
  };

  for (const collection of ['units', 'duplicates', 'conflicts', 'gaps']) {
    array(report[collection], collection).forEach((item, i) => {
      const path = `${collection}[${i}].evidence`;
      group(item?.evidence, path);
      if (collection === 'duplicates' && new Set(item.evidence.map((ref) => ref.ref)).size < 2) {
        fail(path, 'пересечение должно ссылаться минимум на два разных пункта');
      }
    });
  }

  array(report.functions, 'functions').forEach((item, i) => {
    const path = `functions[${i}]`;
    if (!['lost', 'added', 'moved', 'kept', 'reworded'].includes(item?.change)) {
      fail(path, 'неизвестный тип изменения функции');
    }
    group(item.evidenceBefore, `${path}.evidenceBefore`, item.change !== 'added');
    group(item.evidenceAfter, `${path}.evidenceAfter`, item.change !== 'lost');
    edition(item.evidenceBefore, report.meta?.before?.docId, `${path}.evidenceBefore`);
    edition(item.evidenceAfter, report.meta?.after?.docId, `${path}.evidenceAfter`);
    if (item.change === 'lost' && item.evidenceAfter.length) {
      fail(`${path}.evidenceAfter`, 'у функции без найденного соответствия не должно быть подтверждённого источника после');
    }
    if (item.change === 'added' && item.evidenceBefore.length) {
      fail(`${path}.evidenceBefore`, 'у новой функции не должно быть подтверждённого источника до');
    }
    if (item.reviewCandidates !== undefined) {
      array(item.reviewCandidates, `${path}.reviewCandidates`).forEach((candidate, j) => {
        const candidatePath = `${path}.reviewCandidates[${j}].evidence`;
        evidence(candidate?.evidence, candidatePath);
        edition([candidate.evidence], report.meta?.after?.docId, candidatePath);
      });
    }
    if (item.materialChanges !== undefined) {
      array(item.materialChanges, `${path}.materialChanges`).forEach((signal, j) => {
        for (const [field, refs] of [['beforeFragment', item.evidenceBefore], ['afterFragment', item.evidenceAfter]]) {
          const value = signal?.[field];
          const fragmentPath = `${path}.materialChanges[${j}].${field}`;
          if (typeof value !== 'string' || !value.trim()) fail(fragmentPath, 'выделенный фрагмент пуст');
          if (!refs.some((ref) => clauseIndex.get(ref.ref).text.includes(value))) {
            fail(fragmentPath, 'выделенный фрагмент не найден в процитированных источниках этой редакции');
          }
        }
      });
    }
  });

  for (const [texts, refs] of [['findings', 'findingEvidence'], ['recommendations', 'recommendationEvidence']]) {
    const values = array(report.conclusion?.[texts], `conclusion.${texts}`);
    const groups = array(report.conclusion?.[refs], `conclusion.${refs}`);
    if (values.length !== groups.length) fail(`conclusion.${refs}`, 'число наборов источников не совпадает с числом выводов');
    groups.forEach((items, i) => group(items, `conclusion.${refs}[${i}]`));
  }

  if (report.quality?.warnings !== undefined) {
    array(report.quality.warnings, 'quality.warnings').forEach((warning, i) => {
      group(warning?.evidence, `quality.warnings[${i}].evidence`);
    });
  }

  return { checkedReferences, uniqueSources: sources.size };
}
