import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'


import { useZkVault } from '../../vault/zk-vault'
import { useLanguage } from '../../lib/i18n'
import { readDisclosures } from '../../lib/sdjwt'
import CredentialCard from '../../components/CredentialCard'
import VaultUnlockModal from '../../components/VaultUnlockModal'
import { Briefcase, ShieldAlert } from 'lucide-react'

// Institution/major/issuer_did are meant to come from plain DB columns
// (fast, no decrypt needed) — but those columns went unpopulated for every
// credential claimed before a recent fix, and stay unpopulated even after it
// for anything issued before the columns existed at all. The real values are
// still sitting inside each credential's encrypted payload, so once the
// vault is unlocked we decrypt on top of the DB columns and fill in
// whatever they're missing, rather than showing blanks a vault-unlock could
// have avoided.
//
// No degree_type here: it's the exact same string as the card's title
// (degree_title/label — see the Credential interface below), not a distinct
// field, so there's nothing for a decrypt to usefully fill in for it.
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
    unlockWithPasskey,
    lock,
    decryptPayload,
    getAutoLockDeadline,
  } = useZkVault()
  const { t, language } = useLanguage()

  // Vault setup state
  const [vaultExists, setVaultExists] = useState<boolean | null>(null)
  const [vaultStatusLoading, setVaultStatusLoading] = useState(true)
  const [unlockMethod, setUnlockMethod] = useState<'pin' | 'passkey' | 'biometric' | 'both' | null>(null)

  // Decrypted-on-top-of-DB-columns preview data — see the DecryptedPreview
  // comment above. Keyed by credential id.
  const [decryptedPreviews, setDecryptedPreviews] = useState<Record<string, DecryptedPreview>>({})

  // Credentials State
  const [claimedCredentials, setClaimedCredentials] = useState<Credential[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<boolean>(false)
  // credential_id -> number of shares created for it. Best-effort: a failure
  // here just means cards render without a share count, not a page error.
  const [shareCounts, setShareCounts] = useState<Record<string, number>>({})

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
        major: c.major || null,
        cipher: c.cipher,
        iv: c.iv
      }))

      setClaimedCredentials(claimedList)
      setLoading(false)

      // Share counts: one aggregate query instead of one per card. Best-effort —
      // errors here (e.g. migration not yet applied) shouldn't affect the wallet.
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
  }, [])

  // Once the vault is unlocked, decrypt whatever credentials are still
  // missing institution_name (every one claimed before the fix — see
  // DecryptedPreview above) and fill in the real values from inside the
  // credential itself. Best-effort per credential: one failing to decrypt
  // just leaves that card showing what it already had.
  useEffect(() => {
    if (!isUnlocked) return
    const toDecrypt = claimedCredentials.filter(
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
  }, [isUnlocked, claimedCredentials, decryptPayload, decryptedPreviews])

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

  // Live "auto-locks in mm:ss" readout. getAutoLockDeadline() is a plain
  // getter (see VaultContext) so this ticks locally once a second instead of
  // re-rendering every vault consumer in the app on each activity reset.
  const [autoLockMsLeft, setAutoLockMsLeft] = useState<number | null>(null)
  useEffect(() => {
    if (!isUnlocked) {
      setAutoLockMsLeft(null)
      return
    }
    const tick = () => {
      const deadline = getAutoLockDeadline()
      setAutoLockMsLeft(deadline === null ? null : Math.max(0, deadline - Date.now()))
    }
    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [isUnlocked, getAutoLockDeadline])

  const autoLockCountdown = (() => {
    if (autoLockMsLeft === null) return null
    const totalSec = Math.floor(autoLockMsLeft / 1000)
    const m = Math.floor(totalSec / 60)
    const s = totalSec % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  })()

  return (
    <div className="w-full md:max-w-4xl mx-auto pb-24 px-4 md:px-0">
      {/* Header — a full-width app-bar strip (border-bottom only, no card
          radius), not a card like the rest of the page, per spec. */}
      <div className="bg-white border-b border-stone-200 pt-2.5 px-5 pb-4 -mx-4 md:mx-0">
        <h2 className="font-khmer text-[22px] font-bold tracking-[-0.01em] text-stone-900">{t('wallet.title')}</h2>
        <p className="text-[11.5px] text-stone-500 mt-0.5">
          {t('wallet.subtitle_count', { count: claimedCredentials.length })}
        </p>
      </div>

      {/* Vault status strip */}
      {!vaultStatusLoading && (
        <div className="mb-6">
          {vaultExists === false && (
            <div className="-mx-4 md:mx-0 px-5 md:px-0 py-3 md:py-0">
              <button
                className="w-full sm:w-auto bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white font-semibold h-11 px-4 rounded-lg text-sm shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-amber-500 cursor-pointer flex items-center justify-center gap-2"
                onClick={() => navigate('/app/vault-setup')}
              >
                <ShieldAlert size={16} />
                {t('wallet.vault_not_setup')}
              </button>
            </div>
          )}
          {vaultExists === true && !isUnlocked && (
            <div className="flex items-center gap-2.5 py-3 px-5 bg-white border-b border-stone-200 -mx-4 md:mx-0">
              <span className="w-[7px] h-[7px] rounded-full bg-stone-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="font-khmer text-[12.5px] font-semibold text-stone-900">{t('wallet.vault_locked')}</div>
                <div className="font-mono text-[10px] text-stone-500 mt-0.5">
                  Vault locked · tap to unlock
                </div>
              </div>
              <button
                onClick={() => setShowUnlockModal(true)}
                className="shrink-0 bg-indigo-600 hover:bg-indigo-650 text-white font-semibold h-[30px] px-[11px] rounded-lg text-[11px] transition-colors cursor-pointer"
              >
                {t('wallet.unlock_btn')}
              </button>
            </div>
          )}
          {vaultExists === true && isUnlocked && (
            <div className="flex items-center gap-2.5 py-3 px-5 bg-white border-b border-stone-200 -mx-4 md:mx-0">
              <span className="w-[7px] h-[7px] rounded-full bg-emerald-600 shrink-0 shadow-[0_0_0_3px_rgba(5,150,105,0.14)]" />
              <div className="flex-1 min-w-0">
                <div className="font-khmer text-[12.5px] font-semibold text-stone-900">{t('wallet.vault_unlocked')}</div>
                <div className="font-mono text-[10px] text-stone-500 mt-0.5">
                  Vault unlocked{autoLockCountdown !== null ? ` · auto-locks in ${autoLockCountdown}` : ''}
                </div>
              </div>
              <button
                onClick={lock}
                className="shrink-0 border border-stone-200 bg-white hover:bg-stone-50 text-stone-700 font-semibold h-[30px] px-[11px] rounded-lg text-[11px] transition-colors cursor-pointer"
              >
                {t('wallet.lock_now')}
              </button>
            </div>
          )}
        </div>
      )}

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
            {/* Empty State */}
            {claimedCredentials.length === 0 && (
              <div className="bg-white border border-gray-200 shadow-sm rounded-xl p-8 md:p-12 text-center">
                <div className="w-14 h-14 rounded-2xl bg-stone-100 flex items-center justify-center mx-auto mb-4">
                  <Briefcase size={26} className="text-stone-400" />
                </div>
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
                'academic_degree': t('wallet.category_academic_degree'),
                'employment_record': t('wallet.category_employment_record')
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
                    // Wallet home shows at most 2 per category — "All N" goes
                    // to the dedicated per-category page for the rest.
                    const displayCreds = groupCreds.slice(0, 2);

                    // Short English caption next to the Khmer category label —
                    // matches the mockup's "Khmer · English" pairing. Only
                    // shown when Khmer is the active language (when English
                    // is active, displayLabel is already English, so a
                    // second copy of the same word would be redundant).
                    const categoryCaption = type === 'academic_degree' ? 'Degrees' : 'Other'

                    return (
                      <div key={type}>
                        <div className="flex justify-between items-end mb-4 px-1">
                          <h4 className="font-khmer text-[13px] font-semibold text-stone-600">
                            {displayLabel}
                            {language === 'km' && <span className="font-sans text-stone-400"> · {categoryCaption}</span>}
                          </h4>
                          {groupCreds.length > 1 && (
                            <button
                              onClick={() => navigate(`/app/wallet/type/${type}`)}
                              className="text-indigo-600 text-sm font-semibold hover:underline shrink-0"
                            >
                              {t('wallet.all_count', { count: groupCreds.length })}
                            </button>
                          )}
                        </div>
                        {/* Stacked full-width, matching the mockup — no horizontal
                            slide/carousel. */}
                        <div className="flex flex-col gap-4">
                          {displayCreds.map((c) => {
                            const preview = decryptedPreviews[c.id]
                            return (
                              <CredentialCard
                                key={c.id}
                                degreeTitle={c.degree_title}
                                institutionName={c.institution_name || preview?.institution_name}
                                issuerDid={c.issuer_did || preview?.issuer_did}
                                graduationDate={c.graduation_date}
                                createdAt={c.created_at}
                                onClick={() => handleCardClick(c.id)}
                                shareCount={shareCounts[c.id]}
                                major={c.major || preview?.major}
                              />
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )
            })()}
          </div>
        </div>
      )}

      {/* MODAL 1: UNLOCK VAULT DIALOG */}
      {showUnlockModal && (
        <VaultUnlockModal
          unlockMethod={unlockMethod}
          pinInput={pinInput}
          onPinChange={setPinInput}
          onSubmitPin={handleUnlockSubmit}
          onPasskeyClick={handleUnlockWithPasskeyClick}
          isUnlocking={isUnlocking}
          unlockError={unlockError}
          onCancel={() => { setShowUnlockModal(false); setUnlockError(null) }}
          desc={t('wallet.unlock_vault_desc')}
        />
      )}

      {/* =======================================================
          MODAL 2: SETUP NEEDED DIALOG
         ======================================================= */}
      {showSetupNeededModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[100] p-4">
          <div className="bg-white rounded-2xl shadow-lg p-6 md:p-8 w-full max-w-sm flex flex-col animate-scale-in">
            <div className="text-center mb-6">
              <div className="w-12 h-12 rounded-2xl bg-indigo-50 flex items-center justify-center mx-auto mb-2">
                <ShieldAlert size={22} className="text-indigo-600" />
              </div>
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
