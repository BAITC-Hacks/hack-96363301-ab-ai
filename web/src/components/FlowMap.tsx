import { useMemo, useState } from 'react'
import type { AnalysisReport, FunctionDiff } from '../types'
import { EvidenceDisclosure } from './EvidenceDisclosure'

type FlowMode = 'moved' | 'lost' | 'added'
const LABELS = { moved: 'Передача ответственности', lost: 'Без найденного соответствия', added: 'Новые закрепления' }
const COLORS = { moved: '#38bdf8', lost: '#fb7185', added: '#34d399' }

export function FlowMap({ report }: { report: AnalysisReport }) {
  const [mode, setMode] = useState<FlowMode>('moved')
  const [selected, setSelected] = useState<string | null>(null)
  const flows = useMemo(() => {
    const groups = new Map<string, { id: string; from: string; to: string; items: FunctionDiff[] }>()
    report.functions.filter((f) => f.change === mode).forEach((f) => {
      const from = f.ownerBefore || 'Новое закрепление'
      const to = f.ownerAfter || 'Соответствие не найдено'
      const id = JSON.stringify([from, to])
      const group = groups.get(id) || { id, from, to, items: [] }
      group.items.push(f)
      groups.set(id, group)
    })
    return [...groups.values()]
  }, [report, mode])
  const left = [...new Set(flows.map((f) => f.from))]
  const right = [...new Set(flows.map((f) => f.to))]
  const height = Math.max(270, Math.max(left.length, right.length) * 78 + 100)
  const y = (i: number, count: number) => 70 + (i + 0.5) * ((height - 120) / Math.max(1, count))
  const selectedFlow = flows.find((f) => f.id === selected)
  const pick = (id: string) => setSelected(selected === id ? null : id)
  return <div>
    <div className="mb-4 flex flex-wrap gap-2" aria-label="Режим карты">
      {(Object.keys(LABELS) as FlowMode[]).map((key) => <button type="button" key={key} aria-pressed={mode === key}
        onClick={() => { setMode(key); setSelected(null) }} className={`rounded-lg border px-3 py-2 text-sm ${mode === key ? 'border-sky-500 bg-sky-50 font-semibold text-sky-900' : 'border-slate-200 bg-white text-slate-600'}`}>
        {LABELS[key]} · {report.functions.filter((f) => f.change === key).length}
      </button>)}
    </div>
    {!flows.length ? <p className="rounded-xl bg-slate-50 p-6 text-slate-600">Изменений этого типа не обнаружено.</p> : <>
      <div className="overflow-x-auto rounded-xl bg-slate-950 px-2 pb-3 pt-2">
        <svg viewBox={`0 0 1000 ${height}`} className="min-w-[620px] w-full" role="group" aria-label="Карта связей между владельцами функций до и после реорганизации">
          <text x="42" y="34" fill="#94a3b8" fontSize="13" letterSpacing="2">ДО РЕОРГАНИЗАЦИИ</text>
          <text x="732" y="34" fill="#94a3b8" fontSize="13" letterSpacing="2">ПОСЛЕ РЕОРГАНИЗАЦИИ</text>
          {flows.map((flow, flowIndex) => {
            const y1 = y(left.indexOf(flow.from), left.length), y2 = y(right.indexOf(flow.to), right.length)
            const path = `M 260 ${y1} C 455 ${y1}, 545 ${y2}, 740 ${y2}`
            // Метки разнесены вдоль кривых, чтобы не перекрывать друг друга в центре.
            const t = 0.25 + (flowIndex % 5) * 0.12
            const xLabel = (1 - t) ** 3 * 260 + 3 * (1 - t) ** 2 * t * 455 + 3 * (1 - t) * t ** 2 * 545 + t ** 3 * 740
            const blend = 3 * t * t - 2 * t * t * t
            const yLabel = y1 * (1 - blend) + y2 * blend
            return <g key={flow.id} role="button" tabIndex={0} aria-label={`${flow.from} → ${flow.to}: ${flow.items.length} функций`}
              onClick={() => pick(flow.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(flow.id) } }} className="cursor-pointer outline-none focus:opacity-100"
              opacity={selected && selected !== flow.id ? 0.17 : 1}>
              <title>{flow.from} → {flow.to}: {flow.items.length}. Нажмите, чтобы увидеть источники.</title>
              <path d={path} fill="none" stroke="transparent" strokeWidth="24" />
              <path d={path} fill="none" stroke={COLORS[mode]} strokeWidth={Math.min(18, 2 + flow.items.length * 2)} strokeOpacity={selected === flow.id ? 1 : 0.55} />
              <circle cx={xLabel} cy={yLabel} r="15" fill="#0f172a" stroke={COLORS[mode]} />
              <text x={xLabel} y={yLabel + 5} textAnchor="middle" fill="white" fontSize="13" fontWeight="700">{flow.items.length}</text>
            </g>
          })}
          {[{ nodes: left, x: 30 }, { nodes: right, x: 740 }].map(({ nodes, x }) => nodes.map((name, i) => <g key={`${x}-${name}`}>
            <rect x={x} y={y(i, nodes.length) - 28} width="230" height="56" rx="10" fill="#17243c" stroke="#334155" />
            <foreignObject x={x + 12} y={y(i, nodes.length) - 24} width="206" height="48">
              <div className="flex h-full items-center text-[13px] font-semibold leading-tight text-white">{name}</div>
            </foreignObject>
          </g>))}
        </svg>
        <p className="px-4 text-xs text-slate-400">Число на линии — количество сопоставленных функций. Нажмите на связь: каждый переход раскрывается до исходного пункта.</p>
      </div>
      {selectedFlow ? <div className="mt-4 rounded-xl border border-sky-200 bg-sky-50 p-4" aria-live="polite">
        <h3 className="font-semibold text-slate-900">{selectedFlow.from} → {selectedFlow.to}</h3>
        <div className="mt-3 max-h-96 space-y-4 overflow-y-auto">
          {selectedFlow.items.map((f, i) => <div key={i} className="rounded-lg bg-white p-3">
            <p className="text-sm text-slate-800">{f.text}</p>
            <EvidenceDisclosure evidence={[]} label="Проверить переход по источникам" groups={[
              { title: 'До', items: f.evidenceBefore }, { title: 'После', items: f.evidenceAfter },
            ]} />
          </div>)}
        </div>
      </div> : <p className="mt-3 text-sm text-slate-600">Выберите связь на карте для проверки конкретных функций и цитат.</p>}
    </>}
  </div>
}
