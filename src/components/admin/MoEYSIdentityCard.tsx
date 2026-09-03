import { useState } from 'react'
import { Landmark } from 'lucide-react'

const HARDCODED_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAElQ+v04qE...
9x+F0E2+5zN2lH1a9j2uI0V5A3X8c1V8b7U6zT4W1yR...
-----END PUBLIC KEY-----`

export default function MoEYSIdentityCard() {
  const [copied, setCopied] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isExpandedMobile, setIsExpandedMobile] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(HARDCODED_PUBLIC_KEY)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const handleDownload = () => {
    // Download PEM
    const pemBlob = new Blob([HARDCODED_PUBLIC_KEY], { type: 'application/x-pem-file' })
    const pemUrl = URL.createObjectURL(pemBlob)
    const pemLink = document.createElement('a')
    pemLink.href = pemUrl
    pemLink.download = 'moeys-public-key.pem'
    pemLink.click()

    // Download Metadata JSON
    const metaInfo = {
      institution: 'Ministry of Education, Youth and Sport',
      did: 'did:web:moeys.gov.kh',
      established: '2023-12-01T00:00:00Z',
      algorithm: 'ES256 (ECDSA using P-256 and SHA-256)',
      status: 'Active and authorized',
      verification_url: 'https://moeys.gov.kh/.well-known/did',
      key_id: 'key-1'
    }
    const jsonBlob = new Blob([JSON.stringify(metaInfo, null, 2)], { type: 'application/json' })
    const jsonUrl = URL.createObjectURL(jsonBlob)
    const jsonLink = document.createElement('a')
    jsonLink.href = jsonUrl
    jsonLink.download = 'moeys-key-info.json'
    jsonLink.click()
  }

  return (
    <>
      <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 md:p-6 mb-8 shadow-sm">
        {/* Header Section */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 border-b border-indigo-100 pb-4 mb-4">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 bg-white rounded-lg flex items-center justify-center shadow-sm border border-indigo-100 shrink-0">
              <Landmark size={22} className="text-indigo-600" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <h2 className="text-lg md:text-xl font-bold text-indigo-900 leading-tight">
                  Ministry of Education, Youth and Sport
                </h2>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 uppercase tracking-wider">
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                  VERIFIED
                </span>
              </div>
              <div className="space-y-1 mt-2">
                <p className="text-sm text-indigo-800 flex items-center gap-2">
                  <span className="font-semibold text-indigo-900">DID:</span>
                  <code className="bg-indigo-100 px-1.5 py-0.5 rounded text-indigo-700 select-all">
                    did:web:moeys.gov.kh
                  </code>
                </p>
                <p className="text-sm text-indigo-800">
                  <span className="font-semibold text-indigo-900">Established:</span> Dec 1, 2023
                </p>
                <p className="text-sm text-indigo-800">
                  <span className="font-semibold text-indigo-900">Status:</span> Active and authorized
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Main Content (Key section) */}
        <div className="mt-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-indigo-900">Public Key (for verification)</h3>
            {/* Mobile Expand Toggle */}
            <button 
              onClick={() => setIsExpandedMobile(!isExpandedMobile)}
              className="md:hidden text-xs font-medium text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
            >
              {isExpandedMobile ? 'Hide Key' : 'Show Key'}
              <svg 
                className={`w-4 h-4 transition-transform ${isExpandedMobile ? 'rotate-180' : ''}`} 
                fill="none" viewBox="0 0 24 24" stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          </div>
          
          <div className={`
            ${isExpandedMobile ? 'block' : 'hidden'} md:block 
            relative group rounded-lg bg-indigo-950 p-4 border border-indigo-900 overflow-hidden
          `}>
            {/* The pre tag is scrollable on all sizes, but we restrict height on tablets */}
            <pre className="text-indigo-200 text-xs sm:text-sm font-mono overflow-x-auto whitespace-pre h-20 md:h-auto overflow-y-hidden md:overflow-y-visible">
              {HARDCODED_PUBLIC_KEY}
            </pre>
            
            {/* Gradient overlay for tablet to indicate truncation */}
            <div className="hidden sm:block md:hidden absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-indigo-950 to-transparent pointer-events-none" />
          </div>

          <p className="text-xs text-indigo-600 mt-3 mb-4 max-w-2xl">
            This public key is used to verify all MoEYS signatures on the trust registry. 
            Verification URL: <a href="https://moeys.gov.kh/.well-known/did" className="underline hover:text-indigo-800 break-all" target="_blank" rel="noreferrer">https://moeys.gov.kh/.well-known/did</a>
          </p>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => setIsModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-indigo-200 text-indigo-700 text-sm font-medium rounded-md hover:bg-indigo-50 hover:border-indigo-300 transition-colors shadow-sm"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
              View Full Key
            </button>
            <button
              onClick={handleDownload}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-indigo-200 text-indigo-700 text-sm font-medium rounded-md hover:bg-indigo-50 hover:border-indigo-300 transition-colors shadow-sm"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Download Key
            </button>
            <button
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 border border-transparent text-white text-sm font-medium rounded-md hover:bg-indigo-700 transition-colors shadow-sm"
            >
              {copied ? (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Copied!
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                  </svg>
                  Copy to Clipboard
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Full Key Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-gray-50">
              <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                <svg className="w-5 h-5 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                </svg>
                MoEYS Public Key Details
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-200 rounded-full transition-colors"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
                <div className="bg-gray-50 p-3 rounded-lg border border-gray-100">
                  <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Algorithm</p>
                  <p className="text-sm font-semibold text-gray-900">ES256 (ECDSA P-256)</p>
                </div>
                <div className="bg-gray-50 p-3 rounded-lg border border-gray-100">
                  <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Key ID (kid)</p>
                  <p className="text-sm font-semibold text-gray-900">key-1</p>
                </div>
                <div className="bg-gray-50 p-3 rounded-lg border border-gray-100">
                  <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Created</p>
                  <p className="text-sm font-semibold text-gray-900">Dec 1, 2023</p>
                </div>
                <div className="bg-gray-50 p-3 rounded-lg border border-gray-100">
                  <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Expires</p>
                  <p className="text-sm font-semibold text-gray-900">Never (Root Authority)</p>
                </div>
              </div>
              
              <div className="mb-2 flex justify-between items-end">
                <h4 className="text-sm font-semibold text-gray-900">Raw PEM Format</h4>
                <button 
                  onClick={handleCopy}
                  className="text-xs text-indigo-600 hover:text-indigo-800 font-medium flex items-center gap-1"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                  </svg>
                  Copy
                </button>
              </div>
              <div className="bg-gray-900 rounded-lg p-4 overflow-x-auto">
                <pre className="text-emerald-400 text-xs font-mono whitespace-pre">
                  {HARDCODED_PUBLIC_KEY}
                </pre>
              </div>
              
              <div className="mt-6 bg-blue-50 border border-blue-100 rounded-lg p-4 text-sm text-blue-800">
                <h4 className="font-semibold text-blue-900 mb-1 flex items-center gap-1.5">
                  <svg className="w-4 h-4 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Verification Instructions
                </h4>
                <p className="mb-2">
                  To verify a MoEYS signature programmatically, fetch the DID Document from the verification URL and match the <code className="bg-blue-100 px-1 rounded">kid</code> parameter in the credential signature headers.
                </p>
                <code className="block bg-blue-900 text-blue-100 p-2 rounded text-xs overflow-x-auto">
                  curl https://moeys.gov.kh/.well-known/did.json
                </code>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
