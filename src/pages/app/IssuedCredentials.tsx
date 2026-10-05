import { useState, useEffect, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useLanguage, formatDegreeTitle } from '../../lib/i18n'
import { Loader2, IdCard } from 'lucide-react'
import StatusPill from '../../components/ui/StatusPill'
import { loadIssuedRecords, type IssuedRecord } from '../../lib/withdrawal'


export default function IssuedCredentials() {
  const { t } = useLanguage()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [records, setRecords] = useState<IssuedRecord[]>([])

  const loadData = useCallback(async (userId: string) => {
    try {
      setLoading(true)

      // From issued_credentials: the log the database writes as each
      // credential goes out. The old source — pending_credentials and
      // credentials filtered by issuer_did — are the *recipients'* rows, which
      // row-level security rightly hides from the issuer, so this page always
      // came back empty. Withdrawals are marked from the institution's own
      // signed list.
      const { records: issued } = await loadIssuedRecords(userId)
      setRecords(issued)
    } catch (err) {
      console.error('Failed to load issued credentials', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session?.user) {
        loadData(data.session.user.id)
      } else {
        navigate('/auth/login')
      }
    })
  }, [loadData, navigate])

  // Grouping logic (matching Wallet.tsx)
  const groupedRecords = records.reduce((acc, cred) => {
    const type = cred.credential_type || 'academic_degree'
    if (!acc[type]) acc[type] = []
    acc[type].push(cred)
    return acc
  }, {} as Record<string, IssuedRecord[]>)

  const displayOrder = [
    { key: 'academic_degree', label: t('dashboard.academic_degrees') },
    { key: 'other', label: t('dashboard.other_credentials') }
  ]
  const availableGroups = Object.keys(groupedRecords)
  const hasOthers = availableGroups.some(k => k !== 'academic_degree')
  if (hasOthers) {
    const others = availableGroups.filter(k => k !== 'academic_degree').flatMap(k => groupedRecords[k])
    groupedRecords['other'] = others
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] w-full">
        <Loader2 size={40} className="animate-spin text-indigo-600" />
      </div>
    )
  }

  return (
    <div className="w-full md:max-w-4xl mx-auto pb-24 px-4 md:px-0">
      <div className="mb-8 pt-4">
        <h1 className="font-khmer text-3xl font-extrabold text-stone-900 tracking-tight">{t('dashboard.issued_creds')}</h1>
        <p className="text-sm text-stone-500 mt-1">{t('dashboard.issued_creds_desc')}</p>
        <Link to="/app/withdrawals" className="inline-block mt-3 text-sm font-semibold text-rose-700 hover:text-rose-800">
          {t('dashboard.manage_withdrawals')} →
        </Link>
      </div>

      {records.length === 0 ? (
        <div className="bg-white border border-stone-200 rounded-xl p-8 text-center shadow-sm">
          <div className="w-14 h-14 rounded-2xl bg-indigo-50 flex items-center justify-center mx-auto mb-4">
            <IdCard size={26} className="text-indigo-500" />
          </div>
          <h3 className="text-lg font-semibold text-stone-900 mb-2">{t('dashboard.no_creds_issued')}</h3>
          <p className="text-stone-500 text-sm max-w-sm mx-auto">
            {t('dashboard.no_creds_issued_desc')}
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {displayOrder.map(group => {
            const displayCreds = groupedRecords[group.key]
            if (!displayCreds || displayCreds.length === 0) return null

            const previewCreds = displayCreds.slice(0, 3)
            const hasMore = displayCreds.length > 3

            return (
              <div key={group.key} className="flex flex-col gap-3">
                <div className="flex items-center justify-between pb-2 border-b border-stone-200">
                  <h2 className="font-mono text-xs font-bold tracking-widest text-stone-400 uppercase">
                    {group.label}
                  </h2>
                  {hasMore && (
                    <Link
                      to={`/app/issued/type/${group.key}`}
                      className="text-xs font-semibold text-indigo-600 hover:text-indigo-650 transition-colors"
                    >
                      {t('dashboard.see_all')} ({displayCreds.length})
                    </Link>
                  )}
                </div>

                {/* Horizontal scrollable row */}
                <div className="flex flex-row gap-4 overflow-x-auto pb-4 snap-x snap-mandatory">
                  {previewCreds.map((c) => {
                    const isWithdrawn = !!c.withdrawn
                    return (
                      <div
                        key={c.id}
                        className="min-w-[85vw] sm:min-w-[400px] shrink-0 snap-start border-l-4 border-indigo-600 overflow-hidden shadow-sm bg-white rounded-xl border border-stone-200"
                      >
                        <div className="p-4 md:p-6 flex justify-between items-center">
                          <div className="w-full">
                            {/* Top row: title + holder email stacked, status pill */}
                            <div className="flex flex-col sm:flex-row justify-between items-start gap-2 mb-4">
                              <div className="min-w-0">
                                <strong className="font-khmer text-[15px] text-stone-900 block font-semibold leading-snug">
                                  {formatDegreeTitle(c.title)}
                                </strong>
                                {c.email && (
                                  <span className="font-mono text-[9.5px] text-stone-400 block mt-0.5 truncate">
                                    {c.email}
                                  </span>
                                )}
                              </div>
                              <StatusPill
                                status={isWithdrawn ? 'failed' : 'verified'}
                                label={isWithdrawn ? t('dashboard.status_withdrawn') : t('dashboard.status_issued')}
                                className="shrink-0"
                              />
                            </div>

                            {/* Bottom row */}
                            <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2 sm:gap-6 text-xs text-stone-500">
                              <div className="flex gap-4">
                                <div>
                                  <span>{t('wallet.issued_on')} </span>
                                  <strong className="font-mono text-stone-700">{new Date(c.date).toLocaleDateString()}</strong>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
