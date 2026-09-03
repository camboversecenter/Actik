import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { generateIssuerKeys } from '../../lib/did'
import { useZkVault } from '../../vault/zk-vault/hooks'
import {
  Building2,
  Globe,
  ShieldCheck,
  ShieldAlert,
  Award,
  Copy,
  Check,
  Calendar,
  ArrowRight,
  Settings,
  Clock,
  ChevronUp,
  ChevronDown,
  Loader2
} from 'lucide-react'
import { useLanguage } from '../../lib/i18n'
import LanguageSwitcher from '../../components/LanguageSwitcher'
import PageHeader from '../../components/ui/PageHeader'

const MIN_PIN_LEN = 8

interface IssuerInfo {
  id: string
  name: string
  domain: string
  type: string
  did: string
  accredited: boolean
  accredited_at: string | null
  revoked_at: string | null
  public_key: string | null
  created_at: string | null
  updated_at?: string | null
}

export default function InstitutionSettings() {
  const navigate = useNavigate()
  const { t } = useLanguage()
  const { setupVault, encryptPayload } = useZkVault()
  const [currentUser, setCurrentUser] = useState<any | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [issuer, setIssuer] = useState<IssuerInfo | null>(null)

  // Copy indicators
  const [copiedKey, setCopiedKey] = useState(false)
  const [toastMessage, setToastMessage] = useState<string | null>(null)

  // Danger-zone key regeneration state (deliberate, rare — invalidates all
  // previously issued certificates since there is no key-history/versioning)
  const [showRegenerateConfirm, setShowRegenerateConfirm] = useState(false)
  const [regenerateAck, setRegenerateAck] = useState(false)
  const [regeneratePin, setRegeneratePin] = useState('')
  const [isRegenerating, setIsRegenerating] = useState(false)
  const [regenerateError, setRegenerateError] = useState<string | null>(null)

  const showToast = (msg: string) => {
    setToastMessage(msg)
    setTimeout(() => setToastMessage(null), 3000)
  }

  const handleCopyPublicKey = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedKey(true)
      setTimeout(() => setCopiedKey(false), 2000)
      showToast(t('settings.copied'))
    } catch {
      showToast(t('settings.copy_failed'))
    }
  }

  const fetchIssuerProfile = useCallback(async (user: any) => {
    try {
      setLoading(true)
      setLoadError(false)

      // Query standard "owner" column first
      let { data, error } = await supabase
        .from('issuers')
        .select('*')
        .eq('owner', user.id)
        .maybeSingle()

      // Fallback if owner column is missing in custom schema config
      if (error && (error.message.includes('owner') || error.code === '42703')) {
        const fallback = await supabase
          .from('issuers')
          .select('*')
          .eq('owner', user.id)
          .maybeSingle()
        data = fallback.data
        error = fallback.error
      }

      if (error) throw error

      if (data) {
        // Derive domain if not explicitly stored
        let domainVal = data.domain || ''
        if (!domainVal && data.did && data.did.startsWith('did:web:')) {
          domainVal = decodeURIComponent(data.did.substring(8))
        }

        // Parse key representation
        let keyVal = null
        if (data.public_key) {
          keyVal = data.public_key
        } else if (data.public_jwk) {
          keyVal = typeof data.public_jwk === 'string' ? data.public_jwk : JSON.stringify(data.public_jwk, null, 2)
        }

        setIssuer({
          id: data.id,
          name: data.name,
          domain: domainVal || 'Not Specified',
          type: data.type || 'University',
          did: data.did,
          accredited: !!data.accredited,
          accredited_at: data.accredited_at || null,
          revoked_at: data.revoked_at || null,
          public_key: keyVal,
          created_at: data.created_at || null,
          updated_at: data.updated_at || null
        })
      } else {
        setIssuer(null)
      }

      setLoading(false)
    } catch (err) {
      setLoadError(true)
      setLoading(false)
    }
  }, [])

  // Danger zone: deliberately rotate the signing key. This permanently
  // invalidates every certificate issued with the previous key, since there
  // is no key-history/versioning — this only runs on explicit, confirmed
  // user action (checkbox + new PIN required).
  const handleDangerRegenerate = async () => {
    if (!currentUser || !issuer) return
    if (!regenerateAck || regeneratePin.trim().length < MIN_PIN_LEN) return

    setIsRegenerating(true)
    setRegenerateError(null)

    try {
      const { publicJwk, privateJwk } = await generateIssuerKeys()

      const setupOk = await setupVault(regeneratePin, currentUser.id, currentUser.email, { skipPasskey: true })
      if (!setupOk) throw new Error('Failed to secure your new signing key. Please try again.')

      const ciphertext = await encryptPayload(privateJwk)
      let res = await supabase
        .from('issuers')
        .update({ public_jwk: publicJwk, signing_key_ciphertext: ciphertext })
        .eq('owner', currentUser.id)

      if (res.error && (res.error.message.includes('owner') || res.error.message.includes('public_jwk') || res.error.code === '42703')) {
        res = await supabase
          .from('issuers')
          .update({ public_key: JSON.stringify(publicJwk), signing_key_ciphertext: ciphertext })
          .eq('user_id', currentUser.id)
      }

      if (res.error) throw res.error

      sessionStorage.setItem('issuer_private_key', JSON.stringify(privateJwk))
      sessionStorage.setItem('issuer_did', issuer.did)

      setIssuer(prev => prev && { ...prev, public_key: JSON.stringify(publicJwk, null, 2) })
      setShowRegenerateConfirm(false)
      setRegenerateAck(false)
      setRegeneratePin('')
    } catch (err: any) {
      setRegenerateError(err.message || 'Failed to regenerate keys. Please try again.')
    } finally {
      setIsRegenerating(false)
    }
  }

  useEffect(() => {
    let active = true
    async function checkAuth() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session || !session.user) {
        navigate('/auth/login', { replace: true })
        return
      }

      if (active) {
        setCurrentUser(session.user)
        fetchIssuerProfile(session.user)
      }
    }
    checkAuth()
    return () => { active = false }
  }, [navigate, fetchIssuerProfile])

  // Helper: Truncate long key strings for display
  const truncateKey = (key: string | null) => {
    if (!key) return ''
    if (key.length <= 60) return key
    return key.slice(0, 30) + ' ... ' + key.slice(-30)
  }

  // Visual status mapping
  const getAccreditationStatus = () => {
    if (!issuer) return null

    if (issuer.revoked_at) {
      return {
        label: t('settings.accreditation_revoked'),
        desc: `${t('settings.accreditation_revoked_on')} ${new Date(issuer.revoked_at).toLocaleDateString()}`,
        badgeStyle: 'bg-rose-50 text-rose-700 border-rose-200',
        icon: <ShieldAlert size={20} className="text-rose-500" />
      }
    }

    if (issuer.accredited) {
      return {
        label: t('settings.accredited'),
        desc: `${t('settings.approved_by_moeys')}${issuer.accredited_at ? ` ${t('settings.approved_by_moeys_on')} ${new Date(issuer.accredited_at).toLocaleDateString()}` : ''}`,
        badgeStyle: 'bg-emerald-50 text-emerald-700 border-emerald-200',
        icon: <ShieldCheck size={20} className="text-emerald-500" />
      }
    }

    return {
      label: t('settings.pending_approval'),
      desc: t('settings.awaiting_moeys_approval'),
      badgeStyle: 'bg-amber-50 text-amber-700 border-amber-200',
      icon: <Award size={20} className="text-amber-500" />
    }
  }

  const status = getAccreditationStatus()

  return (
    <div className="w-full md:max-w-3xl mx-auto pb-24 px-4 md:px-0">
      <PageHeader icon={Settings} title={t('settings.title')} subtitle={t('settings.subtitle')} />

      {loading && (
        <div className="flex flex-col items-center justify-center py-20 bg-white border border-gray-200 rounded-2xl shadow-sm">
          <div className="animate-spin rounded-full h-10 w-10 border-4 border-indigo-200 border-t-indigo-600" />
          <p className="text-stone-500 mt-4 font-medium">{t('settings.status_loading')}</p>
        </div>
      )}

      {loadError && !loading && (
        <div className="w-full bg-rose-50 border border-rose-200 text-rose-700 rounded-2xl p-6 text-center shadow-sm">
          <h3 className="font-semibold text-rose-900 text-lg mb-2">{t('settings.status_failed')}</h3>
          <p className="text-sm text-rose-700 mb-4">{t('settings.status_error')}</p>
          <button 
            className="bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white font-semibold h-11 px-6 rounded-lg text-sm transition-colors cursor-pointer" 
            onClick={() => fetchIssuerProfile(currentUser)}
          >
            {t('settings.retry_btn')}
          </button>
        </div>
      )}

      {!loading && !loadError && !issuer && (
        <div className="bg-white border border-gray-200 shadow-sm rounded-2xl p-12 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-indigo-50 text-indigo-600 mb-4">
            <Building2 size={32} />
          </div>
          <h3 className="text-lg font-bold text-stone-900">{t('settings.no_inst_registered')}</h3>
          <p className="text-sm text-stone-500 max-w-sm mx-auto mt-2 mb-6 leading-relaxed">
            {t('settings.no_inst_desc')}
          </p>
          <button
            onClick={() => navigate('/app/register-issuer')}
            className="bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-semibold h-11 px-6 rounded-lg text-sm flex items-center justify-center gap-1.5 mx-auto cursor-pointer shadow-sm"
          >
            <span>{t('settings.register_inst_btn')}</span>
            <ArrowRight size={16} />
          </button>
        </div>
      )}

      {!loading && !loadError && issuer && (
        <div className="space-y-6">
          
          {/* Language Switcher Card */}
          <LanguageSwitcher prefix="settings" />

          {/* Card A: Institution Profile Card */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
            <h3 className="text-sm font-bold text-stone-900 tracking-tight mb-5 flex items-center gap-2">
              <Building2 size={18} className="text-indigo-500" />
              <span>{t('settings.inst_profile')}</span>
            </h3>

            <div className="space-y-3 text-sm">
              <div className="flex justify-between items-center py-2 border-b border-gray-100 gap-4">
                <span className="text-gray-500 shrink-0">{t('settings.official_name')}</span>
                <strong className="text-stone-900 font-semibold text-right">{issuer.name}</strong>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-gray-100 gap-4">
                <span className="text-gray-500 shrink-0">{t('settings.inst_domain')}</span>
                <strong className="text-stone-900 font-medium flex items-center gap-1.5">
                  <Globe size={14} className="text-stone-400" />
                  <span>{issuer.domain}</span>
                </strong>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-gray-100">
                <span className="text-gray-500">{t('settings.inst_type')}</span>
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-100">
                  {issuer.type}
                </span>
              </div>
              <div className={`flex justify-between items-center py-2 ${issuer.updated_at ? 'border-b border-gray-100' : ''}`}>
                <span className="text-gray-500">{t('settings.registered_date')}</span>
                <strong className="text-stone-900 font-medium flex items-center gap-1.5">
                  <Calendar size={14} className="text-stone-400" />
                  <span>{issuer.created_at ? new Date(issuer.created_at).toLocaleDateString() : 'N/A'}</span>
                </strong>
              </div>
              {issuer.updated_at && (
                <div className="flex justify-between items-center py-2">
                  <span className="text-gray-500">{t('settings.updated_date')}</span>
                  <strong className="text-stone-900 font-medium flex items-center gap-1.5">
                    <Calendar size={14} className="text-stone-400" />
                    <span>{new Date(issuer.updated_at).toLocaleDateString()}</span>
                  </strong>
                </div>
              )}
            </div>
          </div>

          {/* Card B: Decentralized Identity (DID) */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
            <div className="mb-4">
              <h3 className="text-sm font-bold text-stone-900 tracking-tight flex items-center gap-2">
                <Globe size={18} className="text-indigo-500" />
                <span>{t('settings.did_title')}</span>
              </h3>
            </div>

            <div className="space-y-1 mb-4">
              <span className="text-[10px] font-bold text-stone-400 uppercase tracking-wider block">
                {t('settings.did_label')}
              </span>
              <code className="text-xs bg-stone-50 border border-stone-200 p-2.5 rounded block font-mono text-stone-600 break-all select-all leading-normal">
                {issuer.did}
              </code>
            </div>

            <p className="text-xs text-stone-500 leading-relaxed">
              <strong>{t('settings.did_desc_label')}</strong> {t('settings.did_desc_text')}
            </p>
          </div>

          {/* Card C: Accreditation Status Card */}
          {status && (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
              <h3 className="text-sm font-bold text-stone-900 tracking-tight mb-5 flex items-center gap-2">
                <Award size={18} className="text-indigo-500" />
                <span>{t('settings.accreditation_status')}</span>
              </h3>

              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 rounded-xl border gap-4 bg-stone-50/50">
                <div className="flex items-center gap-3">
                  <div className="shrink-0">
                    {status.icon}
                  </div>
                  <div>
                    <strong className="text-stone-900 font-semibold text-sm block leading-snug">
                      {status.label}
                    </strong>
                    <span className="text-xs text-stone-500 mt-0.5 block">
                      {status.desc}
                    </span>
                  </div>
                </div>

                <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-bold border uppercase tracking-wider ${status.badgeStyle}`}>
                  {status.label}
                </span>
              </div>

              {!issuer.accredited && !issuer.revoked_at && (
                <div className="mt-4 bg-amber-50/50 border border-amber-200 text-amber-800 rounded-xl p-3.5 text-xs leading-relaxed flex gap-2">
                  <Clock size={16} className="shrink-0 text-amber-500" />
                  <p className="margin-0">
                    {t('settings.accreditation_pending_desc')}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Card D: Public Key Section */}
          {issuer.public_key && (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
              <div className="flex justify-between items-start mb-4">
                <h3 className="text-sm font-bold text-stone-900 tracking-tight flex items-center gap-2">
                  <Award size={18} className="text-indigo-500" />
                  <span>{t('settings.public_key_title')}</span>
                </h3>
                <button
                  onClick={() => handleCopyPublicKey(issuer.public_key || '')}
                  className="text-stone-500 hover:text-indigo-600 transition-colors flex items-center gap-1 text-xs font-semibold p-1 hover:bg-stone-50 rounded cursor-pointer"
                >
                  {copiedKey ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                  <span>{copiedKey ? t('settings.copied_btn') : t('settings.copy_btn')}</span>
                </button>
              </div>

              <div className="bg-stone-50 border border-stone-200 rounded-xl p-3.5 mb-4">
                <code className="font-mono text-[10px] block overflow-x-auto text-gray-600 break-all leading-normal">
                  {truncateKey(issuer.public_key)}
                </code>
              </div>

              <p className="text-xs text-stone-500 leading-relaxed">
                <strong>{t('settings.public_key_desc_label')}</strong> {t('settings.public_key_desc_text')}
              </p>
            </div>
          )}

          {/* Danger zone: deliberate, rare key rotation. Only shown once the
              institution is accredited (there's no meaningful "in production"
              key to rotate before that). */}
          {issuer.accredited && (
            <div className="border border-rose-200 rounded-xl overflow-hidden">
              <button
                type="button"
                onClick={() => setShowRegenerateConfirm(!showRegenerateConfirm)}
                className="w-full px-6 py-4 flex justify-between items-center bg-rose-50 border-none cursor-pointer text-left"
              >
                <span className="text-sm font-bold text-rose-700">Danger zone: Regenerate signing key</span>
                {showRegenerateConfirm ? <ChevronUp size={16} className="text-rose-400" /> : <ChevronDown size={16} className="text-rose-400" />}
              </button>

              {showRegenerateConfirm && (
                <div className="p-6 bg-white space-y-4">
                  <p className="text-sm text-stone-600 leading-relaxed">
                    This creates a brand-new signing key. <strong>Every certificate issued with your current key will permanently fail verification</strong> — this cannot be undone. Only do this if you believe your key has been compromised.
                  </p>

                  <label className="flex items-start gap-2 text-sm text-stone-700">
                    <input
                      type="checkbox"
                      checked={regenerateAck}
                      onChange={(e) => setRegenerateAck(e.target.checked)}
                      className="mt-1"
                    />
                    <span>I understand this permanently invalidates every previously issued certificate.</span>
                  </label>

                  <div>
                    <label className="text-xs md:text-sm font-bold text-gray-700 block">New signing PIN</label>
                    <input
                      type="password"
                      value={regeneratePin}
                      onChange={(e) => setRegeneratePin(e.target.value)}
                      placeholder={`Create a ${MIN_PIN_LEN}+ character PIN`}
                      autoComplete="new-password"
                      className="mt-1 block w-full max-w-xs rounded-lg border border-gray-300 px-3 h-11 text-sm focus:border-rose-500 focus:outline-none focus:ring-1 focus:ring-rose-500 bg-white text-stone-900"
                    />
                  </div>

                  {regenerateError && (
                    <div className="bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-lg p-3 font-semibold">
                      {regenerateError}
                    </div>
                  )}

                  <button
                    onClick={handleDangerRegenerate}
                    disabled={!regenerateAck || regeneratePin.trim().length < MIN_PIN_LEN || isRegenerating}
                    className="bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white font-semibold h-11 px-6 rounded-lg text-sm transition-all focus:outline-none flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                  >
                    {isRegenerating && <Loader2 size={18} className="animate-spin" />}
                    <span>Permanently regenerate signing key</span>
                  </button>
                </div>
              )}
            </div>
          )}
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
