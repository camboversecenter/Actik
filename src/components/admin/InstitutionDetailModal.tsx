import { useState } from 'react'
import { X, ExternalLink } from 'lucide-react'
import StatusPill from '../ui/StatusPill'

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

interface InstitutionDetailProps {
  issuer: Issuer
  registeredByEmail: string
  approvedByEmail: string | null
  detailCredCount: number | null
  loadingDetailCount: boolean
  onClose: () => void
  onApprove: () => void
  onReject: () => void
  onRevoke: () => void
  onRestore: () => void
}

/**
 * Format timestamp nicely.
 */
function formatDate(dateStr: string | null) {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return 'Unknown'
  return d.toLocaleDateString('en-US', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function InstitutionDetailModal({
  issuer,
  registeredByEmail,
  approvedByEmail,
  detailCredCount,
  loadingDetailCount,
  onClose,
  onApprove,
  onReject,
  onRevoke,
  onRestore,
}: InstitutionDetailProps) {
  const [copiedText, setCopiedText] = useState<string | null>(null)

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text)
    setCopiedText(label)
    setTimeout(() => setCopiedText(null), 1500)
  }

  // Key ID extractor (attempts to parse JWK to extract kid, fallback to key-001)
  let keyId = 'key-001'
  try {
    const parsed = JSON.parse(issuer.public_key)
    if (parsed.kid) {
      keyId = parsed.kid
    }
  } catch {}

  // Accreditation Status
  const isAccredited = issuer.accredited
  const isRevoked = !issuer.accredited && issuer.revoked_at !== null
  const isPending = !issuer.accredited && issuer.revoked_at === null

  // Credentials metrics logic:
  // - If accredited: active is total, revoked is 0
  // - If revoked: active is 0, revoked is total
  // - If pending: total, active, revoked are all 0
  const credTotal = detailCredCount ?? 0
  const credActive = isAccredited ? credTotal : 0
  const credRevoked = isRevoked ? credTotal : 0

  return (
    <div className="fixed inset-0 bg-stone-900/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm text-left">
      <style>{`
        @keyframes scaleIn {
          0% { transform: scale(0.95); opacity: 0; }
          100% { transform: scale(1); opacity: 1; }
        }
        .animate-scale-in {
          animation: scaleIn 0.2s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
        }
      `}</style>
      
      <div className="bg-white border border-stone-200 rounded-xl shadow-2xl max-w-lg w-full overflow-hidden animate-scale-in max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-stone-150 flex items-center justify-between">
          <div>
            <span className="text-[10px] font-bold text-stone-400 uppercase tracking-widest block">
              Institution Profile
            </span>
            <h3 className="text-lg font-bold text-stone-900 mt-1">{issuer.name}</h3>
          </div>
          <button
            onClick={onClose}
            className="text-stone-400 hover:text-stone-600 focus:outline-none p-1.5 rounded-full hover:bg-stone-50 transition-all cursor-pointer"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="p-6 space-y-6 overflow-y-auto flex-1">
          {/* Institution Information */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold text-stone-400 uppercase tracking-wider border-b border-stone-100 pb-1">
              Institution Information
            </h4>
            <div className="grid grid-cols-2 gap-4 text-xs font-medium">
              <div>
                <span className="text-stone-400 block font-semibold">Official Name</span>
                <span className="text-stone-800 text-sm font-bold block mt-0.5">{issuer.name}</span>
              </div>
              <div>
                <span className="text-stone-400 block font-semibold">Type</span>
                <span className="text-stone-800 text-sm font-bold block mt-0.5">{issuer.type}</span>
              </div>
              <div>
                <span className="text-stone-400 block font-semibold">Domain</span>
                <a
                  href={`https://${issuer.domain}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-indigo-650 hover:underline font-bold inline-flex items-center gap-1 mt-0.5"
                >
                  {issuer.domain}
                  <ExternalLink size={12} className="text-indigo-400" />
                </a>
              </div>
              <div>
                <span className="text-stone-400 block font-semibold">Accreditation Status</span>
                <div className="mt-1">
                  {isAccredited && (
                    <StatusPill status="verified" label={`ACCREDITED (since ${formatDate(issuer.accredited_at).split(',')[0]})`} />
                  )}
                  {isPending && <StatusPill status="pending" label="PENDING APPROVAL" />}
                  {isRevoked && <StatusPill status="failed" label="REVOKED" />}
                </div>
              </div>
            </div>
          </div>

          {/* Decentralized Identity (DID) */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold text-stone-400 uppercase tracking-wider border-b border-stone-100 pb-1">
              Decentralized Identity (DID)
            </h4>
            <div className="space-y-2 text-xs font-medium">
              <div>
                <span className="text-stone-400 block font-semibold">DID Identifier</span>
                <div className="relative group mt-1">
                  <code className="text-[10px] bg-stone-50 border border-stone-200 p-2 rounded block font-mono text-stone-600 break-all select-all font-medium pr-10">
                    {issuer.did}
                  </code>
                  <button
                    onClick={() => handleCopy(issuer.did, 'did')}
                    className="absolute right-2 top-2 text-stone-400 hover:text-indigo-650 p-1 rounded bg-white border border-stone-200 shadow-sm transition-colors focus:outline-none cursor-pointer"
                    title="Copy DID"
                  >
                    {copiedText === 'did' ? (
                      <span className="text-emerald-600 font-bold text-[9px]">Copied!</span>
                    ) : (
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="text-stone-400 block font-semibold">Created</span>
                  <span className="text-stone-800 text-sm font-bold block mt-0.5">{formatDate(issuer.created_at)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Public Key (for verification) */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold text-stone-400 uppercase tracking-wider border-b border-stone-100 pb-1">
              Public Key (for verification)
            </h4>
            <div className="space-y-2 text-xs font-medium">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="text-stone-400 block font-semibold">Algorithm</span>
                  <span className="text-stone-800 text-xs font-bold block mt-0.5">ES256 (ECDSA P-256)</span>
                </div>
                <div>
                  <span className="text-stone-400 block font-semibold">Key ID (kid)</span>
                  <span className="text-stone-800 text-xs font-mono font-bold block mt-0.5">{keyId}</span>
                </div>
              </div>
              <div>
                <span className="text-stone-400 block font-semibold">ES256 Public Key (JWK)</span>
                <div className="relative group mt-1">
                  <div className="bg-stone-50 border border-stone-200 p-2.5 rounded-xl max-h-24 overflow-auto">
                    <code className="text-[9px] font-mono text-stone-500 break-all select-all block leading-normal pr-8">
                      {issuer.public_key}
                    </code>
                  </div>
                  <button
                    onClick={() => handleCopy(issuer.public_key, 'key')}
                    className="absolute right-3 top-2.5 text-stone-400 hover:text-indigo-650 p-1 rounded bg-white border border-stone-200 shadow-sm transition-colors focus:outline-none cursor-pointer"
                    title="Copy Public Key"
                  >
                    {copiedText === 'key' ? (
                      <span className="text-emerald-700 font-bold text-[9px]">Copied!</span>
                    ) : (
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Credentials Issued */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold text-stone-400 uppercase tracking-wider border-b border-stone-100 pb-1">
              Credentials Issued
            </h4>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div className="bg-stone-50 border border-stone-200 rounded-xl p-2.5">
                <span className="text-[10px] text-stone-400 font-bold uppercase tracking-wider block">Total</span>
                {loadingDetailCount ? (
                  <div className="w-4 h-4 border-2 border-stone-200 border-t-indigo-600 rounded-full animate-spin mx-auto mt-1" />
                ) : (
                  <strong className="font-mono text-stone-900 text-base mt-0.5 block">{credTotal}</strong>
                )}
              </div>
              <div className="bg-stone-50 border border-stone-200 rounded-xl p-2.5">
                <span className="text-[10px] text-stone-400 font-bold uppercase tracking-wider block">Active</span>
                {loadingDetailCount ? (
                  <div className="w-4 h-4 border-2 border-stone-200 border-t-indigo-600 rounded-full animate-spin mx-auto mt-1" />
                ) : (
                  <strong className="font-mono text-emerald-700 text-base mt-0.5 block">{credActive}</strong>
                )}
              </div>
              <div className="bg-stone-50 border border-stone-200 rounded-xl p-2.5">
                <span className="text-[10px] text-stone-400 font-bold uppercase tracking-wider block">Revoked</span>
                {loadingDetailCount ? (
                  <div className="w-4 h-4 border-2 border-stone-200 border-t-indigo-600 rounded-full animate-spin mx-auto mt-1" />
                ) : (
                  <strong className="font-mono text-rose-700 text-base mt-0.5 block">{credRevoked}</strong>
                )}
              </div>
            </div>
          </div>

          {/* Registration Details */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold text-stone-400 uppercase tracking-wider border-b border-stone-100 pb-1">
              Registration Details
            </h4>
            <div className="grid grid-cols-2 gap-4 text-xs font-medium">
              <div>
                <span className="text-stone-400 block font-semibold">Registered by</span>
                <span className="text-stone-800 block mt-0.5 font-bold truncate" title={registeredByEmail}>{registeredByEmail}</span>
              </div>
              <div>
                <span className="text-stone-400 block font-semibold">Registered on</span>
                <span className="text-stone-800 block mt-0.5 font-bold">{formatDate(issuer.created_at)}</span>
              </div>
              {isAccredited && (
                <>
                  <div>
                    <span className="text-stone-400 block font-semibold">Approved by</span>
                    <span className="text-stone-800 block mt-0.5 font-bold truncate" title={approvedByEmail || 'MoEYS Root Admin'}>
                      {approvedByEmail || 'MoEYS Root Admin'}
                    </span>
                  </div>
                  <div>
                    <span className="text-stone-400 block font-semibold">Approved on</span>
                    <span className="text-stone-800 block mt-0.5 font-bold">{formatDate(issuer.accredited_at)}</span>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Audit Log */}
          <div className="space-y-3">
            <div className="flex items-center justify-between border-b border-stone-100 pb-1">
              <h4 className="text-xs font-bold text-stone-400 uppercase tracking-wider">
                Audit Log
              </h4>
              <button className="text-[10px] text-indigo-600 hover:text-indigo-800 font-bold transition-colors">
                [View Full Audit Log]
              </button>
            </div>
            <div className="bg-stone-50 border border-stone-200 p-3 rounded-xl text-xs space-y-2 font-medium">
              <div>
                <span className="text-stone-400 block font-semibold">Status</span>
                <strong className={`block uppercase ${isAccredited ? 'text-emerald-700' : isRevoked ? 'text-rose-700' : 'text-amber-700'}`}>
                  {isAccredited ? 'ACCREDITED' : isRevoked ? 'REVOKED' : 'PENDING APPROVAL'}
                </strong>
              </div>
              {isAccredited && (
                <>
                  <div>
                    <span className="text-stone-400 block font-semibold">Approved on</span>
                    <span className="text-stone-800 block">{formatDate(issuer.accredited_at)} by {approvedByEmail || 'System Admin'}</span>
                  </div>
                  <div>
                    <span className="text-stone-400 block font-semibold">Approval reason</span>
                    <span className="text-stone-700 block italic">Verified educational institution credentials under MoEYS trust framework.</span>
                  </div>
                </>
              )}
              {isRevoked && (
                <>
                  <div>
                    <span className="text-stone-400 block font-semibold">Revoked on</span>
                    <span className="text-stone-800 block">{formatDate(issuer.revoked_at)} by {approvedByEmail || 'System Admin'}</span>
                  </div>
                  <div>
                    <span className="text-stone-400 block font-semibold">Revocation reason</span>
                    <span className="text-stone-700 block italic text-rose-600">Administrative revocation order issued.</span>
                  </div>
                </>
              )}
              {isPending && (
                <div className="text-stone-500 italic">No accreditation actions recorded yet. Application is pending review.</div>
              )}
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-6 border-t border-stone-150 bg-stone-50 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="h-10 px-4 border border-stone-200 bg-white text-stone-600 hover:bg-stone-50 font-semibold rounded-[9px] text-xs transition-colors cursor-pointer"
          >
            Close
          </button>
          
          {isAccredited && (
            <>
              <button
                type="button"
                onClick={() => alert('Editing institution properties is coming soon in trust settings.')}
                className="h-10 px-4 border border-stone-200 bg-white text-stone-700 hover:bg-stone-50 font-semibold rounded-[9px] text-xs transition-colors cursor-pointer"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={onRevoke}
                className="h-10 px-4 bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white font-bold rounded-[9px] text-xs shadow-sm transition-colors cursor-pointer"
              >
                Revoke Accreditation
              </button>
            </>
          )}

          {isPending && (
            <>
              <button
                type="button"
                onClick={onReject}
                className="h-10 px-4 border border-rose-200 hover:bg-rose-50 text-rose-600 font-bold rounded-[9px] text-xs transition-colors cursor-pointer"
              >
                Reject
              </button>
              <button
                type="button"
                onClick={onApprove}
                className="h-10 px-4 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-bold rounded-[9px] text-xs shadow-sm transition-colors cursor-pointer"
              >
                Approve
              </button>
            </>
          )}

          {isRevoked && (
            <>
              <button
                type="button"
                disabled
                className="h-10 px-4 border border-stone-200 bg-stone-100 text-stone-400 font-semibold rounded-[9px] text-xs cursor-not-allowed"
              >
                View Details
              </button>
              <button
                type="button"
                onClick={onRestore}
                className="h-10 px-4 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-bold rounded-[9px] text-xs shadow-sm transition-colors cursor-pointer"
              >
                Restore
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
