// A museum exhibit, exported from the holder's wallet.
//
// CamboVerse's personal museum (camboverse docs/MUSEUM.md) hangs certificates
// in a room. ACTIK keeps what that design gives it to keep — the person's
// identity, the issued file, what may be published, verification and
// withdrawal — and hands CamboVerse a reference: the hash of the original
// file, an image the holder has deliberately prepared for showing, and, if the
// holder chooses, the institution's signed printed code.
//
// Built on the holder's device, because only the holder's device can read the
// credential: the vault is end-to-end encrypted. Nothing here touches the
// network.
//
// What the package does NOT carry, on purpose:
//   - the original file. Only its SHA-256 (MUSEUM.md rule 7). The original
//     stays in the holder's vault.
//   - a "verified" flag of any kind. `verification` is "self-asserted" in
//     phase 1 whatever ACTIK knows (rule 1); in phase 2 CamboVerse verifies the
//     printed code itself, on the viewer's device, and never takes this file's
//     word for it (rule 8).
//   - an account identity. Binding a room to an ACTIK person is decision D5,
//     still open; a field nobody can check would be read as if someone had.
//   - the document number or jti in a form a public list could be searched
//     by. `withdrawal.ids` are the same hashes ACTIK's withdrawal lists use,
//     so CamboVerse can take an exhibit down when the institution withdraws it
//     (rule 9) without learning anything it did not already have.

import { entryIdsForCredential } from './revocation'
import { readPrintedFields } from './printedCredential'

export const EXHIBIT_TYPE = 'actik/exhibit/1'

export type ExhibitVisibility = 'private' | 'link' | 'public'

export interface ExhibitPackage {
  type: typeof EXHIBIT_TYPE
  /** Unix seconds. */
  exportedAt: number
  exhibit: {
    /** 'work' for an employment record; 'certificate' for everything else issued. */
    kind: 'certificate' | 'work'
    title: string
    /** Never guessed (MUSEUM.md rule 10). */
    khmerTitle: null
    /** The institution as it signed its name on the credential. */
    issuerName: string
    issuerDid: string
    /** ISO date as the credential carries it, or null. */
    date: string | null
  }
  source: {
    /** The wallet's id for this credential: stable, meaningless outside ACTIK. */
    actikDocumentId: string
    /** Lowercase hex SHA-256 of the ORIGINAL issued file. A printed code's `dh` is its first 32 characters. */
    fileSha256: string | null
    fileType: string | null
    /** The image the holder prepared: cropped, covered, reduced, re-encoded. null when there is none (e.g. a PDF). */
    publicImage: string | null
    /** The most this holder allows. CamboVerse shows the stricter of this and the room's own (rule 3). */
    actikVisibility: ExhibitVisibility
  }
  verification: 'self-asserted'
  /** The institution's QRSeal Profile B code (KH1:…), included only if the holder chose to. */
  credential: string | null
  /** Entry hashes to look for in the issuer's published withdrawal list. */
  withdrawal: { issuer: string; ids: string[] } | null
}

export class ExportRefused extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ExportRefused'
  }
}

/** Bytes and media type of a data: URL. */
export function dataUrlBytes(dataUrl: string): { mime: string; bytes: Uint8Array } | null {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl)
  if (!m) return null
  const mime = m[1] ?? 'application/octet-stream'
  if (!m[2]) return { mime, bytes: new TextEncoder().encode(decodeURIComponent(m[3])) }
  const bin = atob(m[3])
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return { mime, bytes }
}

export async function sha256HexBytes(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.length)
  copy.set(bytes)
  const digest = await crypto.subtle.digest('SHA-256', copy.buffer)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Claims that, if the credential carries them, are probably printed on the
 * certificate too — so the holder is told to cover them before showing it.
 * The image itself is never read; this is a prompt, not a guarantee.
 */
const SENSITIVE_CLAIMS: Array<{ claim: string; label: string }> = [
  { claim: 'national_id', label: 'National ID number' },
  { claim: 'student_id', label: 'Student number' },
  { claim: 'date_of_birth', label: 'Date of birth' },
  { claim: 'birth_date', label: 'Date of birth' },
  { claim: 'place_of_birth', label: 'Place of birth' },
  { claim: 'gpa', label: 'Grades' },
  { claim: 'salary', label: 'Salary' },
]

