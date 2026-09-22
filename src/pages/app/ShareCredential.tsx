import React, { useState, useEffect, useCallback } from 'react'
import { useNavigate, useParams, Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { QRCodeSVG } from 'qrcode.react'
import { useZkVault } from '../../vault/zk-vault'
import { readDisclosures, present } from '../../lib/sdjwt'
import { useLanguage } from '../../lib/i18n'
import { Lock, CheckCircle, Copy, ExternalLink, Mail, Download, Calendar, AlertTriangle, Clock, Check, Loader2, EyeOff } from 'lucide-react'
import VaultUnlockModal from '../../components/VaultUnlockModal'

// Note: The prompt expects: import { useVault } from '../../vault/zk-vault/useVault'
// But the actual file in this project exports useZkVault from '../../vault/zk-vault'

// Note: The prompt expects: import { createPresentation } from '../../lib/sdjwt'
// But the actual file in this project exports present from '../../lib/sdjwt'

interface Credential {
  id: string
  holder_id: string
  issuer_did: string
  institution_name: string
  degree_title: string
  sd_jwt: string
  claimed: boolean
  created_at: string
  cipher?: string
  iv?: string
}

interface ShareRecord {
  id: string
  owner?: string
  presentation: string
  issuer_did?: string
  revealed?: string[]
  expires_at: string
  created_at: string
}

type ExpiryOption = '1day' | '7days' | '30days' | '90days' | 'custom'

// Shared spin keyframe styles
const spinStyles = `
  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
`

export default function ShareCredential() {
  const { credentialId } = useParams<{ credentialId: string }>()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const step = searchParams.get('step') || 'sharing'
  const { unlockWithPin, unlockWithPasskey, decryptPayload, isUnlocked } = useZkVault()
  const { t } = useLanguage()

  // Session & Loading states
  const [currentUser, setCurrentUser] = useState<any | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<'not_found' | 'not_claimed' | 'error' | null>(null)
  const [pendingDecryptAfterUnlock, setPendingDecryptAfterUnlock] = useState(false)

  // Data states
  const [credential, setCredential] = useState<Credential | null>(null)
  const [decryptedSDJwt, setDecryptedSDJwt] = useState<string | null>(null)
  const [availableClaims, setAvailableClaims] = useState<Record<string, any>>({})


  // Unlock Modal states
  const [showUnlockModal, setShowUnlockModal] = useState(false)
  const [pinInput, setPinInput] = useState('')
  const [unlockError, setUnlockError] = useState<string | null>(null)
  const [isUnlocking, setIsUnlocking] = useState(false)
  const [unlockMethod, setUnlockMethod] = useState<'pin' | 'passkey' | 'biometric' | 'both' | null>(null)

  // Selection states (Step 2 & 3) — only the student's name is on by
  // default; everything else, including graduation year, starts off and is
  // an explicit opt-in per share.
  const [selectedFields, setSelectedFields] = useState<string[]>(['name'])
  const [expiryOption, setExpiryOption] = useState<ExpiryOption>('7days')
  const [customDate, setCustomDate] = useState('')
  const [recipientLabel, setRecipientLabel] = useState('')

  // Share action states
  const [isSharing, setIsSharing] = useState(false)
  const [shareError, setShareError] = useState<string | null>(null)
  const [createdShare, setCreatedShare] = useState<any | null>(null)
  const [copiedStates, setCopiedStates] = useState<Record<string, boolean>>({})


  // Quick date calculations
  const calculateExpiryDate = useCallback((): Date => {
    const now = new Date()
    if (expiryOption === '1day') return new Date(now.setDate(now.getDate() + 1))
    if (expiryOption === '7days') return new Date(now.setDate(now.getDate() + 7))
    if (expiryOption === '30days') return new Date(now.setDate(now.getDate() + 30))
    if (expiryOption === '90days') return new Date(now.setDate(now.getDate() + 90))
    if (expiryOption === 'custom' && customDate) return new Date(customDate)
    
    // Default 7 days
    return new Date(now.setDate(now.getDate() + 7))
  }, [expiryOption, customDate])

  const [liveExpiry, setLiveExpiry] = useState<Date>(new Date())

  useEffect(() => {
    setLiveExpiry(calculateExpiryDate())
  }, [calculateExpiryDate])

  // Fetch credential and past shares on mount
  const loadData = useCallback(async (user: any) => {
    if (!credentialId) return

    try {
      setLoading(true)
      setLoadError(null)

      // Query credential
      const { data: credData, error: credErr } = await supabase
        .from('credentials')
        .select('*')
        .eq('id', credentialId)
        .single()

      if (credErr || !credData) {
        setLoadError('not_found')
        setLoading(false)
        return
      }

      // Check owner mapping (holder_id or owner fallback)
      const ownerId = credData.holder_id || credData.owner
      if (ownerId !== user.id) {
        setLoadError('not_found')
        setLoading(false)
        return
      }

      // Check claimed mapping (claimed column or cipher/iv presence)
      const claimedVal = credData.claimed !== undefined ? credData.claimed : true
      if (!claimedVal) {
        setLoadError('not_claimed')
        setLoading(false)
        return
      }

      setCredential({
        id: credData.id,
        holder_id: ownerId,
        issuer_did: credData.issuer_did || 'did:web:...',
        institution_name: credData.institution_name || '',
        degree_title: credData.degree_title || credData.label || 'Certificate',
        sd_jwt: credData.sd_jwt || '',
        claimed: true,
        created_at: credData.created_at,
        cipher: credData.cipher,
        iv: credData.iv
      })



      setLoading(false)
    } catch {
      setLoadError('error')
      setLoading(false)
    }
  }, [credentialId])

  const fetchUnlockMethod = useCallback(async (userId: string) => {
    try {
      const { data: vaultData } = await supabase
        .from('vaults')
        .select('unlock_method')
        .eq('user_id', userId)
        .maybeSingle()

      if (vaultData && vaultData.unlock_method) {
        setUnlockMethod(vaultData.unlock_method as 'pin' | 'passkey' | 'both')
      } else {
        const { data: profileData } = await supabase
          .from('profiles')
          .select('vault_envelope_pin, vault_envelope_passkey')
          .eq('id', userId)
          .maybeSingle()
        
        if (profileData) {
          const hasPin = !!profileData.vault_envelope_pin
          const hasPasskey = !!profileData.vault_envelope_passkey
          if (hasPin && hasPasskey) {
            setUnlockMethod('both')
          } else if (hasPin) {
            setUnlockMethod('pin')
          } else if (hasPasskey) {
            setUnlockMethod('passkey')
          } else {
            setUnlockMethod(null)
          }
        } else {
          setUnlockMethod(null)
        }
      }
    } catch {
      setUnlockMethod(null)
    }
  }, [setUnlockMethod])

  useEffect(() => {
    let active = true
    async function init() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session || !session.user) {
        navigate('/auth/login', { replace: true })
        return
      }

      const { data: profileRow } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', session.user.id)
        .maybeSingle()

      if (active) {
        if (profileRow && profileRow.role === 'issuer') {
          navigate('/app/dashboard', { replace: true })
          return
        }
        setCurrentUser(session.user)
        loadData(session.user)
        fetchUnlockMethod(session.user.id)
      }
    }
    init()
    return () => { active = false }
  }, [navigate, loadData, fetchUnlockMethod])

  useEffect(() => {
    const handleVisibilityChange = () => {
      // Do nothing on visibility change — preserve all state
      // The vault session key is in a ref so it survives
      if (document.visibilityState === 'visible') {
        // If we were already unlocked and had decryptedSDJwt,
        // don't reset anything — just stay on current step
        return
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])

  useEffect(() => {
    if (decryptedSDJwt && (!searchParams.get('step') || searchParams.get('step') === 'locked')) {
      setSearchParams({ step: 'sharing' }, { replace: true })
    }
  }, [decryptedSDJwt, searchParams, setSearchParams])

  // --- VAULT UNLOCK & DECRYPTION FLOW ---
  const handleUnlockSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!currentUser || !credential) return

    try {
      setIsUnlocking(true)
      setUnlockError(null)

      const success = await unlockWithPin(pinInput, currentUser.id)
      if (success) {
        setShowUnlockModal(false)
        setIsUnlocking(false)
        setPendingDecryptAfterUnlock(true)
      } else {
        setUnlockError('Vault unlock failed. Please check your PIN.')
        setIsUnlocking(false)
      }
    } catch {
      setUnlockError('Unlock failed. Please try again.')
      setIsUnlocking(false)
    }
  }

  const handleUnlockWithPasskeyClick = async () => {
    if (!currentUser || !credential) return
    try {
      setIsUnlocking(true)
      setUnlockError(null)

      const success = await unlockWithPasskey(currentUser.id)
      if (success) {
        setShowUnlockModal(false)
        setIsUnlocking(false)
        setPendingDecryptAfterUnlock(true)
      } else {
        setUnlockError('Passkey authentication failed.')
        setIsUnlocking(false)
      }
    } catch {
      setUnlockError('Passkey failed.')
      setIsUnlocking(false)
    }
  }



  useEffect(() => {
    if (isUnlocked && pendingDecryptAfterUnlock && credential) {
      setPendingDecryptAfterUnlock(false)
      decryptCredential(credential)
    }
  }, [isUnlocked, pendingDecryptAfterUnlock, credential])

  const decryptCredential = async (cred: Credential) => {
    try {
      let sdjwtString = ''

      if (cred.cipher && cred.iv) {
        // Fallback schema.sql: Decrypt using cipher and iv
        const decrypted = await decryptPayload({ cipher: cred.cipher, iv: cred.iv }) as { sdjwt: string }
        sdjwtString = decrypted.sdjwt
      } else {
        // Prompt custom schema: Decrypt the parsed sd_jwt JSON string
        const parsedPayload = JSON.parse(cred.sd_jwt)
        const decrypted = await decryptPayload(parsedPayload) as { sdjwt: string }
        sdjwtString = decrypted.sdjwt
      }

      setDecryptedSDJwt(sdjwtString)

      // Decode disclosures to show claims
      const disclosures = readDisclosures(sdjwtString)
      const claims: Record<string, any> = {}
      disclosures.forEach(d => {
        claims[d.name] = d.value
      })

      // Try extraction fallback from headers if disclosures are salt-only
      try {
        const payload = JSON.parse(atob(sdjwtString.split('~')[0].split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
        const fieldsToExtract = ['name', 'year', 'gpa', 'national_id', 'notes', 'student_id', 'email', 'degree_type', 'degree', 'major', 'graduation_date', 'certificate_id', 'photo']
        fieldsToExtract.forEach(f => {
          if (claims[f] === undefined && payload[f] !== undefined) {
            claims[f] = payload[f]
          }
        })
      } catch {}

      // Pre-6502ec7 credentials disclose degree type under the legacy claim
      // name "degree" instead of "degree_type" (see CredentialDetail.tsx for
      // the full history — SD-JWT disclosures are fixed forever at signing
      // time, so old credentials keep the old name). Normalize once here so
      // the toggle UI, counters, and labels below only ever deal with
      // "degree_type" — the actual reveal still asks for "degree" too (see
      // revealNames in handleCreateShare) since that's the real disclosure
      // name on-token for those credentials.
      if (claims.degree_type === undefined && claims.degree !== undefined) {
        claims.degree_type = claims.degree
      }

      setAvailableClaims(claims)
      // Only the student's name defaults on, and only if it's actually
      // available to disclose — everything else (including GPA and National
      // ID, flagged Sensitive/Private below) is an explicit per-share opt-in,
      // never pre-checked just because the credential happens to carry it.
      const fieldsToSelect = ['name'].filter(f => claims[f] !== undefined && claims[f] !== '')
      setSelectedFields(fieldsToSelect)
    } catch {
      setUnlockError('Failed to decrypt credential. Your vault key may have changed.')
      setShowUnlockModal(true)
    }
  }

  // --- SELECTIVE DISCLOSURE SELECTION ---
  const toggleSelectableField = (field: string) => {
    if (selectedFields.includes(field)) {
      setSelectedFields(prev => prev.filter(f => f !== field))
    } else {
      setSelectedFields(prev => [...prev, field])
    }
  }

  // Toggles a group of field names together as one on/off unit (e.g. the
  // "degree type" toggle also needs to flip the legacy "degree" disclosure
  // name for pre-6502ec7 credentials). Checked state is "any of them
  // selected"; toggling off clears all of them, toggling on adds whichever
  // are missing — calling toggleSelectableField per-key in a loop would
  // desync when only some of the keys start selected.
  const toggleSelectableFields = (fields: string[]) => {
    const anySelected = fields.some(f => selectedFields.includes(f))
    setSelectedFields(prev =>
      anySelected
        ? prev.filter(f => !fields.includes(f))
        : [...prev, ...fields.filter(f => !prev.includes(f))]
    )
  }

  // Count fields
  // Always visible: Degree title (DB-column display name, not the SD-JWT
  // "degree_type"/"degree" claim), Institution, Issuer DID, Issue date (4
  // fields). Degree *type* and Major are genuine per-share opt-ins despite
  // sounding similar to "Degree title" — counted below like every other
  // selectable field.
  // Selectable: Name, Year, GPA, National ID, Notes, Email, Student ID,
  // Degree Type, Major, Graduation Date, Certificate ID, Photo
  const selectableKeys = ['name', 'year', 'gpa', 'national_id', 'notes', 'student_id', 'email', 'degree_type', 'major', 'graduation_date', 'certificate_id', 'photo']
  const totalFields = 4 + Object.keys(availableClaims).filter(k => selectableKeys.includes(k) && availableClaims[k] !== undefined && availableClaims[k] !== '').length
  // "degree" is excluded here even though it can end up in selectedFields —
  // it's the internal legacy alias toggleSelectableFields adds alongside
  // "degree_type" (see renderToggleField's aliasKey), not a distinct
  // user-facing field, so counting it too would double-count degree type
  // for credentials that actually carry the legacy claim name.
  const disclosedFieldsCount = 4 + selectedFields.filter(f => f !== 'degree' && availableClaims[f] !== undefined && availableClaims[f] !== '').length
  
  const hiddenFields = selectableKeys
    .filter(f => availableClaims[f] !== undefined && availableClaims[f] !== '' && !selectedFields.includes(f))
    .map(f => {
      if (f === 'name') return 'Full name'
      if (f === 'year') return 'Graduation year'
      if (f === 'gpa') return 'GPA'
      if (f === 'national_id') return 'National ID'
      if (f === 'notes') return 'Additional notes'
      if (f === 'email') return 'Email address'
      if (f === 'student_id') return 'Student ID'
      if (f === 'degree_type') return 'Degree type'
      if (f === 'major') return 'Major'
      if (f === 'graduation_date') return 'Graduation date'
      if (f === 'certificate_id') return 'Certificate ID'
      if (f === 'photo') return 'Student photo'
      return f
    })

  // --- GENERATE SHARE LINK FLOW ---
  const handleCreateShare = async () => {
    if (!decryptedSDJwt || !credential || !currentUser) return

    try {
      setIsSharing(true)
      setShareError(null)

      // Step A: Build the presentation.
      // Institution/iss/iat/exp are always visible in addition to selection
      // (they back the read-only "always shown" rows above). Degree *type*
      // and Major are NOT forced in here — they're real per-share opt-ins
      // now, so they only get revealed via ...selectedFields like every
      // other toggleable field. The one exception: if the student opted in
      // to degree_type, also reveal the legacy "degree" disclosure name,
      // since that's the actual on-token name for credentials issued before
      // 6502ec7 (present() filters by literal disclosure name, so it has no
      // way to know "degree" and "degree_type" mean the same thing).
      const revealNames = ['institution', 'iss', 'iat', 'exp', ...selectedFields,
        ...(selectedFields.includes('degree_type') ? ['degree'] : [])]
      const presentationStr = present(decryptedSDJwt, revealNames)

      // Step B: Generate UUID token
      const token = crypto.randomUUID()
      const expiry = calculateExpiryDate()

      // Step C: Save to Supabase
      const res = await supabase.from('shares').insert({
        id: token,
        owner: currentUser.id,
        credential_id: credential.id,
        presentation: presentationStr,
        issuer_did: credential.issuer_did || '',
        revealed: selectedFields,
        expires_at: expiry.toISOString(),
        created_at: new Date().toISOString(),
        recipient_label: recipientLabel.trim() || null
      })

      if (res.error) {
        console.error('[share] insert error:', res.error)
        throw res.error
      }

      const shareRecord: ShareRecord = {
        id: token,
        owner: currentUser.id,
        presentation: presentationStr,
        issuer_did: credential.issuer_did || '',
        revealed: selectedFields,
        expires_at: expiry.toISOString(),
        created_at: new Date().toISOString()
      }

      setCreatedShare(shareRecord)
      setIsSharing(false)
      setSearchParams({ step: 'success' })
    } catch (err: any) {
      setShareError(err.message || 'Failed to create share link. Please try again.')
      setIsSharing(false)
    }
  }

  // Copy helper
  const handleCopyText = (text: string, id: string) => {
    navigator.clipboard.writeText(text)
    setCopiedStates(prev => ({ ...prev, [id]: true }))
    setTimeout(() => {
      setCopiedStates(prev => ({ ...prev, [id]: false }))
    }, 2000)
  }

  // PNG QR Code Download helper
  const handleDownloadQR = () => {
    const svgEl = document.getElementById('qr-code-svg')
    if (!svgEl) return

    const svgXml = new XMLSerializer().serializeToString(svgEl)
    const svgBase64 = window.btoa(unescape(encodeURIComponent(svgXml)))
    const imgSource = `data:image/svg+xml;base64,${svgBase64}`

    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = 300
      canvas.height = 300
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, 300, 300)
        ctx.drawImage(img, 10, 10, 280, 280)
        const a = document.createElement('a')
        a.download = `credential-qr-${credentialId?.slice(0, 8)}.png`
        a.href = canvas.toDataURL('image/png')
        a.click()
      }
    }
    img.src = imgSource
  }


  // --- RENDER GATES ---

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <style>{spinStyles}</style>
        <div style={{
          width: 40,
          height: 40,
          border: '4px solid var(--forest-soft)',
          borderTop: '4px solid var(--forest)',
          borderRadius: '50%',
          animation: 'spin 1s linear infinite'
        }}></div>
        <p className="muted" style={{ marginTop: '1rem' }}>Loading credential...</p>
      </div>
    )
  }

  // Gate 1: Not Found
  if (loadError === 'not_found') {
    return (
      <div className="max-w-2xl mx-auto text-center" style={{ maxWidth: '36rem', margin: '3rem auto' }}>
        <div className="card" style={{ padding: '2.5rem 2rem' }}>
          <AlertTriangle size={40} style={{ marginBottom: '1rem', color: 'var(--danger)' }} />
          <h2 style={{ fontSize: '1.5rem', color: 'var(--danger)', marginTop: 0 }}>Credential not found</h2>
          <p className="muted" style={{ marginBottom: '2rem' }}>
            This credential does not exist or does not belong to your account.
          </p>
          <button className="primary" onClick={() => navigate('/app/wallet')}>
            Back to wallet
          </button>
        </div>
      </div>
    )
  }

  // Gate 2: Not Claimed
  if (loadError === 'not_claimed') {
    return (
      <div className="max-w-2xl mx-auto" style={{ maxWidth: '36rem', margin: '3rem auto' }}>
        <div className="card" style={{ padding: '2.5rem 2rem', borderLeft: '5px solid var(--gold)', backgroundColor: '#fdfbf7' }}>
          <h2 style={{ fontSize: '1.4rem', color: 'var(--gold)', marginTop: 0 }}>Credential not claimed yet</h2>
          <p className="muted" style={{ marginBottom: '2rem' }}>
            You need to claim this credential into your encrypted vault before you can selectively disclose and share its fields.
          </p>
          <button className="primary" onClick={() => navigate('/app/wallet')} style={{ backgroundColor: 'var(--gold)', border: 'none' }}>
            Go to wallet to claim
          </button>
        </div>
      </div>
    )
  }

  // Gate 3: Loading Error
  if (loadError === 'error') {
    return (
      <div className="max-w-2xl mx-auto text-center" style={{ maxWidth: '36rem', margin: '3rem auto' }}>
        <div className="card" style={{ padding: '2.5rem 2rem' }}>
          <h2 style={{ fontSize: '1.4rem', color: 'var(--danger)', marginTop: 0 }}>An error occurred</h2>
          <p className="muted" style={{ marginBottom: '2rem' }}>
            Failed to load credential information. Please check your network and try again.
          </p>
          <button className="primary" onClick={() => window.location.reload()}>
            Refresh Page
          </button>
        </div>
      </div>
    )
  }

  // Truncate DID
  const truncateDid = (did: string) => {
    if (did.length <= 30) return did
    return did.slice(0, 30) + '...'
  }

  // A field that's always disclosed (issuer DID, institution, degree, issue
  // date) — shown with a lock icon and "always shown" text instead of a
  // toggle, since there's nothing to toggle.
  const renderAlwaysShownField = (label: string, value: React.ReactNode) => (
    <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-stone-100 bg-stone-50/70 text-sm">
      <div className="flex items-center gap-2 min-w-0">
        <Lock size={13} className="text-stone-400 shrink-0" />
        <span className="font-semibold text-stone-700 shrink-0">{label}</span>
        <span className="text-stone-500 font-mono text-xs truncate">{value}</span>
      </div>
      <span className="text-stone-400 text-[11px] italic shrink-0">{t('wallet.always_shown')}</span>
    </div>
  )

  // A selectable field — real toggle switch driven by the same
  // selectedFields/toggleSelectableField state as before, just restyled.
  // opts.aliasKey toggles a second field name in lockstep with fieldKey —
  // used for degree_type, whose legacy disclosure name ("degree") needs to
  // move with it as one unit rather than being a separate row.
  const renderToggleField = (
    fieldKey: string,
    label: string,
    value: React.ReactNode,
    opts?: { mono?: boolean; badge?: { label: string; tone: 'warning' | 'danger' }; aliasKey?: string }
  ) => {
    const groupKeys = opts?.aliasKey ? [fieldKey, opts.aliasKey] : [fieldKey]
    const checked = groupKeys.some(k => selectedFields.includes(k))
    return (
      <div className={`flex items-center gap-3 px-4 py-3 border-b border-stone-100 last:border-b-0 text-sm ${checked ? '' : 'bg-stone-50'}`}>
        <button
          type="button"
          onClick={() => toggleSelectableFields(groupKeys)}
          aria-pressed={checked}
          aria-label={label}
          className={`w-9 h-5 rounded-full transition-colors relative shrink-0 cursor-pointer ${checked ? 'bg-indigo-600' : 'bg-stone-300'}`}
        >
          <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${checked ? 'translate-x-4' : 'translate-x-0'}`} />
        </button>
        <div className="min-w-0 flex-1">
          <span className={`font-semibold ${checked ? 'text-stone-800' : 'text-stone-500'}`}>{label}</span>
          {checked ? (
            <span className={`ml-2 text-stone-500 ${opts?.mono ? 'font-mono text-xs' : ''}`}>{value}</span>
          ) : (
            <span className="ml-2 text-stone-400 text-xs">{t('wallet.will_be_hidden')}</span>
          )}
        </div>
        {opts?.badge && (
          <span className={`shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full ${
            opts.badge.tone === 'danger' ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700'
          }`}>
            {opts.badge.label}
          </span>
        )}
        {!checked && <EyeOff size={15} className="text-stone-400 shrink-0" />}
      </div>
    )
  }

  const generatedShareUrl = createdShare ? `${window.location.origin}/verify/${createdShare.id}` : ''

  return (
    <div className="max-w-2xl mx-auto" style={{ maxWidth: '42rem', margin: '0 auto', fontFamily: 'inherit' }}>
      <style>{spinStyles}</style>

      {/* Back Link */}
      <Link to="/app/wallet" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.9rem', color: 'var(--muted)', textDecoration: 'none', marginBottom: '1.25rem' }}>
        ← {t('wallet.back_to_wallet')}
      </Link>

      {/* Heading */}
      <div style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '1.75rem', fontWeight: 600, color: 'var(--forest)', margin: '0 0 0.25rem' }}>{t('wallet.share_heading')}</h2>
        <p className="muted" style={{ margin: 0, fontSize: '0.95rem' }}>
          {t('wallet.share_subheading')}
        </p>
      </div>

      {/* =======================================================
          1. CREDENTIAL SUMMARY CARD
         ======================================================= */}
      {credential && (
        <div className="card" style={{ backgroundColor: 'var(--paper)', border: '1px solid var(--line)', padding: '1.25rem', marginBottom: '1.5rem' }}>
          <strong style={{ fontSize: '1.1rem', color: 'var(--ink)', display: 'block', marginBottom: '0.15rem' }}>
            {credential.degree_title}
          </strong>
          <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: '0.75rem' }}>
            {credential.institution_name}
          </span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.5rem', fontSize: '0.78rem', color: 'var(--muted)' }}>
            <div>
              <span>{t('wallet.issue_date')}: </span>
              <strong>{new Date(credential.created_at).toLocaleDateString()}</strong>
            </div>
            <div>
              <span>{t('wallet.issuer_did')}: </span>
              <code className="mono" style={{ color: 'var(--forest)' }}>
                {truncateDid(credential.issuer_did)}
              </code>
            </div>
          </div>
        </div>
      )}

      {/* =======================================================
          2. STEP 1: UNLOCK VAULT CARD
         ======================================================= */}
      {!decryptedSDJwt && (
        <div className="card text-center" style={{ padding: '2.5rem 1.5rem', background: '#fff' }}>
          <div style={{ color: '#4f46e5', fontSize: '2.5rem', marginBottom: '0.5rem' }}>
            <Lock size={36} style={{ margin: '0 auto' }} />
          </div>
          <h3 style={{ margin: '0 0 0.5rem', color: 'var(--forest)' }}>{t('wallet.unlock_vault_to_continue')}</h3>
          <p className="muted" style={{ fontSize: '0.85rem', marginBottom: '1.5rem', maxWidth: '320px', margin: '0.5rem auto 1.5rem' }}>
            {unlockMethod === 'passkey' || unlockMethod === 'biometric'
              ? t('wallet.unlock_vault_desc_passkey')
              : t('wallet.unlock_vault_desc_pin')}
          </p>
          <button 
            className="primary"
            onClick={async () => {
              if (unlockMethod === 'passkey' || unlockMethod === 'biometric') {
                // Skip modal — fire biometric directly
                if (!currentUser || !credential) return
                try {
                  setIsUnlocking(true)
                  setUnlockError(null)
                  const success = await unlockWithPasskey(currentUser.id)
                  if (success) {
                    setPendingDecryptAfterUnlock(true)
                  } else {
                    setUnlockError('Biometric authentication failed.')
                    setShowUnlockModal(true) // only show on failure
                  }
                } catch {
                  setUnlockError('Biometric failed. Try again.')
                  setShowUnlockModal(true) // only show on failure
                } finally {
                  setIsUnlocking(false)
                }
              } else {
                // PIN user → open modal as normal
                setShowUnlockModal(true)
              }
            }}
            disabled={isUnlocking}
            style={{ 
              display: 'block',
              width: '100%', 
              maxWidth: '240px', 
              margin: '0 auto',
              backgroundColor: '#4f46e5', 
              color: '#fff', 
              border: 'none', 
              borderRadius: '8px', 
              padding: '0.75rem 1rem', 
              cursor: isUnlocking ? 'not-allowed' : 'pointer',
              fontSize: '0.95rem',
              fontWeight: 600
            }}
          >
            {isUnlocking ? t('wallet.authenticating') : t('wallet.unlock_vault_btn')}
          </button>
        </div>
      )}

      {/* =======================================================
          3. MAIN SHARING INTERFACE (UNLOCKED)
         ======================================================= */}
      {decryptedSDJwt && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          
          {/* Progress Indicator */}
          <div className="w-full max-w-xl mx-auto mb-4 bg-stone-50 border border-stone-200/85 rounded-2xl p-4 shadow-sm text-left">
            <div className="relative flex items-center justify-between">
              <div className="absolute left-8 right-8 top-1/2 -translate-y-1/2 h-0.5 bg-stone-200" style={{ left: '2rem', right: '2rem' }} />
              <div
                className="absolute top-1/2 -translate-y-1/2 h-0.5 bg-indigo-500 transition-all duration-300"
                style={{ 
                  left: '2rem', 
                  width: step === 'success' ? 'calc(100% - 4rem)' : '0%'
                }}
              />

              {/* Step 1: Configure */}
              <div className="relative flex flex-col items-center gap-1 z-10">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all ${
                  step === 'success' 
                    ? 'bg-emerald-500 border-emerald-500 text-white' 
                    : 'bg-indigo-600 border-indigo-600 text-white'
                }`}>
                  {step === 'success' ? <Check size={16} /> : '1'}
                </div>
                <span className="text-[11px] font-bold tracking-tight text-indigo-650">
                  {t('wallet.step_configure')}
                </span>
              </div>

              {/* Step 2: Generate */}
              <div className="relative flex flex-col items-center gap-1 z-10">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all ${
                  step === 'success' 
                    ? 'bg-indigo-600 border-indigo-600 text-white' 
                    : 'bg-white border-stone-300 text-stone-400'
                }`}>
                  {step === 'success' ? <Check size={16} /> : '2'}
                </div>
                <span className={`text-[11px] font-bold tracking-tight ${
                  step === 'success' ? 'text-indigo-650' : 'text-stone-400'
                }`}>
                  {t('wallet.step_generate')}
                </span>
              </div>
            </div>
          </div>

          {/* Status Pill */}
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <span className="pill ok" style={{ backgroundColor: '#e2efe7', color: 'var(--ok)', fontWeight: 600, padding: '0.25rem 0.65rem', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
              <Check size={13} /> {t('wallet.vault_unlocked')}
            </span>
          </div>

          {/* STEP 2: CONFIGURE SHARE SETTINGS */}
          {step === 'sharing' && decryptedSDJwt && (
            <>
              {/* FIELD PICKER */}
              <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-5 md:p-6 text-left">
                <h3 className="font-khmer text-lg font-bold text-stone-900 mb-1">
                  {t('wallet.choose_what_to_share')}
                </h3>
                <p className="text-sm text-stone-500 mb-5 leading-relaxed">
                  {t('wallet.choose_what_to_share_desc')}
                </p>

                {/* Field Rows */}
                <div className="border border-stone-200 rounded-xl overflow-hidden">
                  {renderAlwaysShownField(t('wallet.issuer_did'), truncateDid(credential?.issuer_did || ''))}
                  {renderAlwaysShownField(t('wallet.institution_name'), credential?.institution_name)}
                  {renderAlwaysShownField(t('wallet.degree_title'), credential?.degree_title)}
                  {renderAlwaysShownField(t('wallet.issue_date'), credential && new Date(credential.created_at).toLocaleDateString())}

                  {availableClaims.name !== undefined && availableClaims.name !== '' &&
                    renderToggleField('name', t('wallet.student_name').replace(':', ''), availableClaims.name)}

                  {availableClaims.email !== undefined && availableClaims.email !== '' &&
                    renderToggleField('email', t('wallet.student_email').replace(':', ''), availableClaims.email, { mono: true })}

                  {availableClaims.student_id !== undefined && availableClaims.student_id !== '' &&
                    renderToggleField('student_id', t('wallet.student_id').replace(':', ''), availableClaims.student_id, { mono: true })}

                  {/* degree_type was normalized in decryptCredential from the
                      legacy "degree" disclosure name if that's what this
                      credential actually has — aliasKey keeps the toggle
                      revealing the right on-token name either way. */}
                  {availableClaims.degree_type !== undefined && availableClaims.degree_type !== '' &&
                    renderToggleField('degree_type', t('wallet.degree_type').replace(':', ''), availableClaims.degree_type, { aliasKey: 'degree' })}

                  {availableClaims.major !== undefined && availableClaims.major !== '' &&
                    renderToggleField('major', t('wallet.major').replace(':', ''), availableClaims.major)}

                  {availableClaims.year !== undefined && availableClaims.year !== '' &&
                    renderToggleField('year', t('wallet.field_year'), availableClaims.year)}

                  {availableClaims.graduation_date !== undefined && availableClaims.graduation_date !== '' &&
                    renderToggleField(
                      'graduation_date',
                      t('wallet.graduation_date').replace(':', ''),
                      new Date(availableClaims.graduation_date).toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' })
                    )}

                  {availableClaims.certificate_id !== undefined && availableClaims.certificate_id !== '' &&
                    renderToggleField('certificate_id', t('wallet.certificate_id').replace(':', ''), availableClaims.certificate_id, { mono: true })}

                  {/* Certificate Photo — its own row since it needs a thumbnail preview */}
                  {(availableClaims.photo || availableClaims.student_photo) && (() => {
                    const checked = selectedFields.includes('photo') || selectedFields.includes('student_photo')
                    const toggle = () => {
                      if (availableClaims.photo) toggleSelectableField('photo')
                      if (availableClaims.student_photo) toggleSelectableField('student_photo')
                    }
                    const val = availableClaims.photo || availableClaims.student_photo
                    return (
                      <div className={`flex items-center gap-3 px-4 py-3 border-b border-stone-100 last:border-b-0 text-sm ${checked ? '' : 'bg-stone-50'}`}>
                        <button
                          type="button"
                          onClick={toggle}
                          aria-pressed={checked}
                          aria-label="Certificate photo / scan"
                          className={`w-9 h-5 rounded-full transition-colors relative shrink-0 cursor-pointer ${checked ? 'bg-indigo-600' : 'bg-stone-300'}`}
                        >
                          <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${checked ? 'translate-x-4' : 'translate-x-0'}`} />
                        </button>
                        <div className="min-w-0 flex-1">
                          <div className={`font-semibold ${checked ? 'text-stone-800' : 'text-stone-500'}`}>Certificate photo / scan</div>
                          <div className="text-xs text-stone-500 mt-0.5">
                            {checked ? 'Share the actual certificate image with the employer' : t('wallet.will_be_hidden')}
                          </div>
                        </div>
                        <img
                          src={val.startsWith('data:') || val.startsWith('http') ? val : `data:image/jpeg;base64,${val}`}
                          alt="Certificate"
                          className={`w-12 h-12 object-cover rounded-md border border-stone-200 shrink-0 ${checked ? '' : 'opacity-40 grayscale'}`}
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                        />
                        {!checked && <EyeOff size={15} className="text-stone-400 shrink-0" />}
                      </div>
                    )
                  })()}

                  {availableClaims.gpa !== undefined && availableClaims.gpa !== '' &&
                    renderToggleField('gpa', t('wallet.field_gpa'), availableClaims.gpa, { badge: { label: t('wallet.sensitive'), tone: 'warning' } })}

                  {availableClaims.national_id !== undefined && availableClaims.national_id !== '' &&
                    renderToggleField('national_id', t('wallet.field_national_id'), availableClaims.national_id, { badge: { label: t('wallet.private'), tone: 'danger' } })}

                  {availableClaims.notes !== undefined && availableClaims.notes !== '' &&
                    renderToggleField('notes', t('wallet.field_notes'), availableClaims.notes)}
                </div>

                {/* LIVE FIELD PICKER SUMMARY */}
                <div className="flex justify-between mt-3 text-xs text-stone-500 gap-3">
                  <span>{t('wallet.sharing_fields').replace('{disclosed}', disclosedFieldsCount.toString()).replace('{total}', totalFields.toString())}</span>
                  {hiddenFields.length > 0 && (
                    <span className="text-right">{t('wallet.hidden_fields').replace('{fields}', hiddenFields.join(', '))}</span>
                  )}
                </div>
              </div>

              {/* STEP 3: SET EXPIRY */}
              <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-5 md:p-6 text-left">
                <h3 className="font-khmer text-lg font-bold text-stone-900 mb-1">
                  {t('wallet.who_is_this_for')}
                </h3>
                <div className="mb-6">
                  <input
                    type="text"
                    value={recipientLabel}
                    onChange={(e) => setRecipientLabel(e.target.value)}
                    placeholder={t('wallet.recipient_placeholder')}
                    className="w-full rounded-lg border border-stone-300 px-3 h-11 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>

                <h3 className="font-khmer text-lg font-bold text-stone-900 mb-1">
                  {t('wallet.how_long_active')}
                </h3>
                <p className="text-sm text-stone-500 mb-5">
                  {t('wallet.duration_desc')}
                </p>

                {/* Duration choices row */}
                <div className="grid grid-cols-5 gap-2 mb-5">
                  {['1day', '7days', '30days', '90days', 'custom'].map((opt) => {
                    const isSelected = expiryOption === opt
                    const labels: Record<string, string> = {
                      '1day': t('wallet.day_1'),
                      '7days': t('wallet.days_7'),
                      '30days': t('wallet.days_30'),
                      '90days': t('wallet.days_90'),
                      'custom': t('wallet.custom')
                    }
                    return (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => setExpiryOption(opt as ExpiryOption)}
                        className={`px-1 py-2 text-[13px] font-semibold rounded-lg text-center transition-colors cursor-pointer ${
                          isSelected
                            ? 'border-2 border-indigo-600 bg-indigo-50 text-indigo-650'
                            : 'border border-stone-200 bg-white text-stone-500 hover:border-stone-300'
                        }`}
                      >
                        {labels[opt]}
                      </button>
                    )
                  })}
                </div>

                {/* Custom Date Picker (when selected) */}
                {expiryOption === 'custom' && (
                  <div className="mb-4">
                    <label className="font-semibold text-stone-700 text-sm mb-1.5 block">
                      {t('wallet.choose_expiration_date')}
                    </label>
                    <div className="relative">
                      <input
                        type="date"
                        value={customDate}
                        min={new Date(new Date().setDate(new Date().getDate() + 1)).toISOString().split('T')[0]} // tomorrow
                        max={new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toISOString().split('T')[0]} // 1 year
                        onChange={(e) => setCustomDate(e.target.value)}
                        className="w-full rounded-lg border border-stone-300 pl-10 pr-3 h-11 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      />
                      <Calendar size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
                    </div>
                  </div>
                )}

                {/* Calculated expiry string */}
                <div className="text-sm text-stone-500 flex items-center gap-1.5 mb-5">
                  <Clock size={15} />
                  <span>
                    {t('wallet.link_expires_on')} <strong className="text-stone-800">{liveExpiry.toLocaleString()}</strong>
                  </span>
                </div>

                {/* Warning box */}
                <div className="flex gap-2.5 items-start px-4 py-3 bg-stone-50 border border-stone-200 rounded-lg text-xs text-stone-500 leading-relaxed">
                  <AlertTriangle size={16} className="text-amber-500 shrink-0 mt-0.5" />
                  <p className="m-0">
                    {t('wallet.expiry_warning')}
                  </p>
                </div>
              </div>

              {/* SUBMIT BUTTON */}
              {shareError && (
                <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg px-4 py-2.5 font-medium">
                  {shareError}
                </div>
              )}

              <button
                type="button"
                onClick={handleCreateShare}
                disabled={isSharing || selectedFields.length === 0}
                className="w-full h-12 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2 mb-4 transition-colors disabled:cursor-not-allowed disabled:bg-stone-300 bg-indigo-600 hover:bg-indigo-700 cursor-pointer"
              >
                {isSharing && <Loader2 size={16} className="animate-spin" />}
                <span>{t('wallet.create_share_link')}</span>
              </button>
            </>
          )}

          {/* STEP 3: SUCCESS SHARE LINK */}
          {step === 'success' && createdShare && (
            <div className="card" style={{ borderLeft: '4px solid #10b981', padding: '1.5rem', background: '#fff', display: 'flex', flexDirection: 'column', gap: '1.25rem', textAlign: 'left' }}>
              
              {/* Title Header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <CheckCircle size={20} style={{ color: '#10b981' }} />
                <h3 style={{ margin: 0, color: '#10b981', fontSize: '1.1rem', fontWeight: 600 }}>
                  {t('wallet.share_link_created')}
                </h3>
              </div>

              {/* Share URL text box with buttons */}
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <code 
                  className="mono" 
                  style={{ 
                    flex: 1, 
                    minWidth: '220px', 
                    padding: '0.6rem 0.8rem', 
                    backgroundColor: 'var(--paper)', 
                    border: '1px solid var(--line)', 
                    borderRadius: '6px',
                    fontSize: '0.8rem',
                    display: 'flex',
                    alignItems: 'center',
                    wordBreak: 'break-all'
                  }}
                >
                  {generatedShareUrl}
                </code>
                
                <div style={{ display: 'flex', gap: '0.4rem' }}>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => handleCopyText(generatedShareUrl, 'main')}
                    style={{ padding: '0.5rem 0.75rem', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.3rem', margin: 0 }}
                  >
                    <Copy size={14} />
                    <span>{copiedStates['main'] ? t('wallet.copied') : t('wallet.copy_link')}</span>
                  </button>

                  <a
                    href={generatedShareUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ghost"
                    style={{ padding: '0.5rem 0.75rem', fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center', gap: '0.3rem', textDecoration: 'none', border: '1px solid var(--line)', borderRadius: '8px', color: 'var(--ink)' }}
                  >
                    <ExternalLink size={14} />
                    <span>{t('wallet.open')}</span>
                  </a>
                </div>
              </div>

              {/* QR Code Container */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '1rem', border: '1px solid var(--line)', borderRadius: '8px', backgroundColor: '#fff', maxWidth: '240px', margin: '0 auto' }}>
                <QRCodeSVG 
                  value={generatedShareUrl} 
                  size={180} 
                  id="qr-code-svg" 
                  style={{ display: 'block' }}
                />
              </div>

              {/* QR / Share Options Row */}
              <div style={{ display: 'flex', justifyContent: 'center', gap: '0.75rem' }}>
                <button
                  type="button"
                  className="ghost"
                  onClick={handleDownloadQR}
                  style={{ padding: '0.45rem 0.85rem', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.4rem', margin: 0 }}
                >
                  <Download size={14} />
                  <span>{t('wallet.download_qr_png')}</span>
                </button>

                <a
                  href={`mailto:?subject=${encodeURIComponent('My Actik credential')}&body=${encodeURIComponent(`Here is the verify link to my Actik digital credential: ${generatedShareUrl}`)}`}
                  className="ghost"
                  style={{ padding: '0.45rem 0.85rem', fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center', gap: '0.4rem', textDecoration: 'none', border: '1px solid var(--line)', borderRadius: '8px', color: 'var(--ink)' }}
                >
                  <Mail size={14} />
                  <span>{t('wallet.email_employer')}</span>
                </a>
              </div>

              {/* Share Summary block */}
              <div style={{ backgroundColor: 'var(--paper)', borderRadius: '8px', padding: '1rem', border: '1px solid var(--line)', fontSize: '0.8rem', lineHeight: '1.4' }}>
                <div style={{ margin: '0 0 0.4rem' }}>
                  <span className="muted">{t('wallet.disclosed_fields')} </span>
                  <strong>{['Issuer DID', 'Institution', 'Degree title', 'Issue date', ...selectedFields
                    // "degree" is the internal legacy alias toggled together
                    // with "degree_type" (see renderToggleField's aliasKey)
                    // — drop it here so it doesn't show up as a second,
                    // unlabeled "degree" entry alongside "Degree type".
                    .filter(f => f !== 'degree')
                    .map(f => {
                    if (f === 'name') return 'Full name'
                    if (f === 'year') return 'Graduation year'
                    if (f === 'gpa') return 'GPA'
                    if (f === 'national_id') return 'National ID'
                    if (f === 'notes') return 'Additional notes'
                    if (f === 'email') return 'Email address'
                    if (f === 'student_id') return 'Student ID'
                    if (f === 'degree_type') return 'Degree type'
                    if (f === 'major') return 'Major'
                    if (f === 'graduation_date') return 'Graduation date'
                    if (f === 'certificate_id') return 'Certificate ID'
                    if (f === 'photo') return 'Student photo'
                    return f
                  })].join(', ')}</strong>
                </div>
                {hiddenFields.length > 0 && (
                  <div style={{ margin: '0 0 0.4rem' }}>
                    <span className="muted">Hidden fields: </span>
                    <strong style={{ color: 'var(--danger)' }}>{hiddenFields.join(', ')}</strong>
                  </div>
                )}
                <div style={{ margin: '0 0 0.4rem' }}>
                  <span className="muted">{t('wallet.expires')} </span>
                  <strong>{liveExpiry.toLocaleString()}</strong>
                </div>
                <div>
                  <span className="muted">{t('wallet.token')} </span>
                  <code className="mono">{createdShare.id.slice(0, 8)}...</code>
                </div>
              </div>

              {/* Final Warning banner */}
              <p className="muted" style={{ margin: 0, fontSize: '0.72rem', textAlign: 'center', color: 'var(--danger)' }}>
                {t('wallet.share_warning')}
              </p>

            </div>
          )}

          {/* STEP 3: FALLBACK WHEN ACCESSED DIRECTLY */}
          {step === 'success' && !createdShare && (
            <div className="card text-center" style={{ padding: '2.5rem 1.5rem', background: '#fff' }}>
              <p className="muted" style={{ marginBottom: '1.5rem', fontSize: '0.85rem' }}>
                {t('wallet.no_active_share_link')}
              </p>
              <button 
                className="primary" 
                onClick={() => setSearchParams({ step: 'sharing' })}
                style={{ backgroundColor: '#4f46e5', border: 'none', borderRadius: '8px', padding: '0.6rem 1rem', color: '#fff', cursor: 'pointer', fontSize: '0.9rem', fontWeight: 600 }}
              >
                {t('wallet.go_to_configure_step')}
              </button>
            </div>
          )}

        </div>
      )}

      {/* =======================================================
          5. PAST SHARE LINKS (Redirect)
         ======================================================= */}
      {decryptedSDJwt && (step === 'sharing' || step === 'success') && (
        <div style={{ marginTop: '2.5rem', borderTop: '1px solid var(--line)', paddingTop: '1.5rem', textAlign: 'center' }}>
          <p className="muted" style={{ fontSize: '0.9rem' }}>
            {t('wallet.view_past_share_links')}<Link to="/app/activity" style={{ fontWeight: 600, color: 'var(--forest)' }}>{t('wallet.activity')}</Link>.
          </p>
        </div>
      )}

      {/* MODAL: UNLOCK VAULT DIALOG */}
      {showUnlockModal && (
        <VaultUnlockModal
          unlockMethod={unlockMethod}
          pinInput={pinInput}
          onPinChange={setPinInput}
          onSubmitPin={handleUnlockSubmit}
          onPasskeyClick={handleUnlockWithPasskeyClick}
          isUnlocking={isUnlocking}
          unlockError={unlockError}
          onCancel={() => { setShowUnlockModal(false); setPinInput(''); setUnlockError(null) }}
          desc={t('wallet.unlock_vault_modal_desc')}
        />
      )}
    </div>
  )
}
