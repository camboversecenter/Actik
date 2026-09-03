import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useLanguage } from '../../lib/i18n'
import { Loader2 } from 'lucide-react'
import StatusPill from '../../components/ui/StatusPill'

interface IssuedRecord {
  id: string
  title: string
  date: string
  status: 'pending' | 'claimed'
  credential_type: string
}

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

      let { data: issuerData } = await supabase
        .from('issuers')
        .select('did')
        .eq('owner', userId)
        .maybeSingle()

      if (!issuerData) {
        // Fallback to owner
        const fallback = await supabase
          .from('issuers')
          .select('did')
          .eq('owner', userId)
          .maybeSingle()
        issuerData = fallback.data
      }

      if (!issuerData || !issuerData.did) {
        setLoading(false)
        return
      }

      const myDid = issuerData.did

      const [pendingRes, claimedRes] = await Promise.all([
        supabase.from('pending_credentials').select('*').eq('issuer_did', myDid),
        supabase.from('credentials').select('*').eq('issuer_did', myDid)
      ])

      const merged: IssuedRecord[] = []

      if (pendingRes.data) {
        pendingRes.data.forEach((p: any) => {
          merged.push({
            id: p.id,
            title: p.label || 'Pending Credential',
            date: p.created_at || new Date().toISOString(),
            status: 'pending',
            credential_type: 'academic_degree'
          })
        })
      }

      if (claimedRes.data) {
        claimedRes.data.forEach((c: any) => {
          merged.push({
            id: c.id,
            title: c.degree_title || 'Issued Credential',
            date: c.created_at || new Date().toISOString(),
            status: 'claimed',
            credential_type: c.credential_type || 'academic_degree'
          })
        })
      }

      // Filter by credentialType
      const filtered = merged.filter(cred => {
        const type = cred.credential_type || 'academic_degree'
        if (credentialType === 'other') return type !== 'academic_degree'
        return type === credentialType
      })

      filtered.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

      setRecords(filtered)
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
    <div className="w-full max-w-2xl mx-auto px-4 md:px-0 pb-20">
      <div className="mb-6 pt-4">
        <Link to="/app/issued" className="inline-flex items-center text-sm font-medium text-indigo-600 hover:text-indigo-800 mb-4 transition-colors">
          <svg className="w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          {t('dashboard.back_to_issued')}
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">{getCategoryLabel(credentialType)}</h1>
      </div>

      <div className="flex flex-col gap-4">
        {records.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center text-gray-500">
            {t('dashboard.no_creds_in_category')}
          </div>
        ) : (
          records.map((c) => {
            const isClaimed = c.status === 'claimed'
            return (
              <div 
                key={c.id}
                className="border-l-4 border-indigo-600 overflow-hidden shadow-sm bg-white rounded-xl border border-gray-200"
              >
                <div className="p-4 md:p-6">
                  <div className="flex flex-col sm:flex-row justify-between items-start gap-2 mb-4">
                    <div>
                      <strong className="text-base text-gray-900 block font-bold leading-snug">
                        {c.title}
                      </strong>
                    </div>
                    <StatusPill
                      status={isClaimed ? 'verified' : 'pending'}
                      label={isClaimed ? t('dashboard.status_claimed') : t('dashboard.status_pending')}
                      className="shrink-0"
                    />
                  </div>

                  <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2 sm:gap-6 text-xs text-gray-500">
                    <div className="flex gap-4">
                      <div>
                        <span>{t('wallet.issued_on')} </span>
                        <strong className="text-gray-950">{new Date(c.date).toLocaleDateString()}</strong>
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
