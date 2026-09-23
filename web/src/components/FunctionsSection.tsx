import { useState } from 'react'
import type { FunctionChange, FunctionDiff } from '../types'
import { FunctionChangeBadge, Similarity, functionChangeBar } from './Badges'
import { EvidenceDisclosure } from './EvidenceDisclosure'
import { Empty, Section } from './Section'

const ORDER: FunctionChange[] = ['lost', 'moved', 'added', 'reworded', 'kept']

export function FunctionsSection({ functions }: { functions: FunctionDiff[] }) {
  const [filter, setFilter] = useState<FunctionChange | 'all'>('all')
  const rows = filter === 'all' ? functions : functions.filter((f) => f.change === filter)
  const count = (c: FunctionChange) => functions.filter((f) => f.change === c).length

  return (
    <Section
      id="functions"
      index="02"
      title="Сопоставление функций"
      requirement="Must have 2"
      subtitle="«передана» ≠ «утрачена»: смена владельца не считается потерей"
      right={
        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            onClick={() => setFilter('all')}
            className={`border px-2 py-0.5 text-xs font-medium ${
              filter === 'all' ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-300 bg-white text-slate-700'
            }`}
          >
            Все ({functions.length})
          </button>
          {ORDER.filter((c) => count(c) > 0).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setFilter(filter === c ? 'all' : c)}
              className={`border px-1 py-0.5 ${
                filter === c ? 'border-slate-800 bg-slate-100' : 'border-transparent'
              }`}
            >
              <FunctionChangeBadge change={c} />
              <span className="ml-1 font-mono text-xs text-slate-600">{count(c)}</span>
            </button>
          ))}
        </div>
      }
    >
      {rows.length === 0 ? (
        <Empty text="Функций с такой меткой не найдено." />
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-300 text-left text-xs tracking-wide text-slate-500 uppercase">
              <th className="w-[15%] py-1.5 pr-3 font-semibold">Статус</th>
              <th className="w-[40%] py-1.5 pr-3 font-semibold">Функция</th>
              <th className="w-[15%] py-1.5 pr-3 font-semibold">Владелец «до»</th>
              <th className="w-[15%] py-1.5 pr-3 font-semibold">Владелец «после»</th>
              <th className="py-1.5 font-semibold">Сходство</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((f, i) => (
              <tr key={`${f.text.slice(0, 40)}-${i}`} className="border-b border-slate-200 align-top">
                <td className={`py-2 pr-3 pl-2 ${functionChangeBar(f.change)}`}>
                  <FunctionChangeBadge change={f.change} />
                </td>
                <td className="py-2 pr-3">
                  <div className="font-medium text-slate-900">{f.text}</div>
                  {f.rationale ? (
                    <div className="mt-1 border-l-2 border-slate-300 pl-2 text-[13px] text-slate-600">
                      <span className="font-semibold text-slate-500">Обоснование агента: </span>
                      {f.rationale}
                    </div>
                  ) : null}
                  <EvidenceDisclosure
                    evidence={[]}
                    label="Подтверждающие пункты"
                    groups={[
                      { title: 'Документ «до»', items: f.evidenceBefore },
                      { title: 'Документ «после»', items: f.evidenceAfter },
                    ]}
                  />
                </td>
                <td className="py-2 pr-3 text-[13px] text-slate-800">
                  {f.ownerBefore ?? <span className="text-slate-400">— отсутствует</span>}
                </td>
                <td className="py-2 pr-3 text-[13px] text-slate-800">
                  {f.ownerAfter ?? <span className="font-semibold text-rose-700">— не закреплена</span>}
                </td>
                <td className="py-2">
                  <Similarity value={f.similarity} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  )
}
