import { useEffect, useState } from 'react'
import { analyzeDemo, analyzeFiles, analyzeExample } from './api'
import type { AnalyzeResult } from './api'
import { FallbackBanner, MetaBar, ModeBanner } from './components/Banners'
import { ConclusionSection } from './components/ConclusionSection'
import { FunctionsSection } from './components/FunctionsSection'
import { GapsSection } from './components/GapsSection'
import { OverlapSection } from './components/OverlapSection'
import { TracePanel } from './components/TracePanel'
import { UnitsSection } from './components/UnitsSection'
import { UploadPanel } from './components/UploadPanel'
import { ReportSummary } from './components/ReportSummary'
import { ReorganizationLab } from './components/ReorganizationLab'

const NAV = [
  { id: 'reorganization-lab', label: 'План реорганизации' },
  { id: 'units', label: '01 Подразделения' },
  { id: 'functions', label: '02 Функции' },
  { id: 'overlap', label: '03 Дублирование и КИ' },
  { id: 'gaps', label: '04 Пробелы' },
  { id: 'conclusion', label: '05 Заключение' },
  { id: 'trace', label: 'Трассировка' },
]

function Spinner({ what }: { what: string }) {
  return (
    <div className="border border-slate-300 bg-white px-4 py-8 text-center">
      <div className="text-sm font-semibold text-slate-900">Анализ выполняется…</div>
      <p className="mt-1 text-xs text-slate-600">{what}</p>
    </div>
  )
}

export default function App() {
  const [result, setResult] = useState<AnalyzeResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [stage, setStage] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function run(what: string, fn: () => Promise<AnalyzeResult>) {
    setBusy(true)
    setError(null)
    setResult(null)
    setStage(what)
    try {
      setResult(await fn())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось выполнить анализ.')
    } finally {
      setBusy(false)
      setStage('')
    }
  }

  const report = result?.report ?? null
  useEffect(() => {
    if (report) document.getElementById('reorganization-lab')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [report])

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-4">
      <header className="mb-4 border border-slate-800 bg-slate-800 px-4 py-3 text-white">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-lg font-bold">ИИ-агент «Анализ организационной структуры и функционала»</h1>
          <span className="text-xs text-slate-300">
            сравнение комплектов документов «до» и «после» реорганизации
          </span>
          <span className="ml-auto text-xs text-slate-400">Казактелеком · HackAlem AI</span>
        </div>
        {report ? (
          <nav className="mt-2 flex flex-wrap gap-1 border-t border-slate-700 pt-2">
            {NAV.map((n) => (
              <a
                key={n.id}
                href={`#${n.id}`}
                className="border border-slate-600 px-2 py-0.5 text-xs text-slate-200 hover:bg-slate-700"
              >
                {n.label}
              </a>
            ))}
          </nav>
        ) : null}
      </header>

      <details className="mb-4" open={!report || busy}>
        <summary className={report ? 'rounded-lg border border-slate-300 bg-white px-4 py-3 font-semibold text-slate-700' : 'hidden'}>Изменить документы для сравнения</summary>
        <UploadPanel
          busy={busy}
          onDemo={() => void run('Контрольный комплект: редакция 8 → редакция 9', analyzeDemo)}
          onExample={() => void run('Независимый учебный пример: переименование, перенос, утрата и пересечение функций', analyzeExample)}
          onFiles={(b, a) => void run(`${b.name} → ${a.name}`, () => analyzeFiles(b, a))}
        />
      </details>

      {busy ? <Spinner what={stage} /> : null}
      {error ? <div role="alert" className="mb-4 border border-rose-400 bg-rose-50 p-4 text-rose-900">{error}</div> : null}

      {!busy && !report ? (
        <div className="border border-slate-300 bg-white px-6 py-10 text-center">
          <p className="text-sm font-semibold text-slate-900">Отчёт ещё не сформирован</p>
          <p className="mx-auto mt-1 max-w-2xl text-sm text-slate-600">
            Загрузите два документа (DOCX, PDF, XLSX) — редакции «до» и «после» — или нажмите
            <span className="mx-1 font-semibold text-slate-900">«Проанализировать демо-комплект»</span>: агент
            разберёт контрольный комплект организатора и покажет реорганизацию подразделений, перенос и потерю
            функций, дублирование и конфликт интересов — каждый вывод со ссылкой на пункт документа.
          </p>
        </div>
      ) : null}

      {!busy && result && report ? (
        <div className="space-y-4">
          <ModeBanner mode={report.meta.mode} />
          {result.fallback && result.fallbackReason ? <FallbackBanner reason={result.fallbackReason} /> : null}
          <MetaBar meta={report.meta} />
          <ReorganizationLab key={report.meta.reportId || report.meta.generatedAt} report={report} />
          <ReportSummary report={report} />

          <div className="space-y-4">
            <div className="space-y-4">
              <UnitsSection units={report.units} />
              <FunctionsSection functions={report.functions} />
              <OverlapSection duplicates={report.duplicates} conflicts={report.conflicts} />
              <GapsSection gaps={report.gaps} />
              <ConclusionSection conclusion={report.conclusion} />
            </div>

            <details id="trace" className="border border-slate-300 bg-white">
              <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">Технические подробности анализа</summary>
              <TracePanel trace={report.trace} />
            </details>
          </div>
        </div>
      ) : null}

      <footer className="mt-6 border-t border-slate-300 pt-3 text-xs text-slate-500">
        Выводы агента носят рекомендательный характер и требуют проверки ответственным сотрудником. Каждый
        существенный вывод прослеживается до пункта исходного документа.
      </footer>
    </div>
  )
}
