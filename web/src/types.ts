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

export interface FunctionDiff {
  change: FunctionChange
  text: string
  ownerBefore: string | null
  ownerAfter: string | null
  similarity: number
  evidenceBefore: Evidence[]
  evidenceAfter: Evidence[]
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
  source: 'api' | 'fixture'
  durationMs: number
  inputSize: number | null
  /** Сколько ссылок модель вернула и сколько из них прошли проверку. */
  citationsReturned: number | null
  citationsRejected: number | null
}

export interface DocMeta {
  docId: string
  name: string
  clauses: number
}

/** Полный отчёт — то, что отдаёт POST /api/analyze и рисует фронтенд. */
export interface AnalysisReport {
  meta: {
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
  /** Итоговое аналитическое заключение (must have 5). */
  conclusion: {
    summary: string
    findings: string[]
    recommendations: string[]
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
