import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useZkVault } from '../../vault/zk-vault'
import { readDisclosures, peekJwt } from '../../lib/sdjwt'
import { readPrintedFields } from '../../lib/printedCredential'
import { displayClaim } from '../../lib/claimDisplay'
import PrintableCertificate from '../../components/PrintableCertificate'
import MuseumExportDialog from '../../components/MuseumExportDialog'
import { useLanguage, formatDegreeTitle } from '../../lib/i18n'
import VaultUnlockModal from '../../components/VaultUnlockModal'
import { FileText, Landmark, CheckCircle2, ShieldCheck, ArrowLeft, Maximize2, Code, X, Copy, Share2, Printer, Frame } from 'lucide-react'

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
  const [shareCount, setShareCount] = useState<number | undefined>(undefined)
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
  const [showRawTokenModal, setShowRawTokenModal] = useState(false)
  // The institution's printed (KH1:) copy, if it signed one: kept in the vault
  // beside the credential, so the holder can reprint it.
  const [printed, setPrinted] = useState<{
    payload: string; holder: string; documentId: string; institution: string; issueDate: string
  } | null>(null)
  const [showPrint, setShowPrint] = useState(false)
  const [showMuseum, setShowMuseum] = useState(false)

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

      // Best-effort — errors here (e.g. migration not yet applied) just
      // leave the share count unshown, they don't affect the credential itself.
      try {
        const { count } = await supabase
          .from('shares')
          .select('id', { count: 'exact', head: true })
          .eq('owner', user.id)
          .eq('credential_id', data.id)
        setShareCount(count ?? 0)
      } catch {
        // non-fatal
      }
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
          let decrypted: { sdjwt: string; printed?: string }
          if (cred.cipher && cred.iv) {
            decrypted = await decryptPayload({ cipher: cred.cipher, iv: cred.iv }) as { sdjwt: string; printed?: string }
          } else {
            const parsedPayload = JSON.parse(cred.sd_jwt)
            decrypted = await decryptPayload(parsedPayload) as { sdjwt: string; printed?: string }
          }
          const sdjwtString = decrypted.sdjwt

          if (typeof decrypted.printed === 'string') {
            // The paper shows exactly what the code signs — taken from the code.
            const f = await readPrintedFields(decrypted.printed)
            if (f) {
              setPrinted({
                payload: decrypted.printed, holder: f.subjectName, documentId: f.documentId,
                institution: f.issuingOrganisation, issueDate: f.issueDate,
              })
            }
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
              fields.degree_type = payload.degree_type || payload.degree || ''
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

  // A stacked label/value field row — English is a small technical caption
  // under the Khmer label, the value renders exactly as stored (no
  // translation), and a genuinely-absent value gets an explicit "not
  // specified" instead of an em dash so it can't be mistaken for hidden data.
  const renderField = (label: string, sublabel: string, value: any, mono = false) => {
    const has = value !== undefined && value !== null && value !== ''
    return (
      <div className={`flex justify-between items-start gap-3 px-4 py-3 border-b border-stone-100 last:border-b-0 ${has ? '' : 'bg-amber-50/60'}`}>
        <span className="font-khmer text-[13px] text-stone-500 shrink-0">
          {label}
          <span className="block font-sans text-[10px] text-stone-400 mt-0.5">{sublabel}</span>
        </span>
        {has ? (
          <span className={`font-semibold text-stone-900 text-right break-words ${mono ? 'font-mono text-xs' : 'text-sm'}`}>{value}</span>
        ) : (
          <span className="font-khmer text-amber-700 italic text-xs text-right shrink-0">{t('wallet.not_specified')}</span>
        )}
      </div>
    )
  }

  return (
    <div className="w-full md:max-w-4xl mx-auto px-4 md:px-0 pb-24">
      {/* Back link */}
      <Link to="/app/wallet" className="inline-flex items-center gap-1 text-sm font-semibold text-gray-500 hover:text-indigo-600 transition-colors mb-4">
        <ArrowLeft size={16} />
        {t('wallet.back_to_wallet')}
      </Link>

      {/* Hero — institution, degree title, trust chips. Uses the DB row
          (available pre-unlock) rather than the decrypted claims, so it
          renders immediately even before the vault is unlocked. */}
      <div className="bg-indigo-600 rounded-2xl p-5 text-white mb-4">
        <div className="flex items-center gap-2.5 mb-3">
          <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center shrink-0">
            <Landmark size={16} strokeWidth={2} />
          </div>
          <div className="min-w-0">
            <div className="font-khmer text-[13px] font-semibold truncate">
              {credential.institution_name || t('wallet.institution_unknown')}
            </div>
            {credential.issuer_did && (
              <div className="font-mono text-[10px] text-white/70 truncate">{credential.issuer_did}</div>
            )}
          </div>
        </div>
        <div className="font-khmer text-2xl font-bold leading-snug">{formatDegreeTitle(credential.degree_title)}</div>
        <div className="flex items-center gap-4 mt-3 pt-3 border-t border-white/20">
          <span className="inline-flex items-center gap-1.5 text-[11px] text-teal-100">
            <CheckCircle2 size={12} className="text-teal-300" />
            {t('wallet.trust_accredited_institution')}
          </span>
          <span className="inline-flex items-center gap-1.5 text-[11px] text-teal-100">
            <ShieldCheck size={12} className="text-teal-300" />
            {t('wallet.trust_encrypted_vault')}
          </span>
          <span className="inline-flex items-center gap-1.5 text-[11px] text-teal-100">
            <Share2 size={12} className="text-teal-300" />
            {t('wallet.share_count_label', { count: shareCount ?? 0 })}
          </span>
        </div>
      </div>

      <button
        onClick={() => navigate(`/app/share/${credential.id}`)}
        className="w-full bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-semibold h-12 rounded-xl text-sm transition-all focus:outline-none flex items-center justify-center gap-2 cursor-pointer mb-4"
      >
        {t('wallet.share_credential')}
      </button>

      {isUnlocked && detail && (
        <div className="grid grid-cols-2 gap-3 mb-4">
          <button
            type="button"
            disabled={!printed}
            title={printed ? undefined : t('wallet.no_printed_copy')}
            onClick={() => setShowPrint(true)}
            className="h-11 rounded-xl border border-stone-300 bg-white text-stone-800 text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-40"
          >
            <Printer size={15} /> {t('print.reprint')}
          </button>
          <button
            type="button"
            disabled={credential?.credential_type === 'identity_attestation'}
            onClick={() => setShowMuseum(true)}
            className="h-11 rounded-xl border border-stone-300 bg-white text-stone-800 text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-40"
          >
            <Frame size={15} /> {t('museum.export_button')}
          </button>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="p-5 md:p-8 text-sm text-left">
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
                            <FileText size={28} className="mb-3 text-stone-400" />
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
                                <svg class="mx-auto mb-2" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:#f59e0b"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
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
                        <Maximize2 size={14} />
                        {t('wallet.view_full_screen')}
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="w-24 h-36 bg-stone-150 border border-dashed border-stone-300 rounded flex flex-col items-center justify-center text-stone-400 font-medium text-[10px]">
                    <FileText size={20} className="mb-1" />
                    <span>{t('wallet.no_document')}</span>
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-6">
                {/* Student Information */}
                <div>
                  <div className="font-mono text-[9px] tracking-widest text-stone-400 uppercase mb-2">
                    {t('wallet.student_info')}
                  </div>
                  <div className="bg-white border border-stone-200 rounded-xl overflow-hidden">
                    {renderField(t('wallet.student_name'), 'Full name', detail.name)}
                    {renderField(t('wallet.student_email'), 'Email', detail.email || credential.holder_email)}
                    {credential.credential_type !== 'employment_record' && credential.credential_type !== 'identity_attestation' && renderField(t('wallet.student_id'), 'Student ID', detail.student_id, true)}
                  </div>
                </div>

                {/* Credential Information */}
                <div>
                  <div className="font-mono text-[9px] tracking-widest text-stone-400 uppercase mb-2">
                    {t('wallet.credential_info')}
                  </div>
                  <div className="bg-white border border-stone-200 rounded-xl overflow-hidden">
                    {/* `degree` is the pre-6502ec7 claim name (see git history) —
                        credentials signed before that fix disclose it under
                        "degree" instead of "degree_type", and since an SD-JWT's
                        disclosures are fixed forever at signing time, a code
                        fix alone can't correct already-issued ones. Falling
                        back to it here is the only way those still render. */}
                    {credential.credential_type === 'identity_attestation' ? (
                      <>
                        {renderField(t('proof.field_evidence_type'), 'Document seen', detail.evidence_type ? displayClaim(t, 'evidence_type', detail.evidence_type, null) : null)}
                        {renderField(t('proof.field_verification_level'), 'How it was checked', detail.verification_level ? displayClaim(t, 'verification_level', detail.verification_level, null) : null)}
                        {renderField(t('proof.field_verified_on'), 'Checked on', detail.verified_on ? formatDate(detail.verified_on) : null)}
                      </>
                    ) : credential.credential_type === 'employment_record' ? (
                      <>
                        {renderField(t('proof.field_job_title'), 'Job title', detail.job_title)}
                        {renderField(t('proof.field_employment_type'), 'Employment type', detail.employment_type ? displayClaim(t, 'employment_type', detail.employment_type, null) : null)}
                        {renderField(t('proof.field_department'), 'Department', detail.department)}
                        {renderField(t('proof.field_employment_start'), 'Started', detail.employment_start ? formatDate(detail.employment_start) : null)}
                        {renderField(t('proof.field_employment_status'), 'Status', detail.employment_end
                          ? `${t('proof.employment_ended')} ${formatDate(detail.employment_end)}`
                          : detail.employment_status ? displayClaim(t, 'employment_status', detail.employment_status, typeof detail.iat === 'number' ? detail.iat : peekJwt(detail.rawJwt).iat) : null)}
                        {renderField(t('proof.field_role_description'), 'Role', detail.role_description)}
                      </>
                    ) : (
                      <>
                    {renderField(t('wallet.degree_type'), 'Degree type', formatDegreeTitle(detail.degree_type || detail.degree) || undefined)}
                      {renderField(t('wallet.major'), 'Major', detail.major)}
                      {renderField(t('wallet.graduation_date'), 'Graduation date', detail.graduation_date ? formatDate(detail.graduation_date) : null)}
                      {renderField(t('wallet.certificate_id'), 'Certificate ID', detail.certificate_id, true)}
                      </>
                    )}
                    {renderField(t('wallet.detail_issued_by'), 'Issued by', detail.institution || credential.institution_name)}
                    {renderField(t('wallet.issuer_did'), 'Institution DID', detail.iss || credential.issuer_did, true)}
                    {renderField(t('wallet.issue_date_label'), 'Issue date', credential.created_at ? formatDate(credential.created_at) : null)}
                  </div>
                </div>
              </div>

              {/* Encryption Status Badge */}
              <div className="pt-6 border-t border-stone-200 flex flex-wrap justify-between items-center gap-4">
                <span className="inline-flex items-center gap-1.5 font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded text-xs uppercase tracking-wider">
                  <CheckCircle2 size={13} />
                  {t('wallet.encrypted_badge')}
                </span>

                {/* De-emphasized on purpose: this exports every field with no
                    selective disclosure, unlike Share — not a primary action. */}
                <button
                  type="button"
                  onClick={() => setShowRawTokenModal(true)}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-stone-500 hover:text-stone-700 cursor-pointer"
                >
                  <Code size={13} />
                  {t('wallet.raw_token_trigger')}
                </button>
              </div>

            </div>
          ) : (
            <p className="text-center text-sm text-stone-400 py-12">{t('wallet.no_decrypted_claims')}</p>
          )}
        </div>
      </div>

      {/* RAW TOKEN MODAL — overlay, not an inline expand, so opening it doesn't
          shove the rest of the page down. Code box scrolls internally and is
          capped in height so one very long credential can't blow out the modal. */}
      {showRawTokenModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[85vh] animate-scale-in">
            <div className="px-5 py-4 border-b border-stone-200 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-stone-900">{t('wallet.raw_token_modal_title')}</h3>
                <p className="text-xs text-stone-400 mt-0.5">{t('wallet.raw_token_modal_subtitle')}</p>
              </div>
              <button
                type="button"
                onClick={() => setShowRawTokenModal(false)}
                className="p-1.5 -m-1.5 text-stone-400 hover:text-stone-700 hover:bg-stone-100 rounded-full transition-colors cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <div className="px-5 pt-4">
              <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs leading-relaxed rounded-lg px-3.5 py-3">
                {t('wallet.raw_token_modal_warning')}
              </div>
            </div>

            <div className="p-5">
              <code className="block max-h-64 overflow-y-auto font-mono text-[11px] whitespace-pre-wrap break-all leading-relaxed text-stone-600 bg-stone-50 border border-stone-200 rounded-lg p-4">
                {detail?.rawJwt}
              </code>
            </div>

            <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-t border-stone-200 bg-stone-50">
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(detail?.rawJwt || '')
                    showToast(t('wallet.copied'))
                  } catch {
                    showToast(t('wallet.copy_failed'))
                  }
                }}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-650 hover:underline cursor-pointer"
              >
                <Copy size={12} />
                {t('wallet.copy')}
              </button>
              <span className="font-mono text-[10px] text-stone-400">ES256 · dc+sd-jwt</span>
            </div>
          </div>
        </div>
      )}

      {showPrint && printed && (
        <PrintableCertificate
          payload={printed.payload}
          title={formatDegreeTitle(credential.degree_title)}
          holder={printed.holder}
          documentId={printed.documentId}
          institution={printed.institution}
          issueDate={printed.issueDate}
          onClose={() => setShowPrint(false)}
        />
      )}

      {showMuseum && detail && (
        <MuseumExportDialog
          credentialId={credential.id}
          issuerDid={credential.issuer_did}
          sdjwt={detail.rawJwt}
          jti={peekJwt(detail.rawJwt).jti}
          claims={detail}
          credentialType={credential.credential_type ?? null}
          title={formatDegreeTitle(credential.degree_title)}
          printed={printed?.payload ?? null}
          onClose={() => setShowMuseum(false)}
        />
      )}

      {/* UNLOCK MODAL — cancel navigates back to the wallet rather than just
          closing, since this page has nothing to show without unlocking. */}
      {showUnlockModal && (
        <VaultUnlockModal
          unlockMethod={unlockMethod}
          pinInput={pinInput}
          onPinChange={setPinInput}
          onSubmitPin={handleUnlockSubmit}
          onPasskeyClick={handleUnlockWithPasskeyClick}
          isUnlocking={isUnlocking}
          unlockError={unlockError}
          onCancel={() => navigate('/app/wallet')}
          cancelLabel={t('wallet.cancel_and_go_back')}
        />
      )}

      {toastMessage && (
        <div className="fixed bottom-24 right-4 md:right-6 bg-stone-900 text-white px-4 py-2.5 rounded-lg shadow-lg z-[1000] text-sm font-semibold">
          {toastMessage}
        </div>
      )}
    </div>
  )
}
