import type { Unit, UnitStatus } from '../types'
import { Counter, UnitStatusBadge } from './Badges'
import { EvidenceDisclosure } from './EvidenceDisclosure'
import { Empty, Section } from './Section'

const ORDER: UnitStatus[] = ['created', 'kept', 'reorganized', 'removed']
const TITLE: Record<UnitStatus, string> = {
  created: 'создано',
  kept: 'сохранено',
  reorganized: 'реорганизовано',
  removed: 'упразднено',
}

export function UnitsSection({ units }: { units: Unit[] }) {
  const counts = ORDER.map((s) => ({ s, n: units.filter((u) => u.status === s).length }))

  return (
    <Section
      id="units"
      index="01"
      title="Подразделения"
      requirement="Must have 1"
      subtitle="создано / сохранено / реорганизовано / упразднено"
      right={
        <div className="flex flex-wrap gap-1.5">
          {counts.map(({ s, n }) => (
            <span key={s} className="flex items-center gap-1">
              <UnitStatusBadge status={s} />
              <span className="font-mono text-xs text-slate-700">{n}</span>
            </span>
          ))}
        </div>
      }
    >
      {units.length === 0 ? (
        <Empty text="Изменений в составе подразделений не обнаружено." />
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-300 text-left text-xs tracking-wide text-slate-500 uppercase">
              <th className="w-[36%] py-1.5 pr-3 font-semibold">Подразделение</th>
              <th className="w-[9%] py-1.5 pr-3 font-semibold">Аббр.</th>
              <th className="w-[13%] py-1.5 pr-3 font-semibold">Статус</th>
              <th className="py-1.5 font-semibold">Комментарий и источники</th>
            </tr>
          </thead>
          <tbody>
            {units.map((u, i) => (
              <tr key={`${u.name}-${i}`} className="border-b border-slate-200 align-top">
                <td className="py-2 pr-3 font-medium text-slate-900">{u.name}</td>
                <td className="py-2 pr-3 font-mono text-xs text-slate-700">{u.abbr ?? '—'}</td>
                <td className="py-2 pr-3">
                  <UnitStatusBadge status={u.status} />
                </td>
                <td className="py-2">
                  <div className="text-[13px] text-slate-700">{u.note ?? '—'}</div>
                  <EvidenceDisclosure
                    evidence={u.evidence}
                    label="Подтверждающие пункты"
                    emptyText="Пункт-источник не найден."
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="mt-2 text-xs text-slate-500">
        Итого подразделений в разборе: {units.length}
        {counts
          .filter((c) => c.n > 0)
          .map((c) => (
            <Counter key={c.s} n={c.n} label={TITLE[c.s]} />
          ))}
      </p>
    </Section>
  )
}
