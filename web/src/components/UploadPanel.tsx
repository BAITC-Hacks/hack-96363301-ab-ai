import { useId, useRef, useState } from 'react'

const MAX_FILES = 5
const MAX_FILE_BYTES = 20 * 1024 * 1024
const MAX_TOTAL_BYTES = 100 * 1024 * 1024
type Side = 'before' | 'after'

const fileKey = (file: File) => JSON.stringify([file.name, file.size, file.lastModified])
const totalBytes = (files: File[]) => files.reduce((sum, file) => sum + file.size, 0)

function formatBytes(bytes: number) {
  if (bytes === 0) return '0 МБ'
  if (bytes < 1024) return `${bytes} Б`
  const unit = bytes < 1024 * 1024 ? 'КБ' : 'МБ'
  const value = bytes / (unit === 'КБ' ? 1024 : 1024 * 1024)
  return `${value.toLocaleString('ru-RU', { maximumFractionDigits: 1 })} ${unit}`
}

function FileZone({
  title,
  hint,
  files,
  error,
  disabled,
  onAdd,
  onRemove,
}: {
  title: string
  hint: string
  files: File[]
  error: string | null
  disabled: boolean
  onAdd: (files: File[]) => void
  onRemove: (index: number) => void
}) {
  const id = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)

  function take(list: FileList | null) {
    if (!disabled && list?.length) onAdd(Array.from(list))
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        if (!disabled) setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        if (!disabled) take(e.dataTransfer.files)
      }}
      className={`min-w-0 rounded-lg border border-dashed p-3 ${
        over ? 'border-sky-600 bg-sky-50' : error ? 'border-rose-400 bg-rose-50/40' : files.length ? 'border-emerald-500 bg-emerald-50/60' : 'border-slate-400 bg-slate-50'
      } ${disabled ? 'opacity-60' : ''}`}
    >
      <div id={`${id}-title`} className="text-sm font-semibold text-slate-900">{title}</div>
      <div id={`${id}-hint`} className="mt-0.5 text-xs leading-relaxed text-slate-600">{hint}</div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          aria-describedby={`${id}-hint${error ? ` ${id}-error` : ''}`}
          className="rounded-md border border-slate-400 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 disabled:cursor-not-allowed"
        >
          Добавить файлы
        </button>
        <span className="text-xs text-slate-500">или перетащите сюда</span>
      </div>

      <div className="mt-3 flex flex-wrap justify-between gap-2 text-xs text-slate-600" aria-live="polite">
        <span>Файлов: <strong className="font-mono text-slate-800">{files.length}/{MAX_FILES}</strong></span>
        <span className="font-mono">{formatBytes(totalBytes(files))}</span>
      </div>
      {files.length > 0 ? <ul aria-label={`${title}: выбранные файлы`} className="mt-2 max-h-60 space-y-2 overflow-y-auto">
        {files.map((file, index) => <li key={fileKey(file)} className="flex items-start gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-2">
          <div className="min-w-0 flex-1">
            <p className="break-all text-xs font-medium leading-relaxed text-slate-800">{file.name}</p>
            <p className="mt-0.5 font-mono text-[11px] text-slate-500">{formatBytes(file.size)}</p>
          </div>
          <button type="button" disabled={disabled} onClick={() => onRemove(index)}
            aria-label={`Убрать ${file.name} — ${title}`}
            className="shrink-0 rounded px-1 py-0.5 text-xs text-slate-500 underline underline-offset-2 hover:text-rose-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 disabled:cursor-not-allowed">
            убрать
          </button>
        </li>)}
      </ul> : <p className="mt-2 text-xs text-slate-500">Файлы пока не выбраны.</p>}
      {error && <p id={`${id}-error`} role="alert" className="mt-3 text-xs font-medium leading-relaxed text-rose-700">{error}</p>}

      <input
        ref={inputRef}
        type="file"
        multiple
        disabled={disabled}
        accept=".docx,.pdf,.xlsx"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-hint${error ? ` ${id}-error` : ''}`}
        aria-invalid={!!error}
        className="hidden"
        onChange={(e) => {
          take(e.target.files)
          e.target.value = ''
        }}
      />
    </div>
  )
}

export function UploadPanel({
  busy,
  onDemo,
  onExample,
  onCountercheck,
  onSemantic,
  onFiles,
}: {
  busy: boolean
  onDemo: () => void
  onExample: () => void
  onCountercheck: () => void
  onSemantic: () => void
  onFiles: (before: File[], after: File[]) => void
}) {
  const [before, setBefore] = useState<File[]>([])
  const [after, setAfter] = useState<File[]>([])
  const [fileErrors, setFileErrors] = useState<Record<Side, string | null>>({ before: null, after: null })
  const [error, setError] = useState<string | null>(null)

  function addFiles(side: Side, picked: File[]) {
    if (busy) return
    const current = side === 'before' ? before : after
    const other = side === 'before' ? after : before
    const known = new Set(current.map(fileKey))
    const next = [...current]
    for (const file of picked) {
      const key = fileKey(file)
      if (!known.has(key)) { known.add(key); next.push(file) }
    }

    const unsupported = picked.find((file) => !/\.(docx|pdf|xlsx)$/i.test(file.name))
    const oversized = picked.find((file) => file.size > MAX_FILE_BYTES)
    const reason = unsupported
      ? `Файл «${unsupported.name}» не добавлен. Поддерживаются Word DOCX, текстовый PDF и XLSX.`
      : oversized
        ? `Файл «${oversized.name}» превышает 20 МБ. Уменьшите размер или выберите другой файл.`
        : next.length > MAX_FILES
          ? `В каждой редакции может быть не больше ${MAX_FILES} файлов. Уберите лишние файлы или добавьте меньшую подборку.`
          : totalBytes([...next, ...other]) > MAX_TOTAL_BYTES
            ? 'Общий размер обеих редакций превышает 100 МБ. Уберите лишние файлы или уменьшите их размер.'
            : null

    setError(null)
    setFileErrors((previous) => ({ ...previous, [side]: reason ? `${reason} Ранее выбранные файлы сохранены; новая подборка не добавлена.` : null }))
    if (reason) return
    if (side === 'before') setBefore(next)
    else setAfter(next)
  }

  function removeFile(side: Side, index: number) {
    if (busy) return
    if (side === 'before') setBefore((files) => files.filter((_, position) => position !== index))
    else setAfter((files) => files.filter((_, position) => position !== index))
    setFileErrors({ before: null, after: null })
    setError(null)
  }

  function submit() {
    if (busy) return
    if (!before.length || !after.length) {
      setError('Добавьте хотя бы один файл в каждую редакцию: «до» и «после». Либо запустите демо-комплект.')
      return
    }
    setError(null)
    onFiles(before, after)
  }

  return (
    <div className="border border-slate-300 bg-white">
      <header className="border-b border-slate-300 bg-slate-50 px-4 py-2.5">
        <h2 className="text-base font-semibold text-slate-900">Комплект документов для сравнения</h2>
        <p className="mt-0.5 text-xs text-slate-600">
          Word DOCX, текстовый PDF или XLSX со столбцами «Подразделение» и «Функция». До 5 файлов в каждой редакции, до 20 МБ на файл и до 100 МБ суммарно.
        </p>
      </header>

      <div className="grid gap-3 px-4 py-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(260px,320px)]">
        <FileZone
          title="Комплект «до» реорганизации"
          hint="Действующая редакция: положение и приложения. Следующий выбор добавит файлы к списку."
          files={before}
          error={fileErrors.before}
          disabled={busy}
          onAdd={(files) => addFiles('before', files)}
          onRemove={(index) => removeFile('before', index)}
        />
        <FileZone
          title="Комплект «после» реорганизации"
          hint="Новая редакция: положение и приложения. Порядок файлов сохраняется при добавлении."
          files={after}
          error={fileErrors.after}
          disabled={busy}
          onAdd={(files) => addFiles('after', files)}
          onRemove={(index) => removeFile('after', index)}
        />

        <div className="flex flex-col gap-2 border border-slate-800 bg-slate-800 p-3">
          <div className="text-xs font-semibold tracking-wide text-slate-300 uppercase">
            Проверка без своих файлов
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={onDemo}
            className="w-full bg-amber-400 px-3 py-2.5 text-sm font-bold text-slate-900 hover:bg-amber-300 disabled:cursor-not-allowed disabled:bg-slate-500 disabled:text-slate-300"
          >
            {busy ? 'Анализ выполняется…' : 'Проанализировать демо-комплект'}
          </button>
          <p className="text-[11px] leading-snug text-slate-300">
            Контрольный комплект организатора: «Положение о внутреннем аудите», редакция 8 → редакция 9.
            Работает без API-ключа: анализ и заключение рассчитываются по документам.
          </p>
          <button type="button" disabled={busy} onClick={onExample}
            className="border border-slate-400 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50">
            Проверить учебный пример
          </button>
          <p className="text-[11px] text-slate-300">Синтетические данные с заранее известными изменениями. Скачать XLSX: <a className="underline" href="/api/examples/before.xlsx">до</a> · <a className="underline" href="/api/examples/after.xlsx">после</a>.</p>
          <button type="button" disabled={busy} onClick={onCountercheck}
            className="mt-1 rounded-lg bg-violet-400 px-3 py-2.5 text-sm font-bold text-violet-950 hover:bg-violet-300 disabled:opacity-50">
            Найти скрытые изменения
          </button>
          <p className="text-[11px] text-slate-300">Одно слово меняет обязанность. Учебный пример для контрпроверки. Скачать XLSX: <a className="underline" href="/api/examples/countercheck/before.xlsx">до</a> · <a className="underline" href="/api/examples/countercheck/after.xlsx">после</a>.</p>
          <button type="button" disabled={busy} onClick={onSemantic}
            className="mt-1 rounded-lg bg-cyan-300 px-3 py-2.5 text-sm font-bold text-cyan-950 hover:bg-cyan-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200 disabled:opacity-50">
            Найти переформулировки
          </button>
          <p className="text-[11px] leading-snug text-slate-300">Синтетический пример: разные слова, возможная общая обязанность. Поиск моделью предлагает пары для проверки. Скачать XLSX: <a className="underline" href="/api/examples/semantic/before.xlsx">до</a> · <a className="underline" href="/api/examples/semantic/after.xlsx">после</a>.</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 px-4 py-2">
        <button
          type="button"
          disabled={busy}
          onClick={submit}
          className="border border-slate-800 bg-white px-3 py-1.5 text-sm font-semibold text-slate-900 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Проанализировать загруженные документы
        </button>
        <span className="text-xs text-slate-600" aria-live="polite">Всего файлов: {before.length + after.length} · {formatBytes(totalBytes([...before, ...after]))} из 100 МБ</span>
        {error ? <span role="alert" className="text-xs font-medium text-rose-700">{error}</span> : null}
      </div>
    </div>
  )
}
