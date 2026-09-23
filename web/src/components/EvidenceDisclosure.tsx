import type { Evidence } from '../types'

/** Ярлык документа: red8 → «ред. 8». */
function docLabel(docId: string): string {
  const m = /^red(\d+)$/.exec(docId)
  return m ? (m[1] === '8' ? 'Документ «до»' : 'Документ «после»') : docId
}

function docTone(docId: string): string {
  return docId.endsWith('8')
    ? 'bg-slate-700 text-white'
    : docId.endsWith('9')
      ? 'bg-sky-700 text-white'
      : 'bg-slate-500 text-white'
}

export function EvidenceItem({ ev }: { ev: Evidence }) {
  return (
    <li className="border-l-2 border-slate-300 bg-slate-50 py-1.5 pr-2 pl-3">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className={`rounded-sm px-1.5 py-0.5 font-mono text-[11px] font-semibold ${docTone(ev.docId)}`}>
          {docLabel(ev.docId)}
        </span>
        <span className="font-mono text-xs font-semibold text-slate-900">п. {ev.number}</span>
        <span className="font-mono text-[11px] text-slate-500">{ev.ref}</span>
      </div>
      <blockquote className="text-[13px] text-slate-800 italic">«{ev.text}»</blockquote>
    </li>
  )
}

/**
 * Раскрывающийся блок подтверждающих источников (must have 4).
 * Каждый вывод на экране обязан иметь такой блок: документ, номер пункта,
 * точный текст фрагмента.
 */
export function EvidenceDisclosure({
  evidence,
  label = 'Показать источники',
  emptyText = 'Подтверждающих пунктов нет — вывод построен на отсутствии формулировки в документе «после».',
  groups,
}: {
  evidence: Evidence[]
  label?: string
  emptyText?: string
  /** Альтернатива плоскому списку: несколько подписанных групп («до» / «после»). */
  groups?: Array<{ title: string; items: Evidence[] }>
}) {
  const all = groups ? groups.flatMap((g) => g.items) : evidence
  const count = all.length

  return (
    <details className="group mt-1.5">
      <summary className="inline-flex items-center gap-1.5 text-[13px] font-medium text-sky-800 hover:text-sky-950">
        <span className="font-mono text-xs group-open:hidden">▸</span>
        <span className="hidden font-mono text-xs group-open:inline">▾</span>
        <span className="underline decoration-dotted underline-offset-2">{label}</span>
        <span className="rounded-sm bg-sky-100 px-1.5 py-0.5 font-mono text-[11px] text-sky-900">{count}</span>
      </summary>

      <div className="mt-2 space-y-2">
        {count === 0 ? <p className="text-[13px] text-slate-600">{emptyText}</p> : null}

        {groups
          ? groups.map((g) => (
              <div key={g.title}>
                <div className="mb-1 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                  {g.title}
                </div>
                {g.items.length === 0 ? (
                  <p className="border-l-2 border-rose-300 bg-rose-50 py-1.5 pr-2 pl-3 text-[13px] text-rose-900">
                    Ни одного пункта выше порога сходства не найдено.
                  </p>
                ) : (
                  <ul className="space-y-1.5">
                    {g.items.map((ev, i) => (
                      <EvidenceItem key={`${ev.ref}-${i}`} ev={ev} />
                    ))}
                  </ul>
                )}
              </div>
            ))
          : (
              <ul className="space-y-1.5">
                {evidence.map((ev, i) => (
                  <EvidenceItem key={`${ev.ref}-${i}`} ev={ev} />
                ))}
              </ul>
            )}
      </div>
    </details>
  )
}

/** Компактный перечень ссылок под выводом заключения. */
export function RefChips({ evidence }: { evidence: Evidence[] }) {
  return (
    <span className="ml-1 inline-flex flex-wrap gap-1 align-middle">
      {evidence.map((ev, i) => (
        <span
          key={`${ev.ref}-${i}`}
          title={ev.text}
          className="rounded-sm border border-slate-300 bg-slate-100 px-1 font-mono text-[11px] text-slate-700"
        >
          {ev.ref}
        </span>
      ))}
    </span>
  )
}
