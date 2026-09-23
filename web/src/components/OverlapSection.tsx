import type { ConflictOfInterest, Duplicate } from '../types'
import { EvidenceDisclosure } from './EvidenceDisclosure'
import { Empty, Section } from './Section'

function Owners({ owners }: { owners: string[] }) {
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {owners.map((o, i) => (
        <span key={`${o}-${i}`} className="border border-slate-300 bg-slate-100 px-1.5 py-0.5 text-xs text-slate-800">
          {o}
        </span>
      ))}
    </div>
  )
}

export function OverlapSection({
  duplicates,
  conflicts,
}: {
  duplicates: Duplicate[]
  conflicts: ConflictOfInterest[]
}) {
  return (
    <Section
      id="overlap"
      index="03"
      title="Дублирование функций и конфликт интересов"
      requirement="Must have 3"
      subtitle="сопоставление подразделений между собой"
      right={
        <span className="font-mono text-xs text-slate-600">
          пересечений: {duplicates.length} · потенциальных конфликтов: {conflicts.length}
        </span>
      }
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 border-b border-amber-400 pb-1 text-sm font-semibold text-slate-900">
            Возможное дублирование и совместные обязанности
          </h3>
          {duplicates.length === 0 ? (
            <Empty text="Дублирования функций не обнаружено." />
          ) : (
            <ul className="space-y-3">
              {duplicates.map((d, i) => (
                <li key={`${d.text.slice(0, 30)}-${i}`} className="border-l-4 border-amber-400 bg-amber-50/60 py-2 pr-2 pl-3">
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-xs font-bold text-amber-800">ДУБ-{i + 1}</span>
                    <span className="text-[13px] font-semibold text-slate-900">{d.text}</span>
                  </div>
                  <Owners owners={d.owners} />
                  {d.rationale ? <p className="mt-1.5 text-[13px] text-slate-700">{d.rationale}</p> : null}
                  <EvidenceDisclosure evidence={d.evidence} label="Пункты, где функция закреплена" />
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h3 className="mb-2 border-b border-rose-400 pb-1 text-sm font-semibold text-slate-900">
            Потенциальный конфликт интересов
          </h3>
          {conflicts.length === 0 ? (
            <Empty text="Признаков конфликта интересов не обнаружено." />
          ) : (
            <ul className="space-y-3">
              {conflicts.map((c, i) => (
                <li key={`${c.title.slice(0, 30)}-${i}`} className="border-l-4 border-rose-500 bg-rose-50/60 py-2 pr-2 pl-3">
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-xs font-bold text-rose-800">КИ-{i + 1}</span>
                    <span className="text-[13px] font-semibold text-slate-900">{c.title}</span>
                  </div>
                  <Owners owners={c.owners} />
                  {c.rationale ? <p className="mt-1.5 text-[13px] text-slate-700">{c.rationale}</p> : null}
                  <EvidenceDisclosure evidence={c.evidence} label="Подтверждающие пункты" />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Section>
  )
}
