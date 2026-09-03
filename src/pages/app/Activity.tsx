import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useLanguage } from '../../lib/i18n'
import { Loader2, Link2 } from 'lucide-react'

interface ShareRecord {
  id: string
  owner: string
  presentation: string
  issuer_did: string
  revealed: string[]
  expires_at: string
  created_at: string
  recipient_label?: string | null
  revoked_at?: string | null
}

export default function Activity() {
  const { t } = useLanguage()
  const [currentUser, setCurrentUser] = useState<any | null>(null)
  const [shares, setShares] = useState<ShareRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<boolean>(false)
  
  // Modals & Action States
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [toastType, setToastType] = useState<'success' | 'error'>('success')
  const [revokingShareId, setRevokingShareId] = useState<string | null>(null)
  const [showRevokeConfirmId, setShowRevokeConfirmId] = useState<string | null>(null)
  const [showExtendId, setShowExtendId] = useState<string | null>(null)
  const [extendingShareId, setExtendingShareId] = useState<string | null>(null)
  const [extendOption, setExtendOption] = useState<'1day'|'7days'|'30days'|'90days'>('7days')

  // Helper: Display toast notification
  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToastMessage(msg)
    setToastType(type)
    setTimeout(() => setToastMessage(null), 3000)
  }

  // Fetch current user and their shares
  const loadShares = useCallback(async (userId: string) => {
    try {
      setLoading(true)
      const { data, error } = await supabase
        .from('shares')
        .select('*')
        .eq('owner', userId)
        .order('created_at', { ascending: false })

      if (error) {
        console.error('[Activity] Error fetching shares:', error)
        setLoadError(true)
      } else {
        setShares(data || [])
      }
    } catch (err) {
      console.error('[Activity] Exception fetching shares:', err)
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let active = true

    supabase.auth.getSession().then(({ data }) => {
      if (active && data.session?.user) {
        setCurrentUser(data.session.user)
        loadShares(data.session.user.id)
      } else if (active) {
        setLoading(false)
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      if (active) {
        if (currentSession?.user) {
          setCurrentUser(currentSession.user)
          loadShares(currentSession.user.id)
        } else {
          setCurrentUser(null)
          setShares([])
        }
      }
    })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [loadShares])

  const handleRevokeShare = async (shareId: string) => {
    try {
      setRevokingShareId(shareId)
      
      const revokedTime = new Date().toISOString()
      const { error } = await supabase
        .from('shares')
        .update({ revoked_at: revokedTime })
        .eq('id', shareId)

      if (error) throw error

      // Optimistic update
      setShares(prevShares => 
        prevShares.map(share => 
          share.id === shareId 
            ? { ...share, revoked_at: revokedTime } 
            : share
        )
      )
      
      setShowRevokeConfirmId(null)
      showToast(t('wallet.share_revoked_success'), 'success')
    } catch (err) {
      console.error('[Activity] Error revoking share:', err)
      showToast(t('wallet.share_revoke_failed'), 'error')
    } finally {
      setRevokingShareId(null)
    }
  }

  const handleExtendShare = async (share: ShareRecord) => {
    try {
      setExtendingShareId(share.id)
      
      // Re-check client side
      if (new Date(share.expires_at) < new Date() || share.revoked_at) {
        showToast(t('wallet.cannot_extend_inactive'), 'error')
        setShowExtendId(null)
        setExtendingShareId(null)
        return
      }

      // Calculate new expiry based on current expires_at
      const currentExpiry = new Date(share.expires_at)
      let daysToAdd = 7
      if (extendOption === '1day') daysToAdd = 1
      if (extendOption === '30days') daysToAdd = 30
      if (extendOption === '90days') daysToAdd = 90
      
      const newExpiry = new Date(currentExpiry.setDate(currentExpiry.getDate() + daysToAdd)).toISOString()

      const { error } = await supabase
        .from('shares')
        .update({ expires_at: newExpiry })
        .eq('id', share.id)

      if (error) throw error

      // Optimistic update
      setShares(prevShares => 
        prevShares.map(s => 
          s.id === share.id 
            ? { ...s, expires_at: newExpiry } 
            : s
        )
      )
      
      setShowExtendId(null)
      showToast(t('wallet.share_extend_success'), 'success')
    } catch (err) {
      console.error('[Activity] Error extending share:', err)
      showToast(t('wallet.share_extend_failed'), 'error')
    } finally {
      setExtendingShareId(null)
    }
  }

  // --- Rendering Helpers ---

  // Map internal field names to readable labels
  const getFieldLabel = (f: string) => {
    const map: Record<string, string> = {
      'name': t('wallet.field_name'),
      'year': t('wallet.field_year'),
      'gpa': t('wallet.field_gpa'),
      'national_id': t('wallet.field_national_id'),
      'notes': t('wallet.field_notes'),
      'email': t('wallet.field_email'),
      'student_id': t('wallet.field_student_id'),
      'graduation_date': t('wallet.field_graduation_date'),
      'certificate_id': t('wallet.field_certificate_id'),
      'photo': t('wallet.field_photo'),
      'degree': t('wallet.field_degree'),
      'institution': t('wallet.field_institution'),
      'issue_date': t('wallet.field_issue_date')
    }
    return map[f] || f
  }

  // Date formatter
  const formatDate = (dateStr: string) => {
    if (!dateStr) return ''
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return dateStr
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  }

  // Main Page Layout
  return (
    <div className="w-full max-w-2xl mx-auto mb-16 md:mb-0 relative">
      <div className="mb-8 text-center md:text-left">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">{t('wallet.share_activity_title')}</h1>
        <p className="text-gray-500">{t('wallet.share_activity_desc')}</p>
      </div>

      {/* Main Content Area */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-12">
          <Loader2 size={36} className="animate-spin text-indigo-600" />
          <p className="mt-4 text-gray-500 font-medium">{t('wallet.loading_activity')}</p>
        </div>
      ) : loadError ? (
        <div className="bg-rose-50 border border-rose-200 rounded-xl p-6 text-center">
          <p className="text-rose-600 font-medium mb-2">{t('wallet.failed_load_activity')}</p>
          <button 
            onClick={() => currentUser && loadShares(currentUser.id)}
            className="text-sm bg-white text-rose-600 px-4 py-2 border border-rose-200 rounded-lg hover:bg-rose-50 transition-colors"
          >
            {t('wallet.try_again')}
          </button>
        </div>
      ) : shares.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center shadow-sm">
          <div className="w-14 h-14 rounded-2xl bg-indigo-50 flex items-center justify-center mx-auto mb-4">
            <Link2 size={26} className="text-indigo-500" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">{t('wallet.no_share_links_yet')}</h3>
          <p className="text-gray-500 text-sm max-w-sm mx-auto">
            {t('wallet.no_share_links_desc')}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {shares.map(share => {
            // Derived Status
            let status: 'Active' | 'Expired' | 'Revoked' = 'Active'
            if (share.revoked_at) {
              status = 'Revoked'
            } else if (new Date(share.expires_at) < new Date()) {
              status = 'Expired'
            }

            const isRevoked = status === 'Revoked'
            const isExpired = status === 'Expired'
            const isActive = status === 'Active'

            // Title
            const title = share.recipient_label || t('wallet.share_link_default_title')
            
            // Chips
            const fieldsToDisplay = share.revealed || []
            
            return (
              <div key={share.id} className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm transition-all">
                <div className="flex justify-between items-start gap-4">
                  <div className="flex-1">
                    <h3 className="text-base font-bold text-gray-900 mb-1">{title}</h3>
                    <div className="text-xs text-gray-400 font-mono mb-3">
                      /v/{share.id.slice(0, 8)}
                    </div>
                    
                    {/* Chips */}
                    <div className="flex flex-wrap gap-1.5 mb-4">
                      {fieldsToDisplay.length > 0 ? fieldsToDisplay.map(f => (
                        <span key={f} className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-50 text-blue-700 border border-blue-100">
                          {getFieldLabel(f)}
                        </span>
                      )) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-gray-100 text-gray-600 border border-gray-200">
                          {t('wallet.no_extra_fields')}
                        </span>
                      )}
                    </div>
                  </div>
                  
                  {/* Status Badge */}
                  <div>
                    {isActive && (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                        {t('wallet.status_active')}
                      </span>
                    )}
                    {isExpired && (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-600 border border-gray-200">
                        {t('wallet.status_expired')}
                      </span>
                    )}
                    {isRevoked && (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200">
                        {t('wallet.status_revoked')}
                      </span>
                    )}
                  </div>
                </div>

                {/* Footer Line: Date & Action */}
                <div className="border-t border-gray-100 mt-2 pt-3 flex justify-between items-center text-xs">
                  <div className="text-gray-500">
                    {isActive && `${t('wallet.expires_on')} ${formatDate(share.expires_at)}`}
                    {isExpired && `${t('wallet.expired_on')} ${formatDate(share.expires_at)}`}
                    {isRevoked && `${t('wallet.revoked_on')} ${formatDate(share.revoked_at as string)}`}
                  </div>
                  
                  {isActive && (
                    <div className="flex gap-4">
                      <button
                        onClick={() => {
                          setShowExtendId(share.id)
                          setShowRevokeConfirmId(null)
                        }}
                        className="text-indigo-600 font-medium hover:text-indigo-800 hover:underline transition-colors focus:outline-none"
                      >
                        {t('wallet.extend_btn')}
                      </button>
                      <button
                        onClick={() => {
                          setShowRevokeConfirmId(share.id)
                          setShowExtendId(null)
                        }}
                        className="text-rose-600 font-medium hover:text-rose-800 hover:underline transition-colors focus:outline-none"
                      >
                        {t('wallet.revoke_btn')}
                      </button>
                    </div>
                  )}
                </div>
                
                {/* Inline Confirmation for Revoke */}
                {showRevokeConfirmId === share.id && (
                  <div className="mt-3 p-3 bg-rose-50 border border-rose-100 rounded-lg flex flex-col sm:flex-row items-center justify-between gap-3 text-sm">
                    <span className="text-rose-800 font-medium">{t('wallet.revoke_confirm_msg')}</span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setShowRevokeConfirmId(null)}
                        disabled={revokingShareId === share.id}
                        className="px-3 py-1.5 bg-white text-gray-600 border border-gray-200 rounded hover:bg-gray-50 transition-colors focus:outline-none"
                      >
                        {t('wallet.cancel')}
                      </button>
                      <button
                        onClick={() => handleRevokeShare(share.id)}
                        disabled={revokingShareId === share.id}
                        className="flex items-center justify-center min-w-[70px] px-3 py-1.5 bg-rose-600 text-white font-medium rounded hover:bg-rose-700 transition-colors focus:outline-none disabled:opacity-50"
                      >
                        {revokingShareId === share.id ? (
                          <div style={{ animation: 'spin 1s linear infinite', width: 14, height: 14, border: '2px solid rgba(255,255,255,0.3)', borderTop: '2px solid #fff', borderRadius: '50%' }}></div>
                        ) : (
                          t('wallet.revoke_btn')
                        )}
                      </button>
                    </div>
                  </div>
                )}

                {/* Inline Control for Extend */}
                {showExtendId === share.id && (
                  <div className="mt-3 p-4 bg-indigo-50 border border-indigo-100 rounded-lg flex flex-col gap-3 text-sm">
                    <span className="text-indigo-900 font-medium">{t('wallet.extend_link_expiry')}</span>
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => setExtendOption('1day')}
                        className={`px-3 py-1.5 rounded-md border text-sm font-medium transition-colors ${extendOption === '1day' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}
                      >
                        {t('wallet.plus_1_day')}
                      </button>
                      <button
                        onClick={() => setExtendOption('7days')}
                        className={`px-3 py-1.5 rounded-md border text-sm font-medium transition-colors ${extendOption === '7days' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}
                      >
                        {t('wallet.plus_7_days')}
                      </button>
                      <button
                        onClick={() => setExtendOption('30days')}
                        className={`px-3 py-1.5 rounded-md border text-sm font-medium transition-colors ${extendOption === '30days' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}
                      >
                        {t('wallet.plus_30_days')}
                      </button>
                      <button
                        onClick={() => setExtendOption('90days')}
                        className={`px-3 py-1.5 rounded-md border text-sm font-medium transition-colors ${extendOption === '90days' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}
                      >
                        {t('wallet.plus_90_days')}
                      </button>
                    </div>
                    
                    <div className="mt-2 text-xs text-indigo-700">
                      {t('wallet.new_expiry')} {(() => {
                        const cur = new Date(share.expires_at)
                        let d = 7
                        if (extendOption === '1day') d = 1
                        if (extendOption === '30days') d = 30
                        if (extendOption === '90days') d = 90
                        return formatDate(new Date(cur.setDate(cur.getDate() + d)).toISOString())
                      })()}
                    </div>

                    <div className="flex justify-end gap-2 mt-1">
                      <button
                        onClick={() => setShowExtendId(null)}
                        disabled={extendingShareId === share.id}
                        className="px-3 py-1.5 bg-white text-gray-600 border border-gray-200 rounded hover:bg-gray-50 transition-colors focus:outline-none"
                      >
                        {t('wallet.cancel')}
                      </button>
                      <button
                        onClick={() => handleExtendShare(share)}
                        disabled={extendingShareId === share.id}
                        className="flex items-center justify-center min-w-[70px] px-3 py-1.5 bg-indigo-600 text-white font-medium rounded hover:bg-indigo-700 transition-colors focus:outline-none disabled:opacity-50"
                      >
                        {extendingShareId === share.id ? (
                          <div style={{ animation: 'spin 1s linear infinite', width: 14, height: 14, border: '2px solid rgba(255,255,255,0.3)', borderTop: '2px solid #fff', borderRadius: '50%' }}></div>
                        ) : (
                          t('wallet.confirm_btn')
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Global Toast Notification */}
      {toastMessage && (
        <div 
          style={{
            position: 'fixed',
            bottom: '80px',
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: toastType === 'success' ? '#10b981' : '#ef4444',
            color: '#fff',
            padding: '0.75rem 1.25rem',
            borderRadius: '8px',
            fontSize: '0.9rem',
            fontWeight: 500,
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            animation: 'fadeInOut 3s forwards'
          }}
        >
          {toastMessage}
        </div>
      )}
      <style>{`
        @keyframes fadeInOut {
          0% { opacity: 0; transform: translate(-50%, 10px); }
          10% { opacity: 1; transform: translate(-50%, 0); }
          90% { opacity: 1; transform: translate(-50%, 0); }
          100% { opacity: 0; transform: translate(-50%, -10px); }
        }
      `}</style>
    </div>
  )
}