export function sensitiveFieldsOnDocument(claims: Record<string, unknown>): string[] {
  const out: string[] = []
  for (const { claim, label } of SENSITIVE_CLAIMS) {
    const v = claims[claim]
    if (v !== undefined && v !== null && v !== '' && !out.includes(label)) out.push(label)
  }
  return out
}

export interface ExhibitInput {
  credentialId: string
  issuerDid: string
  /** The credential's own (signed) claims, as disclosed in the holder's vault. */
  claims: Record<string, unknown>
  credentialType?: string | null
  jti: string | null
  title: string
  /** The original issued file as the credential carries it (claims.photo), if any. */
  originalFile: string | null
  publicImage: string | null
  visibility: ExhibitVisibility
  printed: string | null
  includePrinted: boolean
  now: number
}

/** Assemble the package. Pure apart from hashing. */
export async function buildExhibitPackage(input: ExhibitInput): Promise<ExhibitPackage> {
  const asText = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null)
  // An identity check is about a person, not an achievement: never an exhibit.
  if (input.credentialType === 'identity_attestation') {
    throw new ExportRefused('An identity check is not something to exhibit. It stays in your wallet.')
  }

  let fileSha256: string | null = null
  let fileType: string | null = null
  if (input.originalFile) {
    const file = dataUrlBytes(input.originalFile)
    if (!file) throw new ExportRefused('The original file in this credential could not be read.')
    fileSha256 = await sha256HexBytes(file.bytes)
    fileType = file.mime
  }

  let credential: string | null = null
  if (input.includePrinted && input.printed) {
    const fields = await readPrintedFields(input.printed)
    if (!fields) throw new ExportRefused('The printed code in your wallet could not be read.')
    // The printed code and the file must be about the same document: a code
    // whose `dh` names another file would hang beside the wrong image.
    if (fields.documentHash && (!fileSha256 || fields.documentHash.toLowerCase() !== fileSha256.slice(0, 32))) {
      throw new ExportRefused('The printed code was signed for a different file than the one in your wallet.')
    }
    credential = input.printed
  }

  if (input.publicImage && !/^data:image\/jpeg;base64,/.test(input.publicImage)) {
    throw new ExportRefused('The public image must be the prepared (re-encoded) copy.')
  }

  const ids = await entryIdsForCredential(input.issuerDid, { jti: input.jti, claims: input.claims })

  return {
    type: EXHIBIT_TYPE,
    exportedAt: input.now,
    exhibit: {
      kind: input.credentialType === 'employment_record' ? 'work' : 'certificate',
      title: input.title,
      khmerTitle: null,
      issuerName: asText(input.claims.institution) ?? asText(input.claims.issuing_body) ?? '',
      issuerDid: input.issuerDid,
      date:
        asText(input.claims.graduation_date) ?? asText(input.claims.date_certified) ??
        asText(input.claims.employment_start) ??
        asText(input.claims.completion_date) ?? asText(input.claims.date_awarded) ??
        asText(input.claims.event_date) ?? asText(input.claims.date),
    },
    source: {
      actikDocumentId: input.credentialId,
      fileSha256,
      fileType,
      publicImage: input.publicImage,
      actikVisibility: input.visibility,
    },
    verification: 'self-asserted',
    credential,
    withdrawal: ids.length > 0 ? { issuer: input.issuerDid, ids } : null,
  }
}

/**
 * Prepare the image that may be shown: crop, burn in the covered areas,
 * reduce, and re-encode as JPEG. Re-encoding drops EXIF (location, device),
 * and burning the covers into the pixels means there is no layer to peel off.
 */
export async function preparePublicImage(
  source: string,
  options: {
    crop: { x: number; y: number; w: number; h: number } | null
    covers: Array<{ x: number; y: number; w: number; h: number }>
    maxSide?: number
    quality?: number
  }
): Promise<string> {
  const img = await loadImage(source)
  const crop = options.crop ?? { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight }
  const scale = Math.min(1, (options.maxSide ?? 1200) / Math.max(crop.w, crop.h))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(crop.w * scale))
  canvas.height = Math.max(1, Math.round(crop.h * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new ExportRefused('This browser cannot prepare images.')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#1c1917'
  for (const c of options.covers) {
    ctx.fillRect((c.x - crop.x) * scale, (c.y - crop.y) * scale, c.w * scale, c.h * scale)
  }
  return canvas.toDataURL('image/jpeg', options.quality ?? 0.8)
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new ExportRefused('The image could not be opened.'))
    img.src = src
  })
}
