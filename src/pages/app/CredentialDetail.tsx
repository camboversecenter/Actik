import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useZkVault } from '../../vault/zk-vault'
import { readDisclosures } from '../../lib/sdjwt'
import { useLanguage } from '../../lib/i18n'
import PinDotsInput from '../../components/PinDotsInput'

// Reusing same Credential interface
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

const formatDate = (dateStr: string) => {
  if (!dateStr) return '—'
  try {
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return dateStr
    const day = d.getDate()
    const month = d.toLocaleDateString('en-US', { month: 'long' })
    const year = d.getFullYear()
    return `${day} ${month} ${year}`
  } catch {
    return dateStr
  }
}

export default function CredentialDetail() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  
  const [currentUser, setCurrentUser] = useState<any | null>(null)
  const [credential, setCredential] = useState<Credential | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

  // Modals & Action States
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  
  // Vault state
  const { isUnlocked, unlockWithPin, unlockWithPasskey, checkVaultStatus, decryptPayload } = useZkVault()
  const { t } = useLanguage()
  const [vaultExists, setVaultExists] = useState<boolean | null>(null)
  const [unlockMethod, setUnlockMethod] = useState<'pin' | 'passkey' | 'biometric' | 'both' | null>(null)
  
  const [showUnlockModal, setShowUnlockModal] = useState(false)
  const [pinInput, setPinInput] = useState('')
  const [unlockError, setUnlockError] = useState<string | null>(null)
  const [isUnlocking, setIsUnlocking] = useState(false)

  // Decryption state
  const [detail, setDetail] = useState<Record<string, any> | null>(null)
  const [isDecrypting, setIsDecrypting] = useState(false)
  const [expandedRawJwt, setExpandedRawJwt] = useState(false)

  const showToast = (msg: string) => {
    setToastMessage(msg)
    setTimeout(() => setToastMessage(null), 3000)
  }

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

  // Fetch credential
  const loadCredential = useCallback(async (user: any) => {
    try {
      setLoading(true)
      setLoadError(false)

      const { data, error } = await supabase
        .from('credentials')
        .select('*')
        .eq('id', id)
        .eq('owner', user.id)
        .maybeSingle()

      if (error) throw error
      if (!data) {
        setLoadError(true)
        setLoading(false)
        return
      }

      setCredential({
        id: data.id,
        issuer_id: data.issuer_id || '',
        holder_id: data.owner,
        holder_email: data.holder_email || user.email,
        issuer_did: data.issuer_did || '',
        institution_name: data.institution_name || '',
        degree_title: data.degree_title || data.label || 'Degree Certificate',
        sd_jwt: data.sd_jwt || '',
        claimed: data.claimed ?? true,
        claimed_at: data.claimed_at || data.created_at,
        created_at: data.created_at,
        graduation_date: data.graduation_date || null,
        credential_type: data.credential_type || null,
        cipher: data.cipher,
        iv: data.iv
      })
      setLoading(false)
    } catch (err) {
      setLoadError(true)
      setLoading(false)
    }
  }, [id])

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
        loadCredential(session.user)
      }
    }
    init()
    return () => { active = false }
  }, [navigate, checkVault, loadCredential])

  // Unlock handlers
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

  // Trigger unlock modal immediately if locked upon load
  useEffect(() => {
    if (!loading && !loadError && credential && vaultExists && !isUnlocked) {
      setShowUnlockModal(true)
    }
  }, [loading, loadError, credential, vaultExists, isUnlocked])

  // Decryption effect triggered automatically when vault is unlocked post-hoc
  useEffect(() => {
    if (isUnlocked && credential && !detail) {
      const decryptCredDetails = async (cred: Credential) => {
        try {
          setIsDecrypting(true)
          let sdjwtString = ''

          if (cred.cipher && cred.iv) {
            const decrypted = await decryptPayload({ cipher: cred.cipher, iv: cred.iv }) as { sdjwt: string }
            sdjwtString = decrypted.sdjwt
          } else {
            const parsedPayload = JSON.parse(cred.sd_jwt)
            const decrypted = await decryptPayload(parsedPayload) as { sdjwt: string }
            sdjwtString = decrypted.sdjwt
          }

          const disclosures = readDisclosures(sdjwtString)
          const fields: Record<string, any> = { rawJwt: sdjwtString }

          disclosures.forEach(d => {
            fields[d.name] = d.value
          })

          if (!fields.name) {
            try {
              const payload = JSON.parse(atob(sdjwtString.split('~')[0].split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
              fields.name = payload.name || ''
              fields.degree = payload.degree || ''
              fields.institution = payload.institution || ''
              fields.year = payload.year || ''
            } catch {}
          }

          setDetail(fields)
        } catch {
          showToast(t('wallet.decryption_failed'))
        } finally {
          setIsDecrypting(false)
        }
      }
      decryptCredDetails(credential)
    }
  }, [isUnlocked, credential, detail, decryptPayload])

  if (loading) {
    return (
      <div className="w-full md:max-w-4xl mx-auto px-4 md:px-0 py-20 flex flex-col items-center justify-center">
        <style>{spinStyles}</style>
        <div className="animate-spin rounded-full h-10 w-10 border-4 border-indigo-200 border-t-indigo-600" />
        <p className="text-stone-500 mt-4 font-medium">{t('wallet.loading_single')}</p>
      </div>
    )
  }

  if (loadError || !credential) {
    return (
      <div className="w-full md:max-w-4xl mx-auto px-4 md:px-0 py-20 flex flex-col items-center justify-center">
        <div className="bg-white border border-gray-200 shadow-sm rounded-xl p-8 md:p-12 text-center w-full">
          <h3 className="text-lg font-bold text-stone-900 mb-4">{t('wallet.credential_not_found')}</h3>
          <Link to="/app/wallet" className="text-indigo-600 font-semibold hover:underline">
            {t('wallet.return_to_wallet')}
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="w-full md:max-w-4xl mx-auto px-4 md:px-0 pb-24">
      <style>{spinStyles}</style>

      {/* Header with back button */}
      <div className="mb-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Link to="/app/wallet" className="inline-flex items-center gap-1 text-sm font-semibold text-gray-500 hover:text-indigo-600 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            {t('wallet.back_to_wallet')}
          </Link>
          <h2 className="text-2xl font-bold text-stone-900 tracking-tight">
            {credential.institution_name ? `${credential.institution_name} — ` : ''}{credential.degree_title}
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

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {/* Full Page Action Bar */}
        <div className="bg-stone-50 border-b border-gray-200 p-4 flex justify-end">
           <button 
             onClick={() => navigate(`/app/share/${credential.id}`)}
             className="w-full sm:w-auto bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-semibold h-11 px-6 rounded-lg text-sm transition-all focus:outline-none flex items-center justify-center gap-2 cursor-pointer"
           >
             {t('wallet.share_credential')}
           </button>
        </div>

        <div className="p-5 md:p-8 text-sm text-left">
          <p className="text-xs font-bold text-stone-400 uppercase tracking-widest mb-6">
            {t('wallet.metadata_view')}
          </p>

          {!isUnlocked ? (
            <div className="text-center py-12">
              <p className="text-sm text-stone-500 mb-4">
                {t('wallet.encrypted_detail_msg')}
              </p>
              <button 
                className="bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 disabled:bg-indigo-300 text-white font-semibold h-11 px-6 rounded-lg text-sm cursor-pointer flex items-center justify-center gap-2 mx-auto"
                onClick={() => setShowUnlockModal(true)}
                disabled={isUnlocking}
              >
                {isUnlocking ? (
                  <>
                    <div className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-indigo-200 border-t-white" />
                    <span>{t('wallet.authenticating')}</span>
                  </>
                ) : (
                  <span>{t('wallet.unlock_vault_to_view')}</span>
                )}
              </button>
            </div>
          ) : isDecrypting ? (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-2 border-indigo-200 border-t-indigo-600" />
              <p className="text-stone-500 mt-2 text-xs font-medium">{t('wallet.decrypting_claims')}</p>
            </div>
          ) : detail ? (
            <div className="space-y-8">
              {/* Student Document at top, centered */}
              <div className="flex flex-col items-center justify-center mb-8 relative group">
                {detail.photo ? (
                  <>
                    <div className="border border-stone-200 rounded p-1 bg-white shadow-sm shrink-0 flex flex-col items-center justify-center overflow-hidden w-full max-w-4xl relative">
                      {detail.photo.startsWith('data:application/pdf') || detail.photo.endsWith('.pdf') ? (
                        <object 
                          data={detail.photo} 
                          type="application/pdf" 
                          className="w-full aspect-[1.414/1] rounded"
                        >
                          <div className="p-8 text-center text-stone-500 text-sm flex flex-col items-center justify-center h-full bg-stone-50">
                            <span className="text-3xl mb-3">📄</span>
                            <p>{t('wallet.pdf_not_supported')}</p>
                            <a 
                              href={detail.photo} 
                              download={`document-${credential.id.substring(0, 8)}.pdf`} 
                              className="mt-4 px-4 py-2 bg-indigo-600 text-white rounded-lg font-bold hover:bg-indigo-700 transition-colors inline-block"
                            >
                              {t('wallet.download_pdf')}
                            </a>
                          </div>
                        </object>
                      ) : (
                        <img 
                          src={detail.photo.startsWith('data:') || detail.photo.startsWith('http') ? detail.photo : `data:image/jpeg;base64,${detail.photo}`} 
                          alt="Student Document" 
                          className="w-full h-auto object-contain rounded" 
                          onError={(e) => {
                            const target = e.target as HTMLImageElement;
                            target.style.display = 'none';
                            const parent = target.parentElement;
                            if (parent) {
                              const fallback = document.createElement('div');
                              fallback.className = 'p-6 text-center text-stone-500 text-xs';
                              fallback.innerHTML = `
                                <span class="text-2xl mb-2 block">⚠️</span>
                                ${t('wallet.failed_document_preview')}
                                <br/><a href="${detail.photo}" download="document" class="text-indigo-600 font-bold hover:underline mt-2 inline-block">${t('wallet.download_file')}</a>
                              `;
                              parent.appendChild(fallback);
                            }
                          }}
                        />
                      )}
                    </div>
                    
                    <div className="mt-4 w-full max-w-4xl flex justify-end">
                      <button 
                        onClick={() => {
                          const w = window.open('');
                          if (w) {
                            w.document.write('<!DOCTYPE html><html><head><title>Document Viewer</title></head><body style="margin:0;display:flex;align-items:center;justify-content:center;background:#1c1917;height:100vh;overflow:hidden;">');
                            if (detail.photo.startsWith('data:application/pdf') || detail.photo.endsWith('.pdf')) {
                              w.document.write(`<iframe src="${detail.photo}" frameborder="0" style="border:0; width:100%; height:100%;" allowfullscreen></iframe>`);
                            } else {
                              const imgSrc = detail.photo.startsWith('data:') || detail.photo.startsWith('http') ? detail.photo : `data:image/jpeg;base64,${detail.photo}`;
                              w.document.write(`<img src="${imgSrc}" style="max-width:100%;max-height:100%;object-fit:contain;" />`);
                            }
                            w.document.write('</body></html>');
                            w.document.close();
                          } else {
                            const a = document.createElement('a');
                            a.href = detail.photo;
                            a.target = '_blank';
                            a.click();
                          }
                        }}
                        className="flex items-center gap-2 px-4 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-lg text-xs font-semibold border border-stone-200 transition-colors shadow-sm cursor-pointer"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                        </svg>
                        {t('wallet.view_full_screen')}
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="w-24 h-36 bg-stone-150 border border-dashed border-stone-300 rounded flex flex-col items-center justify-center text-stone-400 font-medium text-[10px]">
                    <span className="text-xl mb-1">📄</span>
                    <span>{t('wallet.no_document')}</span>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* Student Information */}
                <div className="space-y-3">
                  <h4 className="text-xs font-bold text-stone-400 uppercase tracking-widest border-b border-stone-250 pb-1">
                    {t('wallet.student_info')}
                  </h4>
                  <div className="space-y-3 text-sm">
                    <div className="flex justify-between md:grid md:grid-cols-3 gap-2">
                      <span className="text-stone-500">{t('wallet.student_name')}</span>
                      <span className="font-semibold text-stone-900 md:col-span-2 text-right md:text-left">
                        {detail.name || '—'}
                      </span>
                    </div>
                    <div className="flex justify-between md:grid md:grid-cols-3 gap-2">
                      <span className="text-stone-500">{t('wallet.student_email')}</span>
                      <span className="font-semibold text-stone-900 md:col-span-2 text-right md:text-left break-all">
                        {detail.email || credential.holder_email || '—'}
                      </span>
                    </div>
                    <div className="flex justify-between md:grid md:grid-cols-3 gap-2">
                      <span className="text-stone-500">{t('wallet.student_id')}</span>
                      <span className="font-semibold text-stone-900 md:col-span-2 text-right md:text-left font-mono">
                        {detail.student_id || '—'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Credential Information */}
                <div className="space-y-3">
                  <h4 className="text-xs font-bold text-stone-400 uppercase tracking-widest border-b border-stone-250 pb-1">
                    {t('wallet.credential_info')}
                  </h4>
                  <div className="space-y-3 text-sm">
                    <div className="flex justify-between md:grid md:grid-cols-3 gap-2">
                      <span className="text-stone-500">{t('wallet.degree_type')}</span>
                      <span className="font-semibold text-stone-900 md:col-span-2 text-right md:text-left">
                        {detail.degree_type || '—'}
                      </span>
                    </div>
                    <div className="flex justify-between md:grid md:grid-cols-3 gap-2">
                      <span className="text-stone-500">{t('wallet.major')}</span>
                      <span className="font-semibold text-stone-900 md:col-span-2 text-right md:text-left">
                        {detail.major || '—'}
                      </span>
                    </div>
                    <div className="flex justify-between md:grid md:grid-cols-3 gap-2">
                      <span className="text-stone-500">{t('wallet.graduation_date')}</span>
                      <span className="font-semibold text-stone-900 md:col-span-2 text-right md:text-left">
                        {formatDate(detail.graduation_date)}
                      </span>
                    </div>
                    <div className="flex justify-between md:grid md:grid-cols-3 gap-2">
                      <span className="text-stone-500">{t('wallet.certificate_id')}</span>
                      <span className="font-semibold text-stone-900 md:col-span-2 text-right md:text-left font-mono">
                        {detail.certificate_id || '—'}
                      </span>
                    </div>
                    <div className="flex justify-between md:grid md:grid-cols-3 gap-2">
                      <span className="text-stone-500">{t('wallet.detail_issued_by')}</span>
                      <span className="font-semibold text-stone-900 md:col-span-2 text-right md:text-left">
                        {detail.institution || credential.institution_name || '—'}
                      </span>
                    </div>
                    <div className="flex justify-between md:grid md:grid-cols-3 gap-2">
                      <span className="text-stone-500">{t('wallet.issuer_did')}</span>
                      <span className="font-mono text-stone-600 text-xs md:col-span-2 text-right md:text-left break-all select-all">
                        {detail.iss || credential.issuer_did || '—'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Encryption Status Badge */}
              <div className="pt-6 border-t border-stone-200 flex flex-wrap justify-between items-center gap-4">
                <span className="inline-flex items-center gap-1.5 font-bold text-emerald-700 bg-emerald-50 border border-emerald-250 px-3 py-1.5 rounded text-xs uppercase tracking-wider">
                  {t('wallet.encrypted_badge')}
                </span>
                
                {/* Raw Collapsible */}
                <button
                  type="button"
                  onClick={() => setExpandedRawJwt(!expandedRawJwt)}
                  className="text-sm font-semibold text-indigo-650 hover:underline cursor-pointer"
                >
                  {expandedRawJwt ? t('wallet.hide_raw_token') : t('wallet.show_raw_token')}
                </button>
              </div>

              {expandedRawJwt && (
                <div className="p-4 bg-stone-50 border border-stone-200 rounded-lg">
                  <code className="font-mono text-xs block overflow-x-auto whitespace-pre-wrap break-all leading-relaxed text-stone-600">
                    {detail.rawJwt}
                  </code>
                </div>
              )}

            </div>
          ) : (
            <p className="text-center text-sm text-stone-400 py-12">{t('wallet.no_decrypted_claims')}</p>
          )}
        </div>
      </div>

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
                <button type="submit" disabled={isUnlocking} className="w-full bg-indigo-600 text-white font-semibold h-11 rounded-lg cursor-pointer">
                  {isUnlocking ? t('wallet.unlocking') : t('wallet.unlock_with_pin')}
                </button>
                {(unlockMethod === 'both' || !unlockMethod) && (
                  <button type="button" onClick={handleUnlockWithPasskeyClick} className="w-full border border-gray-300 text-gray-700 font-semibold h-11 rounded-lg cursor-pointer">
                    {t('wallet.unlock_with_passkey')}
                  </button>
                )}
                {/* Hide cancel button since this page is useless without unlock, but let them go back */}
                <Link to="/app/wallet" className="w-full text-gray-500 font-semibold h-11 rounded-lg flex items-center justify-center cursor-pointer hover:bg-stone-50">
                  {t('wallet.cancel_and_go_back')}
                </Link>
              </form>
            )}
            {(unlockMethod === 'passkey' || unlockMethod === 'biometric') && (
              <div className="flex flex-col gap-3 items-center text-center">
                {unlockError && <p className="text-rose-600 text-xs text-center font-semibold">{unlockError}</p>}
                <button type="button" onClick={handleUnlockWithPasskeyClick} disabled={isUnlocking} className="w-full bg-indigo-600 text-white font-semibold h-11 rounded-lg cursor-pointer">
                  {isUnlocking ? t('wallet.unlocking') : t('wallet.unlock_with_passkey')}
                </button>
                <Link to="/app/wallet" className="w-full text-gray-400 font-semibold h-11 rounded-lg flex items-center justify-center cursor-pointer hover:bg-stone-50">
                  {t('wallet.cancel_and_go_back')}
                </Link>
              </div>
            )}
          </div>
        </div>
      )}

      {toastMessage && (
        <div className="fixed bottom-24 right-4 md:right-6 bg-stone-900 text-white px-4 py-2.5 rounded-lg shadow-lg z-[1000] text-sm font-semibold">
          {toastMessage}
        </div>
      )}
    </div>
  )
}
