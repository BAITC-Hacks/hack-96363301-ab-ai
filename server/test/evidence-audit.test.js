import test from 'node:test';
import assert from 'node:assert/strict';
import { auditReportEvidence } from '../src/analysis/evidence-audit.js';

function fixture() {
  const clauses = [
    { id: 'before/unit', docId: 'before-document', number: '1', text: 'Отдел контроля.' },
    { id: 'after/unit', docId: 'after-document', number: '2', text: 'Отдел аудита.' },
    { id: 'before/function', docId: 'before-document', number: '3', text: 'Подразделение не согласовывает договоры поставщиков.' },
    { id: 'after/function', docId: 'after-document', number: '4', text: 'Подразделение согласовывает договоры поставщиков.' },
    { id: 'after/candidate', docId: 'after-document', number: '5', text: 'Подразделение контролирует исполнение договоров поставщиков.' },
  ];
  const clauseIndex = new Map(clauses.map((clause) => [clause.id, clause]));
  const cite = (key) => {
    const { id, ...clause } = clauseIndex.get(key);
    return { ref: id, ...clause };
  };
  const report = {
    meta: { before: { docId: 'before-document' }, after: { docId: 'after-document' } },
    units: [{ evidence: [cite('before/unit'), cite('after/unit')] }],
    functions: [{
      change: 'moved', evidenceBefore: [cite('before/function')], evidenceAfter: [cite('after/function')],
      reviewCandidates: [{ evidence: cite('after/candidate') }],
      materialChanges: [{ beforeFragment: 'не согласовывает договоры', afterFragment: 'согласовывает договоры' }],
    }],
    duplicates: [{ evidence: [cite('after/function'), cite('after/candidate')] }],
    conflicts: [{ evidence: [cite('after/function'), cite('after/candidate')] }],
    gaps: [{ evidence: [cite('after/unit')] }],
    conclusion: {
      findings: ['Изменилось закрепление функции.'], findingEvidence: [[cite('before/function'), cite('after/function')]],
      recommendations: ['Проверить новое закрепление функции.'], recommendationEvidence: [[cite('after/function')]],
    },
    quality: { warnings: [{ code: 'coverage', evidence: [cite('after/unit')] }] },
  };
  return { report, clauseIndex };
}

test('Аудит сверяет все группы и считает ссылки без предположений о формате идентификаторов', () => {
  const { report, clauseIndex } = fixture();
  const original = JSON.stringify(report);
  assert.deepEqual(auditReportEvidence(report, clauseIndex), { checkedReferences: 14, uniqueSources: 5 });
  assert.equal(JSON.stringify(report), original, 'аудит не изменяет отчёт');
});

test('Подмена текста, номера или документа существующей ссылки блокирует отчёт', () => {
  for (const [field, value] of [['ref', 'missing'], ['docId', 'another-document'], ['number', '999'], ['text', 'Вымышленная цитата']]) {
    const { report, clauseIndex } = fixture();
    report.functions[0].evidenceAfter[0][field] = value;
    assert.throws(() => auditReportEvidence(report, clauseIndex), /Проверка источников: functions\[0\]\.evidenceAfter\[0\]/);
  }
});

test('Имя и идентификатор файла проверяются даже при точной цитате и существующем адресе', () => {
  for (const field of ['fileId', 'fileName']) {
    const { report, clauseIndex } = fixture();
    const source = clauseIndex.get('before/function');
    source.fileId = 'f0123456789abcdef';
    source.fileName = 'Обязанности.docx';
    const apply = (value) => {
      if (Array.isArray(value)) return value.forEach(apply);
      if (!value || typeof value !== 'object') return;
      if (value.ref === source.id) Object.assign(value, { fileId: source.fileId, fileName: source.fileName });
      Object.values(value).forEach(apply);
    };
    apply(report);
    assert.doesNotThrow(() => auditReportEvidence(report, clauseIndex));
    report.functions[0].evidenceBefore[0][field] = 'Подмена';
    assert.throws(() => auditReportEvidence(report, clauseIndex), new RegExp(`поле ${field}`));
  }
});

test('Каждая находка требует хотя бы один источник', () => {
  for (const collection of ['units', 'duplicates', 'conflicts', 'gaps']) {
    const { report, clauseIndex } = fixture();
    report[collection][0].evidence = [];
    assert.throws(() => auditReportEvidence(report, clauseIndex), /отсутствует подтверждающий источник/);
  }
});

test('Для передачи и сохранения нужны обе редакции, для утраты и добавления — соответствующая сторона', () => {
  for (const change of ['moved', 'kept', 'reworded', 'lost', 'added']) {
    const { report, clauseIndex } = fixture();
    const fn = report.functions[0];
    fn.change = change;
    fn.materialChanges = [];
    if (change === 'lost') fn.evidenceAfter = [];
    if (change === 'added') fn.evidenceBefore = [];
    assert.doesNotThrow(() => auditReportEvidence(report, clauseIndex), change);
    for (const field of ['evidenceBefore', 'evidenceAfter']) {
      if ((change === 'lost' && field === 'evidenceAfter') || (change === 'added' && field === 'evidenceBefore')) continue;
      const corrupted = structuredClone(report);
      corrupted.functions[0][field] = [];
      assert.throws(() => auditReportEvidence(corrupted, clauseIndex), /отсутствует подтверждающий источник/, `${change}: ${field}`);
    }
  }
});

