// A printable certificate carrying a printed-lane QR code (KH1:…).
//
// Rendered as HTML and printed by the browser, not built as a PDF: the browser
// shapes Khmer script correctly, and PDF libraries without a shaping engine do
// not — a holder's name printed with its subscripts broken would no longer
// match the name signed into the code, which is exactly the comparison the
// verifier is asked to make.
//
// The four fields the code signs are printed verbatim, in a box labelled for
// what they are. The verifier's app shows the same four; the paper and the
// screen must agree. A genuine code copied onto a forged certificate still
// verifies — that comparison is what catches it.

import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { QRCodeCanvas, QRCodeSVG } from 'qrcode.react'
import { Check, Copy, Download, Printer, QrCode, X } from 'lucide-react'
import { useLanguage } from '../lib/i18n'
import { khmerFontReady } from '../lib/khmerFont'

export interface PrintableCertificateProps {
  payload: string
  title: string
  holder: string
  documentId: string
  institution: string
  issueDate: string
  onClose: () => void
}

const printCss = `
  .actik-print-portal { position: fixed; inset: 0; z-index: 10000; overflow: auto;
    background: #e7e5e4; padding: 24px 16px; }
  .actik-sheet { background: #fff; width: 100%; max-width: 297mm; aspect-ratio: 297 / 210;
    margin: 0 auto; box-shadow: 0 10px 30px rgba(0,0,0,.15); padding: 14mm 16mm;
    display: flex; flex-direction: column; color: #1c1917; }
  @media print {
    @page { size: A4 landscape; margin: 0; }
    body > *:not(.actik-print-portal) { display: none !important; }
    .actik-print-portal { position: static; background: #fff; padding: 0; overflow: visible; }
    .actik-print-toolbar { display: none !important; }
    .actik-sheet { box-shadow: none; max-width: none; width: 297mm; height: 210mm; aspect-ratio: auto; }
  }
`

// The QR alone, for an institution that prints on its own certificate paper.
// It is only as safe as the four fields printed beside it, so the panel hands
// them over with it, verbatim, and says so.
const PNG_PX = 1200

function saveFile(href: string, name: string) {
  const a = document.createElement('a')
  a.href = href
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
}

