import { useState } from 'react'
import type { Evidence, SemanticReviewItem, SemanticReviewResult } from '../types'
import { EvidenceDisclosure } from './EvidenceDisclosure'

type ProposalStatus = 'candidate' | 'meaning_changed'

const SOURCE_LABELS = {
  api: 'Живой ответ модели',
  fixture: 'Сохранённый ответ модели',
  none: 'Ответ модели не получен',
}

const PROPOSAL_LABELS: Record<ProposalStatus, string> = {
  candidate: 'Возможная переформулировка',
  meaning_changed: 'Признаки изменения смысла',
}

function SourceExcerpt({ label, owner, evidence, fragment, after = false }: {
  label: string; owner: string | null; evidence: Evidence | null; fragment: string | null; after?: boolean
}) {
  // На экране допустим только буквальный фрагмент исходного пункта.
  const quote = evidence && fragment && evidence.text.includes(fragment) ? fragment : evidence?.text
  return <div className={`min-w-0 rounded-xl border p-4 ${after ? 'border-cyan-200 bg-cyan-50/50' : 'border-slate-200 bg-slate-50'}`}>
    <div className="flex flex-wrap items-start justify-between gap-2">
      <h4 className={`text-xs font-bold uppercase tracking-wider ${after ? 'text-cyan-800' : 'text-slate-600'}`}>{label}</h4>
      {owner && <span className="max-w-full break-words rounded-md bg-white px-2 py-1 text-xs font-medium text-slate-700">{owner}</span>}
    </div>
    {evidence ? <>
      {(evidence.fileName || evidence.fileId) && <p className="mt-3 break-all text-xs font-medium text-slate-700">{evidence.fileName || evidence.fileId}</p>}
      <p className="mt-1 break-all font-mono text-[11px] text-slate-500">{evidence.ref} · п. {evidence.number}</p>
      <blockquote className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-900">«{quote}»</blockquote>
    </> : <p className="mt-3 text-sm leading-relaxed text-slate-600">Пункт новой редакции не предложен. По этому результату нельзя установить утрату функции.</p>}
  </div>
}

function ProposalCard({ item }: { item: SemanticReviewItem & { status: ProposalStatus } }) {
  const changed = item.status === 'meaning_changed'
  return <article data-semantic-status={item.status} data-before-ref={item.beforeRef} className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <h3 className={`rounded-md px-2 py-1 text-sm font-semibold ${changed ? 'bg-amber-100 text-amber-950' : 'bg-cyan-100 text-cyan-950'}`}>{PROPOSAL_LABELS[item.status]}</h3>
      <div className="text-right">
        <p className="text-xs text-slate-600">Сходство текста по словам: <strong className="font-mono text-sm text-slate-900">{item.similarity === null ? 'не рассчитано' : `${Math.round(item.similarity * 100)}%`}</strong></p>
        <p className="mt-0.5 text-[11px] text-slate-500">Не оценка уверенности модели</p>
      </div>
    </div>

    <p className="mt-3 break-words text-sm font-medium text-slate-700">
      <span className="text-slate-500">Владельцы в источниках: </span>{item.ownerBefore}
      <span aria-hidden="true" className="mx-2 text-slate-400">→</span>
      <span className="sr-only">, в новой редакции: </span>{item.ownerAfter || 'не определён'}
    </p>
    <div className="mt-4 grid gap-3 lg:grid-cols-2">
      <SourceExcerpt label="Исходный пункт «до»" owner={item.ownerBefore} evidence={item.evidenceBefore} fragment={item.beforeFragment} />
      <SourceExcerpt label="Предложенный пункт «после»" owner={item.ownerAfter} evidence={item.evidenceAfter} fragment={item.afterFragment} after />
    </div>

    <div className={`mt-4 border-l-2 pl-3 text-sm leading-relaxed ${changed ? 'border-amber-400' : 'border-cyan-400'}`}>
      <h4 className="font-semibold text-slate-900">Что проверить эксперту</h4>
      <p className="mt-1 text-slate-600">{changed
        ? 'Предложенные пункты могут описывать разные полномочия. Сравните действие, условия, сроки и объём обязанности перед решением о сохранении или передаче функции.'
        : 'Модель предложила возможную пару. Сравните действие, объект и полномочия владельца: похожий смысл ещё не подтверждает сохранение или передачу функции.'}</p>
    </div>

    {item.materialChanges.length > 0 && <div className="mt-4 rounded-lg bg-amber-50 p-3">
      <h4 className="text-xs font-bold uppercase tracking-wide text-amber-900">Изменения формулировки для проверки</h4>
      <ul className="mt-2 space-y-2 text-sm leading-relaxed text-amber-950">
        {item.materialChanges.map((signal, index) => <li key={`${signal.kind}-${index}`}>
          <span className="font-semibold">{signal.title}. </span>{signal.detail}
          <p className="mt-1 break-words text-xs">«{signal.beforeFragment}» → «{signal.afterFragment}»</p>
        </li>)}
      </ul>
    </div>}

    <div className="mt-4 border-t border-slate-100 pt-3">
      <EvidenceDisclosure evidence={[item.evidenceBefore, ...(item.evidenceAfter ? [item.evidenceAfter] : [])]} label="Открыть полные пункты документов" />
    </div>
  </article>
}

