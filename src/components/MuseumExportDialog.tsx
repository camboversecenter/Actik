// Add a credential to a CamboVerse museum: prepare what may be shown, choose
// who may see it, and export the exhibit file. Runs entirely on the holder's
// device — see src/lib/museumExport.ts for what the file carries and why.

import { useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Download, Copy, Undo2, RotateCcw } from 'lucide-react'
import { useLanguage } from '../lib/i18n'
import {
  buildExhibitPackage,
  dataUrlBytes,
  ExportRefused,
  preparePublicImage,
  sensitiveFieldsOnDocument,
  type ExhibitVisibility,
} from '../lib/museumExport'
import { verifyIssuedCredential } from '../lib/claimVerification'
import { CredentialRefused, CredentialWithdrawn } from '../lib/credentialCheck'

type Rect = { x: number; y: number; w: number; h: number }

export interface MuseumExportDialogProps {
  credentialId: string
  issuerDid: string
  sdjwt: string
  jti: string | null
  claims: Record<string, unknown>
  title: string
  printed: string | null
  onClose: () => void
}

export default function MuseumExportDialog(props: MuseumExportDialogProps) {
  const { t } = useLanguage()
  const original = typeof props.claims.photo === 'string' ? props.claims.photo : null
  const originalMime = useMemo(() => (original ? dataUrlBytes(original)?.mime ?? null : null), [original])
  const isImage = !!originalMime && originalMime.startsWith('image/')

  const [mode, setMode] = useState<'cover' | 'crop'>('cover')
  const [covers, setCovers] = useState<Rect[]>([])
  const [crop, setCrop] = useState<Rect | null>(null)
  const [drawing, setDrawing] = useState<Rect | null>(null)
  const [noImage, setNoImage] = useState(false)
  const [visibility, setVisibility] = useState<ExhibitVisibility>('private')
  const [publicChecked, setPublicChecked] = useState(false)
  const [includePrinted, setIncludePrinted] = useState(!!props.printed)
  const [preview, setPreview] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const imgRef = useRef<HTMLImageElement>(null)
  const start = useRef<{ x: number; y: number } | null>(null)

  const sensitive = sensitiveFieldsOnDocument(props.claims)
  const showImage = isImage && !noImage
  const needsPublicConfirm = visibility === 'public' && showImage

  // Pointer position in the image's own pixels.
  const toImage = (e: React.PointerEvent) => {
    const img = imgRef.current!
    const box = img.getBoundingClientRect()
    const sx = img.naturalWidth / box.width
    const sy = img.naturalHeight / box.height
    return {
      x: Math.min(img.naturalWidth, Math.max(0, (e.clientX - box.left) * sx)),
      y: Math.min(img.naturalHeight, Math.max(0, (e.clientY - box.top) * sy)),
    }
  }
  const rectFrom = (a: { x: number; y: number }, b: { x: number; y: number }): Rect => ({
    x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y),
  })
  const changed = () => { setPreview(null); setResult(null) }

  const onDown = (e: React.PointerEvent) => {
    if (!imgRef.current) return
    e.currentTarget.setPointerCapture(e.pointerId)
    start.current = toImage(e)
    setDrawing({ ...start.current, w: 0, h: 0 })
  }
  const onMove = (e: React.PointerEvent) => {
    if (start.current) setDrawing(rectFrom(start.current, toImage(e)))
  }
  const onUp = (e: React.PointerEvent) => {
    if (!start.current) return
    const r = rectFrom(start.current, toImage(e))
    start.current = null
    setDrawing(null)
    if (r.w < 4 || r.h < 4) return
    if (mode === 'cover') setCovers((c) => [...c, r])
    else setCrop(r)
    changed()
  }

  // Overlay boxes are positioned in percent of the image, so they track its displayed size.
  const pct = (r: Rect) => {
    const img = imgRef.current
    if (!img || !img.naturalWidth) return {}
    return {
      left: `${(r.x / img.naturalWidth) * 100}%`, top: `${(r.y / img.naturalHeight) * 100}%`,
      width: `${(r.w / img.naturalWidth) * 100}%`, height: `${(r.h / img.naturalHeight) * 100}%`,
    }
  }

  const prepared = async () => (showImage && original ? preparePublicImage(original, { crop, covers }) : null)

  const doPreview = async () => {
    setError(null)
    try { setPreview(await prepared()) } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }

  const doExport = async () => {
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      // A withdrawn credential does not go up on a wall (MUSEUM.md rule 9).
      // "Could not check right now" does not block: the exhibit carries the
      // withdrawal hashes, and CamboVerse checks them itself.
      try {
        await verifyIssuedCredential(props.sdjwt, props.issuerDid)
      } catch (e) {
        if (e instanceof CredentialWithdrawn) throw new ExportRefused(t('museum.refused_withdrawn'))
        if (e instanceof CredentialRefused && !e.unavailable) throw new ExportRefused(t('museum.refused_rejected'))
        if (!(e instanceof CredentialRefused)) throw e
      }
      const publicImage = await prepared()
      setPreview(publicImage)
      const pkg = await buildExhibitPackage({
        credentialId: props.credentialId,
        issuerDid: props.issuerDid,
        claims: props.claims,
        jti: props.jti,
        title: props.title,
        originalFile: original,
        publicImage,
        visibility,
        printed: props.printed,
        includePrinted,
        now: Math.floor(Date.now() / 1000),
      })
      setResult(JSON.stringify(pkg, null, 2))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const download = () => {
    if (!result) return
    const url = URL.createObjectURL(new Blob([result], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `actik-exhibit-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const radio = (value: ExhibitVisibility, label: string, hint: string) => (
    <label className="flex items-start gap-2 text-sm text-stone-700">
      <input
        type="radio" name="exhibit-visibility" value={value} checked={visibility === value} className="mt-1"
        onChange={() => { setVisibility(value); setPublicChecked(false); changed() }}
      />
      <span><span className="font-medium">{label}</span> <span className="text-xs text-stone-500">{hint}</span></span>
    </label>
  )

  return createPortal(
    <div className="fixed inset-0 z-[200] bg-stone-900/60 backdrop-blur-sm overflow-y-auto p-4" role="dialog" aria-label={t('museum.title')}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-auto my-4">
        <div className="px-5 py-4 border-b border-stone-200 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-stone-900">{t('museum.title')}</h2>
            <p className="text-xs text-stone-500 mt-1 leading-relaxed">{t('museum.intro')}</p>
          </div>
          <button type="button" onClick={props.onClose} aria-label={t('museum.close')} className="p-1.5 -m-1.5 text-stone-400 hover:text-stone-700 rounded-full">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-6 text-sm">
          {/* 1. The picture */}
          <section className="space-y-3">
            <h3 className="font-bold text-stone-900">{t('museum.image_heading')}</h3>
            {!isImage ? (
              <p className="text-stone-600">{original ? t('museum.pdf_no_image') : t('museum.no_file')}</p>
            ) : (
              <>
                <label className="flex items-center gap-2 text-stone-700">
                  <input type="checkbox" checked={noImage} onChange={(e) => { setNoImage(e.target.checked); changed() }} />
                  {t('museum.no_image')}
                </label>
                {!noImage && (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      {(['cover', 'crop'] as const).map((m) => (
                        <button
                          key={m} type="button" onClick={() => setMode(m)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${mode === m ? 'bg-stone-900 text-white border-stone-900' : 'bg-white text-stone-700 border-stone-300'}`}
                        >
                          {t(`museum.mode_${m}`)}
                        </button>
                      ))}
                      <button type="button" disabled={covers.length === 0} onClick={() => { setCovers((c) => c.slice(0, -1)); changed() }}
                        className="inline-flex items-center gap-1 px-2 py-1.5 text-xs text-stone-600 disabled:opacity-40">
                        <Undo2 size={13} /> {t('museum.undo')}
                      </button>
                      <button type="button" disabled={covers.length === 0 && !crop} onClick={() => { setCovers([]); setCrop(null); changed() }}
                        className="inline-flex items-center gap-1 px-2 py-1.5 text-xs text-stone-600 disabled:opacity-40">
                        <RotateCcw size={13} /> {t('museum.reset')}
                      </button>
                    </div>
                    <p className="text-xs text-stone-500">{mode === 'cover' ? t('museum.cover_hint') : t('museum.crop_hint')}</p>
                    <div
                      className="relative select-none touch-none border border-stone-200 rounded-lg overflow-hidden"
                      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}
                      data-testid="redaction-canvas"
                    >
                      <img ref={imgRef} src={original!} alt="" draggable={false} className="block w-full h-auto" />
                      {crop && <div className="absolute border-2 border-dashed border-indigo-500 pointer-events-none" style={pct(crop)} />}
                      {covers.map((c, i) => <div key={i} className="absolute bg-stone-900 pointer-events-none" style={pct(c)} />)}
                      {drawing && (
                        <div className={`absolute pointer-events-none ${mode === 'cover' ? 'bg-stone-900/70' : 'border-2 border-dashed border-indigo-500'}`} style={pct(drawing)} />
                      )}
                    </div>
                  </>
                )}
              </>
            )}

            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900 text-xs leading-relaxed space-y-1">
              {sensitive.length > 0 && (
                <p>
                  <span className="font-semibold">{t('museum.sensitive_heading')}</span> {sensitive.join(', ')}. {t('museum.sensitive_hint')}
                </p>
              )}
              <p>{t('museum.general_warning')}</p>
            </div>
          </section>

          {/* 2. Who may see it */}
          <section className="space-y-2">
            <h3 className="font-bold text-stone-900">{t('museum.visibility_heading')}</h3>
            {radio('private', t('museum.vis_private'), t('museum.vis_private_hint'))}
            {radio('link', t('museum.vis_link'), t('museum.vis_link_hint'))}
            {radio('public', t('museum.vis_public'), t('museum.vis_public_hint'))}
            <p className="text-xs text-stone-500">{t('museum.vis_note')}</p>
            {needsPublicConfirm && (
              <label className="flex items-start gap-2 text-stone-800 font-medium">
                <input type="checkbox" className="mt-1" checked={publicChecked} onChange={(e) => setPublicChecked(e.target.checked)} />
                {t('museum.public_confirm')}
              </label>
            )}
          </section>

          {/* 3. The institution's signed code */}
          <section className="space-y-2">
            <h3 className="font-bold text-stone-900">{t('museum.printed_heading')}</h3>
            {props.printed ? (
              <>
                <label className="flex items-center gap-2 text-stone-700">
                  <input type="checkbox" checked={includePrinted} onChange={(e) => { setIncludePrinted(e.target.checked); changed() }} />
                  {t('museum.printed_include')}
                </label>
                <p className="text-xs text-stone-500 leading-relaxed">{t('museum.printed_hint')}</p>
              </>
            ) : (
              <p className="text-xs text-stone-500">{t('museum.printed_none')}</p>
            )}
          </section>

          {preview && (
            <section className="space-y-2">
              <h3 className="font-bold text-stone-900">{t('museum.preview_heading')}</h3>
              <img src={preview} alt="" className="block max-w-full border border-stone-200 rounded-lg" data-testid="exhibit-preview" />
            </section>
          )}

          {error && <div className="rounded-lg p-3 bg-rose-50 text-rose-800 border border-rose-200">{error}</div>}
          {result && <div className="rounded-lg p-3 bg-stone-50 text-stone-800 border border-stone-200">{t('museum.done')}</div>}
        </div>

        <div className="px-5 py-4 border-t border-stone-200 bg-stone-50 flex flex-wrap items-center justify-end gap-2 rounded-b-2xl">
          {showImage && (
            <button type="button" onClick={doPreview} className="px-3 py-2 rounded-lg border border-stone-300 bg-white text-xs font-semibold text-stone-800">
              {t('museum.preview')}
            </button>
          )}
          {!result ? (
            <button
              type="button" onClick={doExport} disabled={busy || (needsPublicConfirm && !publicChecked)}
              className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-xs font-semibold disabled:opacity-50"
            >
              {busy ? t('museum.preparing') : t('museum.prepare')}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={async () => {
                  try { await navigator.clipboard.writeText(result); setCopied(true) } catch { setCopied(false) }
                }}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-stone-300 bg-white text-xs font-semibold text-stone-800"
              >
                <Copy size={13} /> {copied ? t('museum.copied') : t('museum.copy')}
              </button>
              <button type="button" onClick={download} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 text-white text-xs font-semibold">
                <Download size={13} /> {t('museum.download')}
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
