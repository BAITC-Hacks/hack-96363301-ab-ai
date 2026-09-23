import type { Evidence } from './types'
export type CaseKind = 'lost' | 'duplicate' | 'conflict' | 'gap' | 'moved'
export type Action = 'assign' | 'confirm' | 'accept' | 'escalate' | 'dismiss'
export interface Decision { caseId: string; action: Action; owner: string; note: string; refs: string[]; proposal?: string | null }
export interface ReviewCase {
  id: string; kind: CaseKind; title: string; evidence: Evidence[];
  candidates: Array<{ evidence: Evidence; similarity: number; owner: string }>;
  currentOwners: string[]; actions: Action[]
}
export interface Plan {
  fingerprint: string; cases: ReviewCase[]; owners: Array<{ id: string; name: string }>; decisions: Decision[];
  stats: { total: number; reviewed: number; pending: number; escalated: number; unresolved: number; proposed: number };
  notice: string
}
export const CASE_LABELS: Record<CaseKind, string> = { lost: 'Возможная утрата', duplicate: 'Пересечение', conflict: 'Конфликт интересов', gap: 'Описание функций', moved: 'Передача' }
export const ACTION_LABELS: Record<Action, string> = { assign: 'Предложить ответственного', confirm: 'Подтвердить передачу', accept: 'Оставить совместное участие', escalate: 'Передать на согласование', dismiss: 'Отклонить находку' }

export async function requestPlan(reportId: string, decisions: Decision[], exporting = false): Promise<Response> {
  const response = await fetch(exporting ? '/api/plan/export' : '/api/plan', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reportId, decisions }), signal: AbortSignal.timeout(30000),
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    throw new Error(payload?.error || `Не удалось получить план: HTTP ${response.status}`)
  }
  return response
}
