import { mockReport } from './mock-report'
import type { AnalysisReport } from './types'

export interface AnalyzeResult {
  report: AnalysisReport
  /** true — бэкенд недоступен или ответил невалидно, показан записанный отчёт. */
  fallback: boolean
  /** Причина фолбэка для плашки в интерфейсе. */
  fallbackReason: string | null
}

const ENDPOINT = '/api/analyze'
const TIMEOUT_MS = 120_000

/** Минимальная проверка формы ответа — контракт server/src/types.js. */
function looksLikeReport(value: unknown): value is AnalysisReport {
  if (typeof value !== 'object' || value === null) return false
  const r = value as Partial<AnalysisReport>
  return (
    typeof r.meta === 'object' &&
    r.meta !== null &&
    (r.meta.mode === 'live' || r.meta.mode === 'demo') &&
    Array.isArray(r.units) &&
    Array.isArray(r.functions) &&
    Array.isArray(r.duplicates) &&
    Array.isArray(r.conflicts) &&
    Array.isArray(r.gaps) &&
    Array.isArray(r.trace) &&
    typeof r.conclusion === 'object' &&
    r.conclusion !== null &&
    typeof r.conclusion.summary === 'string' &&
    Array.isArray(r.conclusion.findings) &&
    Array.isArray(r.conclusion.recommendations) &&
    typeof r.conclusion.disclaimer === 'string'
  )
}

function fallback(reason: string): AnalyzeResult {
  return { report: mockReport, fallback: true, fallbackReason: reason }
}

async function post(body: BodyInit, headers?: HeadersInit): Promise<AnalyzeResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      body,
      headers,
      signal: controller.signal,
    })
    if (!res.ok) {
      let detail = `HTTP ${res.status}`
      try {
        const text = await res.text()
        if (text) detail += ` — ${text.slice(0, 200)}`
      } catch {
        /* тело недоступно — хватит кода статуса */
      }
      return fallback(`Бэкенд ответил ошибкой (${detail}).`)
    }
    const data: unknown = await res.json()
    if (!looksLikeReport(data)) {
      return fallback('Ответ бэкенда не соответствует схеме отчёта.')
    }
    return { report: data, fallback: false, fallbackReason: null }
  } catch (err) {
    const reason =
      err instanceof DOMException && err.name === 'AbortError'
        ? 'Бэкенд не ответил за 120 секунд.'
        : `Бэкенд недоступен (${err instanceof Error ? err.message : 'сетевая ошибка'}).`
    return fallback(reason)
  } finally {
    clearTimeout(timer)
  }
}

/** Предзагруженный комплект организатора: редакция 8 → редакция 9. */
export function analyzeDemo(): Promise<AnalyzeResult> {
  return post(JSON.stringify({ demo: true }), { 'Content-Type': 'application/json' })
}

/** Пользовательский комплект: два .docx. */
export function analyzeFiles(before: File, after: File): Promise<AnalyzeResult> {
  const form = new FormData()
  form.append('before', before)
  form.append('after', after)
  return post(form)
}
