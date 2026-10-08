import { useState } from 'react'
import { AlertTriangle, ShieldCheck, Mail, ArrowRight, ArrowLeft } from 'lucide-react'

interface ShareChecklistProps {
  claims: Record<string, any>
  institutionName: string
  issuerDid: string
  issuerEmail?: string
  onProceed: () => void
  onCancel: () => void
}

export default function ShareChecklist({
  claims,
  institutionName,
  issuerDid,
  issuerEmail,
  onProceed,
  onCancel
}: ShareChecklistProps) {
  // Checkbox states
  const [checkedName, setCheckedName] = useState(false)
  const [checkedEmail, setCheckedEmail] = useState(false)
  const [checkedStudentId, setCheckedStudentId] = useState(false)
  const [checkedDegreeType, setCheckedDegreeType] = useState(false)
  const [checkedMajor, setCheckedMajor] = useState(false)
  const [checkedGraduationDate, setCheckedGraduationDate] = useState(false)
  const [checkedCertificateId, setCheckedCertificateId] = useState(false)
  const [checkedIssuer, setCheckedIssuer] = useState(false)

  // Check if a field has actual data
  const has = (value: any): boolean => value !== undefined && value !== null && value !== '' && value !== '—'

  // Check if all boxes are checked
  const allChecked =
    checkedIssuer &&
    (has(claims.name) ? checkedName : true) &&
    (has(claims.email || claims.sub) ? checkedEmail : true) &&
    (has(claims.student_id || claims.studentId) ? checkedStudentId : true) &&
    (has(claims.degree_type || claims.degree) ? checkedDegreeType : true) &&
    (has(claims.major) ? checkedMajor : true) &&
    (has(claims.graduation_date || claims.year) ? checkedGraduationDate : true) &&
    (has(claims.certificate_id || claims.certificateId) ? checkedCertificateId : true)

  // Format Date to "23 November 2023" style
  const formatDate = (dateStr: string) => {
    if (!dateStr) return '—'
    try {
      const d = new Date(dateStr)
      if (isNaN(d.getTime())) return dateStr
      const day = d.getDate()
      const month = d.toLocaleDateString('en-US', { month: 'long' })
      const year = d.getFullYear()
      return `${day} ${month} ${year}`
    } catch {
      return dateStr
    }
  }

  // Derive contact email
  const contactEmail = issuerEmail 
    || (issuerDid?.startsWith('did:web:') 
        ? `support@${issuerDid.substring(8)}` 
        : null)

  return (
    <div className="bg-white rounded-2xl border border-stone-200 p-6 md:p-8 shadow-sm text-left max-w-xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <div className="bg-indigo-100 text-indigo-600 p-2.5 rounded-xl">
          <ShieldCheck size={24} />
        </div>
        <div>
          <h2 className="text-xl md:text-2xl font-bold text-stone-900 tracking-tight">
            Share Verification Checklist
          </h2>
          <p className="text-sm text-stone-500 mt-0.5">
            Verify your credential before sharing
          </p>
        </div>
      </div>

      <p className="text-sm text-stone-600 leading-relaxed mb-2">
        Before you share this certificate with an employer, please verify all information is correct:
      </p>
      <p className="text-xs text-stone-500 leading-relaxed mb-6">
        Please confirm all information is correct before sharing. 
        You must verify the issuer details to proceed.
      </p>

      {/* STUDENT INFORMATION */}
      <div className="space-y-4 mb-6">
        <h3 className="text-xs font-bold text-stone-400 uppercase tracking-widest border-b border-stone-100 pb-1">
          Student Information
        </h3>
        
        <div className="space-y-3">
          {has(claims.name) && (
            <label className="flex items-start gap-3 cursor-pointer select-none group">
              <input
                type="checkbox"
                checked={checkedName}
                onChange={(e) => setCheckedName(e.target.checked)}
                className="mt-1 w-4 h-4 text-indigo-600 border-stone-300 rounded focus:ring-indigo-500 cursor-pointer"
              />
              <span className="text-sm text-stone-700 leading-tight">
                Name is correct: <strong className="text-stone-900">{claims.name}</strong>
              </span>
            </label>
          )}

          {has(claims.email || claims.sub) && (
            <label className="flex items-start gap-3 cursor-pointer select-none group">
              <input
                type="checkbox"
                checked={checkedEmail}
                onChange={(e) => setCheckedEmail(e.target.checked)}
                className="mt-1 w-4 h-4 text-indigo-600 border-stone-300 rounded focus:ring-indigo-500 cursor-pointer"
              />
              <span className="text-sm text-stone-700 leading-tight">
                Email is correct: <strong className="text-stone-900">{claims.email || claims.sub}</strong>
              </span>
            </label>
          )}

          {has(claims.student_id || claims.studentId) && (
            <label className="flex items-start gap-3 cursor-pointer select-none group">
              <input
                type="checkbox"
                checked={checkedStudentId}
                onChange={(e) => setCheckedStudentId(e.target.checked)}
                className="mt-1 w-4 h-4 text-indigo-600 border-stone-300 rounded focus:ring-indigo-500 cursor-pointer"
              />
              <span className="text-sm text-stone-700 leading-tight">
                Student ID is correct: <strong className="text-stone-900 font-mono">{claims.student_id || claims.studentId}</strong>
              </span>
            </label>
          )}
        </div>
      </div>

      {/* CREDENTIAL INFORMATION */}
      <div className="space-y-4 mb-6">
        <h3 className="text-xs font-bold text-stone-400 uppercase tracking-widest border-b border-stone-100 pb-1">
          Credential Information
        </h3>

        <div className="space-y-3">
          {has(claims.degree_type || claims.degree) && (
            <label className="flex items-start gap-3 cursor-pointer select-none group">
              <input
                type="checkbox"
                checked={checkedDegreeType}
                onChange={(e) => setCheckedDegreeType(e.target.checked)}
                className="mt-1 w-4 h-4 text-indigo-600 border-stone-300 rounded focus:ring-indigo-500 cursor-pointer"
              />
              <span className="text-sm text-stone-700 leading-tight">
                Degree type is correct: <strong className="text-stone-900">{claims.degree_type || claims.degree}</strong>
              </span>
            </label>
          )}

          {has(claims.major) && (
            <label className="flex items-start gap-3 cursor-pointer select-none group">
              <input
                type="checkbox"
                checked={checkedMajor}
                onChange={(e) => setCheckedMajor(e.target.checked)}
                className="mt-1 w-4 h-4 text-indigo-600 border-stone-300 rounded focus:ring-indigo-500 cursor-pointer"
              />
              <span className="text-sm text-stone-700 leading-tight">
                Major is correct: <strong className="text-stone-900">{claims.major}</strong>
              </span>
            </label>
          )}

          {has(claims.graduation_date || claims.year) && (
            <label className="flex items-start gap-3 cursor-pointer select-none group">
              <input
                type="checkbox"
                checked={checkedGraduationDate}
                onChange={(e) => setCheckedGraduationDate(e.target.checked)}
                className="mt-1 w-4 h-4 text-indigo-600 border-stone-300 rounded focus:ring-indigo-500 cursor-pointer"
              />
              <span className="text-sm text-stone-700 leading-tight">
                Graduation date is correct: <strong className="text-stone-900">{formatDate(claims.graduation_date || claims.year)}</strong>
              </span>
            </label>
          )}

          {has(claims.certificate_id || claims.certificateId) && (
            <label className="flex items-start gap-3 cursor-pointer select-none group">
              <input
                type="checkbox"
                checked={checkedCertificateId}
                onChange={(e) => setCheckedCertificateId(e.target.checked)}
                className="mt-1 w-4 h-4 text-indigo-600 border-stone-300 rounded focus:ring-indigo-500 cursor-pointer"
              />
              <span className="text-sm text-stone-700 leading-tight">
                Certificate ID is correct: <strong className="text-stone-900 font-mono">{claims.certificate_id || claims.certificateId}</strong>
              </span>
            </label>
          )}
        </div>
      </div>

      {/* ISSUER VERIFICATION */}
      <div className="space-y-4 mb-6">
        <h3 className="text-xs font-bold text-stone-400 uppercase tracking-widest border-b border-stone-100 pb-1">
          Issuer Verification
        </h3>

        <div className="space-y-3">
          <label className="flex items-start gap-3 cursor-pointer select-none group">
            <input
              type="checkbox"
              checked={checkedIssuer}
              onChange={(e) => setCheckedIssuer(e.target.checked)}
              className="mt-1 w-4 h-4 text-indigo-600 border-stone-300 rounded focus:ring-indigo-500 cursor-pointer"
            />
            <span className="text-sm text-stone-700 leading-tight">
              Issuer is: <strong className="text-stone-900">{institutionName || claims.institution || '—'}</strong>
            </span>
          </label>

        </div>
      </div>

      {/* Warning Box */}
      <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 mb-6 flex items-start gap-3">
        <AlertTriangle className="text-rose-500 shrink-0 mt-0.5" size={18} />
        <div className="space-y-2">
          <p className="text-xs text-rose-800 leading-relaxed font-semibold">
            STOP: If any information is incorrect, do NOT share. Contact your issuer to update your credential.
          </p>
          <div className="flex items-center gap-1 text-[11px] text-stone-500 font-medium">
            <Mail size={12} className="text-stone-400" />
            <span>Issuer contact email: </span>
            <a href={contactEmail ? `mailto:${contactEmail}` : '#'} className="text-indigo-600 hover:underline font-semibold font-mono">
              {contactEmail || 'Contact your institution directly'}
            </a>
          </div>
        </div>
      </div>

      {/* Buttons */}
      <div className="flex flex-col sm:flex-row gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 border border-stone-300 bg-white hover:bg-stone-50 active:bg-stone-100 text-stone-700 font-semibold h-11 rounded-xl text-sm transition-all focus:outline-none flex items-center justify-center gap-1.5 cursor-pointer"
        >
          <ArrowLeft size={16} />
          <span>Cancel</span>
        </button>

        <button
          type="button"
          disabled={true}
          title="This feature will be available in a future update"
          className="flex-1 border border-stone-200 bg-stone-50 text-stone-400 font-semibold h-11 rounded-xl text-sm cursor-not-allowed flex items-center justify-center"
        >
          <span>Edit Credential</span>
        </button>

        <button
          type="button"
          onClick={onProceed}
          disabled={!allChecked}
          className="flex-1 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 disabled:bg-stone-200 disabled:text-stone-400 text-white font-semibold h-11 rounded-xl text-sm transition-all focus:outline-none flex items-center justify-center gap-1.5 cursor-pointer disabled:cursor-not-allowed"
        >
          <span>Proceed to Share</span>
          <ArrowRight size={16} />
        </button>
      </div>
    </div>
  )
}
