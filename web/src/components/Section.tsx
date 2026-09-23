import type { ReactNode } from 'react'

export function Section({
  id,
  index,
  title,
  requirement,
  subtitle,
  right,
  children,
}: {
  id: string
  index: string
  title: string
  /** Пункт ТЗ, который закрывает секция — чтобы эксперт ставил галочки. */
  requirement?: string
  subtitle?: string
  right?: ReactNode
  children: ReactNode
}) {
  return (
    <section id={id} className="scroll-mt-4 border border-slate-300 bg-white">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-slate-300 bg-slate-50 px-4 py-2.5">
        <span className="font-mono text-xs text-slate-500">{index}</span>
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        {requirement ? (
          <span className="rounded-sm bg-slate-800 px-1.5 py-0.5 text-[11px] font-semibold text-white">
            {requirement}
          </span>
        ) : null}
        {subtitle ? <span className="text-xs text-slate-600">{subtitle}</span> : null}
        <div className="ml-auto">{right}</div>
      </header>
      <div className="px-4 py-3">{children}</div>
    </section>
  )
}

export function Empty({ text }: { text: string }) {
  return <p className="px-1 py-4 text-sm text-slate-500">{text}</p>
}
