import type { AnalysisReport, DocMeta } from '../types'

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

function DocumentMetaCard({ document, label }: { document: DocMeta; label: string }) {
  const files = document.documents?.length ? document.documents : [{ fileId: document.docId, name: document.name, clauses: document.clauses }]
  return <div className="min-w-0 bg-white px-3 py-2">
    <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
    <ul aria-label={`Файлы: ${label}`} className="mt-1 space-y-2">
      {files.map((file) => <li key={file.fileId} className="min-w-0">
        <p className="break-all font-medium text-slate-900">{file.name}</p>
        {files.length > 1 && <p className="mt-0.5 font-mono text-[11px] text-slate-500">пунктов: {file.clauses}</p>}
      </li>)}
    </ul>
    <div className="mt-1 font-mono text-xs text-slate-600">
      {document.docId} · файлов: {files.length} · пунктов: {document.clauses}
    </div>
  </div>
}

/** Шапка с паспортом сравниваемых комплектов и именами исходных файлов. */
export function MetaBar({ meta }: { meta: AnalysisReport['meta'] }) {
  const when = (() => {
    const d = new Date(meta.generatedAt)
    return Number.isNaN(d.getTime()) ? meta.generatedAt : d.toLocaleString('ru-RU')
  })()

  return (
    <div aria-label="Документы отчёта" className="grid gap-px border border-slate-300 bg-slate-300 text-sm md:grid-cols-3">
      <DocumentMetaCard document={meta.before} label="Комплект «до»" />
      <DocumentMetaCard document={meta.after} label="Комплект «после»" />
      <div className="min-w-0 bg-white px-3 py-2">
        <div className="text-[11px] tracking-wide text-slate-500 uppercase">Отчёт сформирован</div>
        <div className="font-medium text-slate-900">{when}</div>
        <div className="font-mono text-xs text-slate-600">
          режим: {meta.mode === 'demo' ? 'локальный анализ' : 'live (API)'}
        </div>
      </div>
    </div>
  )
}
