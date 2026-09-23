import type { FunctionChange, UnitStatus } from '../types'

const UNIT_STATUS: Record<UnitStatus, { label: string; cls: string }> = {
  created: { label: 'Создано', cls: 'bg-emerald-100 text-emerald-900 ring-emerald-300' },
  kept: { label: 'Сохранено', cls: 'bg-slate-100 text-slate-700 ring-slate-300' },
  reorganized: { label: 'Реорганизовано', cls: 'bg-amber-100 text-amber-900 ring-amber-400' },
  removed: { label: 'Упразднено', cls: 'bg-rose-100 text-rose-900 ring-rose-300' },
}

export function UnitStatusBadge({ status }: { status: UnitStatus }) {
  const s = UNIT_STATUS[status] ?? { label: status, cls: 'bg-slate-100 text-slate-700 ring-slate-300' }
  return (
    <span
      className={`inline-block rounded-sm px-2 py-0.5 text-xs font-semibold whitespace-nowrap ring-1 ring-inset ${s.cls}`}
    >
      {s.label}
    </span>
  )
}

/**
 * `lost` и `moved` намеренно различаются не только цветом, но и начертанием:
 * «утрачена» — залитый красный, «передана» — контурный синий со стрелкой.
 * Это ключевое различие всего решения.
 */
const FUNCTION_CHANGE: Record<FunctionChange, { label: string; cls: string; bar: string }> = {
  lost: {
    label: '● Возможная утрата',
    cls: 'bg-rose-600 text-white ring-rose-700',
    bar: 'border-l-4 border-rose-600',
  },
  moved: {
    label: '→ Передана',
    cls: 'bg-white text-indigo-800 ring-indigo-500',
    bar: 'border-l-4 border-indigo-500',
  },
  added: {
    label: '+ Добавлена',
    cls: 'bg-emerald-100 text-emerald-900 ring-emerald-400',
    bar: 'border-l-4 border-emerald-400',
  },
  reworded: {
    label: '≈ Переформулирована',
    cls: 'bg-amber-100 text-amber-900 ring-amber-400',
    bar: 'border-l-4 border-amber-300',
  },
  kept: {
    label: '= Без изменений',
    cls: 'bg-slate-100 text-slate-600 ring-slate-300',
    bar: 'border-l-4 border-slate-200',
  },
}

// eslint-disable-next-line react/only-export-components
export function functionChangeBar(change: FunctionChange): string {
  return FUNCTION_CHANGE[change]?.bar ?? 'border-l-4 border-slate-200'
}

export function FunctionChangeBadge({ change }: { change: FunctionChange }) {
  const s = FUNCTION_CHANGE[change] ?? {
    label: change,
    cls: 'bg-slate-100 text-slate-700 ring-slate-300',
    bar: '',
  }
  return (
    <span
      className={`inline-block rounded-sm px-2 py-0.5 text-xs font-semibold whitespace-nowrap ring-1 ring-inset ${s.cls}`}
    >
      {s.label}
    </span>
  )
}

export function Similarity({ value }: { value: number }) {
  const pct = Math.round(value * 100)
  return (
    <span className="font-mono text-xs text-slate-600" title="Близость формулировок «до» и «после»">
      {(value ?? 0).toFixed(2)}
      <span className="ml-1 text-slate-400">({pct}%)</span>
    </span>
  )
}

export function Counter({ n, label }: { n: number; label: string }) {
  return (
    <span className="ml-2 rounded-sm bg-slate-200 px-1.5 py-0.5 text-xs font-semibold text-slate-700">
      {n} {label}
    </span>
  )
}
