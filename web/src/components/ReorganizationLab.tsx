import { useEffect, useState } from 'react'
import type { AnalysisReport } from '../types'
import { ACTION_LABELS, CASE_LABELS, requestPlan } from '../planning'
import type { Action, CaseKind, Decision, Plan, ReviewCase } from '../planning'
import { FlowMap } from './FlowMap'
import { EvidenceDisclosure } from './EvidenceDisclosure'
import Countercheck from './Countercheck'

function DecisionEditor({ item, decision, plan, busy, onSave, onRemove }: {
  item: ReviewCase; decision?: Decision; plan: Plan; busy: boolean;
  onSave: (decision: Decision) => void; onRemove: () => void
}) {
  const [action, setAction] = useState<Action>(decision?.action || item.actions[0])
  const [owner, setOwner] = useState(decision?.owner || '')
  const [note, setNote] = useState(decision?.note || '')
  const [refs, setRefs] = useState<string[]>(decision?.refs || item.evidence.map((e) => e.ref))
  const sources = [...new Map([...item.evidence, ...item.candidates.map((c) => c.evidence)].map((e) => [e.ref, e])).values()]
  const needsBoth = action === 'confirm' || item.kind === 'material'
  const coversBoth = ['red8', 'red9'].every((doc) => sources.some((e) => e.docId === doc && refs.includes(e.ref)))
  const canSave = note.trim().length >= 10 && refs.length > 0 && (action !== 'assign' || !!owner) && (!needsBoth || coversBoth)
  return <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-5">
    <div className="text-xs font-bold uppercase tracking-wider text-sky-700">{CASE_LABELS[item.kind]}</div>
    <h3 className="mt-2 text-base font-semibold text-slate-900">{item.title}</h3>
    {item.currentOwners.length > 0 && <p className="mt-2 text-xs text-slate-500">Владельцы в источниках: {item.currentOwners.join(' → ')}</p>}
    <EvidenceDisclosure evidence={item.evidence} label="Основания находки — точные цитаты" />
    {item.candidates.length > 0 && <div className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
      <p className="font-semibold">Перед решением проверьте возможную переформулировку</p>
      {item.candidates.map((c) => <EvidenceDisclosure key={c.evidence.ref} evidence={[c.evidence]} label={`${c.owner}: похожий пункт (${Math.round(c.similarity * 100)}%)`} />)}
    </div>}
    <form className="mt-5 space-y-4" onSubmit={(e) => { e.preventDefault(); if (canSave) onSave({ caseId: item.id, action, owner, note: note.trim(), refs }) }}>
      <label className="block text-sm font-semibold text-slate-700">Решение пользователя
        <select aria-label="Решение пользователя" value={action} onChange={(e) => setAction(e.target.value as Action)} disabled={busy} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal">
          {item.actions.map((a) => <option key={a} value={a}>{ACTION_LABELS[a]}</option>)}
        </select>
      </label>
      {action === 'assign' && <label className="block text-sm font-semibold text-slate-700">Ответственное подразделение
        <select aria-label="Ответственное подразделение" value={owner} onChange={(e) => setOwner(e.target.value)} disabled={busy} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal">
          <option value="">Выберите подразделение новой редакции</option>
          {plan.owners.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.id})</option>)}
        </select>
      </label>}
      <label className="block text-sm font-semibold text-slate-700">Почему это решение обосновано
        <textarea aria-label="Обоснование решения" value={note} onChange={(e) => setNote(e.target.value)} minLength={10} maxLength={2000} rows={3} required disabled={busy}
          placeholder="Укажите, что подтверждают источники и что предлагается изменить. Минимум 10 символов."
          className="mt-1 block w-full resize-y rounded-lg border border-slate-300 px-3 py-2 font-normal" />
      </label>
      <fieldset><legend className="text-sm font-semibold text-slate-700">Источники решения</legend>
        {needsBoth && <p className="mt-1 text-xs text-slate-500">Нужны выбранные источники обеих редакций.</p>}
        <div className="mt-2 max-h-44 space-y-1 overflow-auto rounded-lg bg-slate-50 p-3">
          {sources.map((e) => <label key={e.ref} className="flex min-w-0 items-start gap-2 text-xs text-slate-600">
            <input type="checkbox" className="mt-0.5 shrink-0" checked={refs.includes(e.ref)} disabled={busy} onChange={(event) => setRefs(event.target.checked ? [...refs, e.ref] : refs.filter((r) => r !== e.ref))} />
            <span className="min-w-0 break-words">
              {(e.fileName || e.fileId) && <span className="block break-all font-medium text-slate-800">{e.fileName || e.fileId}</span>}
              <span>{e.docId === 'red8' ? 'До' : 'После'} · п. {e.number} · {e.text.slice(0, 100)}{e.text.length > 100 ? '…' : ''}</span>
            </span>
          </label>)}
        </div>
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <button disabled={busy || !canSave} type="submit" className="rounded-lg bg-sky-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-800 disabled:opacity-40">{busy ? 'Сохраняем…' : 'Сохранить решение'}</button>
        {decision && <button type="button" disabled={busy} onClick={onRemove} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">Вернуть в очередь</button>}
      </div>
    </form>
    {decision?.proposal && <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
      <div className="text-xs font-bold uppercase text-emerald-800">Проект формулировки · требует согласования</div>
      <p className="mt-2 text-sm text-emerald-950">{decision.proposal}</p>
    </div>}
  </div>
}