function QrOnlyPanel(props: PrintableCertificateProps) {
  const { t } = useLanguage()
  const svgWrap = useRef<HTMLDivElement>(null)
  const pngWrap = useRef<HTMLDivElement>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const base = `actik-qr-${props.documentId.replace(/[^A-Za-z0-9_-]+/g, '_') || 'certificate'}`

  const downloadSvg = () => {
    const svg = svgWrap.current?.querySelector('svg')
    if (!svg) return
    const clone = svg.cloneNode(true) as SVGSVGElement
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    clone.removeAttribute('style')
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' }))
    saveFile(url, `${base}.svg`)
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const downloadPng = () => {
    const canvas = pngWrap.current?.querySelector('canvas')
    if (canvas) saveFile(canvas.toDataURL('image/png'), `${base}.png`)
  }

  const copy = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(key)
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500)
    } catch { /* clipboard blocked: the value is on screen to select */ }
  }

  const rows: Array<[string, string, string, boolean]> = [
    ['holder', t('print.field_holder'), props.holder, false],
    ['documentId', t('print.field_document_id'), props.documentId, true],
    ['institution', t('print.field_institution'), props.institution, false],
    ['issueDate', t('print.field_issue_date'), props.issueDate, true],
  ]

  return (
    <div className="actik-print-toolbar max-w-[297mm] mx-auto mb-4 bg-white rounded-xl border border-stone-200 p-4 md:p-5">
      <div className="flex flex-col md:flex-row gap-5">
        <div className="flex flex-col items-center gap-3 shrink-0">
          <div ref={svgWrap} className="bg-white">
            <QRCodeSVG value={props.payload} level="M" marginSize={4} style={{ width: 168, height: 168 }} />
          </div>
          <div ref={pngWrap} className="hidden" aria-hidden>
            <QRCodeCanvas value={props.payload} level="M" marginSize={4} size={PNG_PX} />
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={downloadSvg}
              className="inline-flex items-center gap-1.5 bg-indigo-600 text-white text-sm font-semibold px-3 h-9 rounded-lg">
              <Download size={15} /> SVG
            </button>
            <button type="button" onClick={downloadPng}
              className="inline-flex items-center gap-1.5 bg-white border border-stone-300 text-stone-700 text-sm font-semibold px-3 h-9 rounded-lg">
              <Download size={15} /> PNG
            </button>
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <h2 className="text-base font-semibold text-stone-900">{t('print.qr_only_title')}</h2>
          <p className="mt-1 text-sm text-stone-600 leading-relaxed">{t('print.qr_only_rule')}</p>
          <div className="mt-3 divide-y divide-stone-100 border border-stone-200 rounded-lg">
            {rows.map(([key, label, value, mono]) => (
              <div key={key} className="flex items-center gap-3 px-3 py-2">
                <span className="w-24 md:w-36 shrink-0 text-xs text-stone-500">{label}</span>
                <span className={`flex-1 min-w-0 break-words text-sm font-semibold text-stone-900 select-all ${mono ? 'font-mono' : 'font-khmer'}`}>{value}</span>
                <button type="button" onClick={() => copy(key, value)} aria-label={`${t('print.copy')} ${label}`}
                  className="shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-md text-stone-500 hover:bg-stone-100">
                  {copied === key ? <Check size={15} className="text-emerald-600" /> : <Copy size={15} />}
                </button>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-stone-500 leading-relaxed">{t('print.qr_only_size')}</p>
        </div>
      </div>
    </div>
  )
}

export default function PrintableCertificate(props: PrintableCertificateProps) {
  const { t } = useLanguage()
  const [showQrOnly, setShowQrOnly] = useState(false)
  const field = (label: string, value: string, mono = false) => (
    <div className="flex gap-3 text-[13px] leading-snug">
      <span className="w-40 shrink-0 text-stone-500">{label}</span>
      <span className={`font-semibold text-stone-900 ${mono ? 'font-mono' : 'font-khmer'}`}>{value}</span>
    </div>
  )

  return createPortal(
    <div className="actik-print-portal" role="dialog" aria-label={t('print.title')}>
      <style>{printCss}</style>

      <div className="actik-print-toolbar max-w-[297mm] mx-auto mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-stone-700 min-w-0 flex-1 basis-60">{t('print.toolbar_hint')}</p>
        <div className="flex flex-wrap gap-2 shrink-0">
          <button
            type="button"
            onClick={async () => {
              // Print only once the Khmer faces are in: printing during the
              // font swap would put a fallback-shaped name on the paper.
              await khmerFontReady(`${props.holder}${props.institution}${props.title}`)
              window.print()
            }}
            className="inline-flex items-center gap-2 bg-indigo-600 text-white text-sm font-semibold px-4 h-10 rounded-lg"
          >
            <Printer size={16} /> {t('print.print_button')}
          </button>
          <button
            type="button"
            onClick={() => setShowQrOnly((v) => !v)}
            aria-expanded={showQrOnly}
            className={`inline-flex items-center gap-2 border text-sm font-semibold px-4 h-10 rounded-lg ${
              showQrOnly ? 'bg-indigo-50 border-indigo-300 text-indigo-700' : 'bg-white border-stone-300 text-stone-700'
            }`}
          >
            <QrCode size={16} /> {t('print.qr_only_button')}
          </button>
          <button
            type="button"
            onClick={props.onClose}
            className="inline-flex items-center gap-2 bg-white border border-stone-300 text-stone-700 text-sm font-semibold px-4 h-10 rounded-lg"
          >
            <X size={16} /> {t('verify.close')}
          </button>
        </div>
      </div>

      {showQrOnly && <QrOnlyPanel {...props} />}

      <div className="actik-sheet">
        <div className="text-center font-khmer text-lg font-semibold tracking-wide text-stone-700">
          {props.institution}
        </div>

        <div className="flex-1 flex flex-col items-center justify-center text-center">
          <div className="text-sm uppercase tracking-[0.3em] text-stone-500">{t('print.certifies')}</div>
          <div className="mt-4 font-khmer text-5xl font-bold leading-tight">{props.holder}</div>
          <div className="mt-5 text-sm text-stone-500">{t('print.has_been_awarded')}</div>
          <div className="mt-2 font-khmer text-3xl font-semibold">{props.title}</div>
        </div>

        <div className="flex items-end justify-between gap-8">
          <div className="flex-1 border border-stone-300 rounded-md p-4 space-y-1.5">
            <div className="text-[11px] uppercase tracking-widest text-stone-500 mb-2">{t('print.signed_fields')}</div>
            {field(t('print.field_holder'), props.holder)}
            {field(t('print.field_document_id'), props.documentId, true)}
            {field(t('print.field_institution'), props.institution)}
            {field(t('print.field_issue_date'), props.issueDate, true)}
          </div>

          <div className="w-[52mm] shrink-0 text-center">
            <QRCodeSVG value={props.payload} level="M" marginSize={4} style={{ width: '46mm', height: '46mm' }} />
            <div className="mt-2 text-[10.5px] leading-snug text-stone-600">
              <strong className="block text-stone-800">{t('print.scan_caption')}</strong>
              {t('print.no_website')}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
