import type { AnalysisReport } from '../types'

/** Плашка демо-режима (must have оценки: путь проходится без API-ключа). */
export function ModeBanner({ mode }: { mode: 'live' | 'demo' }) {
  if (mode === 'demo') {
    return (
      <div className="border-l-4 border-amber-500 bg-amber-100 px-4 py-2.5">
        <div className="text-sm font-bold text-amber-900">
          Анализ по документам без живого ответа модели
        </div>
        <p className="mt-0.5 text-xs text-amber-900">
          Анализ и заключение рассчитаны по загруженным документам. Живой ответ модели не использован.
          Доступность проверки моделью указана в трассировке.
        </p>
      </div>
    )
  }
  return (
    <div className="border-l-4 border-emerald-600 bg-emerald-50 px-4 py-2">
      <span className="text-sm font-bold text-emerald-900">Рабочий режим: ответы получены живым вызовом модели</span>
    </div>
  )
}

/** Бэкенд не ответил — показан записанный отчёт. */
export function FallbackBanner({ reason }: { reason: string }) {
  return (
    <div className="border-l-4 border-slate-600 bg-slate-200 px-4 py-2">
      <span className="text-sm font-bold text-slate-900">Показан записанный отчёт из репозитория.</span>{' '}
      <span className="text-xs text-slate-700">
        {reason} Интерфейс работает на данных <code className="bg-slate-300 px-1 font-mono">src/mock-report.ts</code> —
        демо-путь проходится целиком, даже когда сервер не запущен.
      </span>
    </div>
  )
}

/** Шапка с паспортом сравниваемых документов. */
export function MetaBar({ meta }: { meta: AnalysisReport['meta'] }) {
  const when = (() => {
    const d = new Date(meta.generatedAt)
    return Number.isNaN(d.getTime()) ? meta.generatedAt : d.toLocaleString('ru-RU')
  })()

  return (
    <div className="grid gap-px border border-slate-300 bg-slate-300 text-sm md:grid-cols-3">
      <div className="bg-white px-3 py-2">
        <div className="text-[11px] tracking-wide text-slate-500 uppercase">Документ «до»</div>
        <div className="truncate font-medium text-slate-900" title={meta.before.name}>
          {meta.before.name}
        </div>
        <div className="font-mono text-xs text-slate-600">
          {meta.before.docId} · пунктов: {meta.before.clauses}
        </div>
      </div>
      <div className="bg-white px-3 py-2">
        <div className="text-[11px] tracking-wide text-slate-500 uppercase">Документ «после»</div>
        <div className="truncate font-medium text-slate-900" title={meta.after.name}>
          {meta.after.name}
        </div>
        <div className="font-mono text-xs text-slate-600">
          {meta.after.docId} · пунктов: {meta.after.clauses}
        </div>
      </div>
      <div className="bg-white px-3 py-2">
        <div className="text-[11px] tracking-wide text-slate-500 uppercase">Отчёт сформирован</div>
        <div className="font-medium text-slate-900">{when}</div>
        <div className="font-mono text-xs text-slate-600">
          режим: {meta.mode === 'demo' ? 'локальный анализ' : 'live (API)'}
        </div>
      </div>
    </div>
  )
}
