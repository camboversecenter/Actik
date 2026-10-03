import { useState, useEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { longDate } from '../../lib/dates'
import { useLanguage, formatDegreeTitle } from '../../lib/i18n'

import { readDisclosures, type CredentialAssertion } from '../../lib/sdjwt'
import {
  checkCredential,
  CredentialRefused,
  CredentialWithdrawn,
  type CheckedCredential,
} from '../../lib/credentialCheck'
import { loadRevocationState, loadTrustState } from '../../lib/trustAnchor'

// --- TypeScript Types ---
type CheckStatus = 'waiting' | 'running' | 'passed' | 'failed'

interface VerificationCheck {
  id: string
  label: string
  status: CheckStatus
  errorMessage?: string
  detail?: string
}

interface ShareRecord {
  id: string
  credential_id: string
  presentation: string
  disclosed_fields: string[]
  expires_at: string
  created_at: string
}

/**
 * What get_share_for_verification() returns. `presentation` comes back only
 * for a live share: an expired or revoked link yields its status and its
 * dates, never its contents.
 */
interface ShareLookupRow {
  id: string | null
  presentation: string | null
  issuer_did: string | null
  disclosed_fields: string[] | null
  credential_id: string | null
  expires_at: string | null
  created_at: string | null
  status: 'ok' | 'expired' | 'revoked' | 'exhausted' | 'not_found'
}

interface IssuerRecord {
  name: string
  domain: string
  did: string
  accredited: boolean
}

interface ParsedPresentation {
  fields: Record<string, string>
  issuerDID: string
  issuedAt: number
  expiresAt?: number
}

// Always-English mono captions under each Khmer check label — literal
// strings, not run through t(), matching the established "Khmer primary +
// English technical caption" convention used across the rest of the app
// (e.g. CredentialDetail.tsx's renderField sublabel). check 2's real detail
// ("Valid for N more days") already exists on the check object once it
// passes and takes precedence over this static gloss.
const CHECK_SUBLABELS: Record<string, string> = {
  '1': 'Loading credential',
  '2': 'Checking link validity…',
  '3': 'Verifying issuer signature…',
  '4': 'Trust registry check',
}

// --- Helper Functions ---

/**
 * Decodes the base64url payload of a JWT.
 */
function parseJwtPayload(jwt: string): any {
  try {
    const parts = jwt.split('.')
    if (parts.length < 2) return null
    const payloadPart = parts[1]
    const base64 = payloadPart.replace(/-/g, '+').replace(/_/g, '/')
    const bin = window.atob(base64)
    const dec = new TextDecoder()
    const arr = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) {
      arr[i] = bin.charCodeAt(i)
    }
    return JSON.parse(dec.decode(arr))
  } catch (err) {
    console.error('Failed to parse JWT payload:', err)
    return null
  }
}

/**
 * Parses the presentation to extract claims, issuer, issue date, and expiry.
 * Since sdjwt.ts does not export a parsePresentation function directly,
 * we use the exported readDisclosures and parseJwtPayload.
 */
function parsePresentation(presentation: string): ParsedPresentation {
  const jwt = presentation.split('~')[0]
  const payload = parseJwtPayload(jwt) || {}

  // Reserved JWT claims that are not credential data fields
  const RESERVED = new Set(['iss', 'iat', 'exp', 'nbf', 'sub', 'aud', 'jti', '_sd', '_sd_alg', 'vct', 'cnf'])

  const fields: Record<string, string> = {}

  // 1. Include non-reserved plain JWT payload claims (always visible in the signed JWT)
  for (const [k, v] of Object.entries(payload)) {
    if (!RESERVED.has(k) && v !== null && v !== undefined && v !== '') {
      fields[k] = String(v)
    }
  }

  // 2. SD-JWT disclosures override payload claims (explicitly revealed by holder)
  const disclosures = readDisclosures(presentation)
  disclosures.forEach((d) => {
    fields[d.name] = String(d.value)
  })

  // Credentials issued before commit 6502ec7 disclose degree type under the
  // legacy claim name "degree" instead of "degree_type" (SD-JWT disclosures
  // are fixed forever at signing time, so old credentials keep the old
  // name — see CredentialDetail.tsx for the full history). ShareCredential.tsx
  // always reveals "degree" alongside "degree_type" for such credentials
  // (they represent the same field), so without this they'd render as two
  // separate rows — "Degree title" and "Degree type" — showing the exact
  // same value.
  if (fields.degree !== undefined) {
    if (fields.degree_type === undefined) fields.degree_type = fields.degree
    delete fields.degree
  }

  return {
    fields,
    issuerDID: payload.iss || '',
    issuedAt: payload.iat || 0,
    expiresAt: payload.exp,
  }
}

/**
 * Formats keys to Khmer-primary, human-readable labels — reuses the same
 * i18n keys the wallet/share screens already use for these exact fields,
 * so the label a holder sees when sharing matches what a verifier sees here.
 */
function getFieldLabel(key: string, t: (k: string) => string): string {
  switch (key) {
    case 'name':
      return t('wallet.student_name').replace(/[:៖]\s*$/, '')
    case 'degree':
      return t('wallet.degree_title')
    case 'institution':
      return t('wallet.institution_name')
    case 'year':
      return t('wallet.field_year')
    case 'gpa':
      return t('wallet.field_gpa')
    case 'national_id':
      return t('wallet.field_national_id')
    case 'notes':
      return t('wallet.field_notes')
    case 'iss':
      return t('wallet.detail_issued_by')
    case 'iat':
      return t('wallet.issue_date_label')
    case 'email':
      return t('wallet.student_email').replace(/[:៖]\s*$/, '')
    case 'student_id':
      return t('wallet.student_id').replace(/[:៖]\s*$/, '')
    case 'degree_type':
      return t('wallet.degree_type').replace(/[:៖]\s*$/, '')
    case 'major':
      return t('wallet.major').replace(/[:៖]\s*$/, '')
    case 'graduation_date':
      return t('wallet.graduation_date').replace(/[:៖]\s*$/, '')
    case 'certificate_id':
      return t('wallet.certificate_id').replace(/[:៖]\s*$/, '')
    case 'photo':
    case 'student_photo':
      return t('wallet.field_photo')
    default:
      return key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' ')
  }
}

