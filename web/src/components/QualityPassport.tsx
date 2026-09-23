import type { AnalysisQuality } from '../types'
import { EvidenceDisclosure } from './EvidenceDisclosure'

const DOCUMENT_LABELS: Record<string, string> = { red8: 'Документ «до»', red9: 'Документ «после»' }

function Metric({ label, value }: { label: string; value: number }) {
  return <div className="min-w-0">
    <dt className="text-[11px] leading-relaxed text-slate-500">{label}</dt>
    <dd className="mt-1 font-mono text-lg font-semibold tabular-nums text-slate-900">{value}</dd>
  </div>
}

export function QualityPassport({ quality }: { quality: AnalysisQuality }) {
  const unassigned = quality.documents.reduce((total, document) => total + document.unassignedClauses, 0)
  const warningCount = quality.warnings.length

  return <details id="analysis-quality" aria-label="Полнота анализа" open={unassigned > 0}
    className={`group/passport rounded-xl border bg-white ${unassigned > 0 ? 'border-amber-300' : 'border-slate-200'}`}>
    <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-4 gap-y-2 rounded-xl px-4 py-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 [&::-webkit-details-marker]:hidden">
      <span className="flex items-center gap-2">
        <span aria-hidden="true" className="text-xs text-slate-400 transition-transform group-open/passport:rotate-90">▶</span>
        <span className="text-sm font-semibold text-slate-900">Что вошло в анализ</span>
      </span>
      <span className="text-xs text-slate-500">Пункты, владельцы и источники</span>
      <span className="flex flex-wrap gap-2 sm:ml-auto">
        <span className={`rounded-md px-2 py-1 text-xs ${warningCount ? 'bg-amber-50 text-amber-900' : 'bg-slate-100 text-slate-600'}`}>
          Замечаний: <strong className="font-mono tabular-nums">{warningCount}</strong>
        </span>
        <span className={`rounded-md px-2 py-1 text-xs ${unassigned ? 'bg-amber-100 font-semibold text-amber-950' : 'bg-slate-100 text-slate-600'}`}>
          Пунктов без владельца: <strong className="font-mono tabular-nums">{unassigned}</strong>
        </span>
      </span>
    </summary>

    <div className="space-y-4 border-t border-slate-100 px-4 pb-4 pt-3">
      {unassigned > 0 && <p className="rounded-lg border-l-2 border-amber-400 bg-amber-50 px-3 py-2 text-sm leading-relaxed text-amber-950">
        Обнаружены пункты без определённого подразделения: <strong>{unassigned}</strong>. Они не вошли в сравнение функций. Проверьте указанные ниже блоки и владельцев перед использованием выводов.
      </p>}

      <div className="grid gap-3 md:grid-cols-2">
        {quality.documents.map((document) => <section key={`${document.docId}:${document.fileId || document.name}`} className="min-w-0 rounded-lg border border-slate-200 bg-slate-50/70 p-3">
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-sky-800">{DOCUMENT_LABELS[document.docId] || document.docId}</h3>
          <p className="mt-1 break-all text-sm font-medium text-slate-800">{document.name}</p>
          <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-3 sm:grid-cols-4">
            <Metric label="Распознано пунктов" value={document.clauses} />
            <Metric label="Подразделений" value={document.units} />
            <Metric label="Пунктов функций" value={document.functionClauses} />
            <Metric label="Связей с владельцами" value={document.ownerBindings} />
          </dl>
          {document.unassignedClauses > 0 && <p className="mt-3 border-t border-amber-200 pt-2 text-xs font-medium text-amber-900">
            Без определённого подразделения: {document.unassignedClauses}
          </p>}
        </section>)}
      </div>

      <p className="text-xs leading-relaxed text-slate-600">
        «Пунктов функций» — число уникальных распознанных пунктов, включённых в сравнение. Один пункт может быть связан с несколькими владельцами, поэтому связей бывает больше. Эти количества не измеряют полноту документа или правильность смыслового сопоставления.
      </p>

      <div className="flex flex-col gap-3 rounded-lg border border-sky-100 bg-sky-50/60 p-3 sm:flex-row sm:items-center">
        <dl className="flex shrink-0 flex-wrap gap-x-6 gap-y-2">
          <Metric label="Проверено ссылок в отчёте" value={quality.checkedReferences} />
          <Metric label="Уникальных источников" value={quality.uniqueSources} />
        </dl>
        <p className="text-xs leading-relaxed text-slate-600 sm:border-l sm:border-sky-200 sm:pl-4">
          Проверяются адрес и точный текст цитаты. Повторные ссылки учитываются отдельно; совпадение с источником само по себе не подтверждает интерпретацию вывода.
        </p>
      </div>

      {warningCount > 0 ? <section aria-label="Замечания к полноте анализа">
        <h3 className="text-sm font-semibold text-slate-900">Что требует проверки</h3>
        <ul className="mt-2 space-y-2">
          {quality.warnings.map((warning, index) => {
            const missingOwner = warning.code === 'unresolved_owner' || warning.code === 'missing_function_owner'
            return <li key={`${warning.code}-${index}`} className={`rounded-lg border-l-2 p-3 ${missingOwner ? 'border-amber-400 bg-amber-50' : 'border-slate-300 bg-slate-50'}`}>
              <h4 className={`text-sm font-semibold ${missingOwner ? 'text-amber-950' : 'text-slate-800'}`}>{warning.title}</h4>
              <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-relaxed text-slate-600">{warning.detail}</p>
              {warning.evidence.length > 0 && <EvidenceDisclosure evidence={warning.evidence}
                label={missingOwner ? 'Проверить блок без владельца' : 'Проверить основание замечания'} />}
            </li>
          })}
        </ul>
      </section> : <p className="text-xs leading-relaxed text-slate-500">
        Замечаний по распознанной структуре нет. Неизвестные конструкции и нераспознанные обязанности могут оставаться за пределами этих проверок.
      </p>}
    </div>
  </details>
}
