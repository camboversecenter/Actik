// Verify a printed certificate by scanning its QR code — in this app, never in
// a browser.
//
// The scanner reads three kinds of thing and treats them very differently:
//   - a KH1: code, the printed lane: verified here, offline apart from the
//     signed lists it already holds;
//   - a link to this app's own /verify/<id> page, the in-app share lane:
//     followed, because it never leaves this app;
//   - any other link: refused, without being opened or shown as a link.
//     Actik certificates never send anyone to a website, so a code that does
//     is not one, and opening it is the judgement phishing relies on.
//
// No tick on success. The page shows the four fields signed into the code and
// asks the reader to compare them with the paper: a genuine code copied onto
// a forged certificate verifies perfectly, and only that comparison catches it.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import jsQR from 'jsqr'
import { Flashlight, FlashlightOff, ImageUp, RotateCcw, X } from 'lucide-react'
import { longDate } from '../../lib/dates'
import { useLanguage } from '../../lib/i18n'
import {
  classifyScanned,
  peekPrintedIssuer,
  verifyPrintedCredential,
  type CheckedPrinted,
} from '../../lib/printedCredential'
import { CredentialRefused, CredentialWithdrawn, messageForRefusal } from '../../lib/credentialCheck'
import type { WithdrawalReason } from '../../lib/revocation'
import { loadRevocationState, loadTrustState } from '../../lib/trustAnchor'

type Result =
  | { kind: 'checking' }
  | { kind: 'url' }
  | { kind: 'other' }
  | { kind: 'rejected'; message: string }
  | { kind: 'unavailable'; message: string }
  | { kind: 'withdrawn'; reason: WithdrawalReason; revokedAt: number }
  | { kind: 'checked'; checked: CheckedPrinted }

/** Decode a QR code from an image source, scaling large photos down first. */
function decodeFrom(source: CanvasImageSource, width: number, height: number, canvas: HTMLCanvasElement): string | null {
  const scale = Math.min(1, 1600 / Math.max(width, height))
  canvas.width = Math.round(width * scale)
  canvas.height = Math.round(height * scale)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
  return jsQR(image.data, image.width, image.height, { inversionAttempts: 'attemptBoth' })?.data ?? null
}

/** `embedded`: rendered inside the signed-in app shell, which already
 *  supplies the top bar and page padding. */
