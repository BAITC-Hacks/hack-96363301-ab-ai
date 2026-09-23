import { useState } from 'react'
import type { ReactNode } from 'react'
import type { Evidence, FunctionDiff } from '../types'
import { EvidenceDisclosure } from './EvidenceDisclosure'

type Signal = NonNullable<FunctionDiff['materialChanges']>[number]
type Kind = Signal['kind']

const LABELS: Record<Kind, string> = {
  prohibition: 'Отрицание и запрет',
  obligation: 'Обязанность и право',
  frequency: 'Сроки и периодичность',
  scope: 'Объём полномочий',
}

const QUESTIONS: Record<Kind, string> = {
  prohibition: 'Относится ли отрицание к тому же действию? Проверьте соседние пункты и исключения: запрет может быть намеренным ограничением полномочий.',
  obligation: 'Должна ли функция оставаться обязательной? Уточните, закреплена ли обязанность в другом пункте или документе и кто теперь отвечает за результат.',
  frequency: 'Как новая периодичность или срок влияет на контроль? Уточните единицы времени, событие начала отсчёта и допустимые исключения.',
  scope: 'Какие объекты, условия и участники теперь входят в полномочия? Проверьте определения терминов и соседние пункты, прежде чем оценивать последствия.',
}

/** Подсвечиваем только буквальные вхождения, сохраняя текст цитаты без изменений. */
function Highlight({ text, fragments }: { text: string; fragments: string[] }) {
  const intervals: Array<[number, number]> = []
  for (const fragment of new Set(fragments.filter(Boolean))) {
    let start = text.indexOf(fragment)
    while (start !== -1) {
      intervals.push([start, start + fragment.length])
      start = text.indexOf(fragment, start + fragment.length)
    }
  }
  intervals.sort((a, b) => a[0] - b[0])
  const merged: Array<[number, number]> = []
  for (const interval of intervals) {
    const previous = merged[merged.length - 1]
    if (previous && interval[0] <= previous[1]) previous[1] = Math.max(previous[1], interval[1])
    else merged.push([...interval])
  }
  const nodes: ReactNode[] = []
  let cursor = 0
  for (const [start, end] of merged) {
    nodes.push(text.slice(cursor, start))
    nodes.push(<mark key={`${start}-${end}`} className="rounded-sm bg-amber-200 px-0.5 font-semibold text-slate-950">{text.slice(start, end)}</mark>)
    cursor = end
  }
  nodes.push(text.slice(cursor))
  return <>{nodes}</>
}

function SourceColumn({ label, owner, evidence, fragments, after = false }: {
  label: string; owner: string | null; evidence: Evidence[]; fragments: string[]; after?: boolean
}) {
  return <div className={`min-w-0 rounded-xl border p-4 ${after ? 'border-sky-200 bg-sky-50/60' : 'border-slate-200 bg-slate-50'}`}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h4 className={`text-xs font-bold uppercase tracking-wider ${after ? 'text-sky-800' : 'text-slate-600'}`}>{label}</h4>
      {owner && <span className="max-w-full break-words rounded-md bg-white px-2 py-1 text-xs font-medium text-slate-700">{owner}</span>}
    </div>
    {evidence.map((ev, index) => <div key={`${ev.ref}-${index}`} className="mt-3">
      {(ev.fileName || ev.fileId) && <p className="mb-1 break-all text-xs font-medium text-slate-700">
        <span className="font-normal text-slate-500">Файл: </span>{ev.fileName || ev.fileId}
      </p>}
      <p className="break-all font-mono text-[11px] text-slate-500">{ev.ref} · п. {ev.number}</p>
      <blockquote className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-900">
        <Highlight text={ev.text} fragments={fragments} />
      </blockquote>
    </div>)}
    {!evidence.length && <p className="mt-3 text-sm text-slate-600">Цитата этой редакции отсутствует. Сопоставление требует ручной проверки.</p>}
  </div>
}

