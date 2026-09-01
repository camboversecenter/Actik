import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'


import { useZkVault } from '../../vault/zk-vault'
import { useLanguage } from '../../lib/i18n'
import CredentialCard from '../../components/CredentialCard'
import PinDotsInput from '../../components/PinDotsInput'



// Shared keyframe spinner animation
const spinStyles = `
  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
`

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

  // Decryption fallbacks for original schema.sql
  cipher?: string
  iv?: string
}

export default function Wallet() {
  const navigate = useNavigate()
  const [currentUser, setCurrentUser] = useState<any | null>(null)
  
  // ZK-Vault state via the custom useZkVault hook
  const { 
    isUnlocked, 
    checkVaultStatus, 
    unlockWithPin, 
    unlockWithPasskey 
  } = useZkVault()
  const { t } = useLanguage()

  // Vault setup state
  const [vaultExists, setVaultExists] = useState<boolean | null>(null)
  const [vaultStatusLoading, setVaultStatusLoading] = useState(true)
  const [unlockMethod, setUnlockMethod] = useState<'pin' | 'passkey' | 'biometric' | 'both' | null>(null)

  // Credentials State
  const [claimedCredentials, setClaimedCredentials] = useState<Credential[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<boolean>(false)

  // Modals & Action States
  const [showUnlockModal, setShowUnlockModal] = useState(false)
  const [pinInput, setPinInput] = useState('')
  const [unlockError, setUnlockError] = useState<string | null>(null)
  const [isUnlocking, setIsUnlocking] = useState(false)
  const [showSetupNeededModal, setShowSetupNeededModal] = useState(false)

  // Navigation unlock state
  const [pendingNavCredId, setPendingNavCredId] = useState<string | null>(null)



  // Check vault configuration on mount & session changes
  const checkVault = useCallback(async (userId: string) => {
    try {
      setVaultStatusLoading(true)
      const status = await checkVaultStatus(userId)
      if (status.status === 'ok') {
        setVaultExists(status.exists)
      } else {
        setVaultExists(false)
      }

      // Fetch unlock method from vaults table
      const { data: vaultData } = await supabase
        .from('vaults')
        .select('unlock_method')
        .eq('user_id', userId)
        .maybeSingle()

      if (vaultData && vaultData.unlock_method) {
        setUnlockMethod(vaultData.unlock_method as 'pin' | 'passkey' | 'both')
      } else {
        // Fallback: Check profiles table if vaults table is missing or empty
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
    } finally {
      setVaultStatusLoading(false)
    }
  }, [checkVaultStatus, setUnlockMethod])

  // Fetch claimed credentials
  const loadCredentials = useCallback(async (user: any) => {
    try {
      setLoading(true)
      setLoadError(false)

      // Query credentials using the actual schema.sql column (owner)
      const claimedRes = await supabase
        .from('credentials')
        .select('*')
        .eq('owner', user.id)
        .order('created_at', { ascending: false })

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

      setClaimedCredentials(claimedList)
      setLoading(false)
    } catch (err) {
      setLoadError(true)
      setLoading(false)
    }
  }, [])

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

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        return  // preserve state, do not reload
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])

  const handleUnlockSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!currentUser) return
    
    try {
      setIsUnlocking(true)
      setUnlockError(null)

      // Unlock ZK-Vault using PIN
      const success = await unlockWithPin(pinInput, currentUser.id)
      if (success) {
        setShowUnlockModal(false)
        setIsUnlocking(false)
      } else {
        setUnlockError('Vault unlock failed. Please check your PIN.')
        setIsUnlocking(false)
      }
    } catch {
      setUnlockError('Unlock encountered an error. Please try again.')
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
        setIsUnlocking(false)
      } else {
        setUnlockError('Passkey authentication failed.')
        setIsUnlocking(false)
      }
    } catch {
      setUnlockError('Passkey encounter error.')
      setIsUnlocking(false)
    }
  }

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

  const handleCardClick = (credId: string) => {
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
    <div className="w-full md:max-w-4xl mx-auto pb-24 px-4 md:px-0">
      <style>{spinStyles}</style>

      {/* Header and top buttons */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
        <div>
          <h2 className="text-2xl md:text-3xl font-bold text-stone-900 tracking-tight">{t('wallet.title')}</h2>
          <p className="text-sm text-stone-500 mt-1">
            {t('wallet.subtitle')}
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full sm:w-auto">
          {/* Vault Status pill */}
          {!vaultStatusLoading && (
            <div className="flex justify-stretch sm:justify-end">
              {vaultExists === false && (
                <button className="w-full sm:w-auto bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white font-semibold h-11 px-4 rounded-lg text-sm shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-amber-500 cursor-pointer flex items-center justify-center" onClick={() => navigate('/app/vault-setup')}>
                  {t('wallet.vault_not_setup')}
                </button>
              )}
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
          )}
        </div>
      </div>

      {/* Main loading spinner */}
      {loading && claimedCredentials.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20">
          <div className="animate-spin rounded-full h-10 w-10 border-4 border-indigo-200 border-t-indigo-600" />
          <p className="text-stone-500 mt-4 font-medium">{t('wallet.loading')}</p>
        </div>
      )}

      {!loading && !loadError && (
        <div>
          {/* =======================================================
              SECTION B: CLAIMED CREDENTIALS
             ======================================================= */}
          <div>
            <div className="mb-4">
              <h3 className="text-lg font-bold text-stone-900">
                {t('wallet.encrypted_title')}
              </h3>
              <p className="text-sm text-stone-500 mt-1">
                {t('wallet.encrypted_desc')}
              </p>
            </div>

            {/* Empty State */}
            {claimedCredentials.length === 0 && (
              <div className="bg-white border border-gray-200 shadow-sm rounded-xl p-8 md:p-12 text-center">
                <div className="text-5xl mb-4 text-stone-300">💼</div>
                <h3 className="text-lg font-bold text-stone-900">{t('wallet.empty_title')}</h3>
                <p className="text-sm text-stone-500 max-w-sm mx-auto mb-6 mt-2 leading-relaxed">
                  {t('wallet.empty_desc')}
                </p>
                <button 
                  className="bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-semibold h-11 px-6 rounded-lg text-sm cursor-pointer" 
                  onClick={() => navigate('/app/notifications')}
                >
                  {t('wallet.view_notifications')}
                </button>
              </div>
            )}

            {/* Claimed List (Grouped) */}
            {claimedCredentials.length > 0 && (() => {
              const groupedCredentials = claimedCredentials.reduce((acc, cred) => {
                const type = cred.credential_type || 'other';
                if (!acc[type]) acc[type] = [];
                acc[type].push(cred);
                return acc;
              }, {} as Record<string, Credential[]>);

              const typeLabels: Record<string, string> = {
                'academic_degree': t('wallet.category_academic_degree')
              };

              const getLabel = (type: string) => typeLabels[type] || t('wallet.category_other');

              const sortedTypes = Object.keys(groupedCredentials).sort((a, b) => {
                if (a === 'academic_degree') return -1;
                if (b === 'academic_degree') return 1;
                if (a === 'other') return 1;
                if (b === 'other') return -1;
                return a.localeCompare(b);
              });

              return (
                <div className="flex flex-col gap-8">
                  {sortedTypes.map(type => {
                    const groupCreds = groupedCredentials[type];
                    if (!groupCreds || groupCreds.length === 0) return null;
                    
                    const isOther = type === 'other';
                    const displayLabel = isOther ? t('wallet.category_other') : getLabel(type);
                    const displayCreds = groupCreds.slice(0, 3);
                    const hasMore = groupCreds.length > 3;

                    return (
                      <div key={type}>
                        <div className="flex justify-between items-end mb-4 px-1">
                          <h4 className="text-sm font-bold text-gray-500 uppercase tracking-wider">{displayLabel}</h4>
                          {hasMore && (
                            <button 
                              onClick={() => navigate(`/app/wallet/type/${type}`)}
                              className="text-indigo-600 text-sm font-semibold hover:underline"
                            >
                              {t('wallet.see_all', { count: groupCreds.length })}
                            </button>
                          )}
                        </div>
                        {displayCreds.length === 1 ? (
                          // A single credential shouldn't sit in a scroll container —
                          // there's nothing to scroll to, so it just looked clipped.
                          <CredentialCard
                            degreeTitle={displayCreds[0].degree_title}
                            institutionName={displayCreds[0].institution_name}
                            issuerDid={displayCreds[0].issuer_did}
                            graduationDate={displayCreds[0].graduation_date}
                            createdAt={displayCreds[0].created_at}
                            onClick={() => handleCardClick(displayCreds[0].id)}
                          />
                        ) : (
                          <div className="flex flex-row gap-4 overflow-x-auto pb-4 snap-x snap-mandatory">
                            {displayCreds.map((c) => (
                              <CredentialCard
                                key={c.id}
                                degreeTitle={c.degree_title}
                                institutionName={c.institution_name}
                                issuerDid={c.issuer_did}
                                graduationDate={c.graduation_date}
                                createdAt={c.created_at}
                                onClick={() => handleCardClick(c.id)}
                                className="min-w-[85vw] sm:min-w-[400px] shrink-0 snap-start"
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            })()}
          </div>
        </div>
      )}

      {/* =======================================================
          MODAL 1: UNLOCK VAULT DIALOG
         ======================================================= */}
      {showUnlockModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[100] p-4">
          <div className="bg-white rounded-2xl shadow-lg p-6 md:p-8 w-full max-w-sm flex flex-col animate-scale-in">
            <div className="text-center mb-4">
              <div className="text-4xl mb-2">🔒</div>
              <h3 className="text-lg font-bold text-stone-900">{t('wallet.unlock_vault_title')}</h3>
              <p className="text-xs text-stone-500 mt-1 leading-relaxed">
                {t('wallet.unlock_vault_desc')}
              </p>
            </div>

            {unlockMethod === 'pin' && (
              <form onSubmit={handleUnlockSubmit} className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5 mb-2">
                  <label className="text-xs font-semibold text-stone-700">{t('wallet.enter_pin')}</label>
                  <PinDotsInput
                    value={pinInput}
                    onChange={setPinInput}
                    name="vault-pin"
                    autoComplete="current-password"
                    autoFocus
                    required
                  />
                </div>

                {unlockError && (
                  <p className="text-rose-600 text-xs text-center font-semibold mb-2">
                    {unlockError}
                  </p>
                )}

                <div className="flex flex-col gap-2">
                  <button
                    type="submit"
                    disabled={isUnlocking}
                    className="w-full bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-semibold h-11 rounded-lg text-sm flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    {isUnlocking && (
                      <div className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-indigo-200 border-t-white" />
                    )}
                    <span>{t('wallet.unlock_with_pin')}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setShowUnlockModal(false)
                    }}
                    disabled={isUnlocking}
                    className="w-full text-gray-500 font-semibold h-11 rounded-lg text-sm flex items-center justify-center cursor-pointer"
                  >
                    {t('wallet.cancel')}
                  </button>
                </div>
              </form>
            )}

            {(unlockMethod === 'passkey' || unlockMethod === 'biometric') && (
              <div className="flex flex-col gap-3 items-center text-center">
                {isUnlocking ? (
                  <>
                    <div className="animate-spin rounded-full h-8 w-8 border-2 border-indigo-200 border-t-indigo-600 my-2" />
                    <p className="text-sm font-semibold text-stone-800">
                      {t('wallet.authenticating')}
                    </p>
                    <p className="text-xs text-stone-500">
                      {t('wallet.biometric_prompt')}
                    </p>
                  </>
                ) : (
                  <>
                    {unlockError && (
                      <p className="text-rose-600 text-xs font-semibold mb-1">
                        {unlockError}
                      </p>
                    )}
                    <p className="text-sm text-stone-500 mb-1">
                      {t('wallet.biometric_failed')}
                    </p>
                    <button
                      type="button"
                      onClick={handleUnlockWithPasskeyClick}
                      disabled={isUnlocking}
                      className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold h-11 rounded-lg text-sm flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      {t('wallet.try_again')}
                    </button>
                  </>
                )}

                <button
                  type="button"
                  onClick={() => { setShowUnlockModal(false); setUnlockError(null) }}
                  disabled={isUnlocking}
                  className="w-full text-gray-400 text-sm h-10 flex items-center justify-center cursor-pointer"
                  style={{ opacity: isUnlocking ? 0.4 : 1 }}
                >
                  {t('wallet.cancel')}
                </button>
              </div>
            )}

            {(unlockMethod === 'both' || unlockMethod === null) && (
              <form onSubmit={handleUnlockSubmit} className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5 mb-2">
                  <label className="text-xs font-semibold text-stone-700">{t('wallet.enter_pin')}</label>
                  <PinDotsInput
                    value={pinInput}
                    onChange={setPinInput}
                    name="vault-pin"
                    autoComplete="current-password"
                    autoFocus
                    required
                  />
                </div>

                {unlockError && (
                  <p className="text-rose-600 text-xs text-center font-semibold mb-2">
                    {unlockError}
                  </p>
                )}

                <div className="flex flex-col gap-2">
                  <button
                    type="submit"
                    disabled={isUnlocking}
                    className="w-full bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-semibold h-11 rounded-lg text-sm flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    {isUnlocking && (
                      <div className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-indigo-200 border-t-white" />
                    )}
                    <span>{t('wallet.unlock_with_pin')}</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleUnlockWithPasskeyClick}
                    disabled={isUnlocking}
                    className="w-full border border-gray-300 bg-white hover:bg-gray-50 active:bg-gray-100 text-gray-700 font-semibold h-11 rounded-lg text-sm flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <span>{t('wallet.unlock_with_passkey')}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setShowUnlockModal(false)
                    }}
                    disabled={isUnlocking}
                    className="w-full text-gray-500 font-semibold h-11 rounded-lg text-sm flex items-center justify-center cursor-pointer"
                  >
                    {t('wallet.cancel')}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* =======================================================
          MODAL 2: SETUP NEEDED DIALOG
         ======================================================= */}
      {showSetupNeededModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[100] p-4">
          <div className="bg-white rounded-2xl shadow-lg p-6 md:p-8 w-full max-w-sm flex flex-col animate-scale-in">
            <div className="text-center mb-6">
              <div className="text-4xl mb-2">🛡️</div>
              <h3 className="text-lg font-bold text-stone-900">{t('wallet.setup_required_title')}</h3>
              <p className="text-xs text-stone-500 mt-2 leading-relaxed">
                {t('wallet.setup_required_desc')}
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <button
                className="w-full bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-semibold h-11 rounded-lg text-sm flex items-center justify-center cursor-pointer"
                onClick={() => {
                  setShowSetupNeededModal(false)
                  navigate('/app/vault-setup')
                }}
              >
                {t('wallet.setup_vault_btn')}
              </button>

              <button
                className="w-full text-gray-500 font-semibold h-11 rounded-lg text-sm flex items-center justify-center cursor-pointer"
                onClick={() => setShowSetupNeededModal(false)}
              >
                {t('wallet.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
