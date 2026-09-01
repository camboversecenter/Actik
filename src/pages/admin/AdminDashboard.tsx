import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import InstitutionDetailModal from '../../components/admin/InstitutionDetailModal'
import MoEYSIdentityCard from '../../components/admin/MoEYSIdentityCard'
import PublicRegistryManager from '../../components/admin/PublicRegistryManager'
import AuditLogView from '../../components/admin/AuditLogView'
import { logApproval, logRevocation, logRejection, logInstitutionRestore } from '../../lib/auditLog'

// --- TypeScript Types ---
interface Issuer {
  id: string
  user_id: string
  name: string
  domain: string
  type: string
  did: string
  public_key: string
  accredited: boolean
  accredited_at: string | null
  accredited_by: string | null
  revoked_at: string | null
  revoked_by: string | null
  created_at: string
}

type FilterTab = 'all' | 'pending' | 'accredited' | 'revoked'

interface ConfirmModal {
  type: 'approve' | 'revoke' | 'reject' | 'restore'
  issuer: Issuer
  confirmInput: string
  loading: boolean
  error: string | null
  credentialCount?: number
}

interface Toast {
  message: string
  type: 'success' | 'warning' | 'error'
  id: string
}

// --- Helper Functions ---

/**
 * Maps database issuers record properties safely to matching Issuer fields.
 */
function mapDbIssuer(db: Record<string, unknown>): Issuer {
  const name = typeof db.name === 'string' ? db.name : ''
  const did = typeof db.did === 'string' ? db.did : ''
  const id = typeof db.id === 'string' ? db.id : ''
  const owner = typeof db.owner === 'string' ? db.owner : ''
  const user_id = typeof db.user_id === 'string' ? db.user_id : owner

  let extractedDomain = typeof db.domain === 'string' ? db.domain : ''
  if (!extractedDomain && did.startsWith('did:web:')) {
    extractedDomain = decodeURIComponent(did.substring(8))
  }

  const type = typeof db.type === 'string' ? db.type : 'University'

  let publicKeyStr = ''
  if (db.public_key && typeof db.public_key === 'string') {
    publicKeyStr = db.public_key
  } else if (db.public_jwk) {
    publicKeyStr = JSON.stringify(db.public_jwk)
  } else if (db.public_key) {
    publicKeyStr = JSON.stringify(db.public_key)
  }

  return {
    id,
    user_id,
    name,
    domain: extractedDomain,
    type,
    did,
    public_key: publicKeyStr,
    accredited: !!db.accredited,
    accredited_at: typeof db.accredited_at === 'string' ? db.accredited_at : null,
    accredited_by: typeof db.accredited_by === 'string' ? db.accredited_by : null,
    revoked_at: typeof db.revoked_at === 'string' ? db.revoked_at : null,
    revoked_by: typeof db.revoked_by === 'string' ? db.revoked_by : null,
    created_at: typeof db.created_at === 'string' ? db.created_at : new Date().toISOString(),
  }
}

/**
 * Calculates a registered date display string.
 */
