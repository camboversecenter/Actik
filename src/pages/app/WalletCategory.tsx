import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useZkVault } from '../../vault/zk-vault'
import { useLanguage } from '../../lib/i18n'
import CredentialCard from '../../components/CredentialCard'
import VaultUnlockModal from '../../components/VaultUnlockModal'
import { readDisclosures } from '../../lib/sdjwt'

// Best-effort decrypted fallback for credentials claimed before institution_name
// (and friends) were threaded through at issuance/claim time — see Wallet.tsx.
// No degree_type here: it's the exact same string as the card's title
// (degree_title/label below), not a distinct field.
interface DecryptedPreview {
  institution_name?: string
  major?: string
  issuer_did?: string
}

function parseJwtPayload(jwt: string): any {
  try {
    const base64 = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(atob(base64))
  } catch {
    return {}
  }
}

// Reusing same Credential interface from Wallet.tsx
interface Credential {
  id: string
  issuer_id: string
  holder_id: string | null
  holder_email: string
  issuer_did: string
  institution_name: string
  degree_title: string
  sd_jwt: string
  claimed: boolean
  claimed_at: string | null
  created_at: string
  graduation_date?: string | null
  credential_type?: string
  major?: string | null

  cipher?: string
  iv?: string
}

export default function WalletCategory() {
  const navigate = useNavigate()
  const { credentialType } = useParams<{ credentialType: string }>()
  
  const [currentUser, setCurrentUser] = useState<any | null>(null)
  const [credentials, setCredentials] = useState<Credential[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  // credential_id -> number of shares created for it (best-effort, see Wallet.tsx)
  const [shareCounts, setShareCounts] = useState<Record<string, number>>({})

  // Modals & Action States
  
  // Vault state
  const { isUnlocked, unlockWithPin, unlockWithPasskey, checkVaultStatus, decryptPayload } = useZkVault()
  const { t } = useLanguage()
  const [decryptedPreviews, setDecryptedPreviews] = useState<Record<string, DecryptedPreview>>({})
  const [vaultExists, setVaultExists] = useState<boolean | null>(null)
  const [unlockMethod, setUnlockMethod] = useState<'pin' | 'passkey' | 'biometric' | 'both' | null>(null)
  
  const [showUnlockModal, setShowUnlockModal] = useState(false)
  const [pinInput, setPinInput] = useState('')
  const [unlockError, setUnlockError] = useState<string | null>(null)
  const [isUnlocking, setIsUnlocking] = useState(false)

  const [pendingNavCredId, setPendingNavCredId] = useState<string | null>(null)


  // Type label formatting
  const typeLabels: Record<string, string> = {
    'academic_degree': t('wallet.category_academic_degree')
  };
  const isOther = !credentialType || credentialType === 'other'
  const displayLabel = isOther ? t('wallet.category_other') : (typeLabels[credentialType] || t('wallet.category_other'));

  // Check vault configuration on mount
  const checkVault = useCallback(async (userId: string) => {
    try {
      const status = await checkVaultStatus(userId)
      if (status.status === 'ok') {
        setVaultExists(status.exists)
      } else {
        setVaultExists(false)
      }

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
      setVaultExists(false)
      setUnlockMethod(null)
    }
  }, [checkVaultStatus])

  // Fetch claimed credentials filtered by type
  const loadCredentials = useCallback(async (user: any) => {
    try {
      setLoading(true)
      setLoadError(false)

      let query = supabase
        .from('credentials')
        .select('*')
        .eq('owner', user.id)
        .order('created_at', { ascending: false })
      
      if (isOther) {
        query = query.is('credential_type', null)
      } else {
        query = query.eq('credential_type', credentialType)
      }

      const claimedRes = await query;

      if (claimedRes.error) throw claimedRes.error

      const claimedList: Credential[] = (claimedRes.data || []).map((c: any) => ({
        id: c.id,
        issuer_id: c.issuer_id || '',
        holder_id: c.owner,
        holder_email: c.holder_email || user.email,
        issuer_did: c.issuer_did || '',
        institution_name: c.institution_name || '',
        degree_title: c.degree_title || c.label || 'Degree Certificate',
        sd_jwt: c.sd_jwt || '',
        claimed: c.claimed ?? true,
        claimed_at: c.claimed_at || c.created_at,
        created_at: c.created_at,
        graduation_date: c.graduation_date || null,
        credential_type: c.credential_type || null,
        major: c.major || null,
        cipher: c.cipher,
        iv: c.iv
      }))

      setCredentials(claimedList)
      setLoading(false)

      if (claimedList.length > 0) {
        try {
          const { data: shareRows } = await supabase
            .from('shares')
            .select('credential_id')
            .eq('owner', user.id)
            .in('credential_id', claimedList.map(c => c.id))

          const counts: Record<string, number> = {}
          ;(shareRows || []).forEach((r: any) => {
            if (!r.credential_id) return
            counts[r.credential_id] = (counts[r.credential_id] || 0) + 1
          })
          setShareCounts(counts)
        } catch {
          // non-fatal — cards just render without a share count
        }
      }
    } catch (err) {
      setLoadError(true)
      setLoading(false)
    }
  }, [credentialType, isOther])

  // Once the vault is unlocked, decrypt whatever credentials are still
  // missing institution_name and fill in the real values from inside the
  // credential itself (mirrors Wallet.tsx). Best-effort per credential.
  useEffect(() => {
    if (!isUnlocked) return
    const toDecrypt = credentials.filter(
      (c) => !c.institution_name && !decryptedPreviews[c.id] && (c.cipher || c.sd_jwt)
    )
    if (toDecrypt.length === 0) return

    let active = true
    ;(async () => {
      const results: Record<string, DecryptedPreview> = {}
      for (const cred of toDecrypt) {
        try {
          let sdjwtString: string
          if (cred.cipher && cred.iv) {
            const decrypted = await decryptPayload({ cipher: cred.cipher, iv: cred.iv }) as { sdjwt: string }
            sdjwtString = decrypted.sdjwt
          } else {
            const parsedPayload = JSON.parse(cred.sd_jwt)
            const decrypted = await decryptPayload(parsedPayload) as { sdjwt: string }
            sdjwtString = decrypted.sdjwt
          }

          const claims: Record<string, any> = {}
          readDisclosures(sdjwtString).forEach((d) => { claims[d.name] = d.value })
          const payload = parseJwtPayload(sdjwtString.split('~')[0])

          results[cred.id] = {
            institution_name: claims.institution || undefined,
            major: claims.major || undefined,
            issuer_did: payload.iss || undefined,
          }
        } catch {
          // non-fatal — this card just keeps showing whatever it already had
        }
      }
      if (active && Object.keys(results).length > 0) {
        setDecryptedPreviews((prev) => ({ ...prev, ...results }))
      }
    })()

    return () => { active = false }
  }, [isUnlocked, credentials, decryptPayload, decryptedPreviews])

  // Mount logic
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
        checkVault(session.user.id)
        loadCredentials(session.user)
      }
    }
    init()
    return () => { active = false }
  }, [navigate, checkVault, loadCredentials])

  // Decryption & Unlock handlers
  const triggerUnlockForNavigation = async (credId: string) => {
    setPendingNavCredId(credId)
    setPinInput('')
    setUnlockError(null)

    if (unlockMethod === 'passkey' || unlockMethod === 'biometric') {
      try {
        setIsUnlocking(true)
        const success = await unlockWithPasskey(currentUser!.id)
        if (!success) {
          setUnlockError('Biometric authentication failed. Try again.')
          setShowUnlockModal(true)
        }
      } catch {
        setUnlockError('Biometric failed. Try again.')
        setShowUnlockModal(true)
      } finally {
        setIsUnlocking(false)
      }
    } else {
      setShowUnlockModal(true)
    }
  }

  const handleUnlockSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!currentUser) return
    try {
      setIsUnlocking(true)
      setUnlockError(null)
      const success = await unlockWithPin(pinInput, currentUser.id)
      if (success) {
        setShowUnlockModal(false)
      } else {
        setUnlockError('Vault unlock failed. Please check your PIN.')
      }
    } catch {
      setUnlockError('Unlock encountered an error. Please try again.')
    } finally {
      setIsUnlocking(false)
    }
  }

  const handleUnlockWithPasskeyClick = async () => {
    if (!currentUser) return
    try {
      setIsUnlocking(true)
      setUnlockError(null)
      const success = await unlockWithPasskey(currentUser.id)
      if (success) {
        setShowUnlockModal(false)
      } else {
        setUnlockError('Passkey authentication failed.')
      }
    } catch {
      setUnlockError('Passkey encounter error.')
    } finally {
      setIsUnlocking(false)
    }
  }

  const handleViewDetailsClick = (credId: string) => {
    if (isUnlocked) {
      navigate(`/app/credential/${credId}`)
    } else {
      triggerUnlockForNavigation(credId)
    }
  }

  useEffect(() => {
    if (isUnlocked && pendingNavCredId) {
      navigate(`/app/credential/${pendingNavCredId}`)
      setPendingNavCredId(null)
    }
  }, [isUnlocked, pendingNavCredId, navigate])

  return (
    <div className="w-full md:max-w-4xl mx-auto px-4 md:px-0 pb-24">
      {/* Header with back button */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex flex-col gap-2">
          <Link to="/app/wallet" className="inline-flex items-center gap-1 text-sm font-semibold text-gray-500 hover:text-indigo-600 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            {t('wallet.back_to_wallet')}
          </Link>
          <h2 className="text-2xl font-bold text-stone-900 tracking-tight">
            {displayLabel}
          </h2>
        </div>
        <div>
          {vaultExists === true && !isUnlocked && (
            <span className="w-full sm:w-auto text-center px-4 py-2.5 bg-gray-100 border border-gray-200 text-gray-700 text-sm font-semibold rounded-lg">
              {t('wallet.vault_locked')}
            </span>
          )}
          {vaultExists === true && isUnlocked && (
            <span className="w-full sm:w-auto text-center px-4 py-2.5 bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm font-semibold rounded-lg">
              {t('wallet.vault_unlocked')}
            </span>
          )}
        </div>
      </div>

      {loading && credentials.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20">
          <div className="animate-spin rounded-full h-10 w-10 border-4 border-indigo-200 border-t-indigo-600" />
          <p className="text-stone-500 mt-4 font-medium">{t('wallet.loading')}</p>
        </div>
      )}

      {!loading && !loadError && (
        <div>
          {credentials.length === 0 ? (
            <div className="bg-white border border-gray-200 shadow-sm rounded-xl p-8 md:p-12 text-center">
              <h3 className="text-lg font-bold text-stone-900">{t('wallet.no_credentials_found')}</h3>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {credentials.map((c) => {
                const preview = decryptedPreviews[c.id]
                return (
                  <CredentialCard
                    key={c.id}
                    degreeTitle={c.degree_title}
                    institutionName={c.institution_name || preview?.institution_name}
                    issuerDid={c.issuer_did || preview?.issuer_did}
                    graduationDate={c.graduation_date}
                    createdAt={c.created_at}
                    onClick={() => handleViewDetailsClick(c.id)}
                    shareCount={shareCounts[c.id]}
                    major={c.major || preview?.major}
                  />
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* UNLOCK MODAL */}
      {showUnlockModal && (
        <VaultUnlockModal
          unlockMethod={unlockMethod}
          pinInput={pinInput}
          onPinChange={setPinInput}
          onSubmitPin={handleUnlockSubmit}
          onPasskeyClick={handleUnlockWithPasskeyClick}
          isUnlocking={isUnlocking}
          unlockError={unlockError}
          onCancel={() => setShowUnlockModal(false)}
        />
      )}

    </div>
  )
}
