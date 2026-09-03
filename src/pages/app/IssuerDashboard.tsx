import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { generateIssuerKeys, didWeb } from '../../lib/did'
import { Building2, FileSignature, Award, CheckCircle2, Clock, Eye, ArrowRight, Loader2 } from 'lucide-react'

import { useLanguage } from '../../lib/i18n'
import { useZkVault } from '../../vault/zk-vault/hooks'
import IssuerKeyUnlock from '../../components/IssuerKeyUnlock'
import PageHeader from '../../components/ui/PageHeader'
import StatCard from '../../components/ui/StatCard'
import Banner from '../../components/ui/Banner'

const MIN_PIN_LEN = 8

interface IssuerInfo {
  id: string
  name: string
  domain: string
  type: string
  did: string
  accredited: boolean
  rawIssuerData: any
}

export default function IssuerDashboard() {
  const { t } = useLanguage()
  const navigate = useNavigate()
  const { setupVault, encryptPayload } = useZkVault()
  const [currentUser, setCurrentUser] = useState<any | null>(null)

  // Loading & state management
  const [loading, setLoading] = useState(true)
  const [issuerInfo, setIssuerInfo] = useState<IssuerInfo | null>(null)
  const [privateKey, setPrivateKey] = useState<any | null>(null)

  // Registration Form Fields
  const [regName, setRegName] = useState('')
  const [regDomain, setRegDomain] = useState('')
  const [regType, setRegType] = useState('')
  const [regSigningPin, setRegSigningPin] = useState('')
  const [regErrors, setRegErrors] = useState<Record<string, string>>({})
  const [regSubmitError, setRegSubmitError] = useState<string | null>(null)
  const [isRegistering, setIsRegistering] = useState(false)
  const [registerSuccessMsg, setRegisterSuccessMsg] = useState<string | null>(null)

  // Quick stats: certificates issued by this institution
  const [stats, setStats] = useState<{ total: number; claimed: number; pending: number; verifications: number } | null>(null)


  // Check registration and keys on mount/update
  useEffect(() => {
    let active = true

    async function loadDashboardData() {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session || !session.user) {
          navigate('/auth/login', { replace: true })
          return
        }

        if (active) {
          setCurrentUser(session.user)
        }

        // Query issuers table (trying owner first as per schema.sql)
        let { data: issuerData, error: issuerError } = await supabase
          .from('issuers')
          .select('*')
          .eq('owner', session.user.id)
          .maybeSingle()

        if (issuerError && (issuerError.message.includes('owner') || issuerError.code === 'PGRST204')) {
          const fallback = await supabase
            .from('issuers')
            .select('*')
            .eq('owner', session.user.id)
            .maybeSingle()
          issuerData = fallback.data
          issuerError = fallback.error
        }

        if (!active) return

        if (issuerData) {
          // Extract domain
          let domainVal = issuerData.domain || ''
          if (!domainVal && issuerData.did && issuerData.did.startsWith('did:web:')) {
            domainVal = decodeURIComponent(issuerData.did.substring(8))
          }

          setIssuerInfo({
            id: issuerData.id,
            name: issuerData.name,
            domain: domainVal,
            type: issuerData.type || 'University',
            did: issuerData.did,
            accredited: !!issuerData.accredited,
            rawIssuerData: issuerData
          })

          // Retrieve private key from sessionStorage
          const keyJson = sessionStorage.getItem('issuer_private_key')
          if (keyJson) {
            setPrivateKey(JSON.parse(keyJson))
          } else {
            setPrivateKey(null)
          }

          // Quick stats: how many certificates this institution has issued
          const [claimedRes, pendingRes, sharesRes] = await Promise.all([
            supabase.from('credentials').select('*', { count: 'exact', head: true }).eq('issuer_did', issuerData.did),
            supabase.from('pending_credentials').select('*', { count: 'exact', head: true }).eq('issuer_did', issuerData.did),
            // Best-effort: view_count is summed client-side since Supabase-js
            // has no clean aggregate select; a failure here (e.g. migration
            // not yet applied) just leaves the verifications stat at 0.
            // TODO: unbounded select — PostgREST's default 1000-row cap means
            // this will silently under-count once a high-volume issuer's
            // shares pass that many rows. Fine for now; revisit with a
            // server-side sum (RPC or view) if that becomes real.
            supabase.from('shares').select('view_count').eq('issuer_did', issuerData.did)
          ])
          if (active) {
            const claimed = claimedRes.count || 0
            const pending = pendingRes.count || 0
            const verifications = (sharesRes.data || []).reduce(
              (sum: number, row: any) => sum + (row.view_count || 0), 0
            )
            setStats({ claimed, pending, total: claimed + pending, verifications })
          }
        } else {
          setIssuerInfo(null)
        }

        setLoading(false)
      } catch (err) {
        console.error('Failed to load dashboard data:', err)
        if (active) {
          setLoading(false)
        }
      }
    }

    loadDashboardData()
    return () => { active = false }
  }, [navigate])


  // Registration Domain validation helper
  const handleDomainBlur = () => {
    let clean = regDomain.trim()
    clean = clean.replace(/^(https?:\/\/)?(www\.)?/, '')
    clean = clean.split('/')[0]
    setRegDomain(clean)
  }

  // Handle Institution Registration
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!currentUser) return

    // Validate
    const nextErrors: Record<string, string> = {}
    if (regName.trim().length < 3) {
      nextErrors.name = 'Institution name must be at least 3 characters.'
    }
    if (!regDomain.trim()) {
      nextErrors.domain = 'Domain is required.'
    } else if (regDomain.includes(' ')) {
      nextErrors.domain = 'Domain must not contain spaces.'
    } else if (!regDomain.includes('.')) {
      nextErrors.domain = 'Domain must contain at least one dot.'
    }
    if (!regType) {
      nextErrors.type = 'Please select an institution type.'
    }
    if (regSigningPin.trim().length < MIN_PIN_LEN) {
      nextErrors.signingPin = `Signing PIN must be at least ${MIN_PIN_LEN} characters.`
    }

    if (Object.keys(nextErrors).length > 0) {
      setRegErrors(nextErrors)
      return
    }

    setRegErrors({})
    setRegSubmitError(null)
    setIsRegistering(true)

    try {
      // 1. Generate keys
      const { publicJwk, privateJwk } = await generateIssuerKeys()
      const did = didWeb(regDomain.trim())

      // Try schema.sql columns first (owner, public_jwk) to avoid 400 console errors
      let res = await supabase.from('issuers').insert({
        owner: currentUser.id,
        name: regName.trim(),
        did: did,
        public_jwk: publicJwk,
        accredited: false
      })

      if (res.error && (res.error.message.includes('owner') || res.error.message.includes('public_jwk') || res.error.code === '42703')) {
        res = await supabase.from('issuers').insert({
          user_id: currentUser.id,
          name: regName.trim(),
          domain: regDomain.trim(),
          type: regType,
          did: did,
          public_key: JSON.stringify(publicJwk),
          accredited: false
        })
      }

      if (res.error) throw res.error

      // 3. Persist the private key, encrypted with the issuer's signing PIN,
      // so it survives closing this tab instead of being lost with
      // sessionStorage alone.
      const setupOk = await setupVault(regSigningPin, currentUser.id, currentUser.email, { skipPasskey: true })
      if (!setupOk) throw new Error('Failed to secure your signing key. Please try again.')

      const ciphertext = await encryptPayload(privateJwk)
      let vaultRes = await supabase.from('issuers').update({ signing_key_ciphertext: ciphertext }).eq('owner', currentUser.id)
      if (vaultRes.error && (vaultRes.error.message.includes('owner') || vaultRes.error.code === 'PGRST204' || vaultRes.error.code === '42703')) {
        vaultRes = await supabase.from('issuers').update({ signing_key_ciphertext: ciphertext }).eq('user_id', currentUser.id)
      }
      if (vaultRes.error) throw vaultRes.error

      // 4. Save private key in sessionStorage
      sessionStorage.setItem('issuer_private_key', JSON.stringify(privateJwk))
      sessionStorage.setItem('issuer_did', did)

      // 5. Update states
      setPrivateKey(privateJwk)
      setIssuerInfo({
        id: currentUser.id,
        name: regName.trim(),
        domain: regDomain.trim(),
        type: regType,
        did: did,
        accredited: false,
        rawIssuerData: null
      })
      setRegisterSuccessMsg('Institution registered successfully!')
    } catch (err: any) {
      setRegSubmitError(err.message || 'Failed to register institution. Please try again.')
    } finally {
      setIsRegistering(false)
    }
  }



  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] w-full">
        <Loader2 size={40} className="animate-spin text-indigo-600" />
        <p className="text-gray-500 mt-4 font-semibold text-sm">{t('dashboard.loading_dashboard')}</p>
      </div>
    )
  }

  return (
    <div className="w-full max-w-4xl mx-auto px-4 py-6 md:py-10">
      {/* SECTION 1 — REGISTER INSTITUTION (if not registered yet) */}
      {!issuerInfo ? (
        <div className="w-full max-w-xl mx-auto bg-white rounded-2xl shadow-sm border border-stone-200 p-6 md:p-10">
          <div className="text-center mb-6">
            <div className="w-14 h-14 rounded-2xl bg-indigo-50 flex items-center justify-center mx-auto">
              <Building2 size={28} className="text-indigo-600" />
            </div>
            <h1 className="text-2xl font-bold text-stone-900 mt-4">{t('dashboard.register_institution')}</h1>
            <p className="text-sm text-stone-500 mt-1">
              {t('dashboard.register_desc')}
            </p>
          </div>

          <form onSubmit={handleRegister} className="space-y-5">
            <div>
              <label className="text-xs md:text-sm font-bold text-stone-700 block mb-1">
                {t('dashboard.institution_name')}
              </label>
              <input
                type="text"
                value={regName}
                onChange={(e) => setRegName(e.target.value)}
                placeholder="Royal University of Phnom Penh"
                className="block w-full rounded-lg border border-stone-300 px-3 h-11 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white text-stone-900"
              />
              {regErrors.name && (
                <p className="text-rose-600 text-xs mt-1 font-semibold">{regErrors.name}</p>
              )}
            </div>

            <div>
              <label className="text-xs md:text-sm font-bold text-stone-700 block mb-1">
                {t('dashboard.domain_name')}
              </label>
              <input
                type="text"
                value={regDomain}
                onChange={(e) => setRegDomain(e.target.value)}
                onBlur={handleDomainBlur}
                placeholder="rupp.edu.kh"
                className="block w-full rounded-lg border border-stone-300 px-3 h-11 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white text-stone-900"
              />
              <p className="text-[11px] text-stone-500 mt-1 leading-normal">
                {t('dashboard.domain_desc')}
              </p>
              {regErrors.domain && (
                <p className="text-rose-600 text-xs mt-1 font-semibold">{regErrors.domain}</p>
              )}
            </div>

            <div>
              <label className="text-xs md:text-sm font-bold text-stone-700 block mb-1">
                {t('dashboard.institution_type')}
              </label>
              <select
                value={regType}
                onChange={(e) => setRegType(e.target.value)}
                className="block w-full rounded-lg border border-stone-300 px-3 h-11 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white text-stone-900"
              >
                <option value="">{t('dashboard.select_type')}</option>
                <option value="University">{t('dashboard.university')}</option>
                <option value="Ministry">{t('dashboard.ministry')}</option>
                <option value="Training Centre">{t('dashboard.training_centre')}</option>
                <option value="Other">{t('dashboard.other')}</option>
              </select>
              {regErrors.type && (
                <p className="text-rose-600 text-xs mt-1 font-semibold">{regErrors.type}</p>
              )}
            </div>

            <div>
              <label className="text-xs md:text-sm font-bold text-stone-700 block mb-1">
                Signing PIN
              </label>
              <input
                type="password"
                value={regSigningPin}
                onChange={(e) => setRegSigningPin(e.target.value)}
                placeholder={`Create a ${MIN_PIN_LEN}+ character PIN`}
                autoComplete="new-password"
                className="block w-full rounded-lg border border-stone-300 px-3 h-11 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white text-stone-900"
              />
              <p className="text-[11px] text-stone-500 mt-1 leading-normal">
                Protects your certificate-signing key so it survives closing this tab.
              </p>
              {regErrors.signingPin && (
                <p className="text-rose-600 text-xs mt-1 font-semibold">{regErrors.signingPin}</p>
              )}
            </div>

            {regSubmitError && (
              <div className="bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold rounded-lg p-3">
                {regSubmitError}
              </div>
            )}

            <button
              type="submit"
              disabled={isRegistering}
              className="w-full bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-semibold h-11 rounded-lg text-sm transition-all focus:outline-none flex items-center justify-center gap-2 cursor-pointer"
            >
              {isRegistering && <Loader2 size={18} className="animate-spin" />}
              <span>{t('dashboard.register_btn')}</span>
            </button>
          </form>
        </div>
      ) : (
        /* SECTION 2 — REGISTRATION SUCCESS AND ISSUANCE CONTROL */
        <div className="space-y-6">

          {registerSuccessMsg && (
            <Banner tone="success" onDismiss={() => setRegisterSuccessMsg(null)}>
              {registerSuccessMsg}
            </Banner>
          )}

          <PageHeader
            icon={Building2}
            title={t('dashboard.issuer_dashboard')}
            subtitle={t('dashboard.manage_desc')}
          />

          {/* If NOT Accredited: Warning Banner */}
          {!issuerInfo.accredited ? (
            <Banner tone="warning" title={t('dashboard.awaiting_approval')}>
              <p>{t('dashboard.awaiting_desc')}</p>
              <p className="text-xs mt-2 font-medium italic opacity-80">{t('dashboard.awaiting_note')}</p>
            </Banner>
          ) : (
            /* If Accredited: Check Session Cryptographic Key */
            !privateKey ? (
              <IssuerKeyUnlock
                userId={currentUser.id}
                userEmail={currentUser.email}
                did={issuerInfo.did}
                onUnlocked={(jwk) => setPrivateKey(jwk)}
                onKeyRegenerated={(newJwk) =>
                  setIssuerInfo(prev => prev && ({ ...prev, rawIssuerData: { ...prev.rawIssuerData, public_jwk: newJwk } }))
                }
              />
            ) : (
              <>
                {/* Quick stats: certificates issued by this institution */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
                  <StatCard icon={Award} value={stats?.total ?? '—'} label="Total issued" />
                  <StatCard icon={CheckCircle2} value={stats?.claimed ?? '—'} label="Claimed" tone="success" />
                  <StatCard icon={Clock} value={stats?.pending ?? '—'} label="Awaiting claim" tone="warning" />
                  <StatCard icon={Eye} value={stats?.verifications ?? '—'} label="Verifications" />
                </div>

                {/* If accredited & key is active: Credential Issuance Panel (Navigates to new flow) */}
                <div className="bg-white rounded-2xl border border-stone-200 p-8 shadow-sm flex flex-col items-center text-center py-16">
                  <div className="w-16 h-16 rounded-2xl bg-indigo-50 flex items-center justify-center mb-5">
                    <FileSignature size={30} className="text-indigo-600" />
                  </div>
                  <h2 className="text-xl font-bold text-stone-900 mb-2">{t('dashboard.issue_credential')}</h2>
                  <p className="text-sm text-stone-500 mb-6 max-w-md mx-auto">
                    {t('dashboard.issue_credential_desc')}
                  </p>
                  <button
                    onClick={() => navigate('/app/issue')}
                    className="bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-semibold h-11 px-8 rounded-lg text-sm transition-all focus:outline-none cursor-pointer inline-flex items-center gap-2"
                  >
                    <span>{t('dashboard.start_issuance')}</span>
                    <ArrowRight size={16} />
                  </button>
                </div>
              </>
            )
          )}
        </div>
      )}
    </div>
  )
}