export function SemanticReview({ review }: { review: SemanticReviewResult }) {
  const [filter, setFilter] = useState<ProposalStatus | 'all'>('all')
  const proposals = review.items.filter((item): item is SemanticReviewItem & { status: ProposalStatus } => item.status === 'candidate' || item.status === 'meaning_changed')
  const remaining = review.items.filter((item) => item.status === 'not_found' || item.status === 'unreviewed')
  const visible = filter === 'all' ? proposals : proposals.filter((item) => item.status === filter)
  const count = (status: ProposalStatus) => proposals.filter((item) => item.status === status).length

  return <section id="semantic-review" aria-label="Поиск переформулировок" data-source={review.source} data-status={review.status}
    className="scroll-mt-4 overflow-hidden rounded-xl border border-slate-200 bg-slate-50/70">
    <header className="border-b border-slate-200 bg-slate-950 px-4 py-5 text-white sm:px-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <p className="text-[11px] font-bold uppercase tracking-widest text-cyan-300">Дополнительная проверка функций</p>
          <h2 className="mt-1 text-xl font-semibold">Поиск переформулировок</h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-300">Функция могла получить другую формулировку. Для пунктов без текстовой пары модель ищет возможные соответствия в новой редакции.</p>
        </div>
        <div className="max-w-full">
          <p className={`rounded-md px-2.5 py-1.5 text-xs font-semibold ${review.source === 'api' ? 'bg-cyan-900 text-cyan-100' : 'bg-slate-800 text-slate-200'}`}>
            {review.status === 'not_needed' ? 'Дополнительный поиск не запускался' : SOURCE_LABELS[review.source]}
          </p>
          {review.source !== 'none' && <p className="mt-1 break-all font-mono text-[11px] text-slate-400">{review.model}</p>}
        </div>
      </div>

      <dl className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-slate-700 bg-slate-900 p-3">
          <dt className="text-xs text-slate-400">Проверено исходных функций</dt>
          <dd data-semantic-metric="reviewed" className="mt-1 font-mono text-xl font-semibold tabular-nums">{review.reviewed}<span className="text-sm font-normal text-slate-400"> / {review.totalLost}</span></dd>
        </div>
        <div className="rounded-lg border border-slate-700 bg-slate-900 p-3">
          <dt className="text-xs text-slate-400">Пунктов «после» в области поиска</dt>
          <dd data-semantic-metric="after" className="mt-1 font-mono text-xl font-semibold tabular-nums">{review.afterConsidered}<span className="text-sm font-normal text-slate-400"> / {review.afterTotal}</span></dd>
        </div>
        <div className="rounded-lg border border-cyan-900 bg-cyan-950 p-3">
          <dt className="text-xs text-cyan-200">Предложено пар для эксперта</dt>
          <dd data-semantic-metric="proposals" className="mt-1 font-mono text-xl font-semibold tabular-nums text-cyan-100">{proposals.length}</dd>
        </div>
      </dl>
    </header>

    <div className="space-y-4 p-4 sm:p-5">
      <p className="text-xs leading-relaxed text-slate-600">Предложения показаны отдельно: статусы функций и счётчики основного анализа не меняются. Каждую пару нужно проверить по источникам.</p>
      {review.limited && <p className="rounded-lg border-l-2 border-amber-400 bg-amber-50 px-3 py-2 text-sm leading-relaxed text-amber-950">
        Набор для поиска ограничен по числу исходных функций или пунктов новой редакции. Показанные результаты не распространяются на оставшуюся часть комплекта.
      </p>}

      {review.status === 'unavailable' && <div role="status" className="rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="font-semibold text-slate-900">Поиск моделью недоступен для этого запроса</h3>
        <p className="mt-1 text-sm leading-relaxed text-slate-600">Подходящий ответ модели не получен. Основное сопоставление и цитаты доступны; возможные переформулировки требуют ручной проверки.</p>
        <a href="#trace" className="mt-2 inline-block text-xs font-semibold text-sky-800 underline underline-offset-2">Открыть трассировку анализа</a>
      </div>}

      {review.status === 'not_needed' && <p className="rounded-lg border border-slate-200 bg-white p-4 text-sm leading-relaxed text-slate-600">
        {review.totalLost === 0
          ? 'Основное сопоставление не оставило функций без текстовой пары, поэтому дополнительный поиск не запускался. Это не подтверждает смысловую эквивалентность всех найденных пар.'
          : 'Для дополнительного поиска нет подходящего набора пунктов. Основное сопоставление доступно ниже; отсутствие модельной проверки не доказывает утрату функции.'}
      </p>}

      {review.status === 'completed' && !proposals.length && <p className="rounded-lg border border-slate-200 bg-white p-4 text-sm leading-relaxed text-slate-600">
        Пары для ручной проверки не получены. Это относится только к рассмотренной области поиска и не доказывает утрату функций.
      </p>}

      {proposals.length > 0 && <>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Тип предложения модели">
          <button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}
            className={`rounded-lg border px-3 py-2 text-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 ${filter === 'all' ? 'border-slate-800 bg-slate-800 font-semibold text-white' : 'border-slate-200 bg-white text-slate-700'}`}>
            Все предложения · {proposals.length}
          </button>
          {(['candidate', 'meaning_changed'] as const).filter((status) => count(status) > 0).map((status) => <button type="button" key={status} aria-pressed={filter === status} onClick={() => setFilter(status)}
            className={`rounded-lg border px-3 py-2 text-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 ${filter === status ? 'border-cyan-400 bg-cyan-100 font-semibold text-cyan-950' : 'border-slate-200 bg-white text-slate-700'}`}>
            {PROPOSAL_LABELS[status]} · {count(status)}
          </button>)}
        </div>
        <div className="space-y-4" aria-live="polite">
          {visible.map((item) => <ProposalCard key={`${item.beforeRef}-${item.evidenceAfter?.ref || ''}`} item={item} />)}
        </div>
      </>}

      {remaining.length > 0 && <details className="rounded-lg border border-slate-200 bg-white">
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-700">Без предложенной пары или без проверки · {remaining.length}</summary>
        <div className="space-y-3 border-t border-slate-100 p-3">
          {remaining.map((item) => <article key={item.beforeRef} data-semantic-status={item.status} data-before-ref={item.beforeRef} className="rounded-lg bg-slate-50 p-3">
            <div className="flex flex-wrap items-start justify-between gap-2 text-xs">
              <h3 className="break-words font-semibold text-slate-800">{item.ownerBefore}</h3>
              <span className="rounded bg-white px-2 py-1 text-slate-600">{item.status === 'not_found' ? 'Пара не предложена' : 'Не проверено моделью'}</span>
            </div>
            <p className="mt-2 line-clamp-3 break-words text-sm leading-relaxed text-slate-700">{item.evidenceBefore.text}</p>
            <EvidenceDisclosure evidence={[item.evidenceBefore]} label="Проверить исходный пункт и файл" />
            <p className="mt-2 text-xs leading-relaxed text-slate-500">{item.status === 'not_found'
              ? 'В рассмотренной области модель не предложила соответствие. Возможная утрата и переформулировка требуют дальнейшей проверки.'
              : 'Этот пункт не получил результата модельной проверки. Его статус в основном анализе сохранён.'}</p>
          </article>)}
        </div>
      </details>}
    </div>
  </section>
}
