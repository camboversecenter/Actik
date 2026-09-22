import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { CheckCircle2, XCircle, ClipboardList, FileEdit } from 'lucide-react'

export interface AuditLog {
  id: string
  action: string
  admin_id: string | null
  institution_id: string | null
  timestamp: string
  ip_address: string | null
  device_info: string | null
  user_agent: string | null
  reason: string | null
  signature: string | null
  status_before: string | null
  status_after: string | null
  details: any
  // Relational joins
  admin_email?: string
  institution_name?: string
}

export default function AuditLogView({ onClose }: { onClose: () => void }) {
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [filterAction, setFilterAction] = useState('All Actions')
  const [filterDate, setFilterDate] = useState('All Time')

  useEffect(() => {
    fetchLogs()
    
    // Optional: Real-time subscriptions could be added here
  }, [])

  const fetchLogs = async () => {
    setLoading(true)
    setLoadError(false)
    try {
      const { data, error } = await supabase
        .from('audit_logs')
        .select('*')
        .order('timestamp', { ascending: false })
        .limit(20)

      if (error) {
        // Say the log could not be read. Never stand in for it: an audit
        // trail with invented entries is not an audit trail.
        console.error('[audit] could not read audit_logs:', error.message)
        setLogs([])
        setLoadError(true)
      } else {
        setLogs(data || [])
      }
    } catch (e) {
      console.error('[audit] could not read audit_logs:', e instanceof Error ? e.message : String(e))
      setLogs([])
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }

  const handleExport = () => {
    const dataStr = JSON.stringify(logs, null, 2)
    const blob = new Blob([dataStr], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `audit-log-${new Date().toISOString().split('T')[0]}.json`
    link.click()
  }

  // Formatting helpers
  const getActionStyles = (action: string) => {
    if (action.includes('APPROVED') || action.includes('RESTORED')) {
      return { icon: CheckCircle2, color: 'text-emerald-700 bg-emerald-50 border-emerald-200' }
    }
    if (action.includes('REVOKED') || action.includes('REJECTED')) {
      return { icon: XCircle, color: 'text-rose-700 bg-rose-50 border-rose-200' }
    }
    if (action.includes('REGISTERED')) {
      return { icon: ClipboardList, color: 'text-indigo-700 bg-indigo-50 border-indigo-200' }
    }
    return { icon: FileEdit, color: 'text-stone-700 bg-stone-50 border-stone-200' }
  }

  const filteredLogs = logs.filter(log => {
    const matchesSearch = 
      (log.institution_name?.toLowerCase() || '').includes(searchQuery.toLowerCase()) ||
      (log.admin_email?.toLowerCase() || '').includes(searchQuery.toLowerCase())
    
    const matchesAction = filterAction === 'All Actions' || log.action.includes(filterAction.toUpperCase())
    return matchesSearch && matchesAction
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-sm">
      <div className="w-full max-w-4xl bg-white border border-stone-200 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-scale-in">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-stone-200 bg-stone-50 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-stone-900 tracking-tight">Audit Log - Trust Registry</h2>
            <p className="text-xs text-stone-500 font-medium">Complete trail of administrative actions</p>
          </div>
          <button onClick={onClose} className="p-2 text-stone-400 hover:text-stone-700 hover:bg-stone-200 rounded-full transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

      {/* Filters */}
      <div className="p-4 border-b border-stone-200 bg-white grid grid-cols-1 sm:grid-cols-4 gap-3">
        <select 
          value={filterAction}
          onChange={(e) => setFilterAction(e.target.value)}
          className="text-sm border border-stone-200 rounded-[9px] px-3 py-2 bg-stone-50 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        >
          <option>All Actions</option>
          <option>Approved</option>
          <option>Revoked</option>
          <option>Registered</option>
        </select>
        
        <select 
          value={filterDate}
          onChange={(e) => setFilterDate(e.target.value)}
          className="text-sm border border-stone-200 rounded-[9px] px-3 py-2 bg-stone-50 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        >
          <option>All Time</option>
          <option>Last 7 days</option>
          <option>Last 30 days</option>
        </select>

        <input 
          type="text" 
          placeholder="Search admin, institution..." 
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="sm:col-span-2 text-sm border border-stone-200 rounded-[9px] px-3 py-2 bg-stone-50 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </div>

      {/* Log List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6 bg-stone-50/50">
        {loading ? (
          <div className="animate-pulse space-y-4">
            {[1,2,3].map(i => (
              <div key={i} className="h-32 bg-stone-200 rounded-xl w-full"></div>
            ))}
          </div>
        ) : loadError ? (
          <div className="text-center py-12 text-amber-700 text-sm font-medium">
            The audit log could not be read. Nothing is shown rather than something approximate.
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="text-center py-12 text-stone-500 text-sm font-medium">
            No audit logs found matching your filters.
          </div>
        ) : (
          filteredLogs.map(log => {
            const style = getActionStyles(log.action)
            const date = new Date(log.timestamp)
            
            return (
              <div key={log.id} className="relative">
                {/* Timeline connector (hidden on mobile, visible on desktop if mapped inside a timeline container, but kept simple here) */}
                <div className="mb-2">
                  <span className="text-xs font-bold text-stone-500 uppercase tracking-wider">
                    {date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} 
                    <span className="mx-1 text-stone-300">•</span>
                    {date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                
                <div className="bg-white border border-stone-200 rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow">
                  <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wider border mb-4 ${style.color}`}>
                    <style.icon size={13} /> {log.action}
                  </div>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-2 gap-x-4 text-sm mb-4">
                    {log.admin_email && (
                      <div>
                        <span className="text-stone-500 font-medium w-24 inline-block">Admin/User:</span>
                        <span className="font-semibold text-stone-900">{log.admin_email}</span>
                      </div>
                    )}
                    {log.institution_name && (
                      <div>
                        <span className="text-stone-500 font-medium w-24 inline-block">Institution:</span>
                        <span className="font-semibold text-stone-900">{log.institution_name}</span>
                      </div>
                    )}
                    {log.status_before && log.status_after && (
                      <div className="sm:col-span-2">
                        <span className="text-stone-500 font-medium w-24 inline-block">Status:</span>
                        <span className="font-semibold text-stone-500 line-through mr-1">{log.status_before}</span>
                        <span className="text-stone-400">→</span>
                        <span className="font-semibold text-stone-900 ml-1">{log.status_after}</span>
                      </div>
                    )}
                    {log.reason && (
                      <div className="sm:col-span-2">
                        <span className="text-stone-500 font-medium w-24 inline-block">Reason:</span>
                        <span className="font-semibold text-rose-700">{log.reason}</span>
                      </div>
                    )}
                    {log.details?.did && (
                      <div>
                        <span className="text-stone-500 font-medium w-24 inline-block">DID:</span>
                        <code className="text-xs bg-stone-100 px-1 py-0.5 rounded text-indigo-700">{log.details.did}</code>
                      </div>
                    )}
                    {log.ip_address && (
                      <div>
                        <span className="text-stone-500 font-medium w-24 inline-block">IP Address:</span>
                        <span className="text-stone-700 font-mono text-xs">{log.ip_address}</span>
                      </div>
                    )}
                    {log.device_info && (
                      <div>
                        <span className="text-stone-500 font-medium w-24 inline-block">Device:</span>
                        <span className="text-stone-700 text-xs">{log.device_info}</span>
                      </div>
                    )}
                    {log.signature && (
                      <div className="sm:col-span-2 flex items-center gap-2 mt-1">
                        <span className="text-stone-500 font-medium w-24 inline-block">Signature:</span>
                        <code className="text-[10px] text-stone-500 bg-stone-100 px-1.5 py-0.5 rounded truncate max-w-[150px]">
                          {log.signature}
                        </code>
                        <button className="text-[10px] font-bold text-indigo-600 hover:text-indigo-800">
                          [Verify]
                        </button>
                      </div>
                    )}
                  </div>
                  
                  <div className="flex items-center gap-3 pt-3 border-t border-stone-100">
                    <button className="text-xs font-bold text-indigo-600 hover:text-indigo-800 transition-colors">
                      [View Details]
                    </button>
                    {log.action.includes('APPROVED') && (
                      <button className="text-xs font-bold text-rose-600 hover:text-rose-800 transition-colors ml-auto">
                        [Revert Action*]
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })
        )}
        
        {filteredLogs.length > 0 && (
          <div className="text-center pt-4">
            <button className="px-4 py-2 bg-white border border-stone-200 text-sm font-semibold text-stone-600 rounded-[9px] hover:bg-stone-50 shadow-sm transition-colors">
              Load More
            </button>
          </div>
        )}
      </div>

      {/* Footer Actions */}
      <div className="p-4 border-t border-stone-200 bg-white flex items-center justify-between">
        <div className="text-xs font-semibold text-stone-500">
          Showing {filteredLogs.length} entries
        </div>
        <div className="flex gap-2">
          <button 
            onClick={handleExport}
            className="px-3 py-1.5 border border-stone-200 text-stone-700 bg-white hover:bg-stone-50 rounded-[9px] text-xs font-bold shadow-sm transition-colors"
          >
            Export Log
          </button>
          <button 
            onClick={() => window.print()}
            className="px-3 py-1.5 border border-stone-200 text-stone-700 bg-white hover:bg-stone-50 rounded-[9px] text-xs font-bold shadow-sm transition-colors"
          >
            Print
          </button>
          <button 
            onClick={onClose}
            className="px-4 py-1.5 ml-2 border border-stone-200 text-stone-700 bg-white hover:bg-stone-100 rounded-[9px] text-xs font-bold shadow-sm transition-colors"
          >
            Close
          </button>
        </div>
      </div>

      </div>
    </div>
  )
}
