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
    for (const field of ['fileId', 'fileName']) {
      if (item[field] !== original[field]) fail(path, `поле ${field} источника «${item.ref}» не совпадает с исходным файлом`);
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

  // Semantic pairs remain hypotheses. Their sources and owners must come from
  // the already audited local comparison, including rows the model did not review.
  if (report.semanticReview !== undefined) {
    const lostByRef = new Map();
    const afterByRef = new Map();
    const indexOwners = (index, refs, owner) => refs.forEach((ref) => {
      if (!index.has(ref.ref)) index.set(ref.ref, new Set());
      index.get(ref.ref).add(owner);
    });
    for (const item of report.functions) {
      if (item.change === 'lost') indexOwners(lostByRef, item.evidenceBefore, item.ownerBefore);
      indexOwners(afterByRef, item.evidenceAfter, item.ownerAfter);
    }
    const seen = new Set();
    array(report.semanticReview?.items, 'semanticReview.items').forEach((item, i) => {
      const path = `semanticReview.items[${i}]`;
      if (!['candidate', 'meaning_changed', 'not_found', 'unreviewed'].includes(item?.status)) fail(path, 'неизвестный результат смысловой проверки');
      evidence(item.evidenceBefore, `${path}.evidenceBefore`);
      edition([item.evidenceBefore], report.meta?.before?.docId, `${path}.evidenceBefore`);
      if (item.beforeRef !== item.evidenceBefore.ref || !lostByRef.has(item.beforeRef)) {
        fail(`${path}.beforeRef`, 'источник не относится к функции без найденного соответствия');
      }
      if (seen.has(item.beforeRef)) fail(`${path}.beforeRef`, 'повторный результат для одного источника');
      seen.add(item.beforeRef);
      if (!lostByRef.get(item.beforeRef).has(item.ownerBefore)) fail(`${path}.ownerBefore`, 'владелец не совпадает с локальным сопоставлением');
      const materialChanges = array(item.materialChanges, `${path}.materialChanges`);
      const paired = ['candidate', 'meaning_changed'].includes(item.status);
      if (!paired) {
        for (const field of ['evidenceAfter', 'ownerAfter', 'beforeFragment', 'afterFragment', 'similarity']) {
          if (item[field] !== null) fail(`${path}.${field}`, 'для результата без пары ожидалось пустое значение');
        }
        if (materialChanges.length) fail(`${path}.materialChanges`, 'без пары нельзя подтверждать изменение формулировки');
        return;
      }
      evidence(item.evidenceAfter, `${path}.evidenceAfter`);
      edition([item.evidenceAfter], report.meta?.after?.docId, `${path}.evidenceAfter`);
      if (!afterByRef.has(item.evidenceAfter.ref)) fail(`${path}.evidenceAfter`, 'источник не относится к распознанной функции новой редакции');
      if (!afterByRef.get(item.evidenceAfter.ref).has(item.ownerAfter)) fail(`${path}.ownerAfter`, 'владелец не совпадает с локальным сопоставлением');
      if (!Number.isFinite(item.similarity) || item.similarity < 0 || item.similarity > 1) fail(`${path}.similarity`, 'сходство текста должно быть числом от 0 до 1');
      const fragment = (value, ref, fragmentPath) => {
        if (typeof value !== 'string' || !value.trim()) fail(fragmentPath, 'выделенный фрагмент пуст');
        if (!ref.text.includes(value)) fail(fragmentPath, 'выделенный фрагмент не найден в процитированном источнике этой редакции');
      };
      fragment(item.beforeFragment, item.evidenceBefore, `${path}.beforeFragment`);
      fragment(item.afterFragment, item.evidenceAfter, `${path}.afterFragment`);
      materialChanges.forEach((signal, j) => {
        fragment(signal?.beforeFragment, item.evidenceBefore, `${path}.materialChanges[${j}].beforeFragment`);
        fragment(signal?.afterFragment, item.evidenceAfter, `${path}.materialChanges[${j}].afterFragment`);
      });
    });
  }

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
