import type { AnalysisReport } from '../types'
import { EvidenceDisclosure } from './EvidenceDisclosure'
import { Section } from './Section'

export function ConclusionSection({ conclusion }: { conclusion: AnalysisReport['conclusion'] }) {
  return (
    <Section
      id="conclusion"
      index="05"
      title="Итоговое аналитическое заключение"
      requirement="Must have 5"
      subtitle="выводы и рекомендации"
    >
      <p className="border-l-4 border-slate-800 bg-slate-50 py-2 pr-2 pl-3 text-sm text-slate-900">
        {conclusion.summary}
      </p>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 border-b border-slate-300 pb-1 text-sm font-semibold text-slate-900">
            Выявленные отклонения
            <span className="ml-2 font-mono text-xs font-normal text-slate-500">{conclusion.findings.length}</span>
          </h3>
          <ol className="space-y-1.5">
            {conclusion.findings.map((f, i) => (
              <li key={i} className="flex gap-2 text-[13px] text-slate-800">
                <span className="font-mono text-xs font-bold text-slate-500">{String(i + 1).padStart(2, '0')}</span>
                <div>{f}<EvidenceDisclosure evidence={conclusion.findingEvidence[i] || []} /></div>
              </li>
            ))}
          </ol>
        </div>

        <div>
          <h3 className="mb-2 border-b border-slate-300 pb-1 text-sm font-semibold text-slate-900">
            Рекомендации
            <span className="ml-2 font-mono text-xs font-normal text-slate-500">
              {conclusion.recommendations.length}
            </span>
          </h3>
          <ol className="space-y-1.5">
            {conclusion.recommendations.map((r, i) => (
              <li key={i} className="flex gap-2 text-[13px] text-slate-800">
                <span className="font-mono text-xs font-bold text-emerald-700">R{i + 1}</span>
                <div>{r}<EvidenceDisclosure evidence={conclusion.recommendationEvidence[i] || []} /></div>
              </li>
            ))}
          </ol>
        </div>
      </div>

      <div className="mt-4 border border-amber-500 bg-amber-50 px-3 py-2">
        <div className="text-xs font-bold tracking-wide text-amber-900 uppercase">
          Ограничение применения (п. 9 ТЗ)
        </div>
        <p className="mt-1 text-[13px] text-amber-950">{conclusion.disclaimer}</p>
      </div>
    </Section>
  )
}
