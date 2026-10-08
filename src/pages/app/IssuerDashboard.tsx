import { useState, useEffect } from 'react'
import { useNavigate, useLocation, Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { generateIssuerKeys, didWeb } from '../../lib/did'
import { Building2, Plus, Loader2 } from 'lucide-react'

import { useLanguage } from '../../lib/i18n'
import { useZkVault } from '../../vault/zk-vault/hooks'
import IssuerKeyUnlock from '../../components/IssuerKeyUnlock'
import { getIssuerKey, holdIssuerKey, type HeldIssuerKey } from '../../lib/issuerKeyStore'
import { recordNewIssuerKey } from '../../lib/issuerKeys'
import Banner from '../../components/ui/Banner'
import StatusPill from '../../components/ui/StatusPill'

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
  const location = useLocation()
  const { setupVault, encryptPayload } = useZkVault()
  const [currentUser, setCurrentUser] = useState<any | null>(null)

  // Loading & state management
  const [loading, setLoading] = useState(true)
  const [issuerInfo, setIssuerInfo] = useState<IssuerInfo | null>(null)
  const [privateKey, setPrivateKey] = useState<HeldIssuerKey | null>(null)

  // Registration Form Fields
  const [regName, setRegName] = useState('')
  const [regDomain, setRegDomain] = useState('')
  const [regType, setRegType] = useState('')
  const [regSigningPin, setRegSigningPin] = useState('')
  const [regErrors, setRegErrors] = useState<Record<string, string>>({})
  const [regSubmitError, setRegSubmitError] = useState<string | null>(null)
  const [isRegistering, setIsRegistering] = useState(false)
  const [registerSuccessMsg, setRegisterSuccessMsg] = useState<string | null>(null)

  // Surfaces a one-off toast handed off via router state — e.g. IssueCredential.tsx's
  // "Save as draft" button navigates here with { toast: '...' }. Reuses the
  // existing success-Banner slot rather than building a separate toast system.
  // Clears the state immediately so refreshing/back-navigating here doesn't
  // replay the same message.
  useEffect(() => {
    const toast = (location.state as any)?.toast
    if (toast) {
      setRegisterSuccessMsg(toast)
      navigate(location.pathname, { replace: true, state: {} })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // In-progress issue-credential draft (see IssueCredential.tsx — same
  // localStorage key/shape). Surfaced here too, not just on the Issue page
  // itself, so there's a persistent place to find it after navigating away —
  // otherwise it's only ever offered back if you happen to land on
  // /app/issue again.
  const [draftSummary, setDraftSummary] = useState<{ savedAt: string; email: string; name: string; type: string | null } | null>(null)

  const draftStorageKey = currentUser ? `actik_issue_draft_${currentUser.id}` : null

  useEffect(() => {
    if (!draftStorageKey) { setDraftSummary(null); return }
    try {
      const raw = localStorage.getItem(draftStorageKey)
      if (!raw) { setDraftSummary(null); return }
      const parsed = JSON.parse(raw)
      if (parsed?.data) {
        setDraftSummary({
          savedAt: parsed.savedAt,
          email: parsed.data.studentEmail || '',
          name: parsed.data.fullName || '',
          type: parsed.data.selectedType || null,
        })
      }
    } catch {
      setDraftSummary(null)
    }
  }, [draftStorageKey])

  const draftTypeLabel = (type: string | null) => {
    const map: Record<string, string> = {
      academic_degree: t('dashboard.type_academic'),
      attendance_participation: t('dashboard.type_attendance'),
      completion: t('dashboard.type_completion'),
      merit_excellence: t('dashboard.type_merit'),
      appreciation_service: t('dashboard.type_appreciation'),
      professional_certification: t('dashboard.type_professional'),
    }
    return type ? (map[type] || type) : t('dashboard.step_type')
  }

  // Quick stats: certificates issued by this institution
  const [stats, setStats] = useState<{
    total: number; claimed: number; pending: number; verifications: number
    newThisMonth: number; stalePending: number
  } | null>(null)

  // Recent issuances table — real rows (credential title + holder email +
  // date + status), no fabricated holder name since nothing honest exists
  // for that (see IssuedCredentials.tsx).
  const [recentIssuances, setRecentIssuances] = useState<Array<{
    id: string; title: string; email: string | null; date: string; status: 'claimed' | 'pending'
  }>>([])

  // Issuance volume, last 6 months — a real count-by-month, not a mock chart.
  const [chartData, setChartData] = useState<Array<{ label: string; count: number }>>([])


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

          // The signing key, if this session has unlocked it (in memory only).
          const held = getIssuerKey()
          setPrivateKey(held && held.did === issuerData.did ? held : null)

          const monthStart = new Date()
          monthStart.setDate(1)
          monthStart.setHours(0, 0, 0, 0)
          const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

          // Quick stats: how many certificates this institution has issued
          const [
            claimedRes, pendingRes, sharesRes, newThisMonthRes, stalePendingRes,
            recentClaimedRes, recentPendingRes, chartRowsRes
          ] = await Promise.all([
            supabase.from('credentials').select('*', { count: 'exact', head: true }).eq('issuer_did', issuerData.did),
            supabase.from('pending_credentials').select('*', { count: 'exact', head: true }).eq('issuer_did', issuerData.did),
            // Summed server-side for this issuer's own DIDs. `shares` has no
            // public read policy any more (it held every holder's
            // presentation), and an issuer never needed the rows — only the
            // count. This also drops the old client-side sum's 1000-row cap.
            supabase.rpc('issuer_verification_count'),
            supabase.from('credentials').select('*', { count: 'exact', head: true }).eq('issuer_did', issuerData.did).gte('created_at', monthStart.toISOString()),
            supabase.from('pending_credentials').select('*', { count: 'exact', head: true }).eq('issuer_did', issuerData.did).lte('created_at', thirtyDaysAgo),
            // Named columns, all present in the live schema (holder_email /
            // degree_title don't exist on `credentials`, so they're not
            // requested — the row mapping below already falls back past
            // them). Never '*': `cipher` and `student_photo` are large.
            supabase.from('credentials').select('id, label, student_email, created_at').eq('issuer_did', issuerData.did).order('created_at', { ascending: false }).limit(5),
            supabase.from('pending_credentials').select('id, label, degree_type, recipient_email, student_email, created_at').eq('issuer_did', issuerData.did).order('created_at', { ascending: false }).limit(5),
            // Chart bucketing — created_at only, no row cap concern beyond the
            // same 1000-row PostgREST default noted above.
            supabase.from('credentials').select('created_at').eq('issuer_did', issuerData.did)
          ])
          if (active) {
            const claimed = claimedRes.count || 0
            const pending = pendingRes.count || 0
            const verifications = Number(sharesRes.data ?? 0) || 0
            setStats({
              claimed, pending, total: claimed + pending, verifications,
              newThisMonth: newThisMonthRes.count || 0,
              stalePending: stalePendingRes.count || 0
            })

            // Recent issuances — merge claimed + pending, real rows only.
            const merged: Array<{ id: string; title: string; email: string | null; date: string; status: 'claimed' | 'pending' }> = []
            ;(recentClaimedRes.data || []).forEach((c: any) => merged.push({
              id: c.id, title: c.degree_title || c.label || 'Issued credential',
              email: c.holder_email || c.student_email || null,
              date: c.created_at, status: 'claimed'
            }))
            ;(recentPendingRes.data || []).forEach((p: any) => merged.push({
              id: p.id, title: p.label || p.degree_type || 'Pending credential',
              email: p.recipient_email || p.student_email || null,
              date: p.created_at, status: 'pending'
            }))
            merged.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
            setRecentIssuances(merged.slice(0, 5))

            // Issuance volume — last 6 months, counted client-side from real
            // created_at values (no aggregate SQL available via supabase-js).
            const buckets: { key: string; label: string; count: number }[] = []
            const now = new Date()
            for (let i = 5; i >= 0; i--) {
              const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
              buckets.push({ key: `${d.getFullYear()}-${d.getMonth()}`, label: (d.getMonth() + 1).toString(), count: 0 })
            }
            ;(chartRowsRes.data || []).forEach((row: any) => {
              const d = new Date(row.created_at)
              const key = `${d.getFullYear()}-${d.getMonth()}`
              const bucket = buckets.find(b => b.key === key)
              if (bucket) bucket.count += 1
            })
            setChartData(buckets.map(b => ({ label: b.label, count: b.count })))
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
      // Into issuer_secrets, not onto the world-readable registry row — see
      // supabase/migrations/20260910_rls_hardening.sql.
      const vaultRes = await supabase.from('issuer_secrets').upsert(
        { owner: currentUser.id, signing_key_ciphertext: ciphertext, updated_at: new Date().toISOString() },
        { onConflict: 'owner' }
      )
      if (vaultRes.error) throw vaultRes.error

      // 4. On record for the Root to list, and held in memory for signing.
      await recordNewIssuerKey(currentUser.id, publicJwk)
      setPrivateKey(await holdIssuerKey(privateJwk, did))

      // 5. Update states
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
        <p className="text-stone-500 mt-4 font-semibold text-sm">{t('dashboard.loading_dashboard')}</p>
      </div>
    )
  }

  return (
    <div className={`w-full mx-auto px-4 py-6 md:py-10 ${issuerInfo ? 'max-w-6xl' : 'max-w-4xl'}`}>
      {/* SECTION 1 — REGISTER INSTITUTION (if not registered yet) */}
      {!issuerInfo ? (
        <div className="w-full max-w-xl mx-auto bg-white rounded-2xl shadow-sm border border-stone-200 p-6 md:p-10">
          <div className="text-center mb-6">
            <div className="w-14 h-14 rounded-2xl bg-indigo-50 flex items-center justify-center mx-auto">
              <Building2 size={28} className="text-indigo-600" />
            </div>
            <h1 className="mt-4 text-[26px] md:text-[30px] font-bold text-stone-900 leading-tight">{t('dashboard.register_institution')}</h1>
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
                className="block w-full rounded-xl border border-stone-300 px-3 h-11 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white text-stone-900"
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
                className="block w-full rounded-xl border border-stone-300 px-3 h-11 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white text-stone-900"
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
                className="block w-full rounded-xl border border-stone-300 px-3 h-11 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white text-stone-900"
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
                className="block w-full rounded-xl border border-stone-300 px-3 h-11 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white text-stone-900"
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
              className="w-full bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-semibold h-11 rounded-xl text-sm transition-all focus:outline-none flex items-center justify-center gap-2 cursor-pointer"
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

          {/* Header — Khmer title, English/DID mono caption, primary action */}
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="font-khmer text-[26px] md:text-[30px] font-bold text-stone-900 leading-tight">{t('dashboard.issuer_dashboard')}</h1>
              <p className="font-mono text-xs text-stone-400 mt-1">Issuer dashboard · {issuerInfo.did}</p>
            </div>
            {issuerInfo.accredited && privateKey && (
              <button
                onClick={() => navigate('/app/issue')}
                className="shrink-0 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-semibold h-11 px-5 rounded-[10px] text-sm transition-all focus:outline-none cursor-pointer inline-flex items-center gap-2"
              >
                <Plus size={18} strokeWidth={1.9} />
                <span>{t('dashboard.start_issuance')}</span>
              </button>
            )}
          </div>

          {/* In-progress draft — persistent home for it, not just a one-shot
              prompt on the Issue page itself. */}
          {draftSummary && (
            <div className="bg-white rounded-xl border border-indigo-200 p-4 flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="font-khmer text-[13px] font-bold text-stone-900">{t('dashboard.draft_card_title')}</div>
                <div className="text-xs text-stone-500 mt-0.5 truncate">
                  {draftTypeLabel(draftSummary.type)}
                  {(draftSummary.name || draftSummary.email) && ' · '}
                  {draftSummary.name || draftSummary.email}
                </div>
                <div className="font-mono text-[10px] text-stone-400 mt-1">
                  {t('dashboard.draft_found_desc')} {new Date(draftSummary.savedAt).toLocaleString()}
                </div>
              </div>
              <div className="flex items-center gap-4 shrink-0">
                <button
                  type="button"
                  onClick={() => navigate('/app/issue')}
                  className="text-xs font-bold text-indigo-600 hover:text-indigo-650 cursor-pointer"
                >
                  {t('dashboard.continue_editing_btn')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (draftStorageKey) localStorage.removeItem(draftStorageKey)
                    setDraftSummary(null)
                  }}
                  className="text-xs font-bold text-stone-400 hover:text-stone-600 cursor-pointer"
                >
                  {t('dashboard.discard_draft_btn')}
                </button>
              </div>
            </div>
          )}

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
                onUnlocked={() => setPrivateKey(getIssuerKey())}
                onKeyRegenerated={(newJwk) =>
                  setIssuerInfo(prev => prev && ({ ...prev, rawIssuerData: { ...prev.rawIssuerData, public_jwk: newJwk } }))
                }
              />
            ) : (
              <>
                {/* Quick stats: certificates issued by this institution — hand-rolled
                    rather than the shared StatCard (also used by AdminDashboard.tsx),
                    so this redesign doesn't ripple into Admin's cards. */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
                  {[
                    {
                      value: stats?.total ?? '—', label: t('dashboard.stat_total_issued'), tone: 'text-stone-900',
                      sub: stats ? `+${stats.newThisMonth} this month` : ''
                    },
                    {
                      value: stats?.claimed ?? '—', label: t('dashboard.stat_claimed'), tone: 'text-emerald-700',
                      sub: stats && stats.total > 0 ? `${Math.round((stats.claimed / stats.total) * 100)}% claim rate` : ''
                    },
                    {
                      value: stats?.pending ?? '—', label: t('dashboard.stat_pending'), tone: 'text-amber-700',
                      sub: stats ? `${stats.stalePending} over 30 days` : ''
                    },
                    {
                      value: stats?.verifications ?? '—', label: t('dashboard.stat_verifications'), tone: 'text-stone-900',
                      sub: t('dashboard.stat_verifications_sub')
                    },
                  ].map((s) => (
                    <div key={s.label} className="bg-white rounded-xl border border-stone-200 p-4">
                      <div className="font-khmer text-[11px] text-stone-500 font-semibold">{s.label}</div>
                      <div className={`font-mono text-[26px] leading-tight font-bold mt-1 ${s.tone}`}>{s.value}</div>
                      {s.sub && <div className="font-mono text-[10px] text-stone-400 mt-1">{s.sub}</div>}
                    </div>
                  ))}
                </div>

                {/* Recent issuances (real rows) + issuance-volume chart (real
                    counts) side by side, matching the dashboard mockup. */}
                <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4 items-start">
                  <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
                    <div className="flex items-center justify-between px-5 py-4 border-b border-stone-200">
                      <h2 className="font-khmer text-sm font-bold text-stone-900">{t('dashboard.recent_issuances')}</h2>
                      <Link to="/app/issued" className="text-xs font-semibold text-indigo-600 hover:text-indigo-650 transition-colors">
                        {t('dashboard.see_all')}
                      </Link>
                    </div>
                    {recentIssuances.length === 0 ? (
                      <div className="p-8 text-center text-sm text-stone-400">{t('dashboard.no_creds_issued')}</div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-left">
                              <th className="font-mono text-[9px] uppercase tracking-widest text-stone-400 font-semibold px-5 py-2">{t('dashboard.table_holder')}</th>
                              <th className="font-mono text-[9px] uppercase tracking-widest text-stone-400 font-semibold px-3 py-2 hidden sm:table-cell">{t('dashboard.table_credential')}</th>
                              <th className="font-mono text-[9px] uppercase tracking-widest text-stone-400 font-semibold px-3 py-2 hidden md:table-cell">{t('dashboard.table_issued')}</th>
                              <th className="font-mono text-[9px] uppercase tracking-widest text-stone-400 font-semibold px-5 py-2 text-right">{t('dashboard.table_status')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {recentIssuances.map((row) => (
                              <tr key={row.id} className="border-t border-stone-100">
                                <td className="px-5 py-3 font-mono text-xs text-stone-600 truncate max-w-[160px]">{row.email || '—'}</td>
                                <td className="px-3 py-3 hidden sm:table-cell">
                                  <span className="font-khmer text-[13px] font-semibold text-stone-900">{row.title}</span>
                                </td>
                                <td className="px-3 py-3 font-mono text-xs text-stone-500 hidden md:table-cell whitespace-nowrap">
                                  {new Date(row.date).toLocaleDateString()}
                                </td>
                                <td className="px-5 py-3 text-right">
                                  <StatusPill
                                    status={row.status === 'claimed' ? 'verified' : 'pending'}
                                    label={row.status === 'claimed' ? t('dashboard.status_claimed') : t('dashboard.status_pending')}
                                  />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  <div className="bg-white rounded-xl border border-stone-200 p-4">
                    <div className="font-khmer text-xs font-bold text-stone-900 mb-0.5">{t('dashboard.issuance_volume')}</div>
                    <div className="font-mono text-[9px] text-stone-400 uppercase tracking-wide mb-4">Issuance volume</div>
                    {chartData.every(b => b.count === 0) ? (
                      <div className="text-xs text-stone-400 text-center py-8">{t('dashboard.no_creds_issued')}</div>
                    ) : (
                      <div className="flex items-end gap-2 h-24">
                        {chartData.map((b, i) => {
                          const max = Math.max(1, ...chartData.map(x => x.count))
                          const isCurrent = i === chartData.length - 1
                          return (
                            <div key={i} className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end">
                              <div
                                className={`w-full rounded-t ${isCurrent ? 'bg-indigo-600' : 'bg-indigo-200'}`}
                                style={{ height: `${Math.max(4, (b.count / max) * 100)}%` }}
                              />
                              <span className="font-mono text-[9px] text-stone-400">{b.label}</span>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </>
            )
          )}
        </div>
      )}
    </div>
  )
}