export function ReorganizationLab({ report }: { report: AnalysisReport }) {
  const materialCount = report.functions.filter((f) => f.materialChanges?.length).length
  const [tab, setTab] = useState<'map' | 'countercheck' | 'decisions'>(materialCount ? 'countercheck' : 'map')
  const [plan, setPlan] = useState<Plan | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [filter, setFilter] = useState<CaseKind | 'all'>('all')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState('')
  const reportId = report.meta.reportId
  useEffect(() => {
    let active = true
    if (!reportId) return
    void (async () => {
      try {
        let result: Plan = await (await requestPlan(reportId, [])).json()
        let saved: string | null = null
        try { saved = localStorage.getItem(`orgdiff.plan.${result.fingerprint}`) } catch { /* браузер может отключить хранение */ }
        if (saved) {
          try {
            result = await (await requestPlan(reportId, JSON.parse(saved))).json()
            if (active) setStatus('Восстановлен план этого комплекта из браузера.')
          } catch { if (active) setStatus('Сохранённые решения не подошли к отчёту. Открыт новый план.') }
        }
        if (active) { setPlan(result); setSelected(result.cases[0]?.id || null) }
      } catch (err) { if (active) setError(err instanceof Error ? err.message : 'Не удалось открыть план.') }
    })()
    return () => { active = false }
  }, [reportId])

  async function save(decisions: Decision[]) {
    if (!reportId || !plan) return
    setBusy(true); setError(null)
    try {
      const updated: Plan = await (await requestPlan(reportId, decisions)).json()
      setPlan(updated)
      try {
        localStorage.setItem(`orgdiff.plan.${updated.fingerprint}`, JSON.stringify(updated.decisions))
        setStatus('Решение сохранено со ссылками. План доступен в этом браузере.')
      } catch { setStatus('Решение сохранено на экране. Для сохранения копии выгрузите Excel.') }
    } catch (err) { setError(err instanceof Error ? err.message : 'Не удалось сохранить решение.') }
    finally { setBusy(false) }
  }
  async function download() {
    if (!reportId || !plan) return
    setBusy(true); setError(null)
    try {
      const response = await requestPlan(reportId, plan.decisions, true)
      const url = URL.createObjectURL(await response.blob())
      const link = document.createElement('a'); link.href = url; link.download = 'OrgDiff-план-реорганизации.xlsx'; link.click()
      setTimeout(() => URL.revokeObjectURL(url), 10000)
      setStatus('Excel сформирован: план решений, обоснования, источники и сопоставление функций.')
    } catch (err) { setError(err instanceof Error ? err.message : 'Не удалось выгрузить план.') }
    finally { setBusy(false) }
  }
  const selectedCase = plan?.cases.find((c) => c.id === selected)
  const decision = plan?.decisions.find((d) => d.caseId === selected)
  const visible = plan?.cases.filter((c) => filter === 'all' || c.kind === filter) || []
  return <section id="reorganization-lab" className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
    <header className="bg-slate-900 p-5 text-white md:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><div className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-300">OrgDiff · от анализа к решению</div>
          <h2 className="mt-2 text-2xl font-bold md:text-3xl">План реорганизации</h2>
          <p className="mt-2 max-w-2xl text-sm text-slate-300">Проследите передачу функций. Проверьте спорные места. Подготовьте решения с источниками для согласования.</p>
        </div>
        <button onClick={() => void download()} disabled={busy || !plan} type="button" className="rounded-lg bg-emerald-400 px-4 py-3 text-sm font-bold text-emerald-950 hover:bg-emerald-300 disabled:opacity-50">Выгрузить план в Excel ↗</button>
      </div>
      {plan && <div className="mt-6 grid gap-3 sm:grid-cols-3" aria-label="Прогресс рассмотрения">
        {[{ label: 'Находок к рассмотрению', value: plan.stats.total }, { label: 'Решений пользователя', value: plan.stats.reviewed }, { label: 'Без решения / на согласовании', value: plan.stats.unresolved }].map((m) => <div key={m.label} className="rounded-xl border border-slate-700 bg-slate-800/80 px-4 py-3"><div className="text-3xl font-semibold tabular-nums">{m.value}</div><div className="mt-1 text-xs text-slate-300">{m.label}</div></div>)}
      </div>}
      {plan && <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-700"><div className="h-full bg-emerald-400 transition-all duration-500" style={{ width: `${plan.stats.total ? 100 * plan.stats.reviewed / plan.stats.total : 100}%` }} /></div>}
    </header>
    <div className="flex flex-wrap gap-2 border-b border-slate-200 px-5 pt-3" role="tablist" aria-label="Рабочая область реорганизации">
      <button id="map-tab" role="tab" aria-controls="map-panel" aria-selected={tab === 'map'} onClick={() => setTab('map')} className={`border-b-2 px-3 py-3 text-sm font-semibold ${tab === 'map' ? 'border-sky-600 text-sky-800' : 'border-transparent text-slate-500'}`}>01 · Карта ответственности</button>
      <button id="countercheck-tab" role="tab" aria-controls="countercheck-panel" aria-selected={tab === 'countercheck'} onClick={() => setTab('countercheck')} className={`border-b-2 px-3 py-3 text-sm font-semibold ${tab === 'countercheck' ? 'border-violet-600 text-violet-800' : 'border-transparent text-slate-500'}`}>02 · Контрпроверка{materialCount ? ` · ${materialCount}` : ''}</button>
      <button id="decisions-tab" role="tab" aria-controls="decisions-panel" aria-selected={tab === 'decisions'} onClick={() => setTab('decisions')} className={`border-b-2 px-3 py-3 text-sm font-semibold ${tab === 'decisions' ? 'border-sky-600 text-sky-800' : 'border-transparent text-slate-500'}`}>03 · Разобрать находки</button>
    </div>
    <div className="p-4 md:p-6">
      {error && <p role="alert" className="mb-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
      {status && <p role="status" className="mb-4 text-xs text-slate-600">{status}</p>}
      {tab === 'map' ? <div id="map-panel" role="tabpanel" aria-labelledby="map-tab"><FlowMap report={report} /></div> : tab === 'countercheck' ? <div id="countercheck-panel" role="tabpanel" aria-labelledby="countercheck-tab">
        <Countercheck functions={report.functions} onReview={plan ? (f) => {
          const item = plan.cases.find((c) => c.kind === 'material' && c.evidence.some((e) => e.ref === f.evidenceBefore[0]?.ref) && c.evidence.some((e) => e.ref === f.evidenceAfter[0]?.ref))
          if (item) { setSelected(item.id); setFilter('material'); setTab('decisions') }
        } : undefined} />
      </div> : <div id="decisions-panel" role="tabpanel" aria-labelledby="decisions-tab">
        {!plan ? <p className="text-slate-600">{reportId ? 'Загружаем план…' : 'Повторите анализ, чтобы открыть план для текущей версии сервера.'}</p> : <>
          <div className="mb-4 flex flex-wrap gap-2">
            <button onClick={() => setFilter('all')} className={`rounded-full border px-3 py-1 text-xs ${filter === 'all' ? 'bg-slate-900 text-white' : 'bg-white text-slate-600'}`}>Все · {plan.cases.length}</button>
            {(Object.keys(CASE_LABELS) as CaseKind[]).filter((kind) => plan.cases.some((c) => c.kind === kind)).map((kind) => <button key={kind} onClick={() => { setFilter(kind); setSelected(plan.cases.find((c) => c.kind === kind)?.id || null) }} className={`rounded-full border px-3 py-1 text-xs ${filter === kind ? 'bg-slate-900 text-white' : 'bg-white text-slate-600'}`}>{CASE_LABELS[kind]} · {plan.cases.filter((c) => c.kind === kind).length}</button>)}
          </div>
          {!plan.cases.length ? <p className="rounded-xl bg-emerald-50 p-6 text-emerald-900">Находок для рассмотрения нет. Сопоставление функций доступно ниже.</p> : <div className="grid gap-4 lg:grid-cols-[minmax(230px,0.8fr)_minmax(0,1.6fr)]">
            <div className="max-h-[720px] space-y-2 overflow-y-auto pr-1" aria-label="Очередь находок">
              {visible.map((c, i) => { const d = plan.decisions.find((v) => v.caseId === c.id); return <button type="button" key={c.id} onClick={() => setSelected(c.id)} aria-pressed={selected === c.id}
                className={`w-full rounded-xl border p-3 text-left ${selected === c.id ? 'border-sky-500 bg-sky-50 ring-1 ring-sky-500' : 'border-slate-200 bg-slate-50 hover:bg-white'}`}>
                <div className="flex justify-between gap-2 text-[11px] font-semibold uppercase"><span className="text-slate-500">{String(i + 1).padStart(2, '0')} · {CASE_LABELS[c.kind]}</span><span className={d ? 'text-emerald-700' : 'text-amber-700'}>{d ? 'Есть решение' : 'К проверке'}</span></div>
                <p className="mt-2 line-clamp-3 text-sm text-slate-800">{c.title}</p>
              </button> })}
            </div>
            {selectedCase && <DecisionEditor key={`${selectedCase.id}:${JSON.stringify(decision)}`} item={selectedCase} decision={decision} plan={plan} busy={busy}
              onSave={(d) => void save([...plan.decisions.filter((v) => v.caseId !== d.caseId), d])}
              onRemove={() => void save(plan.decisions.filter((v) => v.caseId !== selectedCase.id))} />}
          </div>}
        </>}
      </div>}
      <p className="mt-5 border-t border-slate-100 pt-3 text-xs text-slate-500">{plan?.notice || 'Рабочий план не изменяет исходные документы. Решения требуют согласования.'}</p>
    </div>
  </section>
}