export default function Countercheck({ functions, onReview }: {
  functions: FunctionDiff[]; onReview?: (item: FunctionDiff) => void
}) {
  const [filter, setFilter] = useState<Kind | 'all'>('all')
  const flagged = functions.filter((item) => item.materialChanges?.length)
  const visible = filter === 'all' ? flagged : flagged.filter((item) => item.materialChanges?.some((signal) => signal.kind === filter))
  const maxSimilarity = flagged.length ? Math.round(Math.max(...flagged.map((item) => item.similarity)) * 100) : null
  const count = (kind: Kind) => flagged.filter((item) => item.materialChanges?.some((signal) => signal.kind === kind)).length

  return <div className="space-y-5">
    <div className="overflow-hidden rounded-xl bg-slate-950 p-5 text-white sm:p-6">
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-center">
        <div className="max-w-2xl">
          <p className="text-xs font-bold uppercase tracking-widest text-amber-300">Контрпроверка формулировок</p>
          <h3 className="mt-2 text-xl font-semibold tracking-tight sm:text-2xl">Похожие слова. Другие полномочия?</h3>
          <p className="mt-3 text-sm leading-relaxed text-slate-300">Одно отрицание, новый срок или замена обязанности правом могут изменить смысл знакомого пункта. Здесь показаны сигналы для проверки по обеим редакциям.</p>
        </div>
        <dl className="flex shrink-0 gap-6 border-t border-slate-700 pt-4 sm:border-l sm:border-t-0 sm:pl-6 sm:pt-0">
          <div>
            <dd className="font-mono text-3xl font-semibold text-amber-300">{flagged.length}</dd>
            <dt className="mt-1 max-w-28 text-xs leading-relaxed text-slate-300">функций требуют проверки</dt>
          </div>
          {maxSimilarity !== null && <div>
            <dd className="font-mono text-3xl font-semibold text-white">{maxSimilarity}%</dd>
            <dt className="mt-1 max-w-32 text-xs leading-relaxed text-slate-300">максимальное сходство текста среди находок</dt>
          </div>}
        </dl>
      </div>
      <p className="mt-4 border-t border-slate-800 pt-3 text-xs leading-relaxed text-slate-400">Сходство текста не измеряет уверенность в выводе. Проверка ищет явные изменения формулировок; оценка их последствий остаётся за экспертом.</p>
    </div>

    {!flagged.length ? <div className="rounded-xl border border-slate-200 bg-white p-6">
      <h4 className="font-semibold text-slate-900">Явных сигналов в сопоставленных функциях не найдено</h4>
      <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-600">Это не подтверждает отсутствие рисков. Проверка охватывает только распознаваемые изменения отрицаний, обязанности, сроков и объёма полномочий. Пункты без найденной пары и смысловые изменения за пределами этих признаков требуют отдельного рассмотрения.</p>
    </div> : <>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Тип изменения формулировки">
        <button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}
          className={`rounded-lg border px-3 py-2 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 ${filter === 'all' ? 'border-slate-800 bg-slate-800 font-semibold text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}>
          Все сигналы · {flagged.length}
        </button>
        {(Object.keys(LABELS) as Kind[]).filter((kind) => count(kind) > 0).map((kind) => <button type="button" key={kind} aria-pressed={filter === kind} onClick={() => setFilter(kind)}
          className={`rounded-lg border px-3 py-2 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 ${filter === kind ? 'border-amber-400 bg-amber-100 font-semibold text-amber-950' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}>
          {LABELS[kind]} · {count(kind)}
        </button>)}
      </div>

      <div className="space-y-5" aria-live="polite">
        {visible.map((item, index) => {
          const signals = item.materialChanges || []
          const kinds = [...new Set(signals.map((signal) => signal.kind))]
          return <article key={`${item.evidenceBefore.map((ev) => ev.ref).join(',')}-${item.evidenceAfter.map((ev) => ev.ref).join(',')}-${index}`}
            className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-2">
                {kinds.map((kind) => <span key={kind} className="rounded-md bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-900">{LABELS[kind]}</span>)}
              </div>
              <span className="text-xs text-slate-500">Сходство текста <strong className="font-mono text-sm text-slate-800">{Math.round(item.similarity * 100)}%</strong></span>
            </div>
            <h4 className="mt-3 text-base font-semibold leading-relaxed text-slate-900">{signals.map((signal) => signal.title).join(' · ')}</h4>

            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              <SourceColumn label="Документ «до»" owner={item.ownerBefore} evidence={item.evidenceBefore} fragments={signals.map((signal) => signal.beforeFragment)} />
              <SourceColumn label="Документ «после»" owner={item.ownerAfter} evidence={item.evidenceAfter} fragments={signals.map((signal) => signal.afterFragment)} after />
            </div>

            <div className="mt-4 grid gap-4 text-sm leading-relaxed lg:grid-cols-2">
              <div className="border-l-2 border-amber-400 pl-3">
                <h5 className="font-semibold text-slate-900">Аргумент для проверки</h5>
                <ul className="mt-1 space-y-1 text-slate-600">{signals.map((signal, signalIndex) => <li key={`${signal.kind}-${signalIndex}`}>{signal.detail}</li>)}</ul>
              </div>
              <div className="border-l-2 border-slate-300 pl-3">
                <h5 className="font-semibold text-slate-900">Возможное объяснение</h5>
                <p className="mt-1 text-slate-600">Изменение может быть намеренным, а обязанность — уточняться в другом пункте. Само различие формулировок не доказывает ошибку или утрату функции.</p>
              </div>
            </div>

            <details className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-sm">
              <summary className="cursor-pointer font-semibold text-slate-700">Что проверить перед решением</summary>
              <ul className="mt-2 list-disc space-y-2 pl-5 leading-relaxed text-slate-600">{kinds.map((kind) => <li key={kind}>{QUESTIONS[kind]}</li>)}</ul>
            </details>
            <div className="mt-4 flex flex-wrap items-start justify-between gap-3 border-t border-slate-100 pt-3">
              <EvidenceDisclosure evidence={[]} label="Источники для проверки" groups={[
                { title: 'Документ «до»', items: item.evidenceBefore },
                { title: 'Документ «после»', items: item.evidenceAfter },
              ]} />
              {onReview && <button type="button" onClick={() => onReview(item)} className="rounded-lg bg-sky-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-sky-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600">Рассмотреть в плане</button>}
            </div>
          </article>
        })}
      </div>
    </>}
  </div>
}