export default function ScanCertificate({ embedded = false }: { embedded?: boolean }) {
  const { t } = useLanguage()
  const navigate = useNavigate()
  const [result, setResult] = useState<Result | null>(null)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [cameraOn, setCameraOn] = useState(false)
  // Torch is offered only where the browser exposes it (Android Chrome; iOS Safari does not).
  const [torchOk, setTorchOk] = useState(false)
  const [torchOn, setTorchOn] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const loopRef = useRef<number | null>(null)
  // Bumped by every stop, so a start still waiting on the permission prompt
  // can tell it was cancelled (left the page, switched tab) and let go.
  const startRef = useRef(0)

  const stopCamera = useCallback(() => {
    startRef.current++
    if (loopRef.current !== null) cancelAnimationFrame(loopRef.current)
    loopRef.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    setCameraOn(false)
    setTorchOk(false)
    setTorchOn(false)
  }, [])

  useEffect(() => stopCamera, [stopCamera])

  const handle = useCallback(async (text: string) => {
    stopCamera()
    const kind = classifyScanned(text, window.location.origin)
    if (kind.kind === 'own-link') return navigate(`/verify/${kind.shareId}`)
    // Signed in: straight to answering. Public scanner: the request page,
    // which explains what is asked before anyone signs in.
    if (kind.kind === 'own-request') {
      return navigate(embedded ? `/app/answer/${kind.requestId}` : `/request/${kind.requestId}`)
    }
    if (kind.kind === 'url') return setResult({ kind: 'url' })
    if (kind.kind === 'other') return setResult({ kind: 'other' })

    setResult({ kind: 'checking' })
    try {
      const trust = await loadTrustState()
      const issuer = trust.list ? await peekPrintedIssuer(kind.payload) : null
      const revocations =
        trust.list && issuer ? await loadRevocationState(issuer, trust.list) : { list: null, failure: null }
      const checked = await verifyPrintedCredential(kind.payload, trust, revocations, Math.floor(Date.now() / 1000))
      setResult({ kind: 'checked', checked })
    } catch (e) {
      if (e instanceof CredentialWithdrawn) {
        setResult({ kind: 'withdrawn', reason: e.withdrawalReason, revokedAt: e.revokedAt })
      } else if (e instanceof CredentialRefused) {
        // The reason, never the payload.
        console.error('[scan] refused:', e.reason)
        if (e.reason === 'URL_PAYLOAD_REJECTED') setResult({ kind: 'url' })
        else setResult({ kind: e.unavailable ? 'unavailable' : 'rejected', message: e.message })
      } else {
        setResult({ kind: 'rejected', message: messageForRefusal('UNREADABLE') })
      }
    }
  }, [embedded, navigate, stopCamera])

  const startCamera = async () => {
    const attempt = ++startRef.current
    setCameraError(null)
    setResult(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      })
      if (attempt !== startRef.current) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      streamRef.current = stream
      const video = videoRef.current!
      video.srcObject = stream
      await video.play()
      setCameraOn(true)
      const caps = stream.getVideoTracks()[0]?.getCapabilities?.() as { torch?: boolean } | undefined
      setTorchOk(!!caps?.torch)

      // BarcodeDetector where the browser has one (Chrome, Android); jsQR
      // everywhere else (Safari on iOS).
      const Detector = (window as unknown as { BarcodeDetector?: new (o: object) => { detect(s: CanvasImageSource): Promise<{ rawValue: string }[]> } }).BarcodeDetector
      const detector = Detector ? new Detector({ formats: ['qr_code'] }) : null
      let last = 0
      const tick = async (time: number) => {
        if (!streamRef.current) return
        if (time - last > 180 && video.readyState >= 2) {
          last = time
          let text: string | null = null
          try {
            if (detector) text = (await detector.detect(video))[0]?.rawValue ?? null
            else if (canvasRef.current) text = decodeFrom(video, video.videoWidth, video.videoHeight, canvasRef.current)
          } catch {
            /* one bad frame; keep going */
          }
          if (text) return handle(text)
        }
        loopRef.current = requestAnimationFrame(tick)
      }
      loopRef.current = requestAnimationFrame(tick)
    } catch (e) {
      if (attempt !== startRef.current) return
      // Blocked is different from broken: once a browser has been told no it
      // stops asking, so the person has to be told where to turn it back on.
      const blocked = e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'SecurityError')
      setCameraError(t(blocked ? 'scan.camera_denied' : 'scan.camera_error'))
      stopCamera()
    }
  }

  // Opening Scan asks for the camera straight away, and so does scanning
  // another. Denied: the error shows, with a button to retry.
  const wantsCamera = result === null
  useEffect(() => {
    if (!wantsCamera) return
    void startCamera()
    return stopCamera
    // startCamera is recreated every render; only the want changes matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantsCamera])

  const onPhoto = async (file: File | undefined) => {
    if (!file || !canvasRef.current) return
    setResult(null)
    try {
      const bitmap = await createImageBitmap(file)
      const text = decodeFrom(bitmap, bitmap.width, bitmap.height, canvasRef.current)
      if (text) handle(text)
      else setResult({ kind: 'rejected', message: t('scan.no_code_found') })
    } catch {
      setResult({ kind: 'rejected', message: t('scan.no_code_found') })
    }
  }

  const reset = () => setResult(null)

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0]
    if (!track) return
    const next = !torchOn
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] })
      setTorchOn(next)
    } catch {
      setTorchOk(false)
    }
  }

  // Back to wherever Scan was opened from; a fresh tab has nowhere to go back to.
  const close = () => (window.history.state?.idx > 0 ? navigate(-1) : navigate('/'))

  // Nothing to read yet: the camera, edge to edge, and nothing else. The
  // explanation lives on the result, not in front of the lens.
  if (!result) {
    const corner = 'absolute w-10 h-10 border-white'
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-black text-white">
        <canvas ref={canvasRef} hidden />

        <div className="relative flex-1 min-h-0 overflow-hidden rounded-b-[28px] bg-stone-900">
          <video ref={videoRef} playsInline muted className="absolute inset-0 w-full h-full object-cover" />

          <div className="absolute inset-x-0 top-0 z-10 pt-[env(safe-area-inset-top)] bg-gradient-to-b from-black/55 to-transparent">
            <div className="relative h-14 flex items-center justify-center">
              <h1 className="font-khmer text-lg font-semibold tracking-wide">{t('nav.scan')}</h1>
              <button
                type="button"
                onClick={close}
                aria-label={t('scan.close')}
                className="absolute right-2 top-2 w-10 h-10 flex items-center justify-center rounded-full active:bg-white/15"
              >
                <X size={24} strokeWidth={2} />
              </button>
            </div>
          </div>

          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="relative w-[68%] max-w-[300px] aspect-square">
              <span className={`${corner} top-0 left-0 border-t-4 border-l-4 rounded-tl-3xl`} />
              <span className={`${corner} top-0 right-0 border-t-4 border-r-4 rounded-tr-3xl`} />
              <span className={`${corner} bottom-0 left-0 border-b-4 border-l-4 rounded-bl-3xl`} />
              <span className={`${corner} bottom-0 right-0 border-b-4 border-r-4 rounded-br-3xl`} />
            </div>
          </div>

          {!cameraOn && cameraError && (
            <div className="absolute inset-x-0 bottom-0 z-10 p-5 bg-gradient-to-t from-black/80 to-transparent text-center space-y-3">
              <p className="text-sm leading-relaxed text-white/90">{cameraError}</p>
              <button
                type="button"
                onClick={startCamera}
                className="h-11 px-6 rounded-full bg-white text-stone-900 text-sm font-semibold"
              >
                {t('scan.start_camera')}
              </button>
            </div>
          )}
        </div>

        <div className="flex gap-3 px-4 pt-4 pb-[calc(env(safe-area-inset-bottom)+16px)]">
          {torchOk && (
            <button
              type="button"
              onClick={toggleTorch}
              aria-pressed={torchOn}
              className={`flex-1 h-12 rounded-full inline-flex items-center justify-center gap-2 text-[15px] font-medium ${
                torchOn ? 'bg-white text-stone-900' : 'bg-white/15 text-white'
              }`}
            >
              {torchOn ? <Flashlight size={18} /> : <FlashlightOff size={18} />} {t('scan.flash')}
            </button>
          )}
          <label className="flex-1 h-12 rounded-full bg-white/15 inline-flex items-center justify-center gap-2 text-[15px] font-medium cursor-pointer active:bg-white/25">
            <ImageUp size={18} /> {t('scan.upload')}
            <input type="file" accept="image/*" className="hidden" onChange={(e) => { onPhoto(e.target.files?.[0]); e.target.value = '' }} />
          </label>
        </div>
      </div>
    )
  }

  return (
    <div className={embedded ? 'max-w-xl mx-auto' : 'min-h-screen bg-stone-50 text-stone-900'}>
      {!embedded && (
      <header className="sticky top-0 z-30 material-bar border-b border-stone-900/[0.06] pt-[env(safe-area-inset-top)]">
        <div className="max-w-lg mx-auto px-4 py-4 flex items-center gap-2">
          <img src="/logo.png" alt="Actik" className="h-8 w-auto" />
          <div>
            <div className="text-xl font-semibold text-indigo-600">Actik</div>
            <div className="font-khmer text-[11px] text-stone-500 -mt-0.5">{t('scan.tagline')}</div>
          </div>
        </div>
      </header>
      )}

      <main className={embedded ? 'space-y-5' : 'max-w-lg mx-auto px-4 py-6 space-y-5'}>
        <canvas ref={canvasRef} hidden />

        {result?.kind === 'checking' && <p className="text-sm text-stone-600">{t('scan.checking')}</p>}

        {result && result.kind !== 'checking' && <ScanResult result={result} />}

        {result && result.kind !== 'checking' && (
          <button
            type="button"
            onClick={reset}
            className="w-full inline-flex items-center justify-center gap-2 border border-stone-300 bg-white text-stone-700 font-semibold h-11 rounded-xl text-sm"
          >
            <RotateCcw size={15} /> {t('scan.scan_another')}
          </button>
        )}
      </main>
    </div>
  )
}

