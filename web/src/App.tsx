import { useState } from 'react'
import { analyzeDemo, analyzeFiles } from './api'
import type { AnalyzeResult } from './api'
import { FallbackBanner, MetaBar, ModeBanner } from './components/Banners'
import { ConclusionSection } from './components/ConclusionSection'
import { FunctionsSection } from './components/FunctionsSection'
import { GapsSection } from './components/GapsSection'
import { OverlapSection } from './components/OverlapSection'
import { TracePanel } from './components/TracePanel'
import { UnitsSection } from './components/UnitsSection'
import { UploadPanel } from './components/UploadPanel'

const NAV = [
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

      <div className="mb-4">
        <UploadPanel
          busy={busy}
          onDemo={() => void run('Контрольный комплект: редакция 8 → редакция 9', analyzeDemo)}
          onFiles={(b, a) => void run(`${b.name} → ${a.name}`, () => analyzeFiles(b, a))}
        />
      </div>

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

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
            <div className="space-y-4">
              <UnitsSection units={report.units} />
              <FunctionsSection functions={report.functions} />
              <OverlapSection duplicates={report.duplicates} conflicts={report.conflicts} />
              <GapsSection gaps={report.gaps} />
              <ConclusionSection conclusion={report.conclusion} />
            </div>

            <div className="xl:sticky xl:top-4 xl:self-start">
              <TracePanel trace={report.trace} />
            </div>
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
