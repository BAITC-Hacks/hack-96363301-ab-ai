import type { AnalysisReport } from '../types'

export function ReportSummary({ report }: { report: AnalysisReport }) {
  const cards = [
    { label: 'Проверить возможную утрату', count: report.functions.filter((f) => f.change === 'lost').length, href: '#functions' },
    { label: 'Изменение владельцев', count: report.functions.filter((f) => f.change === 'moved').length, href: '#functions' },
    { label: 'Пересечения обязанностей', count: report.duplicates.length, href: '#overlap' },
    { label: 'Потенциальные конфликты', count: report.conflicts.length, href: '#overlap' },
  ]
  return <section aria-label="Краткие итоги" className="border border-slate-300 bg-white p-4">
    <h2 className="font-semibold text-slate-900">Что требует внимания</h2>
    <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((c) => <a key={c.label} href={c.href} className="border border-slate-200 bg-slate-50 p-3 hover:border-sky-600">
        <div className="text-2xl font-bold text-slate-900">{c.count}</div>
        <div className="text-sm text-slate-700">{c.label}</div>
      </a>)}
    </div>
    <p className="mt-2 text-xs text-slate-600">В таблице сначала показаны изменения. Возможная утрата и сходство формулировок требуют проверки по источникам.</p>
    <a className="mt-2 inline-block text-sm font-semibold text-sky-800 underline" href="#conclusion">Перейти к заключению и рекомендациям</a>
  </section>
}
