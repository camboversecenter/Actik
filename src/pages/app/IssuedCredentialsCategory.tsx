import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useLanguage, formatDegreeTitle } from '../../lib/i18n'
import { Loader2, ArrowLeft } from 'lucide-react'
import StatusPill from '../../components/ui/StatusPill'
import { loadIssuedRecords, type IssuedRecord } from '../../lib/withdrawal'


export default function IssuedCredentialsCategory() {
  const { t } = useLanguage()
  const navigate = useNavigate()
  const { credentialType } = useParams<{ credentialType: string }>()
  
  const [loading, setLoading] = useState(true)
  const [records, setRecords] = useState<IssuedRecord[]>([])

  const getCategoryLabel = (type: string | undefined) => {
    if (type === 'academic_degree') return t('dashboard.academic_degrees')
    return t('dashboard.other_credentials')
  }

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
  }, [credentialType])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session?.user) {
        loadData(data.session.user.id)
      } else {
        navigate('/auth/login')
      }
    })
  }, [loadData, navigate])

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] w-full">
        <Loader2 size={40} className="animate-spin text-indigo-600" />
      </div>
    )
  }

  return (
    <div className="w-full max-w-2xl mx-auto">
      <div className="mb-6 pt-4">
        <Link to="/app/issued" className="inline-flex items-center text-sm font-medium text-indigo-600 hover:text-indigo-650 mb-4 transition-colors">
          <ArrowLeft size={16} strokeWidth={2} className="mr-1" />
          {t('dashboard.back_to_issued')}
        </Link>
        <h1 className="font-khmer text-[26px] md:text-[30px] font-bold text-stone-900 leading-tight">{getCategoryLabel(credentialType)}</h1>
      </div>

      <div className="flex flex-col gap-4">
        {records.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm border border-stone-200 p-8 text-center text-stone-500">
            {t('dashboard.no_creds_in_category')}
          </div>
        ) : (
          records.map((c) => {
            const isWithdrawn = !!c.withdrawn
            return (
              <div
                key={c.id}
                className="border-l-4 border-indigo-600 overflow-hidden shadow-sm bg-white rounded-xl border border-stone-200"
              >
                <div className="p-4 md:p-6">
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
            )
          })
        )}
      </div>
    </div>
  )
}
