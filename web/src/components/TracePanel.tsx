import type { TraceStep } from '../types'

function ms(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(2)} с` : `${n} мс`
}

function size(n: number | null): string {
  if (n === null) return '—'
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}

/**
 * Трассировка пайплайна — видимая агентность.
 * Показывает, что детерминировано, что отдано модели, откуда взят ответ
 * (живой вызов API или записанная фикстура) и сколько ссылок модели
 * отброшено валидатором как неподтверждённые.
 */
export function TracePanel({ trace }: { trace: TraceStep[] }) {
  const llm = trace.filter((t) => t.kind === 'llm')
  const total = trace.reduce((a, t) => a + (t.durationMs ?? 0), 0)
  const returned = trace.reduce((a, t) => a + (t.citationsReturned ?? 0), 0)
  const rejected = trace.reduce((a, t) => a + (t.citationsRejected ?? 0), 0)
  const fixtures = llm.filter((t) => t.source === 'fixture').length

  return (
    <aside id="trace" className="border border-slate-800 bg-slate-900 text-slate-200">
      <header className="border-b border-slate-700 px-3 py-2">
        <h2 className="text-sm font-bold tracking-wide text-white uppercase">Трассировка пайплайна</h2>
        <p className="mt-0.5 text-[11px] text-slate-400">
          Каждый шаг агента: детерминированный или LLM, модель, источник ответа, время.
        </p>
      </header>

      <dl className="grid grid-cols-2 gap-px border-b border-slate-700 bg-slate-700 text-center">
        <div className="bg-slate-900 px-2 py-1.5">
          <dt className="text-[10px] tracking-wide text-slate-400 uppercase">Шагов</dt>
          <dd className="font-mono text-base font-bold text-white">
            {trace.length}
            <span className="ml-1 text-xs font-normal text-slate-400">из них LLM: {llm.length}</span>
          </dd>
        </div>
        <div className="bg-slate-900 px-2 py-1.5">
          <dt className="text-[10px] tracking-wide text-slate-400 uppercase">Суммарное время</dt>
          <dd className="font-mono text-base font-bold text-white">{ms(total)}</dd>
        </div>
        <div className="bg-slate-900 px-2 py-1.5">
          <dt className="text-[10px] tracking-wide text-slate-400 uppercase">Ссылок от модели</dt>
          <dd className="font-mono text-base font-bold text-white">{returned}</dd>
        </div>
        <div className="bg-slate-900 px-2 py-1.5">
          <dt className="text-[10px] tracking-wide text-slate-400 uppercase">Отклонено валидатором</dt>
          <dd className={`font-mono text-base font-bold ${rejected > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
            {rejected}
          </dd>
        </div>
      </dl>

      <ol className="divide-y divide-slate-800">
        {trace.map((t, i) => (
          <li key={`${t.step}-${i}`} className="px-3 py-2">
            <div className="flex items-start gap-2">
              <span className="mt-0.5 font-mono text-[11px] text-slate-500">{String(i + 1).padStart(2, '0')}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span
                    className={`rounded-sm px-1.5 py-0.5 text-[10px] font-bold tracking-wide uppercase ${
                      t.kind === 'llm' ? 'bg-violet-500 text-white' : 'bg-slate-600 text-slate-100'
                    }`}
                  >
                    {t.kind === 'llm' ? 'LLM' : 'детерм.'}
                  </span>
                  {t.model ? (
                    <span className="font-mono text-[11px] text-violet-300">{t.model}</span>
                  ) : null}
                  <span
                    className={`rounded-sm border px-1 text-[10px] font-semibold ${
                      t.source === 'fixture'
                        ? 'border-amber-500 text-amber-300'
                        : 'border-emerald-500 text-emerald-300'
                    }`}
                    title={
                      t.source === 'fixture'
                        ? 'Ответ воспроизведён из записанной фикстуры — API-ключ не нужен'
                        : t.source === 'local' ? 'Расчёт по документам' : t.source === 'none' ? 'Ответ модели не получен' : 'Вызов модели'
                    }
                  >
                    {{ fixture: 'фикстура', api: 'API', local: 'расчёт', none: 'недоступно' }[t.source]}
                  </span>
                  <span className="ml-auto font-mono text-[11px] text-slate-400">{ms(t.durationMs)}</span>
                </div>

                <div className="mt-1 text-[12px] leading-snug text-slate-200">{t.step}</div>

                <div className="mt-1 flex flex-wrap gap-x-3 font-mono text-[10px] text-slate-500">
                  <span>вход: {size(t.inputSize)}</span>
                  {t.citationsReturned !== null ? <span>ссылок: {t.citationsReturned}</span> : null}
                  {t.citationsRejected !== null ? (
                    <span className={t.citationsRejected > 0 ? 'text-rose-400' : 'text-emerald-400'}>
                      отклонено: {t.citationsRejected}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
          </li>
        ))}
      </ol>

      <footer className="border-t border-slate-700 px-3 py-2 text-[11px] leading-snug text-slate-400">
        Текст цитаты и номер пункта подставляет парсер, а не модель. Модель получает только список допустимых
        идентификаторов пунктов конкретной находки. При неверных или пустых ссылках ответ отклоняется.
        Свободный текст модели не публикуется.
        {fixtures > 0 ? (
          <span className="mt-1 block text-amber-300">
            Шагов из фикстур: {fixtures} — демо-режим, ключ не требуется.
          </span>
        ) : null}
      </footer>
    </aside>
  )
}