function formatDisplayDate(dateStr: string | null) {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return 'Unknown'

  return d.toLocaleDateString('en-US', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

/**
 * Style classes selector for institution types.
 */
function getTypeBadgeStyles(type?: string) {
  switch (type) {
    case 'University':
      return 'bg-blue-50 text-blue-700 border-blue-100'
    case 'Ministry':
      return 'bg-purple-50 text-purple-700 border-purple-100'
    case 'Training centre':
      return 'bg-amber-50 text-amber-700 border-amber-100'
    default:
      return 'bg-stone-50 text-stone-700 border-stone-100'
  }
}

export default function AdminDashboard() {
  const [currentUser, setCurrentUser] = useState<{ id: string; email?: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [initialError, setInitialError] = useState<string | null>(null)

  // State arrays
  const [issuers, setIssuers] = useState<Issuer[]>([])
  const [emailMap, setEmailMap] = useState<Record<string, string>>({})
  const [totalCredentials, setTotalCredentials] = useState(0)
  const [totalStudents, setTotalStudents] = useState<number>(0)

  // Search and tabs filter state
  const [searchQuery, setSearchQuery] = useState('')
  const [activeTab, setActiveTab] = useState<FilterTab>('all')

  // Detailed modal view & confirmation modal states
  const [selectedIssuer, setSelectedIssuer] = useState<Issuer | null>(null)
  const [isAuditLogOpen, setIsAuditLogOpen] = useState(false)
  const [detailCredCount, setDetailCredCount] = useState<number | null>(null)
  const [loadingDetailCount, setLoadingDetailCount] = useState(false)
  const [confirmModal, setConfirmModal] = useState<ConfirmModal | null>(null)

  // Custom toast notifications
  const [toasts, setToasts] = useState<Toast[]>([])

  const showToast = (message: string, type: 'success' | 'warning' | 'error' = 'success') => {
    const id = crypto.randomUUID()
    setToasts((prev) => [...prev, { message, type, id }])
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, 5000)
  }

  // --- Initial Load ---
  // --- Institution Management Functions ---
  const fetchInstitutions = async (filter: FilterTab = 'all') => {
    try {
      setLoading(true)
      setInitialError(null)

      const { data: sessionData } = await supabase.auth.getSession()
      if (sessionData?.session?.user) {
        setCurrentUser({
          id: sessionData.session.user.id,
          email: sessionData.session.user.email,
        })
      }

      const [issuersRes, credentialsRes, studentsRes, profilesRes] = await Promise.all([
        supabase.from('issuers').select('*').order('created_at', { ascending: false }),
        supabase.from('credentials').select('id', { count: 'exact' }),
        supabase.from('profiles').select('id', { count: 'exact' }).eq('role', 'student'),
        supabase.from('profiles').select('id, email'),
      ])

      if (issuersRes.error) throw issuersRes.error

      const mappedIssuers = (issuersRes.data || []).map((row) =>
        mapDbIssuer(row as Record<string, unknown>)
      )
      setIssuers(mappedIssuers)

      const emails: Record<string, string> = {}
      if (profilesRes.data) {
        profilesRes.data.forEach((p) => {
          emails[p.id] = p.email || ''
        })
      }
      setEmailMap(emails)

      setTotalCredentials(credentialsRes.count || 0)
      setTotalStudents(studentsRes.count || 0)
      setActiveTab(filter)
      setLoading(false)
    } catch (err: any) {
      console.error('Fetch failed:', err)
      setInitialError(err.message || 'Failed to load registry data')
      setLoading(false)
    }
  }

  // --- Initial Load ---
  useEffect(() => {
    fetchInstitutions('all')
  }, [])

  // --- Fetch Affected Credentials Count ---
  const fetchAffectedCredentialsCount = async (issuer: Issuer): Promise<number> => {
    try {
      const res = await supabase
        .from('credentials')
        .select('id', { count: 'exact', head: true })
        .eq('issuer_id', issuer.user_id || issuer.id)

      if (res.error) {
        const fallbackRes = await supabase
          .from('pending_credentials')
          .select('id', { count: 'exact', head: true })
          .eq('issuer_did', issuer.did)

        if (!fallbackRes.error && fallbackRes.count !== null) {
          return fallbackRes.count
        }
        return 0
      }

      return res.count || 0
    } catch (e) {
      console.error('Count fetch failed:', e)
      return 0
    }
  }

  // --- Open Modals ---
  const handleOpenApproveModal = (issuer: Issuer) => {
    setConfirmModal({
      type: 'approve',
      issuer,
      confirmInput: '',
      loading: false,
      error: null,
    })
  }

  const handleOpenRevokeModal = async (issuer: Issuer) => {
    setConfirmModal({
      type: 'revoke',
      issuer,
      confirmInput: '',
      loading: true,
      error: null,
      credentialCount: 0,
    })

    const count = await fetchAffectedCredentialsCount(issuer)
    setConfirmModal((prev) =>
      prev ? { ...prev, loading: false, credentialCount: count } : null
    )
  }

  const handleOpenRejectModal = (issuer: Issuer) => {
    setConfirmModal({
      type: 'reject',
      issuer,
      confirmInput: '',
      loading: false,
      error: null,
    })
  }

  const handleOpenRestoreModal = (issuer: Issuer) => {
    setConfirmModal({
      type: 'restore',
      issuer,
      confirmInput: '',
      loading: false,
      error: null,
    })
  }

  const approveInstitution = async (institutionId: string, institutionName: string) => {
    if (!currentUser) throw new Error("Not authenticated")
    const timestamp = new Date().toISOString()
    let res = await supabase.from('issuers').update({
      accredited: true,
      accredited_at: timestamp,
      accredited_by: currentUser.id,
      revoked_at: null,
      revoked_by: null,
    }).eq('id', institutionId)

    if (res.error && (res.error.message.includes('column') || res.error.code === '42703')) {
      res = await supabase.from('issuers').update({ accredited: true }).eq('id', institutionId)
    }
    if (res.error) throw res.error

    try {
      await logApproval(institutionId, institutionName)
    } catch (error) {
      console.error('Failed to log approval:', error)
    }

    showToast("Institution accredited successfully", 'success')
    await fetchInstitutions(activeTab)
  }

  const rejectInstitution = async (institutionId: string, institutionName: string, reason?: string) => {
    const res = await supabase.from('issuers').delete().eq('id', institutionId)
    if (res.error) throw res.error
    
    // We would store/send the reason here
    console.log(`Institution ${institutionId} rejected. Reason: ${reason}`)
    
    try {
      await logRejection(institutionId, institutionName, reason || 'Does not meet requirements')
    } catch (error) {
      console.error('Failed to log rejection:', error)
    }
    
    showToast("Institution rejected", 'warning')
    await fetchInstitutions(activeTab)
  }

  const revokeInstitution = async (institutionId: string, institutionName: string, reason?: string) => {
    if (!currentUser) throw new Error("Not authenticated")
    const timestamp = new Date().toISOString()
    let res = await supabase.from('issuers').update({
      accredited: false,
      revoked_at: timestamp,
      revoked_by: currentUser.id,
    }).eq('id', institutionId)

    if (res.error && (res.error.message.includes('column') || res.error.code === '42703')) {
      res = await supabase.from('issuers').update({ accredited: false }).eq('id', institutionId)
    }
    if (res.error) throw res.error

    console.log(`Institution ${institutionId} revoked. Reason: ${reason}`)
    
    try {
      await logRevocation(institutionId, institutionName, reason || 'Administrative revocation')
    } catch (error) {
      console.error('Failed to log revocation:', error)
    }

    showToast("Accreditation revoked", 'warning')
    await fetchInstitutions(activeTab)
  }

  const restoreInstitution = async (institutionId: string, institutionName: string) => {
    if (!currentUser) throw new Error("Not authenticated")
    const timestamp = new Date().toISOString()
    let res = await supabase.from('issuers').update({
      accredited: true,
      accredited_at: timestamp,
      accredited_by: currentUser.id,
      revoked_at: null,
      revoked_by: null,
    }).eq('id', institutionId)

    if (res.error && (res.error.message.includes('column') || res.error.code === '42703')) {
      res = await supabase.from('issuers').update({ accredited: true }).eq('id', institutionId)
    }
    if (res.error) throw res.error

    try {
      await logInstitutionRestore(institutionId, institutionName)
    } catch (error) {
      console.error('Failed to log restore:', error)
    }

    showToast("Institution restored", 'success')
    await fetchInstitutions(activeTab)
  }

  // --- Confirm Action Executions ---
  const handleConfirmAction = async () => {
    if (!confirmModal || !currentUser) return

    const { type, issuer } = confirmModal
    setConfirmModal((prev) => (prev ? { ...prev, loading: true, error: null } : null))

    try {
      if (type === 'approve') {
        await approveInstitution(issuer.id, issuer.name)
      } else if (type === 'revoke') {
        await revokeInstitution(issuer.id, issuer.name, 'Administrative revocation')
      } else if (type === 'reject') {
        await rejectInstitution(issuer.id, issuer.name, 'Does not meet requirements')
      } else if (type === 'restore') {
        await restoreInstitution(issuer.id, issuer.name)
      }

      setConfirmModal(null)
    } catch (err: any) {
      console.error('Confirmation action error:', err)
      setConfirmModal((prev) =>
        prev
          ? {
              ...prev,
              loading: false,
              error: `Action failed: ${err.message || 'Please try again.'}`,
            }
          : null
      )
    }
  }

  // --- Open Detailed Modal ---
  const handleSelectIssuer = async (issuer: Issuer) => {
    setSelectedIssuer(issuer)
    setDetailCredCount(null)
    setLoadingDetailCount(true)
    const count = await fetchAffectedCredentialsCount(issuer)
    setDetailCredCount(count)
    setLoadingDetailCount(false)
  }

  // --- Calculation helper counters ---
  const countTotal = issuers.length
  const countAccredited = issuers.filter((i) => i.accredited).length
  const countPending = issuers.filter((i) => !i.accredited && i.revoked_at === null).length
  const countRevoked = issuers.filter((i) => !i.accredited && i.revoked_at !== null).length

  // --- Filter Logic ---
  const filteredIssuers = issuers.filter((issuer) => {
    const matchesSearch =
      issuer.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      issuer.domain.toLowerCase().includes(searchQuery.toLowerCase()) ||
      issuer.did.toLowerCase().includes(searchQuery.toLowerCase())

    let matchesTab = true
    if (activeTab === 'pending') {
      matchesTab = !issuer.accredited && issuer.revoked_at === null
    } else if (activeTab === 'accredited') {
      matchesTab = issuer.accredited
    } else if (activeTab === 'revoked') {
      matchesTab = !issuer.accredited && issuer.revoked_at !== null
    }

    return matchesSearch && matchesTab
  })

  // Determine button state variables
  const isGlobalActionLoading = !!confirmModal?.loading

  // Form confirmation validation checkers
  const isApproveConfirmInvalid =
    confirmModal?.type === 'approve' &&
    confirmModal.confirmInput.toLowerCase() !== confirmModal.issuer.name.toLowerCase()

  const isRevokeConfirmInvalid =
    confirmModal?.type === 'revoke' && confirmModal.confirmInput !== 'REVOKE'

  const isRejectConfirmInvalid =
    confirmModal?.type === 'reject' && confirmModal.confirmInput !== 'REJECT'

  const isRestoreConfirmInvalid =
    confirmModal?.type === 'restore' && confirmModal.confirmInput !== 'RESTORE'

  const isConfirmButtonDisabled =
    confirmModal?.loading ||
    (confirmModal?.type === 'approve' && isApproveConfirmInvalid) ||
    (confirmModal?.type === 'revoke' && isRevokeConfirmInvalid) ||
    (confirmModal?.type === 'reject' && isRejectConfirmInvalid) ||
    (confirmModal?.type === 'restore' && isRestoreConfirmInvalid)

  // Status Badge Rendering Helper
  const renderStatusBadge = (issuer: Issuer) => {
    if (issuer.accredited) {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
          <span>✓</span> ACCREDITED
        </span>
      )
    } else if (issuer.revoked_at !== null) {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200">
          <span>✕</span> REVOKED
        </span>
      )
    } else {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
          <span>⏳</span> PENDING
        </span>
      )
    }
  }

  // SKELETON LOADER
  if (loading) {
    return (
      <div className="min-h-screen bg-stone-50 p-6 md:p-8 space-y-8 animate-pulse font-sans">
        <div className="space-y-2">
          <div className="h-8 bg-stone-200 rounded w-1/4" />
          <div className="h-4 bg-stone-200 rounded w-2/4" />
        </div>
        
        {/* Stats Grid Skeleton */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-8">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="bg-white border border-stone-200 rounded-xl p-6 space-y-3">
              <div className="h-8 bg-stone-200 rounded w-1/4" />
              <div className="h-3 bg-stone-200 rounded w-3/4" />
            </div>
          ))}
        </div>

        {/* Filter and Search Bar Skeleton */}
        <div className="h-16 bg-stone-250 rounded-xl" />

        {/* Table Skeleton */}
        <div className="bg-white border border-stone-200 rounded-xl p-6 space-y-4">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex justify-between items-center py-4 border-b border-stone-150 last:border-0">
              <div className="space-y-2 w-1/3">
                <div className="h-4 bg-stone-200 rounded w-3/4" />
                <div className="h-3 bg-stone-200 rounded w-1/2" />
              </div>
              <div className="h-4 bg-stone-200 rounded w-1/4" />
              <div className="h-8 bg-stone-200 rounded w-24" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (initialError) {
    return (
      <div className="max-w-2xl mx-auto mt-12 p-6 bg-rose-50 border border-rose-100 rounded-xl">
        <div className="flex gap-3">
          <svg className="w-6 h-6 text-rose-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <div>
            <h3 className="font-semibold text-rose-900 text-lg">Failed to load registry data</h3>
            <p className="text-sm text-rose-700 mt-1">{initialError}</p>
            <button
              onClick={() => window.location.reload()}
              className="mt-4 px-4 py-2 bg-rose-600 text-white font-semibold rounded-lg shadow-sm hover:bg-rose-700 active:bg-rose-800 text-xs transition-colors cursor-pointer"
            >
              Refresh Page
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900 pb-20 relative font-sans antialiased">
      {/* Toast Notifications */}
      <div className="fixed top-4 right-4 z-50 space-y-2 pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`px-4 py-3 rounded-lg border shadow-lg text-sm font-semibold pointer-events-auto flex items-center gap-2 max-w-md animate-scale-in ${
              t.type === 'success'
                ? 'bg-emerald-50 border-emerald-100 text-emerald-800'
                : t.type === 'warning'
                ? 'bg-amber-50 border-amber-100 text-amber-800'
                : 'bg-rose-50 border-rose-100 text-rose-800'
            }`}
          >
            {t.type === 'success' && (
              <svg className="w-4 h-4 text-emerald-600 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l3-3z" clipRule="evenodd" />
              </svg>
            )}
            {t.type === 'warning' && (
              <svg className="w-4 h-4 text-amber-600 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
            )}
            <span>{t.message}</span>
          </div>
        ))}
      </div>

      <style>{`
        @keyframes scaleIn {
          0% { transform: scale(0.95); opacity: 0; }
          100% { transform: scale(1); opacity: 1; }
        }
        .animate-scale-in {
          animation: scaleIn 0.2s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
        }
      `}</style>

      <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-8">
        
        {/* Header Section */}
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-extrabold text-stone-900 tracking-tight">Trust Registry Management</h1>
            <p className="text-sm text-stone-500 mt-1 font-medium">
              Manage accredited institutions and verify trust settings on behalf of MoEYS
            </p>
          </div>
          <button
            onClick={() => setIsAuditLogOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-stone-900 text-white text-sm font-bold rounded-lg shadow-sm hover:bg-stone-800 transition-colors cursor-pointer shrink-0"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            System Audit Log
          </button>
        </div>

        {/* MoEYS Identity Section */}
        <MoEYSIdentityCard />

        {/* Public Registry Manager Section */}
        <PublicRegistryManager 
          countTotal={countTotal} 
          countAccredited={countAccredited} 
        />

        {/* 📊 TRUST REGISTRY OVERVIEW */}
        <section className="space-y-4">
          <h2 className="text-xs font-bold text-stone-400 uppercase tracking-widest flex items-center gap-1.5">
            <span>📊</span> Trust Registry Overview
          </h2>
          
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white border border-stone-200 shadow-sm rounded-xl p-4 sm:p-6">
              <div className="text-2xl sm:text-3xl font-bold text-indigo-600">{countTotal}</div>
              <div className="text-[10px] text-stone-400 font-bold uppercase tracking-wider mt-1.5 font-semibold">
                Total institutions
              </div>
            </div>
            <div className="bg-white border border-stone-200 shadow-sm rounded-xl p-4 sm:p-6">
              <div className="text-2xl sm:text-3xl font-bold text-emerald-600">{countAccredited}</div>
              <div className="text-[10px] text-stone-400 font-bold uppercase tracking-wider mt-1.5 font-semibold">
                Accredited
              </div>
            </div>
            <div className="bg-white border border-stone-200 shadow-sm rounded-xl p-4 sm:p-6">
              <div className="text-2xl sm:text-3xl font-bold text-amber-500">{countPending}</div>
              <div className="text-[10px] text-stone-400 font-bold uppercase tracking-wider mt-1.5 font-semibold">
                Pending Approval
              </div>
            </div>
            <div className="bg-white border border-stone-200 shadow-sm rounded-xl p-4 sm:p-6">
              <div className="text-2xl sm:text-3xl font-bold text-purple-600">{totalCredentials}</div>
              <div className="text-[10px] text-stone-400 font-bold uppercase tracking-wider mt-1.5 font-semibold">
                Credentials Issued {totalStudents > 0 && `(${totalStudents} wallets)`}
              </div>
            </div>
          </div>
        </section>

        {/* 🏛️ INSTITUTIONS MANAGEMENT */}
        <section className="space-y-4">
          <h2 className="text-xs font-bold text-stone-400 uppercase tracking-widest flex items-center gap-1.5">
            <span>🏛️</span> Institutions Management
          </h2>

          {/* Filter and Search Bar */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white border border-stone-200/80 p-4 rounded-xl shadow-sm">
            {/* Search Box */}
            <div className="relative flex-1 w-full md:max-w-md">
              <svg className="absolute left-3 top-3.5 h-4 w-4 text-stone-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                placeholder="Search by institution name or domain..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 h-11 text-sm border border-stone-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 bg-stone-50/50"
              />
            </div>

            {/* Filter Tabs & Count */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-4 w-full md:w-auto">
              <div className="flex border-b border-stone-200 overflow-x-auto whitespace-nowrap scrollbar-none w-full">
                {([
                  { key: 'all', label: `All Institutions (${countTotal})` },
                  { key: 'accredited', label: `Accredited (${countAccredited})` },
                  { key: 'pending', label: `Pending Approval (${countPending})` },
                  { key: 'revoked', label: `Revoked (${countRevoked})` }
                ] as { key: FilterTab; label: string }[]).map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => setActiveTab(tab.key)}
                    className={`px-4 py-2.5 text-xs font-bold uppercase tracking-wider border-b-2 transition-colors focus:outline-none -mb-[1px] cursor-pointer ${
                      activeTab === tab.key
                        ? 'border-indigo-600 text-indigo-600 font-bold'
                        : 'border-transparent text-stone-400 hover:text-stone-700'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Table Container */}
          <div className="bg-white border border-stone-200 shadow-sm rounded-xl overflow-hidden">
            {filteredIssuers.length === 0 ? (
              <div className="text-center py-16 px-4">
                <span className="text-3xl block mb-3">📋</span>
                {issuers.length === 0 ? (
                  <>
                    <h3 className="text-base font-bold text-stone-850">
                      No institutions yet
                    </h3>
                    <p className="text-sm text-stone-500 mt-1 mb-4">
                      Institutions will appear here once they register and are approved.
                    </p>
                    <button onClick={() => showToast("Registration is available via the public landing page.", "warning")} className="px-4 py-2 bg-indigo-50 text-indigo-700 font-medium rounded-md hover:bg-indigo-100 transition-colors">
                      View Registration Page
                    </button>
                  </>
                ) : (
                  <>
                    <h3 className="text-base font-bold text-stone-800 font-sans">No matching institutions found</h3>
                    <p className="text-sm text-stone-500 mt-1">Try adjusting your search query or select another filter tab.</p>
                  </>
                )}
              </div>
            ) : (
              <>
                {/* Desktop Table */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-stone-50 border-b border-stone-200 text-stone-400 text-[10px] font-bold uppercase tracking-widest">
                        <th className="py-3.5 px-6">Name</th>
                        <th className="py-3.5 px-4">Status</th>
                        <th className="py-3.5 px-4">Domain</th>
                        <th className="py-3.5 px-4">Accreditation Info</th>
                        <th className="py-3.5 px-6 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100 text-sm">
                      {filteredIssuers.map((issuer) => {
                        const email = emailMap[issuer.user_id] || 'unknown-user@actik.kh'
                        
                        return (
                          <tr key={issuer.id} className="hover:bg-stone-50/40 transition-colors">
                            <td className="py-4 px-6">
                              <div className="font-semibold text-stone-900">{issuer.name}</div>
                              <div className="text-xs text-stone-400 font-medium mt-0.5">{email}</div>
                            </td>
                            <td className="py-4 px-4">
                              {renderStatusBadge(issuer)}
                            </td>
                            <td className="py-4 px-4">
                              <button
                                onClick={() => {
                                  navigator.clipboard.writeText(issuer.domain)
                                  showToast('Domain copied to clipboard', 'success')
                                }}
                                className="text-indigo-650 hover:underline inline-flex items-center gap-1 font-semibold text-xs cursor-pointer group"
                                title="Click to copy"
                              >
                                {issuer.domain}
                                <svg className="w-3.5 h-3.5 text-stone-300 group-hover:text-indigo-500 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                                </svg>
                              </button>
                            </td>
                            <td className="py-4 px-4 text-xs font-medium text-stone-500">
                              {issuer.accredited ? (
                                <span className="block">Since: <strong>{formatDisplayDate(issuer.accredited_at)}</strong></span>
                              ) : issuer.revoked_at !== null ? (
                                <span className="block text-rose-600">Revoked: <strong>{formatDisplayDate(issuer.revoked_at)}</strong></span>
                              ) : (
                                <span className="block text-amber-600">Applied: <strong>{formatDisplayDate(issuer.created_at)}</strong></span>
                              )}
                            </td>
                            <td className="py-4 px-6 text-right">
                              <div className="flex items-center justify-end gap-2">
                                <button
                                  onClick={() => handleSelectIssuer(issuer)}
                                  className="px-2.5 py-1.5 text-xs font-bold border border-stone-200 hover:bg-stone-50 text-stone-600 rounded-lg shadow-sm transition-colors cursor-pointer"
                                >
                                  View
                                </button>
                                
                                {issuer.accredited ? (
                                  <button
                                    onClick={() => handleOpenRevokeModal(issuer)}
                                    disabled={isGlobalActionLoading}
                                    className="px-2.5 py-1.5 text-xs font-bold border border-rose-200 text-rose-600 bg-white hover:bg-rose-50 rounded-lg shadow-sm disabled:opacity-50 transition-all cursor-pointer"
                                  >
                                    Revoke
                                  </button>
                                ) : issuer.revoked_at !== null ? (
                                  <button
                                    onClick={() => handleOpenRestoreModal(issuer)}
                                    disabled={isGlobalActionLoading}
                                    className="px-2.5 py-1.5 text-xs font-bold border border-emerald-200 text-emerald-600 bg-white hover:bg-emerald-50 rounded-lg shadow-sm disabled:opacity-50 transition-all cursor-pointer"
                                  >
                                    Restore
                                  </button>
                                ) : (
                                  <>
                                    <button
                                      onClick={() => handleOpenRejectModal(issuer)}
                                      disabled={isGlobalActionLoading}
                                      className="px-2.5 py-1.5 text-xs font-bold border border-rose-200 text-rose-600 bg-white hover:bg-rose-50 rounded-lg shadow-sm disabled:opacity-50 transition-all cursor-pointer"
                                    >
                                      Reject
                                    </button>
                                    <button
                                      onClick={() => handleOpenApproveModal(issuer)}
                                      disabled={isGlobalActionLoading}
                                      className="px-2.5 py-1.5 text-xs font-bold border border-emerald-200 text-emerald-600 bg-white hover:bg-emerald-50 rounded-lg shadow-sm disabled:opacity-50 transition-all cursor-pointer"
                                    >
                                      Approve
                                    </button>
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Mobile Card List */}
                <div className="md:hidden divide-y divide-stone-150">
                  {filteredIssuers.map((issuer) => {
                    const email = emailMap[issuer.user_id] || 'unknown-user@actik.kh'

                    return (
                      <div key={issuer.id} className="p-4 flex flex-col gap-3">
                        <div className="flex justify-between items-start">
                          <div>
                            <div className="font-semibold text-stone-905 text-sm">{issuer.name}</div>
                            <div className="text-xs text-stone-400 font-medium mt-0.5">{email}</div>
                            <div className="text-xs text-stone-500 font-semibold mt-1">{issuer.domain}</div>
                          </div>
                          <div className="shrink-0">
                            {renderStatusBadge(issuer)}
                          </div>
                        </div>

                        <div className="text-xs font-medium text-stone-500 flex items-center justify-between border-t border-stone-50 pt-2">
                          {issuer.accredited ? (
                            <span>Since: <strong>{formatDisplayDate(issuer.accredited_at)}</strong></span>
                          ) : issuer.revoked_at !== null ? (
                            <span className="text-rose-600">Revoked: <strong>{formatDisplayDate(issuer.revoked_at)}</strong></span>
                          ) : (
                            <span className="text-amber-600">Applied: <strong>{formatDisplayDate(issuer.created_at)}</strong></span>
                          )}
                          <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border shrink-0 ${getTypeBadgeStyles(issuer.type)}`}>
                            {issuer.type}
                          </span>
                        </div>

                        <div className="flex gap-2.5 mt-1">
                          <button
                            onClick={() => handleSelectIssuer(issuer)}
                            className="flex-1 py-2 text-xs font-bold border border-stone-200 text-stone-600 bg-white hover:bg-stone-50 rounded-lg shadow-sm transition-all h-10 cursor-pointer"
                          >
                            View Details
                          </button>

                          {issuer.accredited ? (
                            <button
                              onClick={() => handleOpenRevokeModal(issuer)}
                              disabled={isGlobalActionLoading}
                              className="flex-1 py-2 text-xs font-bold border border-rose-205 text-rose-600 bg-white hover:bg-rose-50 rounded-lg shadow-sm disabled:opacity-50 transition-all h-10 cursor-pointer"
                            >
                              Revoke
                            </button>
                          ) : issuer.revoked_at !== null ? (
                            <button
                              onClick={() => handleOpenRestoreModal(issuer)}
                              disabled={isGlobalActionLoading}
                              className="flex-1 py-2 text-xs font-bold border border-emerald-205 text-emerald-600 bg-white hover:bg-emerald-50 rounded-lg shadow-sm disabled:opacity-50 transition-all h-10 cursor-pointer"
                            >
                              Restore
                            </button>
                          ) : (
                            <>
                              <button
                                onClick={() => handleOpenRejectModal(issuer)}
                                disabled={isGlobalActionLoading}
                                className="flex-1 py-2 text-xs font-bold border border-rose-205 text-rose-600 bg-white hover:bg-rose-50 rounded-lg shadow-sm disabled:opacity-50 transition-all h-10 cursor-pointer"
                              >
                                Reject
                              </button>
                              <button
                                onClick={() => handleOpenApproveModal(issuer)}
                                disabled={isGlobalActionLoading}
                                className="flex-1 py-2 text-xs font-bold border border-emerald-205 text-emerald-600 bg-white hover:bg-emerald-50 rounded-lg shadow-sm disabled:opacity-50 transition-all h-10 cursor-pointer"
                              >
                                Approve
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        </section>
      </div>

      {/* Audit Log Modal */}
      {isAuditLogOpen && (
        <AuditLogView onClose={() => setIsAuditLogOpen(false)} />
      )}

      {/* Institution Detailed Modal */}
      {selectedIssuer && (
        <InstitutionDetailModal
          issuer={selectedIssuer}
          registeredByEmail={emailMap[selectedIssuer.user_id]}
          approvedByEmail={selectedIssuer.accredited_by ? emailMap[selectedIssuer.accredited_by] : null}
          detailCredCount={detailCredCount}
          loadingDetailCount={loadingDetailCount}
          onClose={() => setSelectedIssuer(null)}
          onApprove={() => {
            handleOpenApproveModal(selectedIssuer)
            setSelectedIssuer(null)
          }}
          onReject={() => {
            handleOpenRejectModal(selectedIssuer)
            setSelectedIssuer(null)
          }}
          onRevoke={() => {
            handleOpenRevokeModal(selectedIssuer)
            setSelectedIssuer(null)
          }}
          onRestore={() => {
            handleOpenRestoreModal(selectedIssuer)
            setSelectedIssuer(null)
          }}
        />
      )}

      {/* Confirmation Modal */}
      {confirmModal && (
        <div className="fixed inset-0 bg-stone-900/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white border border-stone-200 rounded-xl shadow-2xl max-w-md w-full overflow-hidden animate-scale-in text-left">
            {/* Header */}
            <div className="p-6 pb-4 border-b border-stone-100">
              <h3
                className={`text-lg font-bold ${
                  confirmModal.type === 'approve' || confirmModal.type === 'restore'
                    ? 'text-stone-900'
                    : 'text-rose-705'
                }`}
              >
                {confirmModal.type === 'approve' && 'Approve this institution?'}
                {confirmModal.type === 'restore' && 'Restore accreditation?'}
                {confirmModal.type === 'revoke' && 'Revoke accreditation?'}
                {confirmModal.type === 'reject' && 'Reject application?'}
              </h3>
            </div>

            {/* Body */}
            <div className="p-6 space-y-4 text-sm text-stone-600">
              <div className="bg-stone-50 border border-stone-200/60 rounded-lg p-3">
                <div className="font-bold text-stone-800">{confirmModal.issuer.name}</div>
                <div className="text-xs text-stone-400 font-medium mt-0.5">
                  {confirmModal.issuer.domain}
                </div>
              </div>

              {/* Warnings based on transition type */}
              {(confirmModal.type === 'approve' || confirmModal.type === 'restore') && (
                <p className="leading-relaxed text-stone-500">
                  Approving this institution will allow them to issue digital credentials on Actik. Only accredit institutions verified through official channels.
                </p>
              )}
              {confirmModal.type === 'reject' && (
                <p className="leading-relaxed text-rose-600 font-medium">
                  Rejecting this pending application will completely delete the institution's registration request from the registry directory database. This cannot be undone.
                </p>
              )}
              {confirmModal.type === 'revoke' && (
                <div className="space-y-3 leading-relaxed">
                  <p className="text-rose-700 font-bold">
                    Revoking accreditation will immediately invalidate all credentials previously issued by this institution. Employers verifying those credentials will see a failed trust check.
                  </p>
                  {confirmModal.loading ? (
                    <div className="flex items-center gap-1.5 text-xs text-stone-400">
                      <div className="w-3.5 h-3.5 border-2 border-stone-200 border-t-indigo-600 rounded-full animate-spin" />
                      Loading affected credentials count...
                    </div>
                  ) : confirmModal.error ? (
                    <p className="text-xs text-rose-500 font-semibold">{confirmModal.error}</p>
                  ) : (
                    <p className="text-rose-700 font-bold bg-rose-50 border border-rose-100 rounded px-2.5 py-1.5 text-xs">
                      ⚠️ This affects {confirmModal.credentialCount ?? 0} credentials already issued by this institution.
                    </p>
                  )}
                </div>
              )}

              {/* Input for verification */}
              <div className="space-y-2 pt-2">
                <label className="font-bold text-stone-700 text-xs uppercase tracking-wider block">
                  {confirmModal.type === 'approve'
                    ? 'Type the institution name to confirm'
                    : `Type ${confirmModal.type.toUpperCase()} to confirm`}
                </label>
                <input
                  type="text"
                  placeholder={
                    confirmModal.type === 'approve'
                      ? 'Type name exactly...'
                      : `Type ${confirmModal.type.toUpperCase()} exactly...`
                  }
                  value={confirmModal.confirmInput}
                  onChange={(e) =>
                    setConfirmModal({ ...confirmModal, confirmInput: e.target.value })
                  }
                  disabled={confirmModal.loading}
                  className="w-full px-3 h-11 border border-stone-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 text-sm disabled:bg-stone-50"
                />
              </div>
            </div>

            {/* Actions */}
            <div className="p-6 border-t border-stone-100 bg-stone-50 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirmModal(null)}
                disabled={confirmModal.loading}
                className="h-11 px-4 border border-stone-200 bg-white text-stone-600 hover:bg-stone-50 font-semibold rounded-lg text-sm transition-colors disabled:opacity-50 cursor-pointer flex items-center justify-center"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={handleConfirmAction}
                disabled={isConfirmButtonDisabled}
                className={`h-11 px-4 text-white font-bold rounded-lg text-sm shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1.5 cursor-pointer ${
                  confirmModal.type === 'approve' || confirmModal.type === 'restore'
                    ? 'bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800'
                    : 'bg-rose-600 hover:bg-rose-700 active:bg-rose-800'
                }`}
              >
                {confirmModal.loading && (
                  <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                )}
                <span>
                  {confirmModal.type === 'approve' && 'Approve'}
                  {confirmModal.type === 'restore' && 'Restore'}
                  {confirmModal.type === 'revoke' && 'Revoke'}
                  {confirmModal.type === 'reject' && 'Reject Application'}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
