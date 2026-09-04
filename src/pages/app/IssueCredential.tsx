import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { issueSdJwt } from '../../lib/sdjwt'
import { useLanguage, formatDegreeTitle } from '../../lib/i18n'
import IssuerKeyUnlock from '../../components/IssuerKeyUnlock'
import CredentialCard from '../../components/CredentialCard'
import Banner from '../../components/ui/Banner'
import {
  AlertTriangle, CheckCircle2, GraduationCap, UserCheck, Star,
  HeartHandshake, Briefcase, Loader2, Check, ArrowLeft, FileText, Upload,
  Landmark, ShieldCheck,
} from 'lucide-react'

interface IssuerInfo {
  name: string
  domain: string
  did: string
  accredited: boolean
  rawIssuerData: any
}

export default function IssueCredential() {
  const { t } = useLanguage()
  const navigate = useNavigate()
  const [currentUser, setCurrentUser] = useState<any | null>(null)
  
  // Checking & Loading States
  const [checking, setChecking] = useState(true)
  const [issuerInfo, setIssuerInfo] = useState<IssuerInfo | null>(null)
  const [privateKey, setPrivateKey] = useState<any | null>(null)
  const [gateState, setGateState] = useState<'valid' | 'not_registered' | 'pending_approval'>('valid')
  const [gateError, setGateError] = useState<string | null>(null)

  // Form Fields
  const [studentEmail, setStudentEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [degreeTitle, setDegreeTitle] = useState('')
  const [studentId, setStudentId] = useState('')
  const [major, setMajor] = useState('')
  const [graduationDate, setGraduationDate] = useState('')
  const [certificateId, setCertificateId] = useState('')
  const [notes, setNotes] = useState('')

  // New Certificate Types State
  const [selectedType, setSelectedType] = useState<string | null>(null)
  
  const [subType, setSubType] = useState('')
  const [eventName, setEventName] = useState('')
  const [eventDate, setEventDate] = useState('')
  const [organizer, setOrganizer] = useState('')
  const [roleDescription, setRoleDescription] = useState('')

  const [programName, setProgramName] = useState('')
  const [duration, setDuration] = useState('')
  const [completionDate, setCompletionDate] = useState('')
  const [departmentOrRole, setDepartmentOrRole] = useState('')

  const [achievementTitle, setAchievementTitle] = useState('')
  const [basisDescription, setBasisDescription] = useState('')
  const [dateAwarded, setDateAwarded] = useState('')

  const [reason, setReason] = useState('')
  const [capacity, setCapacity] = useState('')
  const [appreciationDate, setAppreciationDate] = useState('')

  const [certName, setCertName] = useState('')
  const [issuingBody, setIssuingBody] = useState('')
  const [licenseNumber, setLicenseNumber] = useState('')
  const [dateCertified, setDateCertified] = useState('')
  const [expiryDate, setExpiryDate] = useState('')

  // Certificate document upload (PDF or image)
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null)
  const [photoFileName, setPhotoFileName] = useState<string>('')
  const [photoError, setPhotoError] = useState<string>('')

  // Student Email Verification State
  const [checkingStudent, setCheckingStudent] = useState(false)
  const [studentFoundStatus, setStudentFoundStatus] = useState<'found' | 'not_found' | 'error' | null>(null)
  const [studentUserId, setStudentUserId] = useState<string | null>(null)

  // Form Validation & Errors
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [issueSuccess, setIssueSuccess] = useState<boolean>(false)
  const [showConfirm, setShowConfirm] = useState<boolean>(false)

  // Draft autosave — client-side only (localStorage), no new Supabase table.
  // Solves "I navigated to another page and lost everything I typed": the
  // in-progress form is saved locally as you type and offered back the next
  // time this page loads, plus an explicit "Save as draft" action on the
  // review screen. The certificate file/photo is deliberately excluded from
  // the saved draft — a data: URL can be several MB and risks blowing
  // localStorage's ~5-10MB quota; the draft banner says so, and the field
  // just needs re-attaching after a resume.
  const [draftPrompt, setDraftPrompt] = useState<{ savedAt: string; data: Record<string, any> } | null>(null)
  const [draftDismissed, setDraftDismissed] = useState(false)

  const draftKey = currentUser ? `actik_issue_draft_${currentUser.id}` : null

  const collectDraftFields = () => ({
    studentEmail, fullName, selectedType, degreeTitle, studentId, major, graduationDate, certificateId, notes,
    subType, eventName, eventDate, organizer, roleDescription,
    programName, duration, completionDate, departmentOrRole,
    achievementTitle, basisDescription, dateAwarded,
    reason, capacity, appreciationDate,
    certName, issuingBody, licenseNumber, dateCertified, expiryDate,
  })

  // Anything worth saving/warning about — an empty form isn't a "draft".
  const hasMeaningfulDraftData = () => {
    const f = collectDraftFields()
    return !!f.selectedType && (!!f.studentEmail.trim() || !!f.fullName.trim() ||
      Object.entries(f).some(([k, v]) => k !== 'selectedType' && k !== 'studentEmail' && k !== 'fullName' && typeof v === 'string' && v.trim() !== ''))
  }

  const saveDraft = () => {
    if (!draftKey) return
    try {
      localStorage.setItem(draftKey, JSON.stringify({ savedAt: new Date().toISOString(), data: collectDraftFields() }))
    } catch (err) {
      console.error('[saveDraft] failed to persist draft:', err)
    }
  }

  const clearDraft = () => {
    if (draftKey) localStorage.removeItem(draftKey)
  }

  const applyDraft = (data: Record<string, any>) => {
    setStudentEmail(data.studentEmail || '')
    setFullName(data.fullName || '')
    setSelectedType(data.selectedType || null)
    setDegreeTitle(data.degreeTitle || '')
    setStudentId(data.studentId || '')
    setMajor(data.major || '')
    setGraduationDate(data.graduationDate || '')
    setCertificateId(data.certificateId || '')
    setNotes(data.notes || '')
    setSubType(data.subType || '')
    setEventName(data.eventName || '')
    setEventDate(data.eventDate || '')
    setOrganizer(data.organizer || '')
    setRoleDescription(data.roleDescription || '')
    setProgramName(data.programName || '')
    setDuration(data.duration || '')
    setCompletionDate(data.completionDate || '')
    setDepartmentOrRole(data.departmentOrRole || '')
    setAchievementTitle(data.achievementTitle || '')
    setBasisDescription(data.basisDescription || '')
    setDateAwarded(data.dateAwarded || '')
    setReason(data.reason || '')
    setCapacity(data.capacity || '')
    setAppreciationDate(data.appreciationDate || '')
    setCertName(data.certName || '')
    setIssuingBody(data.issuingBody || '')
    setLicenseNumber(data.licenseNumber || '')
    setDateCertified(data.dateCertified || '')
    setExpiryDate(data.expiryDate || '')
    if (data.studentEmail) lookupStudent(String(data.studentEmail).trim().toLowerCase())
  }

  // Offer a saved draft back once we know who the user is (once, per mount).
  useEffect(() => {
    if (!draftKey || draftDismissed) return
    try {
      const raw = localStorage.getItem(draftKey)
      if (!raw) return
      const parsed = JSON.parse(raw)
      if (parsed?.data) setDraftPrompt(parsed)
    } catch {
      // Corrupt/old-shape draft — ignore rather than crash the page over it.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey])

  // Autosave while there's real in-progress work, debounced so every
  // keystroke doesn't hit localStorage. Stops once issued (nothing left to
  // protect) or once a draft-restore prompt is still waiting on an answer
  // (don't overwrite the saved draft with the pre-restore empty form).
  useEffect(() => {
    if (!draftKey || issueSuccess || draftPrompt) return
    if (!hasMeaningfulDraftData()) return
    const timer = setTimeout(saveDraft, 800)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    draftKey, issueSuccess, draftPrompt, studentEmail, fullName, selectedType, degreeTitle, studentId, major,
    graduationDate, certificateId, notes, subType, eventName, eventDate, organizer, roleDescription, programName,
    duration, completionDate, departmentOrRole, achievementTitle, basisDescription, dateAwarded, reason, capacity,
    appreciationDate, certName, issuingBody, licenseNumber, dateCertified, expiryDate,
  ])

  // Catches an actual tab close/refresh/URL-bar navigation — separate from
  // the localStorage autosave above, which only covers in-app route changes.
  // (React Router's navigation-blocker API needs a data router; this app
  // uses plain <BrowserRouter>, so it isn't available without a much larger
  // routing change — this covers the real-unload case that always works.)
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (hasMeaningfulDraftData() && !issueSuccess) {
        e.preventDefault()
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  })

  // Mount logic: Run all checks
  useEffect(() => {
    let active = true

    async function runGateChecks() {
      try {
        // Fetch session
        const { data: { session } } = await supabase.auth.getSession()
        if (!session || !session.user) {
          navigate('/auth/login', { replace: true })
          return
        }
        
        if (active) {
          setCurrentUser(session.user)
        }

        // Check 1: Is user registered as an issuer?
        // Query using correct owner column
        let { data: issuerData, error: issuerError } = await supabase
          .from('issuers')
          .select('*')
          .eq('owner', session.user.id)
          .maybeSingle()

        if (issuerError && (issuerError.message.includes('owner') || issuerError.code === 'PGRST204')) {
          const fallback = await supabase
            .from('issuers')
            .select('*')
            .eq('owner', session.user.id)
            .maybeSingle()
          issuerData = fallback.data
          issuerError = fallback.error
        }

        if (!active) return

        if (!issuerData) {
          setGateState('not_registered')
          setChecking(false)
          return
        }

        if (issuerData.accredited === false) {
          setGateState('pending_approval')
          setChecking(false)
          return
        }

        // Check 2: Is the private key available in sessionStorage? If not,
        // IssuerKeyUnlock (rendered below) recovers it from the encrypted
        // vault instead of forcing a sign-out.
        const privateKeyJson = sessionStorage.getItem('issuer_private_key')
        const sessionDid = sessionStorage.getItem('issuer_did')

        setPrivateKey(privateKeyJson ? JSON.parse(privateKeyJson) : null)
        setIssuerInfo({
          name: issuerData.name,
          domain: issuerData.domain || '',
          did: issuerData.did || sessionDid || '',
          accredited: issuerData.accredited,
          rawIssuerData: issuerData
        })
        setGateState('valid')
        setChecking(false)
      } catch (err) {
        if (active) {
          setGateError('Something went wrong loading your account. Please try again.')
          setChecking(false)
        }
      }
    }

    runGateChecks()
    return () => { active = false }
  }, [navigate])

  // Look up a student profile by email — shared by the blur handler below and
  // by draft-restore (re-verifying a restored email rather than trusting a
  // stale cached "found" result from before the tab was left).
  const lookupStudent = async (emailVal: string) => {
    if (!emailVal || !emailVal.includes('@')) return

    setCheckingStudent(true)
    setStudentFoundStatus(null)
    setStudentUserId(null)

    try {
      // Uses a security-definer RPC instead of a direct `profiles` select so the
      // answer doesn't depend on RLS visibility of the caller's own role — a
      // misconfigured/missing issuer role used to make this silently look like
      // "student not found" instead of surfacing the real problem.
      const { data, error } = await supabase.rpc('check_recipient_by_email', { p_email: emailVal })

      if (error) {
        console.error('[lookupStudent] check_recipient_by_email failed:', error)
        setStudentFoundStatus('error')
      } else if (data && data.length > 0) {
        setStudentUserId(data[0].student_id)
        setStudentFoundStatus('found')
      } else {
        setStudentFoundStatus('not_found')
      }
    } catch (err) {
      console.error('[lookupStudent] unexpected error:', err)
      setStudentFoundStatus('error')
    } finally {
      setCheckingStudent(false)
    }
  }

  // Look up student profile on email input blur
  const handleEmailBlur = () => lookupStudent(studentEmail.trim().toLowerCase())

  const validateForm = () => {
    const nextErrors: Record<string, string> = {}
    
    if (!studentEmail.trim() || !studentEmail.includes('@')) {
      nextErrors.studentEmail = 'A valid student email is required.'
    } else if (studentFoundStatus === 'error') {
      nextErrors.studentEmail = 'Could not verify this email — retry before issuing.'
    }
    if (fullName.trim().length < 2) {
      nextErrors.fullName = 'Student name must be at least 2 characters.'
    }
    if (selectedType === 'academic_degree') {
      if (!degreeTitle) nextErrors.degreeTitle = 'Please select a degree type.'
      if (!studentId.trim()) nextErrors.studentId = 'Student ID is required.'
      if (!major.trim()) nextErrors.major = 'Major is required.'
      if (!graduationDate) nextErrors.graduationDate = 'Graduation date is required.'
      if (!certificateId.trim()) nextErrors.certificateId = 'Certificate ID is required.'
      if (!photoDataUrl) nextErrors.photo = 'Certificate file/photo is required.'
    } else if (selectedType === 'attendance_participation') {
      if (!subType) nextErrors.subType = 'Type is required'
      if (!eventName.trim()) nextErrors.eventName = 'Event name is required'
      if (!eventDate) nextErrors.eventDate = 'Event date is required'
      if (!organizer.trim()) nextErrors.organizer = 'Organizer is required'
    } else if (selectedType === 'completion') {
      if (!subType) nextErrors.subType = 'Type is required'
      if (!programName.trim()) nextErrors.programName = 'Program name is required'
      if (!completionDate) nextErrors.completionDate = 'Completion date is required'
    } else if (selectedType === 'merit_excellence') {
      if (!subType) nextErrors.subType = 'Type is required'
      if (!achievementTitle.trim()) nextErrors.achievementTitle = 'Achievement title is required'
      if (!basisDescription.trim()) nextErrors.basisDescription = 'Description is required'
      if (!dateAwarded) nextErrors.dateAwarded = 'Date awarded is required'
    } else if (selectedType === 'appreciation_service') {
      if (!reason.trim()) nextErrors.reason = 'Reason is required'
      if (!appreciationDate) nextErrors.appreciationDate = 'Date is required'
    } else if (selectedType === 'professional_certification') {
      if (!certName.trim()) nextErrors.certName = 'Certification name is required'
      if (!issuingBody.trim()) nextErrors.issuingBody = 'Issuing body is required'
      if (!dateCertified) nextErrors.dateCertified = 'Date certified is required'
    }

    setErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  // Form submit only validates and shows the review screen — issuing the
  // (irreversible, cryptographically signed) credential happens from there.
  const handleReviewSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!issuerInfo || !privateKey) return
    if (!validateForm()) return
    if (checkingStudent) return // wait for lookup to finish
    setShowConfirm(true)
  }

  const handleIssue = async () => {
    if (!issuerInfo || !privateKey) return
    if (!validateForm()) return
    if (checkingStudent) return // wait for lookup to finish

    try {
      setIsSubmitting(true)
      setSubmitError(null)

      let typeMetadata: any = null
      
      const claims: Record<string, any> = {
        sub: studentUserId ?? studentEmail.trim().toLowerCase(),
        name: fullName.trim(),
        institution: issuerInfo.name,
        iss: issuerInfo.did,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60 * 5)
      }

      if (photoDataUrl) claims.photo = photoDataUrl

      if (selectedType === 'academic_degree') {
        claims.degree_type = degreeTitle
        claims.student_id = studentId.trim()
        claims.major = major.trim()
        claims.graduation_date = graduationDate
        claims.certificate_id = certificateId.trim()
      } else if (selectedType === 'attendance_participation') {
        typeMetadata = {
          sub_type: subType,
          event_name: eventName.trim(),
          event_date: eventDate,
          organizer: organizer.trim()
        }
        if (roleDescription.trim()) typeMetadata.role_description = roleDescription.trim()
      } else if (selectedType === 'completion') {
        typeMetadata = {
          sub_type: subType,
          program_name: programName.trim(),
          completion_date: completionDate
        }
        if (duration.trim()) typeMetadata.duration = duration.trim()
        if (subType === 'Certificate of Internship Completion' && departmentOrRole.trim()) {
          typeMetadata.department_or_role = departmentOrRole.trim()
        }
      } else if (selectedType === 'merit_excellence') {
        typeMetadata = {
          sub_type: subType,
          achievement_title: achievementTitle.trim(),
          basis_description: basisDescription.trim(),
          date_awarded: dateAwarded
        }
      } else if (selectedType === 'appreciation_service') {
        typeMetadata = {
          sub_type: 'Certificate of Appreciation',
          reason: reason.trim(),
          date: appreciationDate
        }
        if (capacity.trim()) typeMetadata.capacity = capacity.trim()
      } else if (selectedType === 'professional_certification') {
        typeMetadata = {
          cert_name: certName.trim(),
          issuing_body: issuingBody.trim(),
          date_certified: dateCertified
        }
        if (licenseNumber.trim()) typeMetadata.license_number = licenseNumber.trim()
        if (expiryDate) typeMetadata.expiry_date = expiryDate
      }

      if (typeMetadata) {
        Object.assign(claims, typeMetadata)
      }

      // Step 2: Sign the SD-JWT
      const sdJwt = await issueSdJwt({
        issuerDid: issuerInfo.did,
        issuerPrivateJwk: privateKey,
        subject: claims,
        vct: `https://actik.kh/credentials/${selectedType}`,
        expiresInSec: 365 * 24 * 60 * 60 * 5
      })

      // Step 3: Save to Supabase. The `credentials` table on this project's
      // live schema doesn't have issuer_id/holder_id/holder_email/sd_jwt/
      // claimed columns (confirmed directly against the DB — only the older
      // schema.sql shape plus a handful of added columns exists there), so
      // an insert attempt against it always fails with 42703. Every issued
      // credential actually lives in `pending_credentials` until claimed,
      // at which point Notifications.tsx's executeClaim() migrates it into
      // `credentials` (owner/label/cipher/iv shape). Insert there directly
      // instead of carrying a first attempt that can never succeed.
      const credentialData: any = {
        recipient_email: studentEmail.trim().toLowerCase(),
        sdjwt: sdJwt,
        issuer_did: issuerInfo.did,
        institution_name: issuerInfo.name,
        credential_type: selectedType
      }
      if (selectedType === 'academic_degree') {
        credentialData.label = degreeTitle
        credentialData.degree_type = degreeTitle
        credentialData.student_id = studentId.trim()
        credentialData.major = major.trim()
        credentialData.graduation_date = graduationDate
        credentialData.certificate_id = certificateId.trim()
      } else {
        credentialData.type_metadata = typeMetadata
        credentialData.label = typeMetadata.sub_type || typeMetadata.cert_name || 'Certificate'
      }

      const res = await supabase.from('pending_credentials').insert(credentialData)

      if (res.error) {
        if (res.error.code === '23505' && res.error.message.includes('certificate_id')) {
          throw new Error('A certificate with this ID has already been issued by your institution.')
        }
        throw res.error
      }

      clearDraft()
      setIssueSuccess(true)
      setIsSubmitting(false)
    } catch (err: any) {
      setSubmitError(err.message || 'Issuance failed. Please check details and try again.')
      setIsSubmitting(false)
    }
  }

  const handleReset = () => {
    setStudentEmail('')
    setFullName('')
    setDegreeTitle('')
    setStudentId('')
    setMajor('')
    setGraduationDate('')
    setCertificateId('')
    setNotes('')
    setPhotoDataUrl(null)
    setPhotoFileName('')
    
    setSubType('')
    setEventName('')
    setEventDate('')
    setOrganizer('')
    setRoleDescription('')
    setProgramName('')
    setDuration('')
    setCompletionDate('')
    setDepartmentOrRole('')
    setAchievementTitle('')
    setBasisDescription('')
    setDateAwarded('')
    setReason('')
    setCapacity('')
    setAppreciationDate('')
    setCertName('')
    setIssuingBody('')
    setLicenseNumber('')
    setDateCertified('')
    setExpiryDate('')
    
    setSelectedType(null)
    setStudentFoundStatus(null)
    setStudentUserId(null)
    setErrors({})
    setSubmitError(null)
    setIssueSuccess(false)
    setShowConfirm(false)
  }

  // --- GATES RENDERING ---

  // Main Mount Loading
  if (checking) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh]">
        <Loader2 size={36} className="animate-spin text-indigo-600" />
        <p className="text-stone-500 mt-4 text-sm font-medium">{t('dashboard.checking_auth')}</p>
      </div>
    )
  }

  // Unexpected error loading the gate checks themselves
  if (gateError) {
    return (
      <div className="w-full md:max-w-xl mx-auto px-4 md:px-0 pb-24">
        <div className="bg-white rounded-xl shadow-sm border border-rose-300 border-l-4 p-6 md:p-8">
          <h2 className="text-xl md:text-2xl font-bold text-rose-700 mb-2">Something went wrong</h2>
          <p className="text-sm text-stone-500 mb-6 leading-relaxed">{gateError}</p>
          <button
            className="w-full bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-semibold h-[52px] rounded-lg text-sm transition-all focus:outline-none flex items-center justify-center cursor-pointer"
            onClick={() => window.location.reload()}
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  // Check 1 Fail: Not Registered
  if (gateState === 'not_registered') {
    return (
      <div className="w-full md:max-w-xl mx-auto px-4 md:px-0 pb-24">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 md:p-8 text-center">
          <div className="w-14 h-14 rounded-2xl bg-amber-50 flex items-center justify-center mx-auto mb-4">
            <AlertTriangle size={28} className="text-amber-500" />
          </div>
          <h2 className="text-xl md:text-2xl font-bold text-stone-900 mb-2">{t('dashboard.inst_not_registered')}</h2>
          <p className="text-sm text-stone-500 mb-6 leading-relaxed">
            {t('dashboard.inst_not_registered_desc')}
          </p>
          <button 
            className="w-full bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-semibold h-[52px] rounded-lg text-sm transition-all focus:outline-none flex items-center justify-center cursor-pointer" 
            onClick={() => navigate('/app/register-issuer')}
          >
            {t('dashboard.register_btn')}
          </button>
        </div>
      </div>
    )
  }

  // Check 1 Fail: Pending Approval — a full early-return gate (no form
  // access, no institution data fetched on this branch). Reskinned to the
  // same shared Banner used for this exact condition on IssuerDashboard.tsx,
  // but deliberately still a hard block, not a "queue while pending" form:
  // that would need fetching issuerInfo on this branch and would functionally
  // resemble the open-issuance model this project already rejected.
  if (gateState === 'pending_approval') {
    return (
      <div className="w-full md:max-w-xl mx-auto px-4 md:px-0 pb-24">
        <Banner tone="warning" title={t('dashboard.awaiting_approval')}>
          <p>{t('dashboard.awaiting_desc_issue')}</p>
          <p className="text-xs mt-2 italic opacity-80">{t('dashboard.awaiting_note_issue')}</p>
        </Banner>
        <button
          className="w-full mt-4 border border-stone-300 bg-white hover:bg-stone-50 active:bg-stone-100 text-stone-700 font-semibold h-[52px] rounded-[10px] text-sm transition-all focus:outline-none flex items-center justify-center cursor-pointer"
          onClick={() => navigate('/app/dashboard')}
        >
          {t('dashboard.back_to_dashboard')}
        </button>
      </div>
    )
  }

  // Check 2 Fail: signing key not loaded in this browser session — recover
  // it from the encrypted vault instead of forcing a sign-out.
  if (gateState === 'valid' && !privateKey && currentUser && issuerInfo) {
    return (
      <div className="w-full md:max-w-xl mx-auto px-4 md:px-0 pb-24">
        <IssuerKeyUnlock
          userId={currentUser.id}
          userEmail={currentUser.email}
          did={issuerInfo.did}
          onUnlocked={(jwk) => setPrivateKey(jwk)}
          onKeyRegenerated={(newJwk) =>
            setIssuerInfo(prev => prev && ({ ...prev, rawIssuerData: { ...prev.rawIssuerData, public_jwk: newJwk } }))
          }
        />
      </div>
    )
  }

  // The success screen's summary needs "the title" regardless of which of
  // the 6 credential types was issued — degreeTitle only holds a value for
  // academic_degree, so mirror the same per-type mapping the preview panel
  // below already uses, rather than showing a blank for the other 5 types.
  const successTitle =
    selectedType === 'academic_degree' ? formatDegreeTitle(degreeTitle)
    : selectedType === 'attendance_participation' ? eventName
    : selectedType === 'completion' ? programName
    : selectedType === 'merit_excellence' ? achievementTitle
    : selectedType === 'appreciation_service' ? reason
    : selectedType === 'professional_certification' ? certName
    : ''

  // Success Screen
  if (issueSuccess) {
    return (
      <div className="w-full md:max-w-xl mx-auto px-4 md:px-0 pb-24">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 md:p-8 text-center">
          <div className="w-14 h-14 rounded-2xl bg-emerald-50 flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 size={28} className="text-emerald-600" />
          </div>
          <h2 className="text-xl md:text-2xl font-bold text-stone-900 mb-2">{t('dashboard.credential_issued')}</h2>

          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-6 text-left text-sm space-y-3">
            <div>
              <span className="text-xs text-gray-400 block font-medium">{t('dashboard.student_email')}</span>
              <strong className="text-gray-900 text-base">{studentEmail}</strong>
            </div>
            <div>
              <span className="text-xs text-gray-400 block font-medium">{t('dashboard.degree_cert_label')}</span>
              <strong className="text-gray-900">{successTitle}</strong>
            </div>
            <div>
              <span className="text-xs text-gray-400 block font-medium">{t('dashboard.institution')}</span>
              <strong className="text-gray-900">{issuerInfo?.name}</strong>
            </div>
          </div>

          <div className="bg-emerald-50 border-l-4 border-emerald-500 p-4 rounded text-left text-xs text-emerald-800 leading-relaxed mb-6">
            {studentFoundStatus === 'found' ? (
              <span>{t('dashboard.issue_success_active')}</span>
            ) : (
              <span>{t('dashboard.issue_success_pending')}</span>
            )}
          </div>

          <div className="flex flex-col gap-3">
            <button 
              className="w-full bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-semibold h-[52px] rounded-lg text-sm transition-all focus:outline-none flex items-center justify-center cursor-pointer" 
              onClick={handleReset}
            >
              {t('dashboard.issue_another')}
            </button>
            <button
              className="w-full border border-gray-300 bg-white hover:bg-gray-50 active:bg-gray-100 text-gray-700 font-semibold h-[52px] rounded-lg text-sm transition-all focus:outline-none flex items-center justify-center cursor-pointer"
              onClick={() => navigate('/app/dashboard')}
            >
              {t('account.go_dashboard')}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Type-specific fields to show on the review screen, mirroring the form above.
  const reviewRows: { label: string; value: string }[] = []
  if (selectedType === 'academic_degree') {
    reviewRows.push(
      { label: t('dashboard.degree_type_req'), value: formatDegreeTitle(degreeTitle) },
      { label: t('dashboard.major_req'), value: major },
      { label: t('dashboard.student_id_req'), value: studentId },
      { label: t('dashboard.grad_date_req'), value: graduationDate },
      { label: t('dashboard.cert_id_req'), value: certificateId }
    )
  } else if (selectedType === 'attendance_participation') {
    reviewRows.push(
      { label: t('dashboard.type_req'), value: subType },
      { label: t('dashboard.event_name_req'), value: eventName },
      { label: t('dashboard.event_date_req'), value: eventDate },
      { label: t('dashboard.organizer_req'), value: organizer }
    )
    if (roleDescription.trim()) reviewRows.push({ label: t('dashboard.role_desc_opt'), value: roleDescription })
  } else if (selectedType === 'completion') {
    reviewRows.push(
      { label: t('dashboard.type_req'), value: subType },
      { label: t('dashboard.program_name_req'), value: programName },
      { label: t('dashboard.completion_date_req'), value: completionDate }
    )
    if (duration.trim()) reviewRows.push({ label: t('dashboard.duration_opt'), value: duration })
    if (departmentOrRole.trim()) reviewRows.push({ label: t('dashboard.dept_role_opt'), value: departmentOrRole })
  } else if (selectedType === 'merit_excellence') {
    reviewRows.push(
      { label: t('dashboard.type_req'), value: subType },
      { label: t('dashboard.achievement_title_req'), value: achievementTitle },
      { label: t('dashboard.basis_desc_req'), value: basisDescription },
      { label: t('dashboard.date_awarded_req'), value: dateAwarded }
    )
  } else if (selectedType === 'appreciation_service') {
    reviewRows.push(
      { label: t('dashboard.reason_req'), value: reason },
      { label: t('dashboard.date_req'), value: appreciationDate }
    )
    if (capacity.trim()) reviewRows.push({ label: t('dashboard.capacity_opt'), value: capacity })
  } else if (selectedType === 'professional_certification') {
    reviewRows.push(
      { label: t('dashboard.cert_name_req'), value: certName },
      { label: t('dashboard.issuing_body_req'), value: issuingBody },
      { label: t('dashboard.date_certified_req'), value: dateCertified }
    )
    if (licenseNumber.trim()) reviewRows.push({ label: t('dashboard.license_num_opt'), value: licenseNumber })
    if (expiryDate) reviewRows.push({ label: t('dashboard.expiry_date_opt'), value: expiryDate })
  }

  // Step indicator — derived purely from selectedType/showConfirm, no new
  // state. "Done" steps use emerald (matching the established stepper
  // pattern in VaultSetup.tsx/ShareCredential.tsx), "current" uses indigo.
  const renderStepper = (current: 1 | 2 | 3) => (
    <div className="flex items-center justify-between mb-8 relative px-2 max-w-md mx-auto">
      <div className="absolute top-4 left-[10%] right-[10%] h-[2px] bg-stone-200 z-0" />
      {[
        { n: 1 as const, label: t('dashboard.step_type') },
        { n: 2 as const, label: t('dashboard.credential_details') },
        { n: 3 as const, label: t('dashboard.review_title') },
      ].map((s) => (
        <div key={s.n} className="flex flex-col items-center relative z-10">
          <div
            className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold border-2 transition-colors ${
              s.n < current
                ? 'bg-emerald-500 border-emerald-500 text-white'
                : s.n === current
                ? 'bg-indigo-600 border-indigo-600 text-white'
                : 'bg-white border-stone-300 text-stone-400'
            }`}
          >
            {s.n < current ? <Check size={14} /> : s.n}
          </div>
          <span className="font-khmer text-[10px] font-semibold mt-1.5 text-stone-500 text-center max-w-[80px] leading-tight">
            {s.label}
          </span>
        </div>
      ))}
    </div>
  )

  // Review Screen — shown after the form validates, before the credential is
  // actually signed and written. Issuing is irreversible (a signed SD-JWT), so
  // this gives the issuer one more look before committing.
  if (showConfirm) {
    return (
      <div className="w-full md:max-w-xl mx-auto px-4 md:px-0 pb-24">
        {renderStepper(3)}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 md:p-8">
          <h2 className="text-xl md:text-2xl font-bold text-stone-900 mb-1">{t('dashboard.review_title')}</h2>
          <p className="text-sm text-stone-500 mb-6 leading-relaxed">{t('dashboard.review_desc')}</p>

          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-4 text-left text-sm space-y-3">
            <div>
              <span className="text-xs text-gray-400 block font-medium">{t('dashboard.student_email')}</span>
              <strong className="text-gray-900 text-base break-all">{studentEmail}</strong>
              {studentFoundStatus === 'found' && (
                <p className="text-emerald-700 text-xs mt-1 font-semibold inline-flex items-center gap-1">
                  <CheckCircle2 size={13} />
                  {t('dashboard.student_found')}
                </p>
              )}
              {studentFoundStatus === 'not_found' && (
                <p className="text-amber-600 text-xs mt-1 font-semibold italic leading-normal">{t('dashboard.student_not_found_warning')}</p>
              )}
            </div>
            <div>
              <span className="text-xs text-gray-400 block font-medium">{t('dashboard.full_name_req')}</span>
              <strong className="text-gray-900">{fullName}</strong>
            </div>
            <div>
              <span className="text-xs text-gray-400 block font-medium">{t('dashboard.issuing_institution')}</span>
              <strong className="text-gray-900">{issuerInfo?.name}</strong>
            </div>
            {reviewRows.map((row, i) => (
              <div key={i}>
                <span className="text-xs text-gray-400 block font-medium">{row.label}</span>
                <strong className="text-gray-900 break-words">{row.value || '—'}</strong>
              </div>
            ))}
            {selectedType !== 'academic_degree' && notes.trim() && (
              <div>
                <span className="text-xs text-gray-400 block font-medium">{t('dashboard.additional_notes_opt')}</span>
                <strong className="text-gray-900 break-words whitespace-pre-wrap">{notes}</strong>
              </div>
            )}
            {photoDataUrl && (
              <div>
                <span className="text-xs text-gray-400 block font-medium">{t('dashboard.cert_doc_req')}</span>
                {photoDataUrl.startsWith('data:application/pdf') ? (
                  <strong className="text-gray-900">{photoFileName}</strong>
                ) : (
                  <img
                    src={photoDataUrl}
                    alt="Certificate preview"
                    className="max-h-40 max-w-full mt-1 rounded object-contain border border-gray-200"
                  />
                )}
              </div>
            )}
          </div>

          {submitError && (
            <div className="w-full bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-lg p-3 font-medium mb-4">
              {submitError}
            </div>
          )}

          <div className="flex flex-col gap-3">
            <button
              type="button"
              disabled={isSubmitting}
              onClick={handleIssue}
              className="w-full bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-semibold h-[52px] rounded-lg text-sm transition-all focus:outline-none flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
            >
              {isSubmitting && <Loader2 size={18} className="animate-spin" />}
              <span>{t('dashboard.confirm_issue_btn')}</span>
            </button>
            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => setShowConfirm(false)}
              className="w-full border border-gray-300 bg-white hover:bg-gray-50 active:bg-gray-100 text-gray-700 font-semibold h-[52px] rounded-lg text-sm transition-all focus:outline-none flex items-center justify-center cursor-pointer disabled:opacity-60"
            >
              {t('dashboard.back_to_edit')}
            </button>
            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => {
                saveDraft()
                navigate('/app/dashboard', { state: { toast: t('dashboard.draft_saved_toast') } })
              }}
              className="w-full text-stone-500 hover:text-stone-700 font-semibold h-11 rounded-lg text-sm transition-all focus:outline-none flex items-center justify-center cursor-pointer disabled:opacity-60"
            >
              {t('dashboard.save_as_draft_btn')}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Truncate DID helper
  const truncateDid = (didString: string) => {
    if (didString.length <= 30) return didString
    return didString.slice(0, 30) + '...'
  }

  // Form & Preview Screen
  return (
    <div className="w-full md:max-w-4xl mx-auto px-4 md:px-0 pb-24">
      {/* Back button */}
      <div className="mb-4">
        <button
          onClick={() => navigate('/app/dashboard')}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-indigo-600 transition-colors focus:outline-none cursor-pointer"
        >
          <ArrowLeft size={16} strokeWidth={2.2} />
          {t('dashboard.back_to_dashboard')}
        </button>
      </div>

      {/* Heading */}
      <div className="mb-4">
        <h2 className="text-xl md:text-2xl font-bold text-stone-900 tracking-tight">
          {t('dashboard.issue_credential_title')}
        </h2>
        <p className="text-sm text-stone-500 mt-1 leading-relaxed">
          {t('dashboard.issue_credential_desc_form')}
        </p>
      </div>

      {/* Unsaved-draft prompt — offered once per mount when a saved draft is
          found; resuming re-verifies the recipient email rather than
          trusting a stale cached lookup result. */}
      {draftPrompt && (
        <Banner tone="info" title={t('dashboard.draft_found_title')} className="mb-6">
          <p>
            {t('dashboard.draft_found_desc')} {new Date(draftPrompt.savedAt).toLocaleString()}
          </p>
          <div className="flex gap-3 mt-3">
            <button
              type="button"
              onClick={() => {
                applyDraft(draftPrompt.data)
                setDraftPrompt(null)
                setDraftDismissed(true)
              }}
              className="text-xs font-bold text-indigo-700 hover:text-indigo-800 cursor-pointer"
            >
              {t('dashboard.resume_draft_btn')}
            </button>
            <button
              type="button"
              onClick={() => {
                clearDraft()
                setDraftPrompt(null)
                setDraftDismissed(true)
              }}
              className="text-xs font-bold text-stone-500 hover:text-stone-700 cursor-pointer"
            >
              {t('dashboard.discard_draft_btn')}
            </button>
          </div>
        </Banner>
      )}
      {/* Info Bar */}
      {issuerInfo && (
        <div className="inline-flex flex-wrap items-center bg-indigo-50 border border-indigo-100 text-indigo-700 px-3 py-1.5 rounded-full text-xs font-semibold mb-6 gap-2 max-w-full overflow-hidden">
          <span>{t('dashboard.signing_as')}</span>
          <strong>{issuerInfo.name}</strong>
          <code className="font-mono bg-indigo-100/50 px-2 py-0.5 rounded text-[10px] break-all">
            {truncateDid(issuerInfo.did)}
          </code>
        </div>
      )}

      {renderStepper(selectedType ? 2 : 1)}

      {/* Main Panel grid (Form on left, Preview on right) */}
      {!selectedType ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[
            { id: 'academic_degree', icon: GraduationCap, title: t('dashboard.type_academic'), desc: t('dashboard.type_academic_desc') },
            { id: 'attendance_participation', icon: UserCheck, title: t('dashboard.type_attendance'), desc: t('dashboard.type_attendance_desc') },
            { id: 'completion', icon: CheckCircle2, title: t('dashboard.type_completion'), desc: t('dashboard.type_completion_desc') },
            { id: 'merit_excellence', icon: Star, title: t('dashboard.type_merit'), desc: t('dashboard.type_merit_desc') },
            { id: 'appreciation_service', icon: HeartHandshake, title: t('dashboard.type_appreciation'), desc: t('dashboard.type_appreciation_desc') },
            { id: 'professional_certification', icon: Briefcase, title: t('dashboard.type_professional'), desc: t('dashboard.type_professional_desc') }
          ].map(c => (
            <button
              key={c.id}
              onClick={() => setSelectedType(c.id)}
              className="p-5 bg-white border border-gray-200 rounded-xl hover:border-indigo-500 hover:shadow-sm text-left flex items-start gap-4 transition-all cursor-pointer"
            >
              <div className="shrink-0 w-11 h-11 rounded-xl bg-indigo-50 flex items-center justify-center">
                <c.icon size={22} className="text-indigo-600" />
              </div>
              <div>
                <h3 className="font-bold text-stone-900 text-[15px]">{c.title}</h3>
                <p className="text-xs text-stone-500 mt-1 leading-relaxed">{c.desc}</p>
              </div>
            </button>
          ))}
        </div>
      ) : (
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-6 items-start">

        {/* Form Card */}
        <div className="bg-transparent md:bg-white rounded-xl md:shadow-sm md:border md:border-gray-200 p-0 md:p-8">

          <button
            onClick={() => setSelectedType(null)}
            className="mb-6 inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition-colors focus:outline-none cursor-pointer bg-indigo-50 px-3 py-1.5 rounded-full"
          >
            <ArrowLeft size={14} strokeWidth={2.5} />
            {t('dashboard.change_cert_type')}
          </button>

          <form onSubmit={handleReviewSubmit} className="space-y-5">

            {/* Section A: Student Identity */}
            <h3 className="font-mono text-[9px] tracking-widest text-stone-400 uppercase mt-2 mb-4">
              {t('dashboard.student_section')}
            </h3>

            {/* Student Email */}
            <div>
              <label className="text-xs md:text-sm font-bold text-gray-700 block">{t('dashboard.student_email_req')} <span className="text-rose-500">*</span></label>
              <div className="relative mt-1">
                <input
                  type="email"
                  value={studentEmail}
                  onChange={(e) => setStudentEmail(e.target.value)}
                  onBlur={handleEmailBlur}
                  placeholder="student@example.com"
                  className={`block w-full rounded-lg border px-3 h-11 text-sm focus:outline-none focus:ring-1 bg-white text-stone-900 pr-10 ${
                    studentFoundStatus === 'found'
                      ? 'border-indigo-500 ring-1 ring-indigo-500'
                      : 'border-gray-300 focus:border-indigo-500 focus:ring-indigo-500'
                  }`}
                />
                {checkingStudent && (
                  <div className="absolute right-3 top-3">
                    <div className="animate-spin rounded-full h-5 w-5 border-2 border-gray-200 border-t-indigo-600" />
                  </div>
                )}
              </div>

              {/* Lookup notices */}
              {studentFoundStatus === 'found' && (
                <p className="text-emerald-700 text-xs mt-1 font-semibold inline-flex items-center gap-1">
                  <CheckCircle2 size={13} />
                  {t('dashboard.student_found')}
                </p>
              )}
              {studentFoundStatus === 'not_found' && (
                <p className="text-amber-600 text-xs mt-1 font-semibold italic leading-normal">
                  {t('dashboard.student_not_found_warning')}
                </p>
              )}
              {studentFoundStatus === 'error' && (
                <p className="text-rose-600 text-xs mt-1 font-semibold italic leading-normal">
                  {t('dashboard.student_check_error')}
                </p>
              )}
              {errors.studentEmail && (
                <p className="text-rose-600 text-xs mt-1 font-semibold">{errors.studentEmail}</p>
              )}
            </div>

            {/* Full Name */}
            <div>
              <label className="text-xs md:text-sm font-bold text-gray-700 block">{t('dashboard.full_name_req')} <span className="text-rose-500">*</span></label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Sokha Meng"
                className="mt-1 block w-full rounded-lg border border-gray-300 px-3 h-11 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white text-stone-900"
              />
              {errors.fullName && (
                <p className="text-rose-600 text-xs mt-1 font-semibold">{errors.fullName}</p>
              )}
            </div>

            <div className="border-t border-stone-200 my-6" />

            {/* Section B: Credential Details */}
            <h3 className="font-mono text-[9px] tracking-widest text-stone-400 uppercase mt-2 mb-4">
              {t('dashboard.credential_details')}
            </h3>

            {/* Issuing Institution (Common) */}
            <div>
              <label className="text-xs md:text-sm font-bold text-gray-700 block">{t('dashboard.issuing_institution')}</label>
              <input
                type="text"
                value={issuerInfo?.name || ''}
                readOnly
                className="mt-1 block w-full rounded-lg border border-gray-200 px-3 h-11 text-sm bg-gray-50 text-gray-500 cursor-not-allowed"
              />
            </div>

            {selectedType === 'academic_degree' && (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs md:text-sm font-bold text-gray-700 block">{t('dashboard.degree_type_req')} <span className="text-rose-500">*</span></label>
                    <select
                      value={degreeTitle}
                      onChange={(e) => setDegreeTitle(e.target.value)}
                      className="mt-1 block w-full rounded-lg border border-gray-300 px-3 h-11 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white text-stone-900"
                    >
                      <option value="">{t('dashboard.select_type')}</option>
                      <option value="Bachelor">{formatDegreeTitle('Bachelor')}</option>
                      <option value="Master">{formatDegreeTitle('Master')}</option>
                      <option value="Doctorate (PhD)">{formatDegreeTitle('Doctorate (PhD)')}</option>
                      <option value="Associate">{formatDegreeTitle('Associate')}</option>
                    </select>
                    {errors.degreeTitle && <p className="text-rose-600 text-xs mt-1 font-semibold">{errors.degreeTitle}</p>}
                  </div>
                  <div>
                    <label className="text-xs md:text-sm font-bold text-gray-700 block">{t('dashboard.major_req')} <span className="text-rose-500">*</span></label>
                    <input
                      type="text"
                      value={major}
                      onChange={(e) => setMajor(e.target.value)}
                      placeholder="e.g. Computer Science"
                      className="mt-1 block w-full rounded-lg border border-gray-300 px-3 h-11 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white text-stone-900"
                    />
                    {errors.major && <p className="text-rose-600 text-xs mt-1 font-semibold">{errors.major}</p>}
                  </div>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs md:text-sm font-bold text-gray-700 block">{t('dashboard.student_id_req')} <span className="text-rose-500">*</span></label>
                    <input
                      type="text"
                      value={studentId}
                      onChange={(e) => setStudentId(e.target.value)}
                      placeholder="e.g. STU-2024-001"
                      className="mt-1 block w-full rounded-lg border border-gray-300 px-3 h-11 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white text-stone-900"
                    />
                    {errors.studentId && <p className="text-rose-600 text-xs mt-1 font-semibold">{errors.studentId}</p>}
                  </div>
                  <div>
                    <label className="text-xs md:text-sm font-bold text-gray-700 block">{t('dashboard.grad_date_req')} <span className="text-rose-500">*</span></label>
                    <input
                      type="date"
                      value={graduationDate}
                      onChange={(e) => setGraduationDate(e.target.value)}
                      className="mt-1 block w-full rounded-lg border border-gray-300 px-3 h-11 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white text-stone-900"
                    />
                    {errors.graduationDate && <p className="text-rose-600 text-xs mt-1 font-semibold">{errors.graduationDate}</p>}
                  </div>
                </div>

                <div>
                  <label className="text-xs md:text-sm font-bold text-gray-700 block">{t('dashboard.cert_id_req')} <span className="text-rose-500">*</span></label>
                  <input
                    type="text"
                    value={certificateId}
                    onChange={(e) => setCertificateId(e.target.value)}
                    placeholder="e.g. CERT-2024-12345"
                    className="mt-1 block w-full rounded-lg border border-gray-300 px-3 h-11 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white text-stone-900"
                  />
                  {errors.certificateId && <p className="text-rose-600 text-xs mt-1 font-semibold">{errors.certificateId}</p>}
                </div>
              </>
            )}

            {selectedType === 'attendance_participation' && (
              <>
                <div>
                  <label className="text-xs md:text-sm font-bold text-gray-700 block">{t('dashboard.type_req')}</label>
                  <select value={subType} onChange={e => setSubType(e.target.value)} className="mt-1 block w-full rounded-lg border border-gray-300 px-3 h-11 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white text-stone-900">
                    <option value="">{t('dashboard.select_type')}</option>
                    <option value="Certificate of Attendance">Certificate of Attendance</option>
                    <option value="Certificate of Participation">Certificate of Participation</option>
                  </select>
                  {errors.subType && <p className="text-rose-600 text-xs mt-1 font-semibold">{errors.subType}</p>}
                </div>
                <div>
                  <label className="text-xs md:text-sm font-bold text-gray-700 block">{t('dashboard.event_name_req')}</label>
                  <input type="text" value={eventName} onChange={e => setEventName(e.target.value)} placeholder="Annual Tech Conference 2026" className="mt-1 block w-full rounded-lg border border-gray-300 px-3 h-11 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white text-stone-900" />
                  {errors.eventName && <p className="text-rose-600 text-xs mt-1 font-semibold">{errors.eventName}</p>}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs md:text-sm font-bold text-gray-700 block">{t('dashboard.event_date_req')}</label>
                    <input type="date" value={eventDate} onChange={e => setEventDate(e.target.value)} className="mt-1 block w-full rounded-lg border border-gray-300 px-3 h-11 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white text-stone-900" />
                    {errors.eventDate && <p className="text-rose-600 text-xs mt-1 font-semibold">{errors.eventDate}</p>}
                  </div>
                  <div>
                    <label className="text-xs md:text-sm font-bold text-gray-700 block">{t('dashboard.organizer_req')}</label>
                    <input type="text" value={organizer} onChange={e => setOrganizer(e.target.value)} placeholder="Ministry of Education" className="mt-1 block w-full rounded-lg border border-gray-300 px-3 h-11 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white text-stone-900" />
                    {errors.organizer && <p className="text-rose-600 text-xs mt-1 font-semibold">{errors.organizer}</p>}
                  </div>
                </div>
                <div>
                  <label className="text-xs md:text-sm font-bold text-gray-700 block">{t('dashboard.role_desc_opt')}</label>
                  <input type="text" value={roleDescription} onChange={e => setRoleDescription(e.target.value)} placeholder="Keynote Speaker" className="mt-1 block w-full rounded-lg border border-gray-300 px-3 h-11 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white text-stone-900" />
                </div>
              </>
            )}

            {selectedType === 'completion' && (
              <>
                <div>
                  <label className="text-xs md:text-sm font-bold text-gray-700 block">{t('dashboard.type_req')}</label>
                  <select value={subType} onChange={e => setSubType(e.target.value)} className="mt-1 block w-full rounded-lg border border-gray-300 px-3 h-11 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white text-stone-900">
                    <option value="">{t('dashboard.select_type')}</option>
                    <option value="Certificate of Completion">Certificate of Completion</option>
                    <option value="Certificate of Internship Completion">Certificate of Internship Completion</option>
                  </select>
                  {errors.subType && <p className="text-rose-600 text-xs mt-1 font-semibold">{errors.subType}</p>}
                </div>
                <div>
                  <label className="text-xs md:text-sm font-bold text-gray-700 block">{t('dashboard.program_name_req')}</label>
                  <input type="text" value={programName} onChange={e => setProgramName(e.target.value)} placeholder="Advanced React Bootcamp" className="mt-1 block w-full rounded-lg border border-gray-300 px-3 h-11 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white text-stone-900" />
                  {errors.programName && <p className="text-rose-600 text-xs mt-1 font-semibold">{errors.programName}</p>}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs md:text-sm font-bold text-gray-700 block">{t('dashboard.completion_date_req')}</label>
                    <input type="date" value={completionDate} onChange={e => setCompletionDate(e.target.value)} className="mt-1 block w-full rounded-lg border border-gray-300 px-3 h-11 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white text-stone-900" />
                    {errors.completionDate && <p className="text-rose-600 text-xs mt-1 font-semibold">{errors.completionDate}</p>}
                  </div>
                  <div>
                    <label className="text-xs md:text-sm font-bold text-gray-700 block">{t('dashboard.duration_opt')}</label>
                    <input type="text" value={duration} onChange={e => setDuration(e.target.value)} placeholder="12 Weeks" className="mt-1 block w-full rounded-lg border border-gray-300 px-3 h-11 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white text-stone-900" />
                  </div>
                </div>
                {subType === 'Certificate of Internship Completion' && (
                  <div>
                    <label className="text-xs md:text-sm font-bold text-gray-700 block">{t('dashboard.dept_role_opt')}</label>
                    <input type="text" value={departmentOrRole} onChange={e => setDepartmentOrRole(e.target.value)} placeholder="Frontend Engineering Intern" className="mt-1 block w-full rounded-lg border border-gray-300 px-3 h-11 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white text-stone-900" />
                  </div>
                )}
              </>
            )}

            {selectedType === 'merit_excellence' && (
              <>
                <div>
                  <label className="text-xs md:text-sm font-bold text-gray-700 block">{t('dashboard.type_req')}</label>
                  <select value={subType} onChange={e => setSubType(e.target.value)} className="mt-1 block w-full rounded-lg border border-gray-300 px-3 h-11 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white text-stone-900">
                    <option value="">{t('dashboard.select_type')}</option>
                    <option value="Certificate of Merit">Certificate of Merit</option>
                    <option value="Certificate of Excellence">Certificate of Excellence</option>
                  </select>
                  {errors.subType && <p className="text-rose-600 text-xs mt-1 font-semibold">{errors.subType}</p>}
                </div>
                <div>
                  <label className="text-xs md:text-sm font-bold text-gray-700 block">{t('dashboard.achievement_title_req')}</label>
                  <input type="text" value={achievementTitle} onChange={e => setAchievementTitle(e.target.value)} placeholder="Top Student of the Year" className="mt-1 block w-full rounded-lg border border-gray-300 px-3 h-11 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white text-stone-900" />
                  {errors.achievementTitle && <p className="text-rose-600 text-xs mt-1 font-semibold">{errors.achievementTitle}</p>}
                </div>
                <div>
                  <label className="text-xs md:text-sm font-bold text-gray-700 block">{t('dashboard.basis_desc_req')}</label>
                  <textarea value={basisDescription} onChange={e => setBasisDescription(e.target.value)} placeholder="Achieved the highest overall score in the graduating class." rows={2} className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white text-stone-900 resize-vertical min-h-[60px]" />
                  {errors.basisDescription && <p className="text-rose-600 text-xs mt-1 font-semibold">{errors.basisDescription}</p>}
                </div>
                <div>
                  <label className="text-xs md:text-sm font-bold text-gray-700 block">{t('dashboard.date_awarded_req')}</label>
                  <input type="date" value={dateAwarded} onChange={e => setDateAwarded(e.target.value)} className="mt-1 block w-full rounded-lg border border-gray-300 px-3 h-11 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white text-stone-900" />
                  {errors.dateAwarded && <p className="text-rose-600 text-xs mt-1 font-semibold">{errors.dateAwarded}</p>}
                </div>
              </>
            )}

            {selectedType === 'appreciation_service' && (
              <>
                <div>
                  <label className="text-xs md:text-sm font-bold text-gray-700 block">{t('dashboard.reason_req')}</label>
                  <input type="text" value={reason} onChange={e => setReason(e.target.value)} placeholder="Outstanding contribution to the community outreach program" className="mt-1 block w-full rounded-lg border border-gray-300 px-3 h-11 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white text-stone-900" />
                  {errors.reason && <p className="text-rose-600 text-xs mt-1 font-semibold">{errors.reason}</p>}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs md:text-sm font-bold text-gray-700 block">{t('dashboard.date_req')}</label>
                    <input type="date" value={appreciationDate} onChange={e => setAppreciationDate(e.target.value)} className="mt-1 block w-full rounded-lg border border-gray-300 px-3 h-11 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white text-stone-900" />
                    {errors.appreciationDate && <p className="text-rose-600 text-xs mt-1 font-semibold">{errors.appreciationDate}</p>}
                  </div>
                  <div>
                    <label className="text-xs md:text-sm font-bold text-gray-700 block">{t('dashboard.capacity_opt')}</label>
                    <input type="text" value={capacity} onChange={e => setCapacity(e.target.value)} placeholder="Lead Volunteer" className="mt-1 block w-full rounded-lg border border-gray-300 px-3 h-11 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white text-stone-900" />
                  </div>
                </div>
              </>
            )}

            {selectedType === 'professional_certification' && (
              <>
                <div>
                  <label className="text-xs md:text-sm font-bold text-gray-700 block">{t('dashboard.cert_name_req')}</label>
                  <input type="text" value={certName} onChange={e => setCertName(e.target.value)} placeholder="Certified Cloud Architect" className="mt-1 block w-full rounded-lg border border-gray-300 px-3 h-11 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white text-stone-900" />
                  {errors.certName && <p className="text-rose-600 text-xs mt-1 font-semibold">{errors.certName}</p>}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs md:text-sm font-bold text-gray-700 block">{t('dashboard.issuing_body_req')}</label>
                    <input type="text" value={issuingBody} onChange={e => setIssuingBody(e.target.value)} placeholder="Cloud Services Inc." className="mt-1 block w-full rounded-lg border border-gray-300 px-3 h-11 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white text-stone-900" />
                    {errors.issuingBody && <p className="text-rose-600 text-xs mt-1 font-semibold">{errors.issuingBody}</p>}
                  </div>
                  <div>
                    <label className="text-xs md:text-sm font-bold text-gray-700 block">{t('dashboard.license_num_opt')}</label>
                    <input type="text" value={licenseNumber} onChange={e => setLicenseNumber(e.target.value)} placeholder="CCA-12345" className="mt-1 block w-full rounded-lg border border-gray-300 px-3 h-11 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white text-stone-900" />
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs md:text-sm font-bold text-gray-700 block">{t('dashboard.date_certified_req')}</label>
                    <input type="date" value={dateCertified} onChange={e => setDateCertified(e.target.value)} className="mt-1 block w-full rounded-lg border border-gray-300 px-3 h-11 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white text-stone-900" />
                    {errors.dateCertified && <p className="text-rose-600 text-xs mt-1 font-semibold">{errors.dateCertified}</p>}
                  </div>
                  <div>
                    <label className="text-xs md:text-sm font-bold text-gray-700 block">{t('dashboard.expiry_date_opt')}</label>
                    <input type="date" value={expiryDate} onChange={e => setExpiryDate(e.target.value)} className="mt-1 block w-full rounded-lg border border-gray-300 px-3 h-11 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white text-stone-900" />
                  </div>
                </div>
              </>
            )}

            {/* Additional Notes - hidden for academic_degree per spec */}
            {selectedType !== 'academic_degree' && (
              <div>
                <label className="text-xs md:text-sm font-bold text-gray-700 block">{t('dashboard.additional_notes_opt')}</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  placeholder="Graduated with distinction. Major in Software Engineering."
                  className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white text-stone-900 resize-vertical min-h-[80px]"
                />
              </div>
            )}

            {/* Certificate Document Upload */}
            <div>
              <label className="text-xs md:text-sm font-bold text-gray-700 block">
                {t('dashboard.cert_doc_req')} {selectedType === 'academic_degree' ? <span className="text-rose-500">*</span> : <span className="font-normal text-gray-400">(optional)</span>}
              </label>
              <p className="text-[11px] text-gray-500 mt-0.5 mb-2">
                {t('dashboard.cert_doc_desc')}
              </p>

              {/* Drop zone / file picker */}
              <label
                htmlFor="cert-upload"
                className="flex flex-col items-center justify-center w-full border-2 border-dashed border-gray-300 rounded-lg p-5 cursor-pointer hover:border-indigo-400 hover:bg-indigo-50/30 transition-colors"
              >
                {photoDataUrl ? (
                  /* Preview after upload */
                  <div className="w-full space-y-2">
                    {photoDataUrl.startsWith('data:application/pdf') ? (
                      <div className="flex items-center gap-2 text-indigo-700 font-semibold text-sm">
                        <FileText size={20} className="text-rose-500 shrink-0" strokeWidth={1.9} />
                        {photoFileName}
                      </div>
                    ) : (
                      <img
                        src={photoDataUrl}
                        alt="Certificate preview"
                        className="max-h-48 max-w-full mx-auto rounded object-contain border border-gray-200"
                      />
                    )}
                    <p className="text-[11px] text-center text-indigo-500 font-medium">{t('dashboard.change_file')}</p>
                  </div>
                ) : (
                  /* Empty state */
                  <div className="flex flex-col items-center gap-2 text-gray-400">
                    <Upload size={28} strokeWidth={1.9} />
                    <span className="text-xs font-medium">{t('dashboard.select_file')}</span>
                    <span className="text-[11px]">{t('dashboard.pdf_image_limit')}</span>
                  </div>
                )}
                <input
                  id="cert-upload"
                  type="file"
                  accept="application/pdf,image/jpeg,image/png,image/webp,image/gif"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (!file) return
                    const MAX_MB = 5
                    if (file.size > MAX_MB * 1024 * 1024) {
                      setPhotoError(`File is too large. Maximum size is ${MAX_MB} MB.`)
                      return
                    }
                    setPhotoError('')
                    setPhotoFileName(file.name)
                    const reader = new FileReader()
                    reader.onload = (ev) => {
                      const result = ev.target?.result
                      if (typeof result === 'string') setPhotoDataUrl(result)
                    }
                    reader.readAsDataURL(file)
                    // Reset so same file can be re-selected
                    e.target.value = ''
                  }}
                />
              </label>

              {photoError && (
                <p className="text-rose-600 text-xs mt-1 font-semibold">{photoError}</p>
              )}
              {errors.photo && (
                <p className="text-rose-600 text-xs mt-1 font-semibold">{errors.photo}</p>
              )}
              {photoDataUrl && (
                <button
                  type="button"
                  onClick={() => { setPhotoDataUrl(null); setPhotoFileName('') }}
                  className="mt-1.5 text-xs text-gray-400 hover:text-rose-500 transition-colors"
                >
                  {t('dashboard.remove_document')}
                </button>
              )}
            </div>

            {/* Submit Error */}
            {submitError && (
              <div className="w-full bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-lg p-3 font-medium">
                {submitError}
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-semibold h-[52px] rounded-lg text-sm transition-all focus:outline-none flex items-center justify-center gap-2 cursor-pointer"
            >
              {isSubmitting && <Loader2 size={18} className="animate-spin" />}
              <span>{t('dashboard.issue_credential_btn')}</span>
            </button>

          </form>
        </div>

        {/* Live preview — same CredentialCard the student will actually see,
            fed with the form's current values, so the issuer can check the
            result before signing anything. */}
        {selectedType === 'academic_degree' ? (
          <div className="lg:sticky lg:top-6">
            <div className="font-mono text-[9.5px] tracking-widest text-stone-400 uppercase mb-2">
              {t('dashboard.live_preview')}
            </div>
            <CredentialCard
              degreeTitle={degreeTitle || t('dashboard.degree_preview_placeholder')}
              institutionName={issuerInfo?.name}
              issuerDid={issuerInfo?.did}
              graduationDate={graduationDate || null}
              createdAt={new Date().toISOString()}
              major={major || null}
            />
          </div>
        ) : (
          /* The other 5 credential types have no dedicated card component
             (CredentialCard's props — degreeTitle/major/graduationDate — are
             academic-degree-specific), so this hand-rolls a preview matching
             its exact visual recipe (indigo header band, dashed teal seal)
             fed from each type's own fields, rather than retrofitting the
             shared component's props. */
          (() => {
            const preview =
              selectedType === 'attendance_participation'
                ? { title: eventName, subtitle: subType, date: eventDate }
                : selectedType === 'completion'
                ? { title: programName, subtitle: subType, date: completionDate }
                : selectedType === 'merit_excellence'
                ? { title: achievementTitle, subtitle: subType, date: dateAwarded }
                : selectedType === 'appreciation_service'
                ? { title: reason, subtitle: capacity, date: appreciationDate }
                : selectedType === 'professional_certification'
                ? { title: certName, subtitle: issuingBody, date: dateCertified }
                : null

            if (!preview) return null

            return (
              <div className="lg:sticky lg:top-6">
                <div className="font-mono text-[9.5px] tracking-widest text-stone-400 uppercase mb-2">
                  {t('dashboard.live_preview')}
                </div>
                <div className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden">
                  <div className="bg-indigo-600 px-4 py-2.5 flex items-center gap-2.5">
                    <div className="h-5 px-1.5 rounded bg-white/20 flex items-center justify-center shrink-0">
                      <Landmark size={12} className="text-white" strokeWidth={2} />
                    </div>
                    <div className="flex-1 min-w-0 font-khmer text-[13px] font-semibold text-white truncate">
                      {issuerInfo?.name || t('wallet.institution_unknown')}
                    </div>
                    <Check size={15} className="text-white shrink-0" strokeWidth={2.6} />
                  </div>
                  <div className="flex items-start gap-3.5 p-4">
                    <div className="min-w-0 flex-1">
                      <h4 className="font-khmer font-bold text-stone-900 text-[17px] leading-snug">
                        {preview.title || t('dashboard.credential_preview_placeholder')}
                      </h4>
                      {preview.subtitle && <p className="text-sm text-stone-500 mt-0.5 truncate">{preview.subtitle}</p>}
                      <div className="flex items-center gap-4 mt-3">
                        <div>
                          <div className="font-mono text-[9px] text-stone-400 uppercase tracking-wide">{t('wallet.issued_on_label')}</div>
                          <div className="font-mono text-xs font-medium text-stone-700">
                            {preview.date ? new Date(preview.date).toLocaleDateString() : '—'}
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="w-14 h-14 rounded-full border-[1.5px] border-dashed border-teal-200 bg-teal-50 flex flex-col items-center justify-center shrink-0">
                      <ShieldCheck size={17} className="text-teal-500" strokeWidth={1.75} />
                      <span className="font-mono text-[6.5px] text-teal-500 mt-0.5 tracking-wider">{t('wallet.seal_label')}</span>
                    </div>
                  </div>
                </div>
              </div>
            )
          })()
        )}

      </div>
      )}
    </div>
  )
}
