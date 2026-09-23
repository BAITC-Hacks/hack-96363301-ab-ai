import { z } from 'zod';

/**
 * Контракт между парсером, анализом, LLM-слоем и фронтендом.
 * Меняется только координатором.
 *
 * Принцип, на котором держится всё решение: текст цитаты и номер пункта
 * подставляет ПАРСЕР, а не модель. Модель получает список допустимых
 * идентификаторов и возвращает только их. Вывод со ссылкой на пункт вне
 * списка отбрасывается. Так закрывается ограничение п. 9 ТЗ — «агент не
 * должен формировать утверждения, не подтверждённые документами».
 */

/** Ссылка на пункт документа: `red9#5.3.3` или `red8#3.4а`. */
export const ClauseRef = z.string().regex(/^red\d+#[a-z\d.]+[а-яё]?$/u, 'ожидается идентификатор пункта или строки');

/** Подтверждённая цитата — собирается на бэкенде из парсера. */
export const Evidence = z.object({
  ref: ClauseRef,
  docId: z.string(),
  number: z.string(),
  text: z.string(),
});

/** Статус подразделения между редакциями (must have 1). */
export const UnitStatus = z.enum(['created', 'kept', 'reorganized', 'removed']);

export const Unit = z.object({
  name: z.string(),
  abbr: z.string().nullable(),
  status: UnitStatus,
  /** Пункт, где подразделение упомянуто в «до» и/или «после». */
  evidence: z.array(Evidence),
  note: z.string().nullable(),
});

/**
 * Что случилось с функцией между редакциями (must have 2).
 * `moved` — функция сохранилась, но сменила владельца. Это НЕ потеря,
 * и отличать одно от другого обязательно: наивное сравнение по номеру
 * пункта выдаёт десятки ложных «потерь» из-за сквозной перенумерации.
 */
export const FunctionChange = z.enum(['lost', 'moved', 'added', 'reworded', 'kept']);

export const MaterialChange = z.object({
  kind: z.enum(['prohibition', 'obligation', 'frequency', 'scope']),
  title: z.string(), detail: z.string(),
  beforeFragment: z.string(), afterFragment: z.string(),
});

export const FunctionDiff = z.object({
  change: FunctionChange,
  text: z.string(),
  ownerBefore: z.string().nullable(),
  ownerAfter: z.string().nullable(),
  similarity: z.number().min(0).max(1),
  evidenceBefore: z.array(Evidence),
  evidenceAfter: z.array(Evidence),
  materialChanges: z.array(MaterialChange).default([]),
  reviewCandidates: z.array(z.object({ evidence: Evidence, similarity: z.number().min(0).max(1), owner: z.string() })).default([]),
  /** Объяснение от модели; при пустом ключе берётся из фикстур. */
  rationale: z.string().nullable(),
});

/** Дублирование функции между подразделениями (must have 3). */
export const Duplicate = z.object({
  text: z.string(),
  owners: z.array(z.string()),
  evidence: z.array(Evidence),
  rationale: z.string().nullable(),
});

/** Потенциальный конфликт интересов (must have 3). */
export const ConflictOfInterest = z.object({
  title: z.string(),
  owners: z.array(z.string()),
  evidence: z.array(Evidence),
  rationale: z.string().nullable(),
});

/** Пробел в нормативном закреплении — наша находка сверх ТЗ. */
export const NormativeGap = z.object({
  title: z.string(),
  detail: z.string(),
  evidence: z.array(Evidence),
});

/** Один шаг пайплайна — показывается в интерфейсе (видимая агентность). */
export const TraceStep = z.object({
  step: z.string(),
  kind: z.enum(['deterministic', 'llm']),
  model: z.string().nullable(),
  source: z.enum(['api', 'fixture', 'local', 'none']),
  durationMs: z.number(),
  inputSize: z.number().nullable(),
  /** Сколько ссылок модель вернула и сколько из них прошли проверку. */
  citationsReturned: z.number().nullable(),
  citationsRejected: z.number().nullable(),
});

/** Полный отчёт — то, что отдаёт POST /api/analyze и рисует фронтенд. */
export const AnalysisReport = z.object({
  meta: z.object({
    reportId: z.string().uuid().optional(),
    before: z.object({ docId: z.string(), name: z.string(), clauses: z.number() }),
    after: z.object({ docId: z.string(), name: z.string(), clauses: z.number() }),
    mode: z.enum(['live', 'demo']),
    generatedAt: z.string(),
  }),
  units: z.array(Unit),
  functions: z.array(FunctionDiff),
  duplicates: z.array(Duplicate),
  conflicts: z.array(ConflictOfInterest),
  gaps: z.array(NormativeGap),
  /** Итоговое аналитическое заключение (must have 5). */
  conclusion: z.object({
    summary: z.string(),
    findings: z.array(z.string()),
    findingEvidence: z.array(z.array(Evidence)),
    recommendations: z.array(z.string()),
    recommendationEvidence: z.array(z.array(Evidence)),
    disclaimer: z.string(),
  }),
  trace: z.array(TraceStep),
});

/**
 * Схема ответа модели на шаге классификации.
 * Намеренно узкая: модель выбирает метку и объясняет, но ссылки берёт
 * только из переданного ей списка допустимых идентификаторов.
 */
export const LlmClassification = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      change: FunctionChange,
      rationale: z.string(),
      citations: z.array(ClauseRef),
    }),
  ),
});

export const LlmConclusion = z.object({
  summary: z.string(),
  findings: z.array(z.string()),
  recommendations: z.array(z.string()),
});