/**
 * The always-English mono caption under each Khmer field label — same
 * "Khmer primary + English technical caption" pattern used in
 * CredentialDetail.tsx's renderField. Plain literal strings, not t() — this
 * caption is deliberately not translated in either language mode.
 */
function getFieldSublabel(key: string): string {
  const map: Record<string, string> = {
    name: 'Full name',
    degree: 'Degree',
    institution: 'Institution',
    year: 'Year',
    gpa: 'GPA',
    national_id: 'National ID',
    notes: 'Notes',
    email: 'Email',
    student_id: 'Student ID',
    degree_type: 'Degree',
    major: 'Major',
    graduation_date: 'Graduation date',
    certificate_id: 'Certificate ID',
    photo: 'Certificate photo / scan',
    student_photo: 'Certificate photo / scan',
  }
  return map[key] || key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' ')
}

/**
 * Displays a certificate image and auto-clips black letterbox bars at the bottom.
 * Uses useRef so the element reference stays valid inside async callbacks.
 * Scans row average luminance (perceptual) — robust against JPEG compression artifacts.
 */
function CertificateImageField({ imgSrc, onFullscreen }: { imgSrc: string; onFullscreen: () => void }) {
  const { t } = useLanguage()
  const imgRef = useRef<HTMLImageElement>(null)
  const [clipHeight, setClipHeight] = useState<number | undefined>(undefined)

  useEffect(() => {
    setClipHeight(undefined)
    const el = imgRef.current
    if (!el) return

    function detect() {
      const img = imgRef.current
      if (!img) return
      const { naturalWidth, naturalHeight } = img
      const displayWidth = img.getBoundingClientRect().width
      if (!naturalWidth || !naturalHeight || !displayWidth) return

      try {
        const canvasW = Math.min(naturalWidth, 400)
        const scale = canvasW / naturalWidth
        const canvasH = Math.round(naturalHeight * scale)
        const canvas = document.createElement('canvas')
        canvas.width = canvasW
        canvas.height = canvasH
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        ctx.drawImage(img, 0, 0, canvasW, canvasH)

        // Average perceptual luminance per row.
        // JPEG-compressed black ≈ 2–10; real certificate content ≈ 50–255.
        const THRESHOLD = 40
        const sx = Math.floor(canvasW * 0.1)
        const ex = Math.floor(canvasW * 0.9)
        const rowPixels = ex - sx
        let lastContentRow = canvasH

        for (let y = canvasH - 1; y >= Math.floor(canvasH * 0.25); y--) {
          const row = ctx.getImageData(0, y, canvasW, 1).data
          let lum = 0
          for (let x = sx; x < ex; x++) {
            lum += row[x * 4] * 0.299 + row[x * 4 + 1] * 0.587 + row[x * 4 + 2] * 0.114
          }
          if (lum / rowPixels > THRESHOLD) { lastContentRow = y + 1; break }
        }

        if (lastContentRow < canvasH * 0.95) {
          const displayH = (displayWidth / naturalWidth) * naturalHeight
          setClipHeight(Math.ceil(displayH * (lastContentRow / canvasH)) + 10)
        }
      } catch {
        // Canvas blocked — show full image
      }
    }

    // If already decoded (cached image), run after layout via rAF.
    // Otherwise attach a load listener then run via rAF.
    if (el.complete && el.naturalWidth > 0) {
      requestAnimationFrame(detect)
    } else {
      const onLoad = () => requestAnimationFrame(detect)
      el.addEventListener('load', onLoad)
      return () => el.removeEventListener('load', onLoad)
    }
  }, [imgSrc])

  return (
    <>
      <div style={{
        border: '1px solid #e7e5e4',
        borderRadius: 8,
        overflow: 'hidden',
        background: '#fff',
        width: '100%',
        ...(clipHeight !== undefined ? { maxHeight: clipHeight } : {}),
      }}>
        <img
          ref={imgRef}
          src={imgSrc}
          alt="Certificate"
          style={{ display: 'block', width: '100%', height: 'auto' }}
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
        />
      </div>
      <div style={{ marginTop: '0.75rem', display: 'flex', justifyContent: 'flex-end' }}>
        <button
          type="button"
          onClick={onFullscreen}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '7px 16px', background: '#f5f5f4',
            border: '1px solid #e7e5e4', borderRadius: 8,
            color: '#57534e', fontSize: '0.75rem', fontWeight: 600,
            cursor: 'pointer', boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
          }}
        >
          <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
          </svg>
          {t('wallet.view_full_screen')}
        </button>
      </div>
    </>
  )
}

