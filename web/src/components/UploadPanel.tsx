import { useRef, useState } from 'react'

function FileZone({
  title,
  hint,
  file,
  disabled,
  onPick,
}: {
  title: string
  hint: string
  file: File | null
  disabled: boolean
  onPick: (f: File | null) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)

  function take(list: FileList | null) {
    const f = list && list.length > 0 ? list[0] : null
    if (!f) return
    if (!/\.docx$/i.test(f.name)) {
      onPick(null)
      window.alert(`Ожидается файл .docx, получен «${f.name}».`)
      return
    }
    onPick(f)
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
      className={`border border-dashed p-3 ${
        over ? 'border-sky-600 bg-sky-50' : file ? 'border-emerald-500 bg-emerald-50' : 'border-slate-400 bg-slate-50'
      } ${disabled ? 'opacity-60' : ''}`}
    >
      <div className="text-sm font-semibold text-slate-900">{title}</div>
      <div className="mt-0.5 text-xs text-slate-600">{hint}</div>

      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          className="border border-slate-400 bg-white px-2.5 py-1 text-xs font-medium text-slate-800 hover:bg-slate-100 disabled:cursor-not-allowed"
        >
          Выбрать .docx
        </button>
        {file ? (
          <>
            <span className="truncate font-mono text-xs text-emerald-900" title={file.name}>
              {file.name}
            </span>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onPick(null)}
              className="text-xs text-slate-500 underline hover:text-rose-700"
            >
              убрать
            </button>
          </>
        ) : (
          <span className="text-xs text-slate-500">файл не выбран — можно перетащить сюда</span>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".docx"
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
  onFiles,
}: {
  busy: boolean
  onDemo: () => void
  onFiles: (before: File, after: File) => void
}) {
  const [before, setBefore] = useState<File | null>(null)
  const [after, setAfter] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)

  function submit() {
    if (!before || !after) {
      setError('Загрузите оба документа: «до» и «после». Либо запустите демо-комплект — он уже в репозитории.')
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
          Положения о подразделениях, приложения к распорядительным документам, оргструктуры. Формат — .docx.
        </p>
      </header>

      <div className="grid gap-3 px-4 py-3 lg:grid-cols-[1fr_1fr_minmax(260px,320px)]">
        <FileZone
          title="Документ «до» реорганизации"
          hint="Действующая редакция"
          file={before}
          disabled={busy}
          onPick={(f) => {
            setBefore(f)
            setError(null)
          }}
        />
        <FileZone
          title="Документ «после» реорганизации"
          hint="Новая редакция"
          file={after}
          disabled={busy}
          onPick={(f) => {
            setAfter(f)
            setError(null)
          }}
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
            Работает без API-ключа — ответы модели воспроизводятся из записанных фикстур.
          </p>
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
        {error ? <span className="text-xs font-medium text-rose-700">{error}</span> : null}
      </div>
    </div>
  )
}