test('Источники кандидатов тоже проверяются, даже если не вошли в итоговое сопоставление', () => {
  const { report, clauseIndex } = fixture();
  report.functions[0].reviewCandidates[0].evidence.text += ' Дописано моделью.';
  assert.throws(() => auditReportEvidence(report, clauseIndex), /reviewCandidates\[0\]\.evidence.*текст цитаты/);
});

test('Существующая точная цитата другой редакции не подменяет источник функции или кандидата', () => {
  for (const target of ['evidenceBefore', 'evidenceAfter', 'reviewCandidates']) {
    const { report, clauseIndex } = fixture();
    const fn = report.functions[0];
    fn.materialChanges = [];
    if (target === 'evidenceBefore') fn.evidenceBefore = structuredClone(fn.evidenceAfter);
    if (target === 'evidenceAfter') fn.evidenceAfter = structuredClone(fn.evidenceBefore);
    if (target === 'reviewCandidates') fn.reviewCandidates[0].evidence = structuredClone(fn.evidenceBefore[0]);
    assert.throws(() => auditReportEvidence(report, clauseIndex), /источник относится к другой редакции/, target);
  }
});

test('Без метаданных редакций аудит сохраняет проверку точности источников', () => {
  const { report, clauseIndex } = fixture();
  delete report.meta;
  assert.deepEqual(auditReportEvidence(report, clauseIndex), { checkedReferences: 14, uniqueSources: 5 });
});

test('Утрата не имеет подтверждённого пункта после, добавление — подтверждённого пункта до', () => {
  for (const change of ['lost', 'added']) {
    const { report, clauseIndex } = fixture();
    report.functions[0].change = change;
    report.functions[0].materialChanges = [];
    assert.throws(() => auditReportEvidence(report, clauseIndex), /не должно быть подтверждённого источника/, change);
  }
});

test('Пересечение требует разные исходные пункты, повтор одной ссылки недостаточен', () => {
  for (const repeat of [false, true]) {
    const { report, clauseIndex } = fixture();
    const ref = report.duplicates[0].evidence[0];
    report.duplicates[0].evidence = repeat ? [ref, structuredClone(ref)] : [ref];
    assert.throws(() => auditReportEvidence(report, clauseIndex), /минимум на два разных пункта/);
  }
});

test('Каждому выводу и каждой рекомендации соответствует непустая проверенная группа источников', () => {
  for (const field of ['findingEvidence', 'recommendationEvidence']) {
    for (const corruption of ['missing-group', 'extra-group', 'empty-group', 'wrong-source']) {
      const { report, clauseIndex } = fixture();
      const groups = report.conclusion[field];
      if (corruption === 'missing-group') groups.pop();
      if (corruption === 'extra-group') groups.push(groups[0]);
      if (corruption === 'empty-group') groups[0] = [];
      if (corruption === 'wrong-source') groups[0][0].ref = 'missing';
      assert.throws(() => auditReportEvidence(report, clauseIndex), /conclusion\./, `${field}: ${corruption}`);
    }
  }
});

test('Фрагменты контрпроверки непусты и буквально присутствуют в процитированной редакции', () => {
  for (const [field, value] of [
    ['beforeFragment', ''], ['afterFragment', '  '], ['beforeFragment', 'НЕ согласовывает'],
    ['afterFragment', 'не согласовывает договоры'], ['afterFragment', 'контролирует исполнение договоров'],
  ]) {
    const { report, clauseIndex } = fixture();
    report.functions[0].materialChanges[0][field] = value;
    assert.throws(() => auditReportEvidence(report, clauseIndex), /materialChanges\[0\]/, `${field}: ${value}`);
  }
});

test('Фрагмент контрпроверки может находиться в любом из нескольких процитированных пунктов редакции', () => {
  const { report, clauseIndex } = fixture();
  const candidate = report.functions[0].reviewCandidates[0].evidence;
  report.functions[0].evidenceAfter.push(candidate);
  report.functions[0].materialChanges[0].afterFragment = 'контролирует исполнение договоров';
  assert.doesNotThrow(() => auditReportEvidence(report, clauseIndex));
});

test('Предупреждения о качестве требуют точный источник, включая диагностические предупреждения парсера', () => {
  for (const corruption of ['empty', 'missing', 'invalid']) {
    const { report, clauseIndex } = fixture();
    report.quality.warnings[0].code = 'parser-diagnostic';
    if (corruption === 'empty') report.quality.warnings[0].evidence = [];
    if (corruption === 'missing') delete report.quality.warnings[0].evidence;
    if (corruption === 'invalid') report.quality.warnings[0].evidence[0].text = 'Подмена';
    assert.throws(() => auditReportEvidence(report, clauseIndex), /quality\.warnings\[0\]\.evidence/);
  }
  const { report, clauseIndex } = fixture();
  delete report.quality;
  assert.doesNotThrow(() => auditReportEvidence(report, clauseIndex));
});
