/**
 * Зеркало контракта server/src/types.js (zod) один в один.
 * Менять здесь ничего нельзя — схему правит только координатор на бэкенде.
 */

/** Ссылка на пункт документа: `red9#5.3.3` или `red8#3.4а`. */
export type ClauseRef = string

/** Подтверждённая цитата — собирается на бэкенде из парсера. */
export interface Evidence {
  ref: ClauseRef
  docId: string
  fileId?: string
  fileName?: string
  number: string
  text: string
}

/** Статус подразделения между редакциями (must have 1). */
export type UnitStatus = 'created' | 'kept' | 'reorganized' | 'removed'

export interface Unit {
  name: string
  abbr: string | null
  status: UnitStatus
  /** Пункт, где подразделение упомянуто в «до» и/или «после». */
  evidence: Evidence[]
  note: string | null
}

/**
 * Что случилось с функцией между редакциями (must have 2).
 * `moved` — функция сохранилась, но сменила владельца. Это НЕ потеря.
 */
export type FunctionChange = 'lost' | 'moved' | 'added' | 'reworded' | 'kept'

export interface MaterialChange {
  kind: 'prohibition' | 'obligation' | 'frequency' | 'scope'
  title: string
  detail: string
  beforeFragment: string
  afterFragment: string
}

export interface FunctionDiff {
  change: FunctionChange
  text: string
  ownerBefore: string | null
  ownerAfter: string | null
  similarity: number
  evidenceBefore: Evidence[]
  evidenceAfter: Evidence[]
  materialChanges?: MaterialChange[]
  reviewCandidates?: Array<{ evidence: Evidence; similarity: number; owner: string }>
  /** Объяснение от модели; при пустом ключе берётся из фикстур. */
  rationale: string | null
}

/** Дублирование функции между подразделениями (must have 3). */
export interface Duplicate {
  text: string
  owners: string[]
  evidence: Evidence[]
  rationale: string | null
}

/** Потенциальный конфликт интересов (must have 3). */
export interface ConflictOfInterest {
  title: string
  owners: string[]
  evidence: Evidence[]
  rationale: string | null
}

/** Пробел в нормативном закреплении — находка сверх ТЗ. */
export interface NormativeGap {
  title: string
  detail: string
  evidence: Evidence[]
}

/** Один шаг пайплайна — показывается в интерфейсе (видимая агентность). */
export interface TraceStep {
  step: string
  kind: 'deterministic' | 'llm'
  model: string | null
  source: 'api' | 'fixture' | 'local' | 'none'
  durationMs: number
  inputSize: number | null
  /** Сколько ссылок модель вернула и сколько из них прошли проверку. */
  citationsReturned: number | null
  citationsRejected: number | null
}

export interface DocMeta {
  docId: string
  documents?: Array<{ fileId: string; name: string; clauses: number }>
  name: string
  clauses: number
}

export interface AnalysisQuality {
  documents: Array<{ docId: string; fileId?: string; name: string; clauses: number; units: number; functionClauses: number; ownerBindings: number; unassignedClauses: number }>
  warnings: Array<{ code: string; title: string; detail: string; evidence: Evidence[] }>
  checkedReferences: number
  uniqueSources: number
}

export interface SemanticReviewItem {
  beforeRef: ClauseRef
  ownerBefore: string
  status: 'candidate' | 'meaning_changed' | 'not_found' | 'unreviewed'
  ownerAfter: string | null
  evidenceBefore: Evidence
  evidenceAfter: Evidence | null
  beforeFragment: string | null
  afterFragment: string | null
  similarity: number | null
  materialChanges: MaterialChange[]
}

/** Предложения модельного поиска не изменяют основное сопоставление функций. */
export interface SemanticReviewResult {
  status: 'completed' | 'unavailable' | 'not_needed'
  source: 'api' | 'fixture' | 'none'
  model: string
  totalLost: number
  reviewed: number
  afterConsidered: number
  afterTotal: number
  limited: boolean
  items: SemanticReviewItem[]
}

/** Полный отчёт — то, что отдаёт POST /api/analyze и рисует фронтенд. */
export interface AnalysisReport {
  meta: {
    reportId?: string
    before: DocMeta
    after: DocMeta
    mode: 'live' | 'demo'
    generatedAt: string
  }
  units: Unit[]
  functions: FunctionDiff[]
  duplicates: Duplicate[]
  conflicts: ConflictOfInterest[]
  gaps: NormativeGap[]
  quality?: AnalysisQuality
  semanticReview?: SemanticReviewResult
  /** Итоговое аналитическое заключение (must have 5). */
  conclusion: {
    summary: string
    findings: string[]
    findingEvidence: Evidence[][]
    recommendations: string[]
    recommendationEvidence: Evidence[][]
    disclaimer: string
  }
  trace: TraceStep[]
}

/** Схема ответа модели на шаге классификации. */
export interface LlmClassification {
  items: Array<{
    id: string
    change: FunctionChange
    rationale: string
    citations: ClauseRef[]
  }>
}

export interface LlmConclusion {
  summary: string
  findings: string[]
  recommendations: string[]
}
