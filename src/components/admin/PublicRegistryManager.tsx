import { useState } from 'react'
import { Globe, CheckCircle2, Clock, Zap, ExternalLink } from 'lucide-react'
import RegistryExportModal from './RegistryExportModal'

export default function PublicRegistryManager({ countTotal = 0, countAccredited = 0 }) {
  const [isPublishing, setIsPublishing] = useState(false)
  const [lastPublished, setLastPublished] = useState<Date | null>(new Date('2026-12-12T12:31:00'))
  const [autoPublish, setAutoPublish] = useState(false)
  const [showVerifyModal, setShowVerifyModal] = useState(false)
  const [showExportModal, setShowExportModal] = useState(false)

  const handlePublish = async () => {
    setIsPublishing(true)
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 1500))
    setLastPublished(new Date())
    setIsPublishing(false)
    // We would normally fire a toast here, but for isolation we'll just log or use browser alert if no toast context
    alert('Registry published successfully')
  }

  const handleRefresh = async () => {
    // Simulate checking sync
    await new Promise(resolve => setTimeout(resolve, 500))
  }

  const isPublished = true // In a real app, compare local state hash with published hash
  
  return (
    <section className="space-y-4 mb-8">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-bold text-stone-400 uppercase tracking-widest flex items-center gap-1.5">
          <Globe size={14} /> Public Registry Management
        </h2>
        
        {/* Auto-publish Toggle */}
        <label className="flex items-center gap-2 cursor-pointer group">
          <span className="text-xs font-semibold text-stone-500 group-hover:text-stone-700 transition-colors">
            Auto-publish on changes
          </span>
          <div className="relative">
            <input 
              type="checkbox" 
              className="sr-only" 
              checked={autoPublish} 
              onChange={() => setAutoPublish(!autoPublish)} 
            />
            <div className={`block w-8 h-5 rounded-full transition-colors ${autoPublish ? 'bg-indigo-500' : 'bg-stone-300'}`}></div>
            <div className={`absolute left-0.5 top-0.5 bg-white w-4 h-4 rounded-full transition-transform ${autoPublish ? 'transform translate-x-3' : ''}`}></div>
          </div>
        </label>
      </div>

      <div className="bg-sky-50 border border-sky-100 rounded-xl shadow-sm overflow-hidden flex flex-col md:flex-row">
        
        {/* Left Side: Status Card */}
        <div className="p-5 md:p-6 md:w-2/3 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-3 mb-4">
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold uppercase tracking-wider border ${
                isPublished
                  ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                  : 'bg-amber-100 text-amber-800 border-amber-200'
              }`}>
                {isPublished ? <CheckCircle2 size={13} /> : <Clock size={13} />}
                {isPublished ? 'PUBLISHED' : 'DRAFT PENDING'}
              </span>
              {autoPublish && (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-sky-600 bg-sky-100 px-2 py-0.5 rounded-full uppercase tracking-wider border border-sky-200">
                  <Zap size={11} /> Auto-sync Active
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-4 gap-x-6 text-sm mb-6">
              <div>
                <span className="text-sky-700 block text-xs font-semibold uppercase tracking-wider mb-0.5">Public URL</span>
                <a href="https://registry.actik.kh/public" target="_blank" rel="noreferrer" className="text-indigo-600 font-semibold hover:underline flex items-center gap-1">
                  registry.actik.kh/public
                  <ExternalLink size={12} />
                </a>
              </div>
              <div>
                <span className="text-sky-700 block text-xs font-semibold uppercase tracking-wider mb-0.5">Last Published</span>
                <span className="font-semibold text-stone-900">
                  {lastPublished ? lastPublished.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Never'}
                </span>
                <span className="text-stone-500 text-xs block">by admin@moeys.gov.kh</span>
              </div>
              
              <div className="sm:col-span-2 bg-white/60 p-3 rounded-lg border border-sky-100/50">
                <div className="flex items-start justify-between flex-wrap gap-2">
                  <div>
                    <span className="text-sky-700 block text-xs font-semibold uppercase tracking-wider mb-0.5">Registry Signature</span>
                    <code className="text-xs font-mono text-stone-700 bg-white px-1.5 py-0.5 rounded border border-stone-200 break-all">
                      0x3f5a9c2ebde4108892...
                    </code>
                  </div>
                  <button 
                    onClick={() => setShowVerifyModal(true)}
                    className="text-xs font-bold text-indigo-600 hover:text-indigo-800 transition-colors"
                  >
                    [Verify Signature]
                  </button>
                </div>
                <div className="mt-2 text-xs text-stone-500">
                  MoEYS Public Key Used: <code className="bg-white px-1 rounded text-stone-600">did:web:moeys.gov.kh</code>
                </div>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center gap-2 pt-4 border-t border-sky-200/50">
            <button
              onClick={handlePublish}
              disabled={isPublishing || autoPublish}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold rounded-lg shadow-sm transition-colors"
            >
              {isPublishing ? (
                <>
                  <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Publishing...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                  Publish Registry
                </>
              )}
            </button>
            
            <div>
              <button
                onClick={() => setShowExportModal(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-white hover:bg-sky-50 border border-sky-200 text-sky-800 text-sm font-bold rounded-lg shadow-sm transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Download Registry
              </button>
            </div>

            <button
              onClick={() => window.open('https://registry.actik.kh/public', '_blank')}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-white hover:bg-sky-50 border border-sky-200 text-sky-800 text-sm font-bold rounded-lg shadow-sm transition-colors"
            >
              View Public Page
            </button>
            
            <button
              onClick={handleRefresh}
              className="p-2 bg-white hover:bg-sky-50 border border-sky-200 text-sky-600 rounded-lg shadow-sm transition-colors ml-auto md:ml-0"
              title="Refresh Status"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          </div>
        </div>

        {/* Right Side: Details & Audit Trail */}
        <div className="bg-white/80 border-l border-sky-100 p-5 md:p-6 md:w-1/3 flex flex-col">
          <div className="mb-6">
            <h3 className="text-xs font-bold text-sky-800 uppercase tracking-widest mb-3 border-b border-sky-100 pb-2">
              Registry Details
            </h3>
            <ul className="space-y-2 text-sm text-stone-600 font-medium">
              <li className="flex justify-between items-center">
                <span>Total Institutions</span>
                <span className="font-bold text-stone-900 bg-stone-100 px-2 py-0.5 rounded">{countTotal}</span>
              </li>
              <li className="flex justify-between items-center">
                <span>Accredited</span>
                <span className="font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">{countAccredited}</span>
              </li>
              <li className="flex justify-between items-center text-xs mt-3 text-stone-400">
                <span>Last Modified</span>
                <span>Dec 12, 12:31 PM</span>
              </li>
            </ul>
          </div>
          
          <div className="mt-auto">
            <h3 className="text-xs font-bold text-sky-800 uppercase tracking-widest mb-3 border-b border-sky-100 pb-2 flex items-center justify-between">
              Recent Publishes
              <button className="text-[10px] text-indigo-600 hover:text-indigo-800 transition-colors">
                [History]
              </button>
            </h3>
            <ul className="space-y-3 text-xs">
              <li className="flex items-start gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-1.5 shrink-0"></div>
                <div>
                  <p className="font-semibold text-stone-800">Dec 12, 12:31 PM</p>
                  <p className="text-stone-500">by admin@moeys.gov.kh</p>
                </div>
              </li>
              <li className="flex items-start gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-stone-300 mt-1.5 shrink-0"></div>
                <div>
                  <p className="font-semibold text-stone-600">Dec 11, 02:45 PM</p>
                  <p className="text-stone-400">by admin@moeys.gov.kh</p>
                </div>
              </li>
            </ul>
          </div>
        </div>
      </div>

      {/* Signature Verification Modal */}
      {showVerifyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-scale-in">
            <div className="p-5 border-b border-stone-200 bg-stone-50 flex items-center justify-between">
              <h3 className="text-lg font-bold text-stone-900 flex items-center gap-2">
                <svg className="w-5 h-5 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
                Signature Verification
              </h3>
              <button onClick={() => setShowVerifyModal(false)} className="text-stone-400 hover:text-stone-600">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            <div className="p-6 space-y-4">
              <div className="flex items-center gap-3 p-3 bg-emerald-50 text-emerald-800 rounded-lg border border-emerald-200">
                <svg className="w-6 h-6 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l3-3z" clipRule="evenodd" />
                </svg>
                <div>
                  <p className="font-bold">Valid MoEYS Signature</p>
                  <p className="text-xs opacity-90 mt-0.5">The registry has not been tampered with since publication.</p>
                </div>
              </div>
              
              <div className="space-y-2 text-sm">
                <div>
                  <span className="text-stone-500 font-semibold block text-xs uppercase tracking-wider">Computed Hash</span>
                  <code className="text-xs bg-stone-100 px-2 py-1 rounded block text-stone-800 font-mono break-all mt-1">
                    0a4d55a8d778e5022fab701977c5d840bbc486d0
                  </code>
                </div>
                <div>
                  <span className="text-stone-500 font-semibold block text-xs uppercase tracking-wider">Signed With Key</span>
                  <code className="text-xs bg-indigo-50 text-indigo-800 px-2 py-1 rounded block font-mono mt-1">
                    did:web:moeys.gov.kh#key-1
                  </code>
                </div>
              </div>
            </div>
            
            <div className="p-4 border-t border-stone-200 bg-stone-50 flex justify-end">
              <button 
                onClick={() => setShowVerifyModal(false)}
                className="px-4 py-2 bg-white border border-stone-300 text-stone-700 font-bold rounded-lg shadow-sm hover:bg-stone-100 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Export/Download Modal */}
      {showExportModal && (
        <RegistryExportModal 
          onClose={() => setShowExportModal(false)}
          totalInstitutions={countTotal}
          accreditedInstitutions={countAccredited}
        />
      )}
    </section>
  )
}
