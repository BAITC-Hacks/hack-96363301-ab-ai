import type { NormativeGap } from '../types'
import { EvidenceDisclosure } from './EvidenceDisclosure'
import { Empty, Section } from './Section'

export function GapsSection({ gaps }: { gaps: NormativeGap[] }) {
  return (
    <Section
      id="gaps"
      index="04"
      title="Пробелы в нормативном закреплении"
      requirement="Сверх ТЗ"
      subtitle="функции, не закреплённые в разделе функций положения"
      right={<span className="font-mono text-xs text-slate-600">найдено: {gaps.length}</span>}
    >
      {gaps.length === 0 ? (
        <Empty text="Пробелов в нормативном закреплении не выявлено." />
      ) : (
        <ul className="space-y-3">
          {gaps.map((g, i) => (
            <li key={`${g.title.slice(0, 30)}-${i}`} className="border-l-4 border-violet-500 bg-violet-50/50 py-2 pr-2 pl-3">
              <div className="text-[13px] font-semibold text-slate-900">{g.title}</div>
              <p className="mt-1 text-[13px] text-slate-700">{g.detail}</p>
              <EvidenceDisclosure evidence={g.evidence} label="Подтверждающие пункты" />
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}