function ScanResult({ result }: { result: Exclude<Result, { kind: 'checking' }> }) {
  const { t } = useLanguage()
  const [observed, setObserved] = useState({ subjectName: '', documentId: '', issuingOrganisation: '', issueDate: '' })

  if (result.kind === 'url') {
    return (
      <div className="border border-rose-200 bg-rose-50 rounded-xl p-5 space-y-2">
        <h2 className="text-lg font-bold text-rose-800">{t('scan.url_title')}</h2>
        <p className="text-sm text-rose-900 leading-relaxed">{messageForRefusal('URL_PAYLOAD_REJECTED')}</p>
      </div>
    )
  }
  if (result.kind === 'other') {
    return (
      <div className="border border-stone-200 bg-white rounded-xl p-5 space-y-2">
        <h2 className="text-lg font-bold text-stone-900">{t('scan.other_title')}</h2>
        <p className="text-sm text-stone-600 leading-relaxed">{t('scan.other_desc')}</p>
      </div>
    )
  }
  if (result.kind === 'unavailable') {
    return (
      <div className="border border-amber-200 bg-amber-50 rounded-xl p-5 space-y-2">
        <h2 className="text-lg font-bold text-amber-800">{t('verify.unavailable_title')}</h2>
        <p className="text-sm text-amber-900 leading-relaxed">{result.message}</p>
      </div>
    )
  }
  if (result.kind === 'withdrawn') {
    return (
      <div className="border border-rose-200 bg-rose-50 rounded-xl p-5 space-y-2">
        <h2 className="text-lg font-bold text-rose-800">{t('verify.withdrawn_title')}</h2>
        <p className="text-sm text-rose-900">{t(`verify.withdrawn_${result.reason}`)}</p>
        {result.revokedAt > 0 && (
          <p className="text-xs text-rose-700">{longDate(result.revokedAt)}</p>
        )}
        <p className="text-sm text-rose-900">{t('scan.do_not_accept')}</p>
      </div>
    )
  }
  if (result.kind === 'rejected') {
    return (
      <div className="border border-rose-200 bg-rose-50 rounded-xl p-5 space-y-2">
        <h2 className="text-lg font-bold text-rose-800">{t('scan.rejected_title')}</h2>
        <p className="text-sm text-rose-900 leading-relaxed">{result.message}</p>
        <p className="text-sm text-rose-900">{t('scan.do_not_accept')}</p>
      </div>
    )
  }

  const { checked } = result
  const m = checked.assertion.mustMatchPrintedDocument
  const typed = Object.values(observed).some((v) => v.trim() !== '')
  const comparison = typed ? checked.assertion.compareWithPrintedDocument(observed) : null
  // Only what the reader actually typed is compared: a box left empty is
  // "not checked", not "differs" — counting it would make every partial check
  // shout, and a warning that always shouts gets ignored.
  const typedMismatches = comparison
    ? comparison.mismatches.filter((c) => observed[c.field].trim() !== '')
    : []
  const rows: Array<[keyof typeof m, string, boolean]> = [
    ['subjectName', t('print.field_holder'), false],
    ['documentId', t('print.field_document_id'), true],
    ['issuingOrganisation', t('print.field_institution'), false],
    ['issueDate', t('print.field_issue_date'), true],
  ]

  return (
    <div className="space-y-4">
      {/* No tick. What was established, and what is left to the reader. */}
      <div>
        <h2 className="font-khmer text-xl font-bold text-stone-900">{t('verify.success_title')}</h2>
        <p className="text-sm text-stone-600 mt-1 leading-relaxed">
          {t('scan.signed_by').replace('{issuer}', checked.issuer.name)}
          {checked.key.status === 'retired' ? ` ${t('scan.retired_key_note')}` : ''}
        </p>
      </div>

      <div className="border border-amber-200 bg-amber-50/60 rounded-xl p-4 space-y-3">
        <div>
          <h3 className="font-khmer text-sm font-bold text-stone-900">{t('verify.compare_heading')}</h3>
          <p className="text-xs text-stone-600 mt-0.5 leading-relaxed">{t('scan.compare_desc')}</p>
        </div>
        <div className="divide-y divide-amber-200/60">
          {rows.map(([field, label, mono]) => {
            const c = comparison?.comparisons.find((x) => x.field === field)
            const checkedField = c && observed[field].trim() !== ''
            return (
              <div key={field} className="py-2">
                <div className="flex items-baseline justify-between gap-4">
                  <span className="font-khmer text-xs font-semibold text-stone-500 shrink-0">{label}</span>
                  <span className={`text-base text-right font-semibold text-stone-900 ${mono ? 'font-mono' : 'font-khmer'}`}>
                    {m[field]}
                  </span>
                </div>
                {checkedField && (
                  <div className={`text-xs mt-1 text-right ${c.matches ? 'text-stone-500' : 'text-rose-700 font-semibold'}`}>
                    {c.matches ? t('scan.matches_typed') : t('scan.differs_typed').replace('{value}', observed[field])}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Standing — "clear" says how fresh; "unchecked" never reads as current. */}
      {checked.standing.status === 'clear' ? (
        <div className="border border-stone-200 rounded-xl p-4 bg-white text-sm text-stone-700">
          <span className="font-semibold">{t('verify.standing_clear_title')}</span>{' '}
          {t('verify.standing_clear_desc')
            .replace('{issuer}', checked.issuer.name)
            .replace('{version}', String(checked.standing.listVersion))
            .replace('{date}', longDate(checked.standing.listIssuedAt))}
        </div>
      ) : (
        <div className="border border-amber-200 rounded-xl p-4 bg-amber-50/60 text-sm text-amber-900">
          <span className="font-semibold">{t('verify.standing_unchecked_title')}</span>{' '}
          {checked.standing.why === 'expired'
            ? t('verify.standing_lapsed_desc')
                .replace('{issuer}', checked.issuer.name)
                .replace('{date}', longDate(checked.standing.listExpiredAt ?? 0))
            : t('verify.standing_none_desc').replace('{issuer}', checked.issuer.name)}
        </div>
      )}

      {/* Optional: type what the paper says and let the app compare exactly. */}
      <details className="bg-white border border-stone-200 rounded-xl p-4">
        <summary className="text-sm font-semibold text-stone-800 cursor-pointer">{t('scan.type_to_compare')}</summary>
        <div className="mt-3 space-y-2">
          {rows.map(([field, label, mono]) => (
            <input
              key={field}
              value={observed[field]}
              onChange={(e) => setObserved((o) => ({ ...o, [field]: e.target.value }))}
              placeholder={label}
              className={`w-full border border-stone-300 rounded-lg px-3 py-2 text-sm ${mono ? 'font-mono' : 'font-khmer'}`}
            />
          ))}
          {typedMismatches.length > 0 && (
            <p className="text-sm font-semibold text-rose-700">
              {t('scan.mismatch_warning').replace('{count}', String(typedMismatches.length))}
            </p>
          )}
        </div>
      </details>

      <p className="text-[11px] text-stone-400 font-mono break-all">
        {checked.issuer.did} · {t('scan.trust_list_version').replace('{version}', String(checked.trustListVersion))}
      </p>
    </div>
  )
}
