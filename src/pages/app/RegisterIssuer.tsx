import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { generateIssuerKeys, didWeb } from '../../lib/did'
import { useLanguage } from '../../lib/i18n'
import { useZkVault } from '../../vault/zk-vault/hooks'
import { Building2, CheckCircle2, ChevronDown, ChevronUp, Loader2 } from 'lucide-react'

const MIN_PIN_LEN = 8

interface IssuerData {
  id?: string
  owner?: string
  user_id?: string
  name: string
  did: string
  accredited: boolean
  domain?: string
  type?: string
  public_key?: string
  public_jwk?: any
}

export default function RegisterIssuer() {
  const { t } = useLanguage()
  const navigate = useNavigate()
  const { setupVault, encryptPayload } = useZkVault()
  const [currentUser, setCurrentUser] = useState<any | null>(null)

  // Loading & Screen states
  const [checking, setChecking] = useState(true)
  const [existingIssuer, setExistingIssuer] = useState<IssuerData | null>(null)
  const [registeredSuccess, setRegisteredSuccess] = useState<IssuerData | null>(null)

  // Form fields
  const [name, setName] = useState('')
  const [domain, setDomain] = useState('')
  const [type, setType] = useState('')
  const [signingPin, setSigningPin] = useState('')
  
  // Validation errors
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  
  // DID Collapse explanation box
  const [didExplanationExpanded, setDidExplanationExpanded] = useState(false)

  useEffect(() => {
    let active = true

    async function loadUserAndIssuer() {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session || !session.user) {
          navigate('/auth/login', { replace: true })
          return
        }

        if (active) {
          setCurrentUser(session.user)
        }

        // Try querying by owner
        let { data, error } = await supabase
          .from('issuers')
          .select('*')
          .eq('owner', session.user.id)
          .maybeSingle()

        // Fallback to querying by owner if owner column doesn't exist
        if (error && (error.message.includes('owner') || error.code === 'PGRST204')) {
          const fallback = await supabase
            .from('issuers')
            .select('*')
            .eq('owner', session.user.id)
            .maybeSingle()
          data = fallback.data
          error = fallback.error
        }

        if (active) {
          if (!error && data) {
            setExistingIssuer(data)
          }
          setChecking(false)
        }
      } catch (err) {
        if (active) {
          setChecking(false)
        }
      }
    }

    loadUserAndIssuer()
    return () => { active = false }
  }, [navigate])

  const handleDomainBlur = () => {
    let clean = domain.trim()
    // Strip http://, https://, and www.
    clean = clean.replace(/^(https?:\/\/)?(www\.)?/, '')
    // Strip trailing path/slashes
    clean = clean.split('/')[0]
    setDomain(clean)
  }

  const validateForm = () => {
    const nextErrors: Record<string, string> = {}
    
    if (name.trim().length < 3) {
      nextErrors.name = 'Institution name must be at least 3 characters.'
    }
    if (!domain.trim()) {
      nextErrors.domain = 'Domain is required.'
    } else if (domain.includes(' ')) {
      nextErrors.domain = 'Domain must not contain spaces.'
    } else if (!domain.includes('.')) {
      nextErrors.domain = 'Domain must contain at least one dot.'
    }
    if (!type || type === 'Select type...') {
      nextErrors.type = 'Please select a valid institution type.'
    }
    if (signingPin.trim().length < MIN_PIN_LEN) {
      nextErrors.signingPin = `Signing PIN must be at least ${MIN_PIN_LEN} characters.`
    }

    setErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!currentUser) return
    if (!validateForm()) return

    try {
      setIsSubmitting(true)
      setSubmitError(null)

      // Step 1: Generate DID identity
      const { publicJwk, privateJwk } = await generateIssuerKeys()
      const did = didWeb(domain)

      // Step 2: Save to Supabase (attempting user prompt fields, with fallback to schema.sql layout)
      const jwkToStore = { ...publicJwk, alg: 'ES256' }
      let res = await supabase.from('issuers').insert({
        user_id: currentUser.id,
        name: name.trim(),
        domain: domain.trim(),
        type: type,
        did: did,
        public_key: JSON.stringify(jwkToStore),
        accredited: false,
        created_at: new Date().toISOString()
      })

      // Fallback if custom user columns are not configured in DB
      if (res.error && (res.error.message.includes('column') || res.error.code === '42703')) {
        res = await supabase.from('issuers').insert({
          owner: currentUser.id,
          name: name.trim(),
          did: did,
          public_jwk: jwkToStore,
          accredited: false
        })
      }

      if (res.error) throw res.error

      // Step 3: Persist the private key, encrypted with the issuer's signing
      // PIN, so it survives closing this tab instead of being lost with
      // sessionStorage alone.
      const setupOk = await setupVault(signingPin, currentUser.id, currentUser.email, { skipPasskey: true })
      if (!setupOk) throw new Error('Failed to secure your signing key. Please try again.')

      const ciphertext = await encryptPayload(privateJwk)
      let vaultRes = await supabase.from('issuers').update({ signing_key_ciphertext: ciphertext }).eq('owner', currentUser.id)
      if (vaultRes.error && (vaultRes.error.message.includes('owner') || vaultRes.error.code === 'PGRST204' || vaultRes.error.code === '42703')) {
        vaultRes = await supabase.from('issuers').update({ signing_key_ciphertext: ciphertext }).eq('user_id', currentUser.id)
      }
      if (vaultRes.error) throw vaultRes.error

      // Step 4: Store private key in sessionStorage for this session too, so
      // nothing downstream (signing/issuance) needs to change.
      sessionStorage.setItem('issuer_private_key', JSON.stringify(privateJwk))
      sessionStorage.setItem('issuer_did', did)

      // Step 5: Success state
      const successData: IssuerData = {
        name: name.trim(),
        did: did,
        accredited: false,
        domain: domain.trim(),
        type: type
      }
      setRegisteredSuccess(successData)
      setIsSubmitting(false)
    } catch (err: any) {
      setSubmitError(err.message || 'Registration failed. Please try again.')
      setIsSubmitting(false)
    }
  }

  if (checking) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh]">
        <Loader2 size={36} className="animate-spin text-indigo-600" />
        <p className="text-stone-500 mt-4 text-sm font-medium">{t('dashboard.checking_registration')}</p>
      </div>
    )
  }

  // Already Registered State
  if (existingIssuer) {
    const isAccredited = existingIssuer.accredited
    return (
      <div className="w-full md:max-w-xl mx-auto px-4 md:px-0 pb-24">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 md:p-8 text-center">
          <div className="w-14 h-14 rounded-2xl bg-indigo-50 flex items-center justify-center mx-auto mb-4">
            <Building2 size={28} className="text-indigo-600" />
          </div>
          <h2 className="text-xl md:text-2xl font-bold text-stone-900 mb-2">{t('dashboard.inst_already_registered')}</h2>
          <p className="text-sm text-stone-500 mb-6 leading-relaxed">
            {t('dashboard.inst_linked_desc')}
          </p>

          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-6 text-left text-sm space-y-3">
            <div>
              <span className="text-xs text-gray-400 block font-medium">{t('dashboard.inst_name')}</span>
              <strong className="text-gray-900 text-base">{existingIssuer.name}</strong>
            </div>
            {existingIssuer.domain && (
              <div>
                <span className="text-xs text-gray-400 block font-medium">{t('dashboard.inst_domain')}</span>
                <strong className="text-gray-900">{existingIssuer.domain}</strong>
              </div>
            )}
            <div>
              <span className="text-xs text-gray-400 block font-medium">{t('dashboard.inst_did')}</span>
              <code className="mono block bg-gray-100 p-2 rounded text-xs mt-1 overflow-x-auto">
                {existingIssuer.did}
              </code>
            </div>
          </div>

          <div className="mb-6">
            {isAccredited ? (
              <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200">
                {t('dashboard.accredited_badge')}
              </span>
            ) : (
              <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold bg-amber-100 text-amber-800 border border-amber-200">
                {t('dashboard.pending_badge')}
              </span>
            )}
          </div>

          <div className="flex flex-col gap-3">
            {isAccredited ? (
              <button 
                className="w-full bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-semibold h-[52px] rounded-lg text-sm transition-all focus:outline-none flex items-center justify-center cursor-pointer"
                onClick={() => navigate('/app/issue')}
              >
                {t('dashboard.issue_credential')}
              </button>
            ) : (
              <p className="text-xs text-rose-600 font-semibold italic">
                {t('dashboard.cannot_issue_until_approved')}
              </p>
            )}
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

  // Registration Success State
  if (registeredSuccess) {
    return (
      <div className="w-full md:max-w-xl mx-auto px-4 md:px-0 pb-24">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 md:p-8 text-center">
          <div className="w-14 h-14 rounded-2xl bg-emerald-50 flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 size={28} className="text-emerald-600" />
          </div>
          <h2 className="text-xl md:text-2xl font-bold text-stone-900 mb-2">{t('dashboard.inst_registered')}</h2>
          
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-6 text-left text-sm space-y-3">
            <div>
              <span className="text-xs text-gray-400 block font-medium">{t('dashboard.inst_name')}</span>
              <strong className="text-gray-900 text-base">{registeredSuccess.name}</strong>
            </div>
            <div>
              <span className="text-xs text-gray-400 block font-medium">{t('dashboard.inst_did')}</span>
              <code className="mono block bg-gray-100 p-2 rounded text-xs mt-1 overflow-x-auto">
                {registeredSuccess.did}
              </code>
            </div>
          </div>

          <div className="mb-6">
            <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold bg-amber-100 text-amber-800 border border-amber-200">
              {t('dashboard.pending_badge')}
            </span>
          </div>

          <div className="bg-amber-50 border-l-4 border-amber-500 p-4 rounded text-left text-xs text-amber-800 leading-relaxed mb-6">
            <p className="font-bold mb-1">{t('dashboard.next_steps')}</p>
            <ul className="list-disc pl-4 space-y-1">
              <li>{t('dashboard.step_added_registry')}</li>
              <li>{t('dashboard.step_moeys_review')}</li>
              <li>{t('dashboard.step_can_issue')}</li>
              <li>{t('dashboard.step_key_stored')}</li>
            </ul>
          </div>

          <div className="flex flex-col gap-3">
            <button 
              className="w-full bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-semibold h-[52px] rounded-lg text-sm transition-all focus:outline-none flex items-center justify-center cursor-pointer"
              onClick={() => navigate('/app/issue')}
            >
              {t('dashboard.issue_credential')}
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

  // Registration Form State
  return (
    <div className="w-full md:max-w-xl mx-auto px-4 md:px-0 pb-24">
      {/* Headers */}
      <div className="mb-6">
        <h2 className="text-xl md:text-2xl font-bold text-stone-900 tracking-tight">
          {t('dashboard.register_inst_title')}
        </h2>
        <p className="text-sm text-stone-500 mt-1 leading-relaxed">
          {t('dashboard.register_inst_desc')}
        </p>
      </div>

      {/* Form Card */}
      <div className="bg-transparent md:bg-white rounded-xl md:shadow-sm md:border md:border-gray-200 p-0 md:p-8">
        <form onSubmit={handleRegister} className="space-y-5">
          
          {/* Institution Name */}
          <div>
            <label className="text-xs md:text-sm font-bold text-gray-700 block">{t('dashboard.inst_name_label')}</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Royal University of Phnom Penh"
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 h-11 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white text-stone-900"
            />
            {errors.name && (
              <p className="text-rose-600 text-xs mt-1 font-semibold">{errors.name}</p>
            )}
          </div>

          {/* Domain */}
          <div>
            <label className="text-xs md:text-sm font-bold text-gray-700 block">{t('dashboard.domain_label')}</label>
            <input
              type="text"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              onBlur={handleDomainBlur}
              placeholder="rupp.edu.kh"
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 h-11 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white text-stone-900"
            />
            <p className="text-[11px] text-gray-500 mt-1 leading-relaxed">
              {t('dashboard.domain_help')}
            </p>
            {errors.domain && (
              <p className="text-rose-600 text-xs mt-1 font-semibold">{errors.domain}</p>
            )}
          </div>

          {/* Collapsible DID Explanation Box */}
          <div className="border border-gray-200 rounded-lg overflow-hidden bg-gray-50">
            <button
              type="button"
              onClick={() => setDidExplanationExpanded(!didExplanationExpanded)}
              className="w-full px-4 py-2.5 flex justify-between items-center bg-transparent border-none cursor-pointer text-left text-xs md:text-sm font-semibold text-indigo-600 hover:text-indigo-800 transition-colors"
            >
              <span>{t('dashboard.what_is_did')}</span>
              {didExplanationExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
            
            {didExplanationExpanded && (
              <div className="px-4 pb-3 text-xs text-gray-500 leading-relaxed space-y-2">
                <p>
                  {t('dashboard.did_desc1')}
                </p>
                <p className="font-semibold">
                  {t('dashboard.did_example')} <code className="mono block bg-gray-150 px-2 py-0.5 rounded text-stone-700 mt-0.5">did:web:rupp.edu.kh</code>
                </p>
                <p>
                  {t('dashboard.did_desc2')}
                </p>
                <p>
                  {t('dashboard.did_desc3')}
                </p>
              </div>
            )}
          </div>

          {/* Institution Type */}
          <div>
            <label className="text-xs md:text-sm font-bold text-gray-700 block">{t('dashboard.inst_type_label')}</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 h-11 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white text-stone-900"
            >
              <option value="">{t('dashboard.select_type')}</option>
              <option value="University">University</option>
              <option value="Ministry">Ministry</option>
              <option value="Training centre">Training centre</option>
              <option value="Other">Other</option>
            </select>
            {errors.type && (
              <p className="text-rose-600 text-xs mt-1 font-semibold">{errors.type}</p>
            )}
          </div>

          {/* Signing PIN */}
          <div>
            <label className="text-xs md:text-sm font-bold text-gray-700 block">Signing PIN</label>
            <input
              type="password"
              value={signingPin}
              onChange={(e) => setSigningPin(e.target.value)}
              placeholder={`Create a ${MIN_PIN_LEN}+ character PIN`}
              autoComplete="new-password"
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 h-11 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white text-stone-900"
            />
            <p className="text-[11px] text-gray-500 mt-1 leading-relaxed">
              Protects your certificate-signing key so it survives closing this tab. You&apos;ll enter this PIN each time you return, instead of regenerating a new key.
            </p>
            {errors.signingPin && (
              <p className="text-rose-600 text-xs mt-1 font-semibold">{errors.signingPin}</p>
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
            <span>{t('dashboard.register_btn_text')}</span>
          </button>
        </form>
      </div>
    </div>
  )
}
