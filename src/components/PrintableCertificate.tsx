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

import { createPortal } from 'react-dom'
import { QRCodeSVG } from 'qrcode.react'
import { Printer, X } from 'lucide-react'
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

export default function PrintableCertificate(props: PrintableCertificateProps) {
  const { t } = useLanguage()
  const field = (label: string, value: string, mono = false) => (
    <div className="flex gap-3 text-[13px] leading-snug">
      <span className="w-40 shrink-0 text-stone-500">{label}</span>
      <span className={`font-semibold text-stone-900 ${mono ? 'font-mono' : 'font-khmer'}`}>{value}</span>
    </div>
  )

  return createPortal(
    <div className="actik-print-portal" role="dialog" aria-label={t('print.title')}>
      <style>{printCss}</style>

      <div className="actik-print-toolbar max-w-[297mm] mx-auto mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-stone-700">{t('print.toolbar_hint')}</p>
        <div className="flex gap-2 shrink-0">
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
            onClick={props.onClose}
            className="inline-flex items-center gap-2 bg-white border border-stone-300 text-stone-700 text-sm font-semibold px-4 h-10 rounded-lg"
          >
            <X size={16} /> {t('verify.close')}
          </button>
        </div>
      </div>

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
