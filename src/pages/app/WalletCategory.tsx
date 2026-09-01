import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useZkVault } from '../../vault/zk-vault'
import { useLanguage } from '../../lib/i18n'
import CredentialCard from '../../components/CredentialCard'
import PinDotsInput from '../../components/PinDotsInput'

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

  cipher?: string
  iv?: string
}

// Shared keyframe spinner animation
const spinStyles = `
  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
`


export default function WalletCategory() {
  const navigate = useNavigate()
  const { credentialType } = useParams<{ credentialType: string }>()
  
  const [currentUser, setCurrentUser] = useState<any | null>(null)
  const [credentials, setCredentials] = useState<Credential[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

  // Modals & Action States
  
  // Vault state
  const { isUnlocked, unlockWithPin, unlockWithPasskey, checkVaultStatus } = useZkVault()
  const { t } = useLanguage()
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
        cipher: c.cipher,
        iv: c.iv
      }))

      setCredentials(claimedList)
      setLoading(false)
    } catch (err) {
      setLoadError(true)
      setLoading(false)
    }
  }, [credentialType, isOther])

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
      <style>{spinStyles}</style>

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
              {credentials.map((c) => (
                <CredentialCard
                  key={c.id}
                  degreeTitle={c.degree_title}
                  institutionName={c.institution_name}
                  issuerDid={c.issuer_did}
                  graduationDate={c.graduation_date}
                  createdAt={c.created_at}
                  onClick={() => handleViewDetailsClick(c.id)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* UNLOCK MODAL */}
      {showUnlockModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[100] p-4">
          <div className="bg-white rounded-2xl shadow-lg p-6 md:p-8 w-full max-w-sm flex flex-col animate-scale-in">
            <div className="text-center mb-4">
              <div className="text-4xl mb-2">🔒</div>
              <h3 className="text-lg font-bold text-stone-900">{t('wallet.unlock_vault_title')}</h3>
            </div>
            {/* Logic based on unlock method */}
            {(unlockMethod === 'pin' || unlockMethod === 'both' || !unlockMethod) && (
              <form onSubmit={handleUnlockSubmit} className="flex flex-col gap-3">
                <PinDotsInput
                  value={pinInput}
                  onChange={setPinInput}
                  name="vault-pin"
                  autoComplete="current-password"
                  autoFocus
                  required
                />
                {unlockError && <p className="text-rose-600 text-xs text-center font-semibold">{unlockError}</p>}
                <button type="submit" disabled={isUnlocking} className="w-full bg-indigo-600 text-white font-semibold h-11 rounded-lg">
                  {isUnlocking ? t('wallet.unlocking') : t('wallet.unlock_with_pin')}
                </button>
                {(unlockMethod === 'both' || !unlockMethod) && (
                  <button type="button" onClick={handleUnlockWithPasskeyClick} className="w-full border border-gray-300 text-gray-700 font-semibold h-11 rounded-lg">
                    {t('wallet.unlock_with_passkey')}
                  </button>
                )}
                <button type="button" onClick={() => setShowUnlockModal(false)} className="w-full text-gray-500 font-semibold h-11 rounded-lg">
                  {t('wallet.cancel')}
                </button>
              </form>
            )}
            {(unlockMethod === 'passkey' || unlockMethod === 'biometric') && (
              <div className="flex flex-col gap-3 items-center text-center">
                {unlockError && <p className="text-rose-600 text-xs text-center font-semibold">{unlockError}</p>}
                <button type="button" onClick={handleUnlockWithPasskeyClick} disabled={isUnlocking} className="w-full bg-indigo-600 text-white font-semibold h-11 rounded-lg">
                  {isUnlocking ? t('wallet.unlocking') : t('wallet.unlock_with_passkey')}
                </button>
                <button type="button" onClick={() => setShowUnlockModal(false)} className="w-full text-gray-400 font-semibold h-11 rounded-lg">
                  {t('wallet.cancel')}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  )
}
