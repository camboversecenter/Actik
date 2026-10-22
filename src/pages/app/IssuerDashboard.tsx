import { useState, useEffect } from 'react'
import { useNavigate, useLocation, Link, Navigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { Plus, Loader2 } from 'lucide-react'

import { useLanguage } from '../../lib/i18n'
import IssuerKeyUnlock from '../../components/IssuerKeyUnlock'
import { getIssuerKey, type HeldIssuerKey } from '../../lib/issuerKeyStore'
import Banner from '../../components/ui/Banner'
import StatusPill from '../../components/ui/StatusPill'
import { issuerTypeLabel } from '../../lib/issuerType'

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
  const [currentUser, setCurrentUser] = useState<any | null>(null)

  // Loading & state management
  const [loading, setLoading] = useState(true)
  const [issuerInfo, setIssuerInfo] = useState<IssuerInfo | null>(null)
  const [privateKey, setPrivateKey] = useState<HeldIssuerKey | null>(null)

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
            type: issuerTypeLabel(issuerData.type, issuerData.kind),
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


  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] w-full">
        <Loader2 size={40} className="animate-spin text-indigo-600" />
        <p className="text-stone-500 mt-4 font-semibold text-sm">{t('dashboard.loading_dashboard')}</p>
      </div>
    )
  }

  // No institution yet: the full registration form lives at
  // /app/register-issuer (it offers every issuer type, Employer included).
  if (!issuerInfo) return <Navigate to="/app/register-issuer" replace />

  return (
    <div className="w-full mx-auto px-4 py-6 md:py-10 max-w-6xl">
      {/* Issuance control */}
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
    </div>
  )
}