export default function VerifyCredential() {
  const { t, language, setLanguage } = useLanguage()
  const { token } = useParams<{ token: string }>()
  const isTokenInvalid = !token || token.length < 10

  const [status, setStatus] = useState<'loading' | 'success' | 'failed' | 'idle'>('idle')
  const [checks, setChecks] = useState<VerificationCheck[]>([
    { id: '1', label: t('verify.check_1'), status: 'waiting' },
    { id: '2', label: t('verify.check_2'), status: 'waiting' },
    { id: '4', label: t('verify.check_4'), status: 'waiting' },
    { id: '3', label: t('verify.check_3'), status: 'waiting' },
    { id: '5', label: t('verify.check_5'), status: 'waiting' },
  ])

  const [share, setShare] = useState<ShareRecord | null>(null)
  // Which way check 2 failed — expired and withdrawn read the same to the
  // crypto and very differently to the person holding the paper.
  const [linkStatus, setLinkStatus] = useState<'expired' | 'revoked' | 'exhausted' | null>(null)
  const [issuer, setIssuer] = useState<IssuerRecord | null>(null)
  // What verification produced. There is no boolean on it by design: holding
  // this object means a registered key signed these fields, which is not the
  // same as the document in the reader's hand being the one that was issued.
  const [assertion, setAssertion] = useState<CredentialAssertion | null>(null)
  // The whole result of the check: which signed-list key vouched for it, and
  // its standing against the issuer's withdrawal list.
  const [checked, setChecked] = useState<CheckedCredential | null>(null)
  // Refused, "we could not check", and "the issuer withdrew it" are three
  // different answers and must not be dressed the same. The code is only to
  // blame in the first; nobody is in the second; the institution decided the
  // third.
  const [failureKind, setFailureKind] = useState<'rejected' | 'unavailable' | 'withdrawn'>('rejected')
  const [withdrawal, setWithdrawal] = useState<{ reason: string; revokedAt: number } | null>(null)
  const [parsedPresentation, setParsedPresentation] = useState<ParsedPresentation | null>(null)
  const [detailsExpanded, setDetailsExpanded] = useState(false)
  const [fullscreenImage, setFullscreenImage] = useState<string | null>(null)

  const updateCheck = (id: string, status: CheckStatus, errorMessage?: string, detail?: string) => {
    setChecks((prev) =>
      prev.map((c) => (c.id === id ? { ...c, status, errorMessage, detail } : c))
    )
  }

  useEffect(() => {
    if (isTokenInvalid) return

    let active = true

    async function runVerification() {
      // Initialize checks list
      setChecks([
        { id: '1', label: t('verify.check_1'), status: 'running' },
        { id: '2', label: t('verify.check_2'), status: 'waiting' },
        { id: '4', label: t('verify.check_4'), status: 'waiting' },
        { id: '3', label: t('verify.check_3'), status: 'waiting' },
        { id: '5', label: t('verify.check_5'), status: 'waiting' },
      ])
      setStatus('loading')

      // --- CHECK 1: Fetch the share ---
      if (!active) return

      try {
        // `shares` has no public read policy: an anonymous select would have
        // handed out every holder's presentation, live or not. This RPC
        // returns one share by id, and returns its presentation only while
        // the link is neither expired nor revoked
        // (supabase/migrations/20260910_rls_hardening.sql).
        const { data: shareRows, error: shareError } = await supabase.rpc(
          'get_share_for_verification',
          { p_share_id: token }
        )

        const lookup = (Array.isArray(shareRows) ? shareRows[0] : shareRows) as
          | ShareLookupRow
          | undefined

        if (shareError || !lookup || lookup.status === 'not_found') {
          updateCheck('1', 'failed', 'This link does not exist')
          if (active) setStatus('failed')
          return
        }

        const shareRecord: ShareRecord = {
          id: lookup.id || token || '',
          credential_id: lookup.credential_id || '',
          presentation: lookup.presentation || '',
          disclosed_fields: lookup.disclosed_fields || [],
          expires_at: lookup.expires_at || '',
          created_at: lookup.created_at || '',
        }

        setShare(shareRecord)
        updateCheck('1', 'passed')

        // --- CHECK 2: is the link still live? ---
        updateCheck('2', 'running')
        if (!active) return

        // Withdrawal by the holder is its own outcome, not a generic failure:
        // the holder took the link back, the credential is not in question.
        if (lookup.status === 'revoked') {
          setLinkStatus('revoked')
          updateCheck('2', 'failed', 'The holder has withdrawn this share link')
          if (active) setStatus('failed')
          return
        }

        // A link the holder limited to one view, already viewed.
        if (lookup.status === 'exhausted') {
          setLinkStatus('exhausted')
          updateCheck('2', 'failed', 'This link could be opened only once, and it already has been')
          if (active) setStatus('failed')
          return
        }

        // Expiry is decided by the database, not by this browser's clock.
        if (lookup.status === 'expired' || new Date(shareRecord.expires_at) < new Date()) {
          setLinkStatus('expired')
          const formattedDate = shareRecord.expires_at
            ? new Date(shareRecord.expires_at).toLocaleDateString('en-US', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })
            : ''
          updateCheck(
            '2',
            'failed',
            formattedDate ? `This share link expired on ${formattedDate}` : 'This share link has expired'
          )
          if (active) setStatus('failed')
          return
        }

        const diffMs = new Date(shareRecord.expires_at).getTime() - new Date().getTime()
        const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24))
        const remainingText = `Valid for ${diffDays} more day${diffDays === 1 ? '' : 's'}`
        updateCheck('2', 'passed', undefined, remainingText)

        // --- CHECKS 4, 3, 5: registry, signature, withdrawal ---
        // One call does all three, in that order, against the Root-signed
        // trust list — never against the `issuers` table, which anyone with
        // database access could edit. See src/lib/credentialCheck.ts.
        updateCheck('4', 'running')
        if (!active) return

        const jwt = shareRecord.presentation.split('~')[0]
        const payload = parseJwtPayload(jwt)
        const issuerDID: string | undefined = payload?.iss

        const trust = await loadTrustState()
        const revocations =
          trust.list && issuerDID
            ? await loadRevocationState(issuerDID, trust.list)
            : { list: null, failure: null }
        if (!active) return

        let result: CheckedCredential
        try {
          result = await checkCredential(
            shareRecord.presentation,
            issuerDID,
            trust,
            revocations,
            Math.floor(Date.now() / 1000)
          )
        } catch (e) {
          if (!(e instanceof CredentialRefused)) throw e
          // The reason, never the payload.
          console.error('[verify] refused:', e.reason)

          // Which step it stopped at: the steps before it passed.
          const stoppedAt =
            e.reason.startsWith('TRUSTLIST_') || e.reason.startsWith('ISSUER_NOT') || e.reason.startsWith('KEY_') || e.reason === 'NO_ISSUER'
              ? '4'
              : e.reason.startsWith('REVOCATIONS_') || e.reason === 'CREDENTIAL_REVOKED'
                ? '5'
                : '3'
          if (stoppedAt !== '4') updateCheck('4', 'passed')
          if (stoppedAt === '5') updateCheck('3', 'passed')

          if (e instanceof CredentialWithdrawn) {
            setFailureKind('withdrawn')
            setWithdrawal({ reason: e.withdrawalReason, revokedAt: e.revokedAt })
          } else {
            setFailureKind(e.unavailable ? 'unavailable' : 'rejected')
          }
          updateCheck(stoppedAt, 'failed', e.message)
          if (active) setStatus('failed')
          return
        }

        updateCheck('4', 'passed', undefined, `Signed trust list v${result.trustListVersion}`)
        updateCheck('3', 'passed', undefined, result.key.status === 'retired' ? 'Signed with a since-retired key, before it was retired' : undefined)
        updateCheck(
          '5',
          'passed',
          undefined,
          result.standing.status === 'clear'
            ? `Not withdrawn, per the issuer's list v${result.standing.listVersion}`
            : 'Standing unchecked'
        )

        setChecked(result)
        setAssertion(result.assertion)
        setIssuer({
          name: result.issuer.name,
          domain: result.issuer.domain ?? '',
          did: result.issuer.did,
          accredited: true,
        })

        // Parse claims for display
        const parsed = parsePresentation(shareRecord.presentation)
        setParsedPresentation(parsed)

        if (active) setStatus('success')

        // Best-effort verification count — fire-and-forget, never blocks
        // rendering the result. The RPC itself re-validates expiry/revocation
        // server-side, so this can't inflate the count past what's genuine.
        if (token) {
          supabase.rpc('record_verification', { p_share_id: token }).then(({ error }) => {
            if (error) console.error('[verify] record_verification failed:', error)
          })
        }
      } catch (err) {
        console.error(err)
        if (active) {
          setChecks((prev) => {
            const running = prev.find((c) => c.status === 'running')
            if (running) {
              return prev.map((c) =>
                c.id === running.id
                  ? { ...c, status: 'failed', errorMessage: 'An unexpected internal error occurred' }
                  : c
              )
            }
            return prev
          })
          setStatus('failed')
        }
      }
    }

    runVerification()

    return () => {
      active = false
    }
  }, [token, isTokenInvalid])

  const formatTimestamp = (sec: number) => {
    if (!sec) return ''
    return new Date(sec * 1000).toLocaleDateString('en-US', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
  }

  const formatExpiryDate = (isoString?: string) => {
    if (!isoString) return ''
    return new Date(isoString).toLocaleString('en-US', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const isExpiringSoon = (isoString?: string) => {
    if (!isoString) return false
    const diffMs = new Date(isoString).getTime() - new Date().getTime()
    return diffMs > 0 && diffMs < 24 * 60 * 60 * 1000
  }

  // Determine which check failed
  const failedCheck = checks.find((c) => c.status === 'failed')

  const getFailureSubtext = () => {
    if (!failedCheck) return 'An error occurred during verification.'
    switch (failedCheck.id) {
      case '1':
        return 'This link does not exist'
      case '2':
        return linkStatus === 'revoked'
          ? 'The holder has withdrawn this link'
          : linkStatus === 'exhausted'
            ? 'This single-use link has already been opened'
            : 'This link has expired'
      case '3':
        return failureKind === 'unavailable'
          ? 'This code was not checked'
          : "This code did not verify"
      case '4':
        return failureKind === 'unavailable'
          ? 'The signed trust registry could not be checked'
          : 'The issuing institution is not on the signed trust registry'
      case '5':
        return failureKind === 'withdrawn'
          ? 'The institution has withdrawn this credential'
          : "The institution's withdrawal list could not be checked"
      default:
        return 'An error occurred during verification.'
    }
  }

  const getGuidanceText = () => {
    if (!failedCheck) return ''
    switch (failedCheck.id) {
      case '1':
        return 'Check the link you were given, or ask the holder to share a new one.'
      case '2':
        return linkStatus === 'revoked'
          ? 'The holder withdrew this link. Ask them for a new one if you still need it.'
          : linkStatus === 'exhausted'
            ? 'Single-use links stop working after the first view. Ask the holder for a new one.'
            : 'Ask the credential holder to generate a new share link.'
      case '3':
        return failureKind === 'unavailable'
          ? 'Nothing is wrong with the code as far as we know — we could not check it. Try again shortly.'
          : 'This code did not verify. Do not accept it as proof, and ask the holder for the credential another way.'
      case '4':
        return failureKind === 'unavailable'
          ? 'Nothing is wrong with the code as far as we know — we could not check it. Try again shortly.'
          : 'Contact the institution directly to verify their credentials.'
      case '5':
        return failureKind === 'withdrawn'
          ? 'Do not accept this credential. The institution, not the code, ended it — the holder can ask the institution why.'
          : 'Nothing is wrong with the code as far as we know — we could not check it. Try again shortly.'
      default:
        return ''
    }
  }

  // Field display ordering reference
  const FIELD_ORDER = ['name', 'degree', 'institution', 'year', 'gpa', 'national_id', 'notes', 'email', 'student_id', 'degree_type', 'major', 'graduation_date', 'certificate_id', 'photo']

  // Filter out raw JWT claims (iss, iat, exp) — shown separately or not at
  // all. "degree" is here too: parsePresentation() already merges it into
  // "degree_type" and deletes the key, so it never actually appears in
  // parsedPresentation.fields — without also skipping it here, a legacy
  // credential's share.disclosed_fields (which still lists "degree", since
  // that's the real on-token name ShareCredential.tsx reveals) would look
  // like a field that got hidden, even though degree info was shown fine
  // under "degree_type".
  const SKIP_FIELDS = ['iss', 'iat', 'exp', 'degree']
  const sortedFields = Object.entries(parsedPresentation?.fields || {})
    .filter(([key]) => !SKIP_FIELDS.includes(key))
    .sort((a, b) => {
      const indexA = FIELD_ORDER.indexOf(a[0])
      const indexB = FIELD_ORDER.indexOf(b[0])
      if (indexA === -1 && indexB === -1) return a[0].localeCompare(b[0])
      if (indexA === -1) return 1
      if (indexB === -1) return -1
      return indexA - indexB
    })

  // Hidden fields: only fields the student explicitly chose NOT to disclose.
  // share.disclosed_fields contains the claim names the student selected to reveal.
  // Fields present in disclosed_fields but absent from the actual presentation are truly hidden.
  // We do NOT use a hardcoded list — that would flag non-existent claims as hidden.
  const presentedKeys = new Set(Object.keys(parsedPresentation?.fields || {}).filter(k => !SKIP_FIELDS.includes(k)))
  const hiddenFields = (share?.disclosed_fields || []).filter(f => !presentedKeys.has(f) && !SKIP_FIELDS.includes(f))

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900 flex flex-col relative antialiased">
      {/* Fullscreen image lightbox */}
      {fullscreenImage && (
        <div
          onClick={() => setFullscreenImage(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.88)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '1rem',
          }}
        >
          <button
            type="button"
            onClick={() => setFullscreenImage(null)}
            style={{
              position: 'absolute',
              top: 16,
              right: 16,
              background: 'rgba(255,255,255,0.15)',
              border: '1px solid rgba(255,255,255,0.2)',
              borderRadius: 8,
              color: 'white',
              cursor: 'pointer',
              padding: '6px 14px',
              fontSize: '0.8rem',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
            {t('verify.close')}
          </button>
          <img
            src={fullscreenImage}
            alt="Certificate (full screen)"
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: '100%',
              maxHeight: '90vh',
              objectFit: 'contain',
              borderRadius: 8,
              boxShadow: '0 25px 60px rgba(0,0,0,0.5)',
            }}
          />
        </div>
      )}

      {/* For production, add @media print CSS to hide buttons and show clean result */}
      <style>{`
        @keyframes scaleIn {
          0% { transform: scale(0.9); opacity: 0; }
          100% { transform: scale(1); opacity: 1; }
        }
        .animate-scale-in {
          animation: scaleIn 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
        }
        @media print {
          .no-print {
            display: none !important;
          }
          body {
            background-color: white !important;
          }
          .print-card {
            border: none !important;
            box-shadow: none !important;
            padding: 0 !important;
          }
        }
      `}</style>

      {/* Thin indigo top border */}
      <div className="h-1 bg-indigo-600 w-full no-print" />

      {/* Top bar */}
      <header className="border-b border-stone-100 bg-white no-print">
        <div className="max-w-lg mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img src="/logo.png" alt="Actik" className="h-8 w-auto" />
            <div className="flex flex-col">
              <span className="text-xl font-semibold text-indigo-600">Actik</span>
              <span className="font-khmer text-[10px] text-stone-500 -mt-0.5 font-medium">
                {t('verify.tagline')}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden sm:inline font-khmer text-xs font-semibold text-stone-400 uppercase tracking-wider">
              {t('verify.result_label')}
            </span>
            <div className="inline-flex border border-stone-200 rounded-[6px] overflow-hidden">
              <button
                type="button"
                onClick={() => setLanguage('km')}
                aria-pressed={language === 'km'}
                className={`font-khmer px-2.5 py-1 text-[11px] font-bold transition-colors cursor-pointer ${
                  language === 'km' ? 'bg-indigo-600 text-white' : 'bg-white text-stone-500 hover:bg-stone-50'
                }`}
              >
                ខ្មែរ
              </button>
              <button
                type="button"
                onClick={() => setLanguage('en')}
                aria-pressed={language === 'en'}
                className={`px-2.5 py-1 text-[11px] font-semibold border-l border-stone-200 transition-colors cursor-pointer ${
                  language === 'en' ? 'bg-indigo-600 text-white' : 'bg-white text-stone-500 hover:bg-stone-50'
                }`}
              >
                EN
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 w-full max-w-lg mx-auto px-4 py-8">
        <div className="bg-transparent md:bg-white rounded-[14px] md:border md:border-stone-200 md:shadow-sm p-5 md:p-[26px] print-card">
          {/* 1. Invalid Token State */}
          {isTokenInvalid && (
            <div className="text-center py-6">
              <div className="w-12 h-12 rounded-full bg-rose-50 border border-rose-100 flex items-center justify-center mx-auto mb-4 text-rose-500">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  />
                </svg>
              </div>
              <h2 className="font-khmer text-xl font-semibold text-stone-900 mb-2">{t('verify.invalid_link_title')}</h2>
              <p className="text-sm text-stone-600 mb-1">
                {t('verify.invalid_link_desc')}
              </p>
              <p className="text-xs text-stone-400 font-medium">{t('verify.invalid_link_hint')}</p>
            </div>
          )}

          {/* 2. Loading State */}
          {!isTokenInvalid && status === 'loading' && (
            <div className="space-y-6">
              <div>
                <h2 className="font-khmer text-[15.5px] font-bold text-stone-900">{t('verify.loading_title')}</h2>
                <p className="font-mono text-xs text-stone-400 mt-1 font-medium">Running four independent security checks</p>
              </div>
              <div className="space-y-4 pt-4 border-t border-stone-100">
                {checks.map((check) => (
                  <div key={check.id} className="flex flex-col">
                    <div className="flex items-center gap-3">
                      {check.status === 'waiting' && (
                        <div className="w-[18px] h-[18px] rounded-full border border-stone-200 bg-stone-50 flex items-center justify-center shrink-0">
                          <div className="w-1.5 h-1.5 rounded-full bg-stone-300" />
                        </div>
                      )}
                      {check.status === 'running' && (
                        <div className="w-[18px] h-[18px] rounded-full border-2 border-indigo-200 border-t-indigo-600 animate-spin shrink-0" />
                      )}
                      {check.status === 'passed' && (
                        <div className="w-[18px] h-[18px] rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        </div>
                      )}
                      {check.status === 'failed' && (
                        <div className="w-[18px] h-[18px] rounded-full bg-rose-100 text-rose-600 flex items-center justify-center shrink-0">
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </div>
                      )}
                      <span
                        className={`font-khmer text-sm font-medium ${
                          check.status === 'running'
                            ? 'text-indigo-600'
                            : check.status === 'passed'
                            ? 'text-emerald-800'
                            : check.status === 'failed'
                            ? 'text-rose-600 font-semibold'
                            : 'text-stone-400'
                        }`}
                      >
                        {check.label}
                      </span>
                    </div>
                    {/* Always-English mono technical caption — same "Khmer
                        primary, English caption" convention used across the
                        rest of the app for structured/technical detail. */}
                    <span className="pl-[30px] font-mono text-[10.5px] text-stone-400 mt-0.5">
                      {check.detail || CHECK_SUBLABELS[check.id]}
                    </span>
                    {check.status === 'failed' && check.errorMessage && (
                      <p className="pl-[30px] pt-1 text-xs text-rose-500 font-semibold leading-relaxed">
                        {check.errorMessage}
                      </p>
                    )}
                  </div>
                ))}
              </div>
              <p className="text-center font-mono text-[10.5px] text-stone-400 pt-2">
                {t('verify.no_account_needed')}
              </p>
            </div>
          )}

          {/* 3. Verified Result State */}
          {!isTokenInvalid && status === 'success' && (
            <div className="space-y-6">
              {/* Header Section — deliberately no tick and no colour verdict.
                  A tick answers "is this fine?", which a signature cannot
                  answer: it says a registered key signed these fields, and the
                  reader still has to compare them with the document. */}
              <div className="text-center py-4 flex flex-col items-center">
                <h2 className="font-khmer text-xl font-bold text-stone-900">{t('verify.success_title')}</h2>
                <p className="text-sm text-stone-500 mt-1 font-medium max-w-sm mx-auto leading-relaxed">
                  {t('verify.success_desc')}
                </p>
              </div>

              {/* Recap row — the three checks that just ran, restated as a
                  quick-scan summary rather than making the verifier re-read
                  the in-progress checklist. */}
              <div className="flex flex-wrap gap-x-6 gap-y-3 justify-center">
                {[
                  { label: t('verify.check_3'), sub: 'Signature · ES256' },
                  { label: t('verify.check_4'), sub: 'Trust registry' },
                  { label: t('verify.check_2'), sub: 'Link not expired' },
                ].map((item, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-stone-300 shrink-0" />
                    <div>
                      <div className="font-khmer text-xs font-bold text-stone-900 leading-tight">{item.label.replace(/[…\s]*$/, '')}</div>
                      <div className="font-mono text-[10px] text-stone-400 leading-tight">{item.sub}</div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Standing. "clear" is only as fresh as the issuer's list, and
                  says so; "unchecked" must never read as current. */}
              {checked && (
                checked.standing.status === 'clear' ? (
                  <div className="border border-stone-200 rounded-[11px] p-4 bg-white text-sm text-stone-700">
                    <span className="font-semibold">{t('verify.standing_clear_title')}</span>{' '}
                    {t('verify.standing_clear_desc')
                      .replace('{issuer}', checked.issuer.name)
                      .replace('{version}', String(checked.standing.listVersion))
                      .replace('{date}', longDate(checked.standing.listIssuedAt))}
                  </div>
                ) : (
                  <div className="border border-amber-200 rounded-[11px] p-4 bg-amber-50/60 text-sm text-amber-900">
                    <span className="font-semibold">{t('verify.standing_unchecked_title')}</span>{' '}
                    {checked.standing.why === 'expired'
                      ? t('verify.standing_lapsed_desc')
                          .replace('{issuer}', checked.issuer.name)
                          .replace('{date}', longDate(checked.standing.listExpiredAt ?? 0))
                      : t('verify.standing_none_desc').replace('{issuer}', checked.issuer.name)}
                  </div>
                )
              )}

              {/* The transplant check. A genuine code photographed off a real
                  certificate and printed on a forged one verifies perfectly,
                  because nothing about the paper is signed. Comparing these
                  four fields with the document is the only thing that closes
                  it, so they are given their own block above the details. */}
              {assertion && (
                <div className="border border-amber-200 rounded-[11px] p-4 bg-amber-50/60 space-y-3">
                  <div>
                    <h3 className="font-khmer text-sm font-bold text-stone-900">{t('verify.compare_heading')}</h3>
                    <p className="text-xs text-stone-600 mt-0.5 leading-relaxed">{t('verify.compare_desc')}</p>
                  </div>
                  <div className="divide-y divide-amber-200/60">
                    {([
                      ['subjectName', t('verify.compare_subject')],
                      ['documentId', t('verify.compare_document_id')],
                      ['issuingOrganisation', t('verify.compare_organisation')],
                      ['issueDate', t('verify.compare_issue_date')],
                    ] as const).map(([field, label]) => {
                      const value = assertion.mustMatchPrintedDocument[field]
                      return (
                        <div key={field} className="flex items-baseline justify-between gap-4 py-1.5">
                          <span className="font-khmer text-xs font-semibold text-stone-500 shrink-0">{label}</span>
                          <span className={`text-sm text-right ${value ? 'font-semibold text-stone-900' : 'italic text-stone-400'}`}>
                            {value ?? t('verify.compare_not_disclosed')}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Issuer Trust Badge */}
              <div className="border border-indigo-200 rounded-[11px] p-4 bg-indigo-50 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1">
                  <span className="font-khmer text-[10px] font-bold text-indigo-500 uppercase tracking-widest">
                    {t('verify.issued_by_label')}
                  </span>
                  <h3 className="text-base font-bold text-stone-900">{issuer?.name}</h3>
                  <a
                    href={`https://${issuer?.domain}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-stone-500 hover:text-indigo-600 flex items-center gap-1 font-medium transition-colors"
                  >
                    {issuer?.domain}
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                      />
                    </svg>
                  </a>
                </div>
                {/* Standing, stated. Not a badge: a shield with a tick reads
                    as "safe", which is a claim about the institution nobody
                    here is in a position to make. */}
                <div className="w-full sm:w-auto border-t sm:border-t-0 border-indigo-200/40 pt-3 sm:pt-0 sm:text-right">
                  <p className="font-khmer text-xs font-semibold text-stone-700">{t('verify.accredited_badge')}</p>
                </div>
              </div>

              {/* Disclosed Fields Section */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-khmer text-lg font-medium text-stone-900">{t('verify.credential_details_heading')}</h3>
                  <span className="font-mono text-[10.5px] text-stone-400">
                    {sortedFields.length} of {sortedFields.length + hiddenFields.length} fields disclosed
                  </span>
                </div>
                <hr className="border-stone-100" />
                <div className="divide-y divide-stone-100">
                  {sortedFields.map(([key, value]) => {
                    if (key === 'photo' || key === 'student_photo') {
                      const valStr = String(value)
                      const isPdf = valStr.startsWith('data:application/pdf') || valStr.endsWith('.pdf')
                      return (
                        <div key={key} style={{ marginBottom: '1rem', marginTop: '1rem' }}>
                          <div className="font-khmer" style={{
                            fontSize: '0.75rem',
                            color: 'var(--muted)',
                            marginBottom: '0.4rem',
                            fontWeight: 600,
                            textTransform: 'uppercase',
                            letterSpacing: '0.05em'
                          }}>
                            {getFieldLabel(key, t)}
                          </div>
                          {isPdf ? (
                            <div style={{ width: '100%', borderRadius: 8, border: '1px solid #e7e5e4', overflow: 'hidden', background: '#f5f5f4' }}>
                              <object
                                data={valStr + '#toolbar=0&navpanes=0&scrollbar=0'}
                                type="application/pdf"
                                width="100%"
                                height="420"
                                style={{ display: 'block' }}
                              >
                                <div style={{ padding: '1.5rem', textAlign: 'center', color: '#78716c', fontSize: '0.875rem' }}>
                                  {t('verify.pdf_not_supported')}
                                </div>
                              </object>
                            </div>
                          ) : (
                            <CertificateImageField
                              imgSrc={valStr.startsWith('data:') || valStr.startsWith('http')
                                ? valStr
                                : `data:image/jpeg;base64,${valStr}`}
                              onFullscreen={() => setFullscreenImage(
                                valStr.startsWith('data:') || valStr.startsWith('http')
                                  ? valStr
                                  : `data:image/jpeg;base64,${valStr}`
                              )}
                            />
                          )}
                        </div>
                      )
                    }
                    if (key === 'graduation_date') {
                      let formatted = String(value)
                      try {
                        const d = new Date(String(value))
                        if (!isNaN(d.getTime())) {
                          const day = d.getDate()
                          const month = d.toLocaleDateString('en-US', { month: 'long' })
                          const year = d.getFullYear()
                          formatted = `${day} ${month} ${year}`
                        }
                      } catch {}
                      return (
                        <div key={key} className="py-2.5 flex flex-col sm:flex-row sm:justify-between sm:items-start text-sm gap-1 sm:gap-0">
                          <span className="font-khmer text-stone-500 font-medium">
                            {getFieldLabel(key, t)}
                            <span className="block font-sans font-normal text-[10px] text-stone-400 mt-0.5">{getFieldSublabel(key)}</span>
                          </span>
                          <span className="font-mono text-stone-900 font-semibold sm:text-right max-w-full sm:max-w-[65%] break-words">
                            {formatted}
                          </span>
                        </div>
                      )
                    }
                    return (
                      <div key={key} className="py-2.5 flex flex-col sm:flex-row sm:justify-between sm:items-start text-sm gap-1 sm:gap-0">
                        <span className="font-khmer text-stone-500 font-medium">
                          {getFieldLabel(key, t)}
                          <span className="block font-sans font-normal text-[10px] text-stone-400 mt-0.5">{getFieldSublabel(key)}</span>
                        </span>
                        <span className="text-stone-900 font-semibold sm:text-right max-w-full sm:max-w-[65%] break-words">
                          {key === 'degree' || key === 'degree_type' ? formatDegreeTitle(String(value)) : String(value)}
                        </span>
                      </div>
                    )
                  })}
                  {parsedPresentation?.issuedAt && (
                    <div className="py-2.5 flex flex-col sm:flex-row sm:justify-between sm:items-start text-sm gap-1 sm:gap-0">
                      <span className="font-khmer text-stone-500 font-medium">
                        {t('wallet.issue_date_label')}
                        <span className="block font-sans font-normal text-[10px] text-stone-400 mt-0.5">Issue date</span>
                      </span>
                      <span className="font-mono text-stone-900 font-semibold sm:text-right">
                        {formatTimestamp(parsedPresentation.issuedAt)}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Hidden Fields Notice — leads with the count (per spec's
                  "N hidden by the credential holder"), field names + the
                  reassurance clause follow as a muted mono caption. */}
              {hiddenFields.length > 0 && (
                <div className="px-3.5 py-3 bg-stone-50 rounded-lg border border-stone-200/60 flex items-start gap-2.5">
                  <svg className="w-4 h-4 text-stone-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div>
                    <div className="font-khmer text-xs font-semibold text-stone-600">
                      {t('verify.hidden_count_label', { count: hiddenFields.length })}
                    </div>
                    <div className="font-mono text-[10.5px] text-stone-400 mt-1">
                      Hidden: {hiddenFields.map((f) => getFieldSublabel(f)).join(', ')} · selective disclosure does not weaken the signature
                    </div>
                  </div>
                </div>
              )}

              {/* Validity Section */}
              {share?.expires_at && (
                <div className="border-t border-stone-100 pt-4 flex flex-col gap-2">
                  <div className="flex items-center justify-between text-xs text-stone-500">
                    <span className="font-khmer font-medium">{t('verify.link_valid_until')}</span>
                    <span className="font-semibold text-stone-700">
                      {formatExpiryDate(share.expires_at)}
                    </span>
                  </div>
                  {isExpiringSoon(share.expires_at) && (
                    <div className="flex items-center gap-1.5 text-amber-700 bg-amber-50 border border-amber-200/60 rounded px-2.5 py-1 text-xs mt-0.5">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                        />
                      </svg>
                      {t('verify.link_expiring_soon')}
                    </div>
                  )}
                </div>
              )}

              {/* Collapsible Technical Details — labels stay English/mono, same as
                  the mockup's own choice for this section (ISSUER DID, SHARE
                  TOKEN, etc. are shown in caps mono regardless of language). */}
              <div className="border-t border-stone-100 pt-4 no-print">
                <button
                  type="button"
                  onClick={() => setDetailsExpanded(!detailsExpanded)}
                  className="w-full flex items-center justify-between text-xs font-semibold text-stone-400 hover:text-indigo-600 focus:outline-none transition-colors"
                >
                  <span className="font-khmer">{t('verify.technical_details_toggle')}</span>
                  <span>{detailsExpanded ? '▲' : '▼'}</span>
                </button>
                {detailsExpanded && (
                  <div className="mt-4 space-y-3 bg-stone-50 border border-stone-200/50 rounded-lg p-4 text-xs font-mono text-stone-600 animate-scale-in">
                    <div className="flex flex-col gap-1">
                      <span className="font-bold text-stone-400 text-[10px] uppercase">Issuer DID:</span>
                      <span className="break-all bg-white p-2 border border-stone-200/40 rounded text-[11px] font-medium shadow-inner">
                        {parsedPresentation?.issuerDID}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="font-bold text-stone-400 text-[10px] uppercase">Share Token:</span>
                      <span className="bg-white px-2 py-0.5 border border-stone-200/40 rounded text-stone-700 shadow-inner">
                        {token ? `${token.substring(0, 16)}...` : ''}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="font-bold text-stone-400 text-[10px] uppercase">Verified at:</span>
                      <span className="text-stone-700 font-medium">{new Date().toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="font-bold text-stone-400 text-[10px] uppercase">Format:</span>
                      <span className="bg-indigo-50 border border-indigo-100 text-indigo-700 text-[10px] px-1.5 py-0.5 rounded font-sans font-bold">
                        SD-JWT (dc+sd-jwt)
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="font-bold text-stone-400 text-[10px] uppercase">Algorithm:</span>
                      <span className="text-stone-700 font-medium">ES256</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 4. Failed Result State */}
          {!isTokenInvalid && status === 'failed' && (
            <div className="space-y-6">
              {/* Header Section */}
              <div className="text-center py-4 flex flex-col items-center">
                <div className={`w-12 h-12 rounded-full flex items-center justify-center mb-3 animate-scale-in ${
                  failureKind === 'unavailable'
                    ? 'bg-amber-50 border border-amber-200 text-amber-600'
                    : 'bg-rose-50 border border-rose-200 text-rose-500'
                }`}>
                  {failureKind === 'unavailable' ? (
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                    </svg>
                  ) : (
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  )}
                </div>
                <h2 className={`font-khmer text-xl font-bold ${failureKind === 'unavailable' ? 'text-amber-700' : 'text-rose-700'}`}>
                  {failureKind === 'unavailable'
                    ? t('verify.unavailable_title')
                    : failureKind === 'withdrawn'
                      ? t('verify.withdrawn_title')
                      : t('verify.failed_title')}
                </h2>
                {failureKind === 'withdrawn' && withdrawal && (
                  <p className="text-sm text-stone-700 mt-2 max-w-sm mx-auto leading-relaxed">
                    <span className="font-semibold">{t('verify.withdrawn_reason')}</span> {withdrawal.reason}
                    <span className="block text-xs text-stone-500 mt-0.5">
                      {longDate(withdrawal.revokedAt)}
                    </span>
                  </p>
                )}
                <p className="font-khmer text-sm text-stone-500 mt-1 font-medium max-w-sm mx-auto leading-relaxed">
                  {getFailureSubtext()}
                </p>
              </div>

              {/* Sequential check results list — stops at the failed step;
                  checks that never ran (still 'waiting') are omitted rather
                  than shown grayed out, since nothing meaningful happened to
                  them. */}
              <div className="mt-8 border border-rose-100 rounded-xl p-4 bg-rose-50/10 space-y-4">
                <h3 className="font-khmer text-xs font-bold text-stone-400 uppercase tracking-widest">
                  {t('verify.verification_steps_heading')}
                </h3>
                <div className="space-y-3.5">
                  {checks
                    .slice(0, checks.findIndex((c) => c.status === 'failed') + 1 || checks.length)
                    .map((check) => (
                    <div key={check.id} className="flex flex-col">
                      <div className="flex items-center gap-3">
                        {check.status === 'passed' && (
                          <div className="w-[18px] h-[18px] rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          </div>
                        )}
                        {check.status === 'failed' && (
                          <div className="w-[18px] h-[18px] rounded-full bg-rose-100 text-rose-600 flex items-center justify-center shrink-0">
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </div>
                        )}
                        {(check.status === 'waiting' || check.status === 'running') && (
                          <div className="w-[18px] h-[18px] rounded-full border border-stone-200 bg-stone-50 flex items-center justify-center shrink-0">
                            <div className="w-1.5 h-1.5 rounded-full bg-stone-300" />
                          </div>
                        )}
                        <span
                          className={`font-khmer text-sm font-medium ${
                            check.status === 'passed'
                              ? 'text-emerald-800'
                              : check.status === 'failed'
                              ? 'text-rose-600 font-semibold'
                              : 'text-stone-400'
                          }`}
                        >
                          {check.label}
                        </span>
                      </div>
                      {check.status === 'failed' && check.errorMessage && (
                        <p className="pl-[30px] pt-1 text-xs text-rose-500 font-semibold leading-relaxed">
                          {check.errorMessage}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Guidance / What to do */}
              {failedCheck && (
                <div className="p-4 bg-stone-50 rounded-xl border border-stone-200 text-stone-600 text-xs leading-relaxed">
                  <span className="font-khmer font-bold text-stone-700 block mb-1">{t('verify.what_to_do_label')}</span>
                  <p className="font-medium">{getGuidanceText()}</p>
                </div>
              )}
            </div>
          )}
        </div>

      </main>

      {/* Footer Trust Details */}
      {!isTokenInvalid && status !== 'loading' && (
        <footer className="mt-12 text-center space-y-6 pb-12 no-print border-t border-stone-200/60 pt-8">
          <div className="text-left max-w-lg mx-auto">
            <h4 className="font-khmer text-xs font-bold text-stone-400 uppercase tracking-widest text-center mb-6">
              {t('verify.footer_heading')}
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-xs text-stone-600 px-4">
              <div className="space-y-1 text-center">
                <div className="w-8 h-8 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto mb-2 border border-indigo-100/50 shadow-sm">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                    />
                  </svg>
                </div>
                <span className="font-khmer font-bold text-stone-800 block">{t('verify.trust_signature_title')}</span>
                <p className="text-stone-500 leading-normal">
                  {t('verify.trust_signature_desc')}
                </p>
              </div>
              <div className="space-y-1 text-center">
                <div className="w-8 h-8 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto mb-2 border border-indigo-100/50 shadow-sm">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                    />
                  </svg>
                </div>
                <span className="font-khmer font-bold text-stone-800 block">{t('verify.trust_registry_title')}</span>
                <p className="text-stone-500 leading-normal">
                  {t('verify.trust_registry_desc')}
                </p>
              </div>
              <div className="space-y-1 text-center">
                <div className="w-8 h-8 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto mb-2 border border-indigo-100/50 shadow-sm">
                  <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                    />
                  </svg>
                </div>
                <span className="font-khmer font-bold text-stone-800 block">{t('verify.trust_disclosure_title')}</span>
                <p className="text-stone-500 leading-normal">
                  {t('verify.trust_disclosure_desc')}
                </p>
              </div>
            </div>
          </div>
          <div className="space-y-1 text-xs text-stone-400">
            <p className="font-medium">{t('verify.powered_by')}</p>
            <a
              href="https://actik.app"
              target="_blank"
              rel="noopener noreferrer"
              className="text-indigo-500 hover:underline font-semibold"
            >
              {t('verify.learn_more')}
            </a>
          </div>
        </footer>
      )}
    </div>
  )
}
