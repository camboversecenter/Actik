import React, { useState, useEffect, useCallback } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useZkVault } from '../../vault/zk-vault'
import { useLanguage } from '../../lib/i18n'
import { Bell, ArrowLeft, Inbox } from 'lucide-react'
import PinDotsInput from '../../components/PinDotsInput'

interface PendingCredential {
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
  cipher?: string
  iv?: string
  credential_type?: string
  type_metadata?: any
  label?: string
  student_id?: string
  major?: string
  graduation_date?: string
  certificate_id?: string
}

export default function Notifications() {
  const navigate = useNavigate()
  const { t } = useLanguage()
  const { 
    isUnlocked,  
    checkVaultStatus, 
    unlockWithPin, 
    unlockWithPasskey, 
    encryptPayload 
  } = useZkVault()

  // State
  const [currentUser, setCurrentUser] = useState<any | null>(null)
  const [pendingList, setPendingList] = useState<PendingCredential[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [toastMessage, setToastMessage] = useState<string | null>(null)

  // Vault configuration status
  const [vaultExists, setVaultExists] = useState<boolean | null>(null)
  const [unlockMethod, setUnlockMethod] = useState<'pin' | 'passkey' | 'biometric' | 'both' | null>(null)

  // Modal / Action state
  const [showUnlockModal, setShowUnlockModal] = useState(false)
  const [unlockTargetCred, setUnlockTargetCred] = useState<PendingCredential | null>(null)
  const [pinInput, setPinInput] = useState('')
  const [unlockError, setUnlockError] = useState<string | null>(null)
  const [isUnlocking, setIsUnlocking] = useState(false)
  const [showSetupNeededModal, setShowSetupNeededModal] = useState(false)

  const [claimingCredId, setClaimingCredId] = useState<string | null>(null)
  const [claimErrors, setClaimErrors] = useState<Record<string, string>>({})

  // Helper: Toast
  const showToast = (msg: string) => {
    setToastMessage(msg)
    setTimeout(() => setToastMessage(null), 3000)
  }

  // Check vault configuration and fetch unlock method
  const checkVault = useCallback(async (userId: string) => {
    try {
      const status = await checkVaultStatus(userId)
      if (status.status === 'ok') {
        setVaultExists(status.exists)
      } else {
        setVaultExists(false)
      }

      // Query vaults
      const { data: vaultData } = await supabase
        .from('vaults')
        .select('unlock_method')
        .eq('user_id', userId)
        .maybeSingle()

      if (vaultData && vaultData.unlock_method) {
        setUnlockMethod(vaultData.unlock_method as 'pin' | 'passkey' | 'both')
      } else {
        // Fallback to profiles table
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

  // Fetch pending list
  const loadPending = useCallback(async (user: any) => {
    try {
      setLoading(true)
      setLoadError(false)

      // Query pending_credentials directly (schema.sql — issuers insert here, students claim from here)
      const fallbackUnclaimed = await supabase
        .from('pending_credentials')
        .select('*')
        .eq('recipient_email', user.email.toLowerCase())
        .order('created_at', { ascending: false })

      if (fallbackUnclaimed.error) throw fallbackUnclaimed.error

      const unclaimedList: PendingCredential[] = (fallbackUnclaimed.data || []).map((p: any) => ({
        id: p.id,
        issuer_id: '',
        holder_id: null,
        holder_email: p.recipient_email || p.student_email || user.email,
        issuer_did: p.issuer_did,
        institution_name: p.institution_name || '',
        degree_title: p.label || p.degree_type || 'Degree Certificate',
        sd_jwt: p.sdjwt,
        claimed: false,
        claimed_at: null,
        created_at: p.created_at,
        credential_type: p.credential_type
      }))

      setPendingList(unclaimedList)
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
        loadPending(session.user)
      }
    }
    init()
    return () => { active = false }
  }, [navigate, checkVault, loadPending])

  // --- CLAIM FLOW ---
  const triggerClaimFlow = async (credential: PendingCredential) => {
    if (claimingCredId) return

    // Vault exists check
    if (!vaultExists) {
      setShowSetupNeededModal(true)
      return
    }

    // Unlock check
    if (!isUnlocked) {
      setUnlockTargetCred(credential)
      setPinInput('')
      setUnlockError(null)
      setShowUnlockModal(true)
      return
    }

    await executeClaim(credential)
  }

  const handleUnlockAndClaimSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!unlockTargetCred || !currentUser) return

    try {
      setIsUnlocking(true)
      setUnlockError(null)

      const success = await unlockWithPin(pinInput, currentUser.id)
      if (success) {
        setShowUnlockModal(false)
        setIsUnlocking(false)
        await executeClaim(unlockTargetCred)
      } else {
        setUnlockError(t('wallet.vault_unlock_failed'))
        setIsUnlocking(false)
      }
    } catch {
      setUnlockError(t('wallet.vault_unlock_error'))
      setIsUnlocking(false)
    }
  }

  const handleUnlockWithPasskeyClick = async () => {
    if (!unlockTargetCred || !currentUser) return
    try {
      setIsUnlocking(true)
      setUnlockError(null)

      const success = await unlockWithPasskey(currentUser.id)
      if (success) {
        setShowUnlockModal(false)
        setIsUnlocking(false)
        await executeClaim(unlockTargetCred)
      } else {
        setUnlockError(t('wallet.passkey_auth_failed'))
        setIsUnlocking(false)
      }
    } catch {
      setUnlockError(t('wallet.passkey_error'))
      setIsUnlocking(false)
    }
  }

  const executeClaim = async (cred: PendingCredential) => {
    setClaimingCredId(cred.id)
    setClaimErrors(prev => ({ ...prev, [cred.id]: '' }))

    try {
      const payload = { sdjwt: cred.sd_jwt }
      const encryptedPayload = await encryptPayload(payload)
      const encryptedStr = JSON.stringify(encryptedPayload)

      let updateRes

      // Fallback schema detection
      const isFallback = (cred.cipher !== undefined || cred.iv !== undefined) || (!cred.sd_jwt) || (cred.issuer_id === '')

      if (isFallback) {
        updateRes = await supabase.from('credentials').insert({
          owner: currentUser.id,
          label: cred.degree_title || cred.label,
          cipher: encryptedPayload.cipher,
          iv: encryptedPayload.iv,
          credential_type: cred.credential_type,
          type_metadata: cred.type_metadata,
          student_id: cred.student_id,
          major: cred.major,
          graduation_date: cred.graduation_date,
          certificate_id: cred.certificate_id
        })

        if (!updateRes.error) {
          await supabase.from('pending_credentials').delete().eq('id', cred.id)
        }
      } else {
        updateRes = await supabase
          .from('credentials')
          .update({
            sd_jwt: encryptedStr,
            claimed: true,
            claimed_at: new Date().toISOString()
          })
          .eq('id', cred.id)
      }

      if (updateRes.error) {
        throw new Error(t('wallet.cred_save_failed'))
      }

      setPendingList(prev => prev.filter(c => c.id !== cred.id))
      showToast(t('wallet.cred_claim_success'))
    } catch (err: any) {
      setClaimErrors(prev => ({ ...prev, [cred.id]: err.message || 'Claim failed' }))
    } finally {
      setClaimingCredId(null)
    }
  }

  const truncateDid = (did: string) => {
    if (!did) return 'Unknown'
    if (did.length <= 32) return did
    return did.slice(0, 32) + '...'
  }

  return (
    <div className="w-full md:max-w-2xl mx-auto pb-24 px-4 md:px-0">
      {/* Back Link */}
      <Link to="/app/wallet" className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-500 hover:text-indigo-600 transition-colors mb-6">
        <ArrowLeft size={16} />
        {t('wallet.back_to_wallet')}
      </Link>

      <div className="flex items-center gap-3 mb-6">
        <div className="bg-indigo-100 text-indigo-600 p-2.5 rounded-xl">
          <Bell size={24} />
        </div>
        <div>
          <h2 className="text-2xl md:text-3xl font-bold text-stone-900 tracking-tight">{t('wallet.notifications_title')}</h2>
          <p className="text-sm text-stone-500 mt-0.5">
            {t('wallet.notifications_desc')}
          </p>
        </div>
      </div>

      {loading && (
        <div className="flex flex-col items-center justify-center py-20 bg-white border border-gray-200 rounded-xl shadow-sm">
          <div className="animate-spin rounded-full h-10 w-10 border-4 border-indigo-200 border-t-indigo-600" />
          <p className="text-stone-500 mt-4 font-medium">{t('wallet.checking_pending_credentials')}</p>
        </div>
      )}

      {loadError && !loading && (
        <div className="w-full bg-rose-50 border border-rose-200 text-rose-700 rounded-xl p-6 text-center shadow-sm">
          <h3 className="font-semibold text-rose-900 text-lg mb-2">{t('wallet.failed_load_notifications')}</h3>
          <p className="text-sm text-rose-700 mb-4">{t('wallet.refresh_to_try_again')}</p>
          <button className="bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white font-semibold h-11 px-6 rounded-lg text-sm transition-colors cursor-pointer" onClick={() => loadPending(currentUser)}>
            {t('wallet.retry_btn')}
          </button>
        </div>
      )}

      {!loading && !loadError && (
        <div className="space-y-4">
          {pendingList.length === 0 ? (
            <div className="bg-white border border-gray-200 shadow-sm rounded-xl p-12 text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-indigo-50 text-indigo-600 mb-4">
                <Inbox size={32} />
              </div>
              <h3 className="text-lg font-bold text-stone-900">{t('wallet.all_caught_up')}</h3>
              <p className="text-sm text-stone-500 max-w-sm mx-auto mt-2 leading-relaxed">
                {t('wallet.no_pending_credentials_desc')}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {pendingList.map((c) => (
                <div 
                  key={c.id}
                  className="flex flex-col sm:flex-row justify-between items-start sm:items-center bg-white border border-gray-200 shadow-sm rounded-xl p-5 gap-4 hover:border-indigo-100 transition-colors"
                >
                  <div className="flex-1">
                    <strong className="text-sm md:text-base text-gray-900 block font-semibold leading-snug">
                      {c.institution_name ? `${c.institution_name} — ` : ''}{c.degree_title}
                    </strong>
                    <div className="text-xs text-gray-500 mt-1">
                      {t('wallet.issued_by')}<code className="font-mono text-[10px] text-indigo-600 bg-indigo-50 px-1 py-0.5 rounded break-all">{truncateDid(c.issuer_did)}</code>
                    </div>
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-4 w-full sm:w-auto border-t sm:border-t-0 pt-3 sm:pt-0">
                    <span className="text-xs text-gray-400">
                      {new Date(c.created_at).toLocaleDateString()}
                    </span>
                    <button
                      onClick={() => triggerClaimFlow(c)}
                      disabled={claimingCredId !== null}
                      className="w-full sm:w-auto bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-semibold h-11 px-5 rounded-lg text-xs md:text-sm flex items-center justify-center gap-1.5 cursor-pointer shadow-sm"
                    >
                      {claimingCredId === c.id && (
                        <div className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-indigo-200 border-t-white" />
                      )}
                      <span>{t('wallet.claim_to_vault_btn')}</span>
                    </button>
                  </div>

                  {claimErrors[c.id] && (
                    <div className="w-full bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded p-2.5 mt-2">
                      {t('wallet.claim_failed_msg')}{claimErrors[c.id]}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
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
                {t('wallet.unlock_vault_modal_desc')}
              </p>
            </div>

            {unlockMethod === 'pin' && (
              <form onSubmit={handleUnlockAndClaimSubmit} className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5 mb-2">
                  <label className="text-xs font-semibold text-stone-700">{t('wallet.enter_vault_pin')}</label>
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
                    <span>{t('wallet.unlock_and_claim_btn')}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setShowUnlockModal(false)
                      setUnlockTargetCred(null)
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
              <div className="flex flex-col gap-3">
                <div className="text-center py-4 text-sm text-stone-600">
                  {unlockMethod === 'biometric'
                    ? t('wallet.auth_biometric_desc')
                    : t('wallet.auth_passkey_desc')}
                </div>

                {unlockError && (
                  <p className="text-rose-600 text-xs text-center font-semibold mb-2">
                    {unlockError}
                  </p>
                )}

                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={handleUnlockWithPasskeyClick}
                    disabled={isUnlocking}
                    className="w-full bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-semibold h-11 rounded-lg text-sm flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    {isUnlocking && (
                      <div className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-indigo-200 border-t-white" />
                    )}
                    <span>{unlockMethod === 'biometric' ? t('wallet.unlock_with_biometric') : t('wallet.unlock_with_passkey')}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setShowUnlockModal(false)
                      setUnlockTargetCred(null)
                    }}
                    disabled={isUnlocking}
                    className="w-full text-gray-500 font-semibold h-11 rounded-lg text-sm flex items-center justify-center cursor-pointer"
                  >
                    {t('wallet.cancel')}
                  </button>
                </div>
              </div>
            )}

            {(unlockMethod === 'both' || unlockMethod === null) && (
              <form onSubmit={handleUnlockAndClaimSubmit} className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5 mb-2">
                  <label className="text-xs font-semibold text-stone-700">{t('wallet.enter_vault_pin')}</label>
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
                    <span>{t('wallet.unlock_and_claim_btn')}</span>
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
                      setUnlockTargetCred(null)
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
          MODAL 2: VAULT SETUP NEEDED DIALOG
         ======================================================= */}
      {showSetupNeededModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[100] p-4">
          <div className="bg-white rounded-2xl shadow-lg p-6 md:p-8 w-full max-w-sm flex flex-col animate-scale-in text-center">
            <div className="text-4xl mb-2">⚙️</div>
            <h3 className="text-lg font-bold text-stone-900">{t('wallet.vault_setup_required_title')}</h3>
            <p className="text-xs text-stone-500 mt-2 mb-6 leading-relaxed">
              {t('wallet.vault_setup_required_desc')}
            </p>
            <div className="flex flex-col gap-2.5">
              <button
                className="w-full bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-semibold h-11 rounded-lg text-sm flex items-center justify-center cursor-pointer"
                onClick={() => navigate('/app/vault-setup')}
              >
                {t('wallet.setup_my_vault_btn')}
              </button>
              <button
                className="w-full border border-gray-300 bg-white hover:bg-gray-50 active:bg-gray-100 text-gray-700 font-semibold h-11 rounded-lg text-sm flex items-center justify-center cursor-pointer"
                onClick={() => setShowSetupNeededModal(false)}
              >
                {t('wallet.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast notifications */}
      {toastMessage && (
        <div className="fixed bottom-24 right-4 md:right-6 bg-stone-900 text-white px-4 py-2.5 rounded-lg shadow-lg z-[1000] text-sm font-semibold animate-scale-in">
          {toastMessage}
        </div>
      )}
    </div>
  )
}
