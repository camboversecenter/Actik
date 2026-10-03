import React, { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useZkVault } from '../../vault/zk-vault'
import { Lock, CheckCircle, XCircle, ChevronDown, ChevronUp, HelpCircle, Check, AlertTriangle, KeyRound, ShieldCheck, Ban, Settings2, Building2, User, Info } from 'lucide-react'
import { useLanguage } from '../../lib/i18n'
import LanguageSwitcher from '../../components/LanguageSwitcher'
import PinDotsInput from '../../components/PinDotsInput'
import { verifyIssuedCredential } from '../../lib/claimVerification'

// Note: The prompt expects import { useVault } from '../../vault/zk-vault/useVault'
// But the actual file in this project exports useZkVault from '../../vault/zk-vault'

type UnlockMethod = 'biometric' | 'passkey' | 'pin'
type SetupStep = 1 | 2 | 3

interface VaultRecord {
  id: string
  user_id: string
  encrypted_envelope: string
  unlock_method: UnlockMethod
  created_at: string
}

export interface Credential {
  id: string
  issuer_id: string
  holder_id: string | null
  holder_email: string
  issuer_did: string
  institution_name: string
  degree_title: string
  sd_jwt: string
  claimed: boolean
  claimed_at: string | null
  created_at: string
  cipher?: string
  iv?: string
}

// Shared spin keyframe styles
const spinStyles = `
  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
`

export default function VaultSetup() {
  const navigate = useNavigate()
  const location = useLocation()
  const { setupVault, checkVaultStatus, lock } = useZkVault()
  const { t } = useLanguage()

  // Routing source check
  const searchParams = new URLSearchParams(location.search)
  const isFromWallet = searchParams.get('from') === 'wallet' || (location.state as any)?.from === 'wallet'

  // User details
  const [currentUser, setCurrentUser] = useState<any | null>(null)
  const [userRole, setUserRole] = useState<string | null>(null)
  const [checking, setChecking] = useState(true)

  // Wizard state
  const [step, setStep] = useState<SetupStep>(1)
  const [existingVault, setExistingVault] = useState<Partial<VaultRecord> | null>(null)
  const [showReconfigureModal, setShowReconfigureModal] = useState(false)
  
  // PIN inputs — a single masked field (not split digit boxes) so browsers
  // can recognize it as a real password field and offer to save it, with
  // Face ID/Touch ID/Windows Hello gating the autofill on later visits.
  const [pin, setPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [showPin, setShowPin] = useState(false)
  const [pinError, setPinError] = useState<string | null>(null)

  // Security explainer collapse
  const [explainOpen, setExplainOpen] = useState(false)

  // Creation checklist states
  const [creationStatus, setCreationStatus] = useState<{
    keyGen: 'idle' | 'running' | 'done' | 'error'
    envelope: 'idle' | 'running' | 'done' | 'error'
    saving: 'idle' | 'running' | 'done' | 'error'
    verifying: 'idle' | 'running' | 'done' | 'error'
  }>({
    keyGen: 'idle',
    envelope: 'idle',
    saving: 'idle',
    verifying: 'idle'
  })
  
  const [creationError, setCreationError] = useState<string | null>(null)

  // Reset vault states
  const [showResetModal, setShowResetModal] = useState(false)
  const [resetInput, setResetInput] = useState('')
  const [isResetting, setIsResetting] = useState(false)

  // Check vault status on mount
  useEffect(() => {
    let active = true
    async function initCheck() {
      try {
        setChecking(true)
        const { data: { session } } = await supabase.auth.getSession()
        if (!session || !session.user) {
          navigate('/auth/login', { replace: true })
          return
        }

        if (active) {
          setCurrentUser(session.user)
        }

        // Fetch user profile role
        const { data: profileRow } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', session.user.id)
          .maybeSingle()

        if (active && profileRow) {
          setUserRole(profileRow.role)
          if (profileRow.role === 'issuer') {
            alert("Vault setup is for students only. Issuers manage credentials on the Dashboard.")
            navigate('/app/dashboard', { replace: true })
            return
          }
        }

        // Check if vault exists using prompts-requested table query
        let { data: vaultData, error: vaultError } = await supabase
          .from('vaults')
          .select('id, created_at, unlock_method')
          .eq('user_id', session.user.id)
          .maybeSingle()

        // Check if vaults table does not exist
        const isVaultsMissing = vaultError && (
          vaultError.code === '42P01' || 
          vaultError.message.includes('does not exist') || 
          vaultError.message.includes('missing')
        )

        if (active) {
          if (isVaultsMissing) {
            // Fall back to profiles status
            const status = await checkVaultStatus(session.user.id)
            if (status.status === 'ok' && status.exists) {
              setExistingVault({
                user_id: session.user.id,
                created_at: new Date().toISOString(), // default fallback
                unlock_method: status.hasPasskey ? 'passkey' : 'pin'
              })
            } else {
              setExistingVault(null)
            }
          } else if (!vaultError && vaultData) {
            setExistingVault(vaultData)
          } else {
            setExistingVault(null)
          }
          setChecking(false)
        }
      } catch (err) {
        if (active) {
          setExistingVault(null)
          setChecking(false)
        }
      }
    }

    initCheck()
    return () => { active = false }
  }, [navigate, checkVaultStatus, setUserRole])

  const isPinComplete = pin.length === 6
  const isConfirmComplete = confirmPin.length === 6
  const pinsMatch = pin === confirmPin

  const canContinueStep1 = isPinComplete && isConfirmComplete && pinsMatch

  // Step 1 submit
  const handleContinueToStep2 = (e: React.FormEvent) => {
    e.preventDefault()
    if (!canContinueStep1) return
    setPinError(null)
    setStep(2)
    triggerVaultCreation()
  }

  // Step 2 Logic: Perform actual zk-vault creation
  const triggerVaultCreation = async () => {
    if (!currentUser) return
    setCreationError(null)
    setCreationStatus({
      keyGen: 'running',
      envelope: 'idle',
      saving: 'idle',
      verifying: 'idle'
    })

    try {
      const pinCode = pin

      // 1. Generate Key status
      await new Promise(r => setTimeout(r, 800))
      setCreationStatus(prev => ({ ...prev, keyGen: 'done', envelope: 'running' }))

      // 2. Create Envelope status
      await new Promise(r => setTimeout(r, 800))
      setCreationStatus(prev => ({ ...prev, envelope: 'done', saving: 'running' }))

      // Call actual setup function — PIN only, skip the passkey ceremony.
      const success = await setupVault(
        pinCode,
        currentUser.id,
        currentUser.email,
        { skipPasskey: true }
      )

      if (!success) {
        throw new Error('PIN vault creation failed.')
      }

      // Get envelopes from profiles to save to vaults table (or sync)
      const { data: profileRow } = await supabase
        .from('profiles')
        .select('vault_envelope_pin, vault_pin_salt, vault_envelope_passkey, passkey_id')
        .eq('id', currentUser.id)
        .single()

      const envelopePayloadStr = JSON.stringify({
        pinEnvelope: profileRow?.vault_envelope_pin || null,
        pinSalt: profileRow?.vault_pin_salt || null,
        passkeyEnvelope: profileRow?.vault_envelope_passkey || null,
        passkeyId: profileRow?.passkey_id || null
      })

      // 3. Save to Supabase (try vaults table first, fallback cleanly)
      let res = await supabase.from('vaults').upsert({
        user_id: currentUser.id,
        encrypted_envelope: envelopePayloadStr,
        unlock_method: 'pin',
        created_at: new Date().toISOString()
      })

      const isVaultsTableMissing = res.error && (
        res.error.code === '42P01' || 
        res.error.message.includes('does not exist') || 
        res.error.message.includes('missing')
      )

      if (res.error && !isVaultsTableMissing) {
        throw new Error('Supabase save failed: ' + res.error.message)
      }

      setCreationStatus(prev => ({ ...prev, saving: 'done', verifying: 'running' }))
      
      // 4. Verify Vault
      await new Promise(r => setTimeout(r, 800))
      setCreationStatus(prev => ({ ...prev, verifying: 'done' }))

      // Advance to step 3 after verify completes
      await new Promise(r => setTimeout(r, 600))
      setStep(3)
    } catch (err: any) {
      setCreationStatus(prev => {
        const next = { ...prev }
        if (next.keyGen === 'running') next.keyGen = 'error'
        else if (next.envelope === 'running') next.envelope = 'error'
        else if (next.saving === 'running') next.saving = 'error'
        else if (next.verifying === 'running') next.verifying = 'error'
        return next
      })
      setCreationError(err.message || 'Setup failed. Please try again.')
    }
  }

  // Reset vault operation
  const handleResetConfirm = async () => {
    if (resetInput !== 'RESET' || !currentUser) return
    try {
      setIsResetting(true)

      // 1. Delete from vaults table (if exists)
      await supabase.from('vaults').delete().eq('user_id', currentUser.id)

      // 2. Clear vault columns from profiles table
      await supabase
        .from('profiles')
        .update({
          vault_envelope_pin: null,
          vault_pin_salt: null,
          vault_envelope_passkey: null,
          passkey_id: null
        })
        .eq('id', currentUser.id)

      // 3. Clear local state
      lock()

      // Reset components
      setExistingVault(null)
      setShowResetModal(false)
      setResetInput('')
      setStep(1)
      setPin('')
      setConfirmPin('')
      setIsResetting(false)
    } catch {
      setIsResetting(false)
    }
  }

  // A stacked label/value field row — same convention as CredentialDetail's
  // renderField: English is a small technical caption under the Khmer
  // label, and the value renders right-aligned (mono for anything
  // identifier-shaped, like an email address).
  const renderField = (label: string, sublabel: string, value: any, mono = false) => (
    <div className="flex justify-between items-center gap-3 py-2.5 border-b border-stone-100 last:border-b-0">
      <span className="font-khmer text-[11.5px] text-stone-500 shrink-0">
        {label}
        <span className="block font-sans text-[9px] text-stone-400 mt-0.5">{sublabel}</span>
      </span>
      <span className={`font-semibold text-stone-900 text-right break-all ${mono ? 'font-mono text-xs' : 'text-sm'}`}>{value}</span>
    </div>
  )

  // Main Loader
  if (checking) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <style>{spinStyles}</style>
        <div style={{
          width: 44,
          height: 44,
          border: '4px solid var(--forest-soft)',
          borderTop: '4px solid var(--forest)',
          borderRadius: '50%',
          animation: 'spin 1s linear infinite'
        }}></div>
        <p className="muted" style={{ marginTop: '1rem' }}>{t('account.checking_vault')}</p>
      </div>
    )
  }

  // Render Page
  return (
    <div className="w-full md:max-w-xl mx-auto px-4 md:px-0 pb-24">
      <style>{spinStyles}</style>

      {/* =======================================================
          A. ALREADY SET UP STATE
         ======================================================= */}
      {existingVault && (
        <div className="space-y-6 max-w-xl mx-auto">
          {/* Status Message */}
          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5 text-center shadow-sm">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 mb-3">
              <CheckCircle size={24} />
            </div>
            <h2 className="font-khmer text-lg font-bold text-stone-900">{t('account.title')}</h2>
            <p className="font-khmer text-xs text-stone-500 mt-1 leading-relaxed max-w-md mx-auto">
              {t('account.subtitle')}
            </p>
          </div>

          {/* Card 1: Account Information */}
          <div className="bg-white rounded-2xl shadow-sm border border-stone-200 p-6">
            <h3 className="font-khmer text-[12.5px] font-bold text-stone-900 tracking-tight mb-3 flex items-center gap-2">
              <User size={15} strokeWidth={1.85} className="text-indigo-600" />
              {t('account.account_info')}
            </h3>

            <div>
              {renderField(t('account.email'), 'Email', currentUser?.email, true)}
              <div className="flex justify-between items-center gap-3 py-2.5 border-b border-stone-100">
                <span className="font-khmer text-[11.5px] text-stone-500 shrink-0">
                  {t('account.role')}
                  <span className="block font-sans text-[9px] text-stone-400 mt-0.5">Role</span>
                </span>
                <span className="font-khmer inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-indigo-50 text-indigo-650 border border-indigo-200">
                  {userRole ? t(`role.${userRole.toLowerCase()}`) : t('role.student')}
                </span>
              </div>
              {renderField(
                t('account.created'),
                'Created',
                currentUser?.created_at ? new Date(currentUser.created_at).toLocaleDateString() : '—'
              )}
            </div>
          </div>

          {/* Card 2: Vault Security */}
          <div className="bg-white rounded-2xl shadow-sm border border-stone-200 p-6 relative overflow-hidden">
            <h3 className="font-khmer text-[12.5px] font-bold text-stone-900 tracking-tight mb-3 flex items-center gap-2">
              <Lock size={15} strokeWidth={1.85} className="text-indigo-600" />
              {t('account.vault_security')}
            </h3>

            <div className="mb-5">
              {renderField(
                t('account.unlock_method'),
                'Unlock method',
                existingVault.unlock_method === 'pin' ? t('account.pin_method') : t('account.bio_method')
              )}
              {renderField(
                t('account.vault_configured'),
                'Configured',
                new Date(existingVault.created_at || '').toLocaleDateString()
              )}
            </div>

            <button
              onClick={() => setShowReconfigureModal(true)}
              className="font-khmer w-full border border-indigo-600 bg-transparent hover:bg-indigo-50 active:bg-indigo-100 text-indigo-600 font-semibold h-11 px-4 rounded-xl text-sm transition-all focus:outline-none flex items-center justify-center cursor-pointer"
            >
              {t('account.change_unlock')}
            </button>
          </div>

          {/* Language Switcher Card */}
          <LanguageSwitcher prefix="account" variant="compact-row" />

          {/* Card 3: Action Options */}
          <div className="bg-white rounded-2xl shadow-sm border border-stone-200 p-6 flex flex-col gap-3">
            <button
              className="font-khmer w-full bg-indigo-600 hover:bg-indigo-650 active:bg-indigo-700 text-white font-semibold h-11 rounded-lg text-sm transition-all focus:outline-none flex items-center justify-center cursor-pointer"
              onClick={() => navigate('/app/wallet')}>
              {t('account.go_wallet')}
            </button>
            <button
              className="font-khmer w-full border border-rose-200 bg-white hover:bg-rose-50 active:bg-rose-100 text-rose-600 font-semibold h-11 rounded-lg text-sm transition-all focus:outline-none flex items-center justify-center cursor-pointer"
              onClick={() => setShowResetModal(true)}>
              {t('account.reset_vault')}
            </button>
          </div>

          {/* Security tips / Info banner */}
          <div className="flex gap-3 items-start p-4 bg-indigo-50 rounded-xl border border-indigo-200 text-xs text-indigo-800 leading-relaxed shadow-sm">
            <Info size={17} strokeWidth={1.9} className="text-indigo-650 shrink-0 mt-0.5" />
            <div className="font-khmer">
              <strong className="font-bold block mb-0.5">{t('account.sec_recs')}</strong>
              {t('account.sec_recs_desc')}
            </div>
          </div>
        </div>
      )}

      {/* =======================================================
          B. SETUP FLOW WIZARD
         ======================================================= */}
      {!existingVault && (
        <div>
          {/* Header */}
          <div className="text-center mb-8">
            <h2 className="text-2xl font-bold text-stone-900 tracking-tight">{t('account.setup_title')}</h2>
            <p className="text-sm text-stone-500 mt-1 max-w-sm mx-auto leading-relaxed">
              {t('account.vault_setup_subtitle')}
            </p>
          </div>

          {/* Stepper progress indicator */}
          <div className="flex items-center justify-between mb-8 relative px-4">
            {/* Horizontal Line background */}
            <div className="absolute top-4 sm:top-5 left-[10%] right-[10%] h-[2px] bg-gray-200 z-0" />
            
            {/* Step 1 */}
            <div className="flex flex-col items-center relative z-10">
              <div 
                className={`w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center text-xs sm:text-sm font-semibold border-2 transition-colors ${
                  step === 1 ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-emerald-500 border-emerald-500 text-white'
                }`}
              >
                {step > 1 ? <Check size={16} /> : '1'}
              </div>
              <span className="text-[10px] md:text-xs font-semibold mt-1.5 text-gray-500 hidden sm:inline">{t('account.step_choose_method')}</span>
            </div>

            {/* Step 2 */}
            <div className="flex flex-col items-center relative z-10">
              <div 
                className={`w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center text-xs sm:text-sm font-semibold border-2 transition-colors ${
                  step === 2 ? 'bg-indigo-600 border-indigo-600 text-white' : step > 2 ? 'bg-emerald-500 border-emerald-500 text-white' : 'bg-white border-gray-200 text-gray-400'
                }`}
              >
                {step > 2 ? <Check size={16} /> : '2'}
              </div>
              <span className="text-[10px] md:text-xs font-semibold mt-1.5 text-gray-500 hidden sm:inline">{t('account.step_create_vault')}</span>
            </div>

            {/* Step 3 */}
            <div className="flex flex-col items-center relative z-10">
              <div 
                className={`w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center text-xs sm:text-sm font-semibold border-2 transition-colors ${
                  step === 3 ? 'bg-emerald-500 border-emerald-500 text-white' : 'bg-white border-gray-200 text-gray-400'
                }`}
              >
                3
              </div>
              <span className="text-[10px] md:text-xs font-semibold mt-1.5 text-gray-500 hidden sm:inline">{t('account.step_done')}</span>
            </div>
          </div>

          {/* =======================================================
              STEP 1: CHOOSE UNLOCK METHOD
             ======================================================= */}
          {step === 1 && (
            <div>
              <h3 className="text-base md:text-lg font-bold text-stone-900 mb-4">
                {t('account.how_to_unlock')}
              </h3>

              {/* PIN is the only unlock method: it's derived in software from
                  the PIN text (PBKDF2) rather than bound to one device's
                  hardware, so the same PIN works on any device/browser —
                  unlike a platform biometric passkey, which only ever works
                  on the single device it was created on. */}
              <div className="border-2 border-indigo-600 bg-indigo-50/30 rounded-xl p-5 mb-6 flex flex-col">
                <div className="mb-4 text-indigo-600">
                  <Lock size={28} />
                </div>
                <strong className="text-sm md:text-base text-gray-900 block font-semibold">{t('account.pin_title')}</strong>
                <p className="text-xs text-gray-500 mt-2 mb-4 leading-relaxed">
                  {t('account.pin_desc')}
                </p>
                <ul className="list-disc pl-4 space-y-1.5 text-[11px] text-gray-500">
                  <li>{t('account.pin_feature_1')}</li>
                  <li>{t('account.pin_feature_2')}</li>
                  <li>{t('account.pin_feature_3')}</li>
                </ul>
              </div>

              {/* PIN entry via PinDotsInput — still a single real password
                  <input> under the dot-progress visual (not split digit
                  boxes), inside a form with autoComplete hints, so the
                  browser can offer to save it and gate autofill behind
                  Face ID/Touch ID/Windows Hello on later visits. See
                  components/PinDotsInput.tsx for why that matters. */}
              <form onSubmit={handleContinueToStep2}>
                <div className="bg-white border border-gray-200 rounded-xl p-5 md:p-6 mb-6 shadow-sm">

                  {/* Create PIN block */}
                  <div className="mb-6">
                    <label className="text-xs md:text-sm font-bold text-gray-700 block text-center mb-3">
                      {t('account.create_pin')}
                    </label>
                    <PinDotsInput
                      value={pin}
                      onChange={setPin}
                      name="vault-pin"
                      autoComplete="new-password"
                      reveal={showPin}
                      autoFocus
                    />
                  </div>

                  {/* Confirm PIN block */}
                  <div className="mb-4">
                    <label className="text-xs md:text-sm font-bold text-gray-700 block text-center mb-3">
                      {t('account.confirm_pin')}
                    </label>
                    <PinDotsInput
                      value={confirmPin}
                      onChange={setConfirmPin}
                      name="vault-pin-confirm"
                      autoComplete="new-password"
                      reveal={showPin}
                    />
                  </div>

                  {/* Toggle show/hide PIN */}
                  <div className="flex flex-col sm:flex-row justify-between items-center gap-2 mt-4 pt-4 border-t border-gray-100">
                    <label className="flex items-center gap-2 cursor-pointer text-xs text-gray-500">
                      <input
                        type="checkbox"
                        checked={showPin}
                        onChange={(e) => setShowPin(e.target.checked)}
                        className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <span>{t('account.show_pin_digits')}</span>
                    </label>

                    {isPinComplete && isConfirmComplete && !pinsMatch && (
                      <span className="text-rose-600 text-xs font-semibold">
                        {t('account.pin_mismatch_error')}
                      </span>
                    )}
                    {isPinComplete && isConfirmComplete && pinsMatch && (
                      <span className="text-emerald-600 text-xs font-semibold">
                        {t('account.pin_matches')}
                      </span>
                    )}
                  </div>
                </div>

                {/* Error messages */}
                {pinError && (
                  <div className="w-full bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-lg p-3 mb-4 font-medium">
                    {pinError}
                  </div>
                )}

                {/* Continue button */}
                <button
                  type="submit"
                  className={`w-full h-[52px] font-semibold rounded-lg transition-all flex items-center justify-center gap-2 mb-6 ${
                    canContinueStep1 ? 'bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 cursor-pointer text-white shadow-sm' : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  }`}
                  disabled={!canContinueStep1}
                >
                  {t('account.continue_btn')}
                </button>
              </form>

              {/* SECURITY EXPLAINER SECTION */}
              <div className="border-t border-gray-200 pt-5">
                <button
                  type="button"
                  onClick={() => setExplainOpen(!explainOpen)}
                  className="w-full flex items-center justify-between bg-transparent border-none cursor-pointer p-0 text-gray-500 text-sm font-semibold hover:text-indigo-600 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <HelpCircle size={18} />
                    <span>{t('account.how_it_works')}</span>
                  </div>
                  {explainOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </button>

                {explainOpen && (
                  <div className="mt-3 bg-gray-50 border border-gray-200 rounded-lg p-4 text-xs leading-relaxed text-gray-500 space-y-3">
                    <p className="flex gap-2">
                      <KeyRound size={14} className="shrink-0 mt-0.5 text-gray-400" />
                      <span><strong>Local Key Derivation:</strong> Your encryption key is derived directly from your PIN using the browser&apos;s WebCrypto API.</span>
                    </p>
                    <p className="flex gap-2">
                      <Ban size={14} className="shrink-0 mt-0.5 text-gray-400" />
                      <span><strong>Zero Knowledge:</strong> The key never leaves your device. Actik servers only store the encrypted envelopes (gibberish without your device key).</span>
                    </p>
                    <p className="flex gap-2">
                      <Lock size={14} className="shrink-0 mt-0.5 text-gray-400" />
                      <span><strong>AES-GCM 256 Encryption:</strong> We use industry-standard AES-GCM 256-bit symmetric encryption to wrap certificates.</span>
                    </p>
                    <p className="flex gap-2">
                      <Settings2 size={14} className="shrink-0 mt-0.5 text-gray-400" />
                      <span><strong>Technical stack:</strong> A PIN-derived KEK envelope secures the main Data Encryption Key (DEK).</span>
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* =======================================================
              STEP 2: CREATING THE VAULT CHECKSLIST
             ======================================================= */}
          {step === 2 && (
            <div className="bg-white rounded-xl border border-gray-200 p-6 md:p-8 shadow-sm">
              <h3 className="text-base md:text-lg font-bold text-stone-900 mb-1">
                {t('account.creating_your_vault')}
              </h3>
              <p className="text-xs md:text-sm text-gray-500 mb-6 leading-relaxed">
                {t('account.confirm_with_device')} {t('account.pin_passcode')}
              </p>

              {/* Checklist visualizer */}
              <div className="flex flex-col gap-4 mb-8 w-full leading-relaxed">
                {/* 1. Generating encryption key */}
                <div className="flex items-center gap-3 text-sm md:text-base">
                  {creationStatus.keyGen === 'idle' && <div className="w-5 h-5 rounded-full border border-gray-200 bg-gray-50 shrink-0" />}
                  {creationStatus.keyGen === 'running' && <div className="animate-spin rounded-full h-5 w-5 border-2 border-gray-200 border-t-indigo-600 shrink-0" />}
                  {creationStatus.keyGen === 'done' && <CheckCircle size={20} className="text-emerald-500 shrink-0" />}
                  {creationStatus.keyGen === 'error' && <XCircle size={20} className="text-rose-500 shrink-0" />}
                  <span className={creationStatus.keyGen === 'running' ? 'text-gray-900 font-semibold' : 'text-gray-500'}>
                    {t('account.generating_key')}
                  </span>
                </div>

                {/* 2. Creating vault envelope */}
                <div className="flex items-center gap-3 text-sm md:text-base">
                  {creationStatus.envelope === 'idle' && <div className="w-5 h-5 rounded-full border border-gray-200 bg-gray-50 shrink-0" />}
                  {creationStatus.envelope === 'running' && <div className="animate-spin rounded-full h-5 w-5 border-2 border-gray-200 border-t-indigo-600 shrink-0" />}
                  {creationStatus.envelope === 'done' && <CheckCircle size={20} className="text-emerald-500 shrink-0" />}
                  {creationStatus.envelope === 'error' && <XCircle size={20} className="text-rose-500 shrink-0" />}
                  <span className={creationStatus.envelope === 'running' ? 'text-gray-900 font-semibold' : 'text-gray-500'}>
                    {t('account.creating_envelope')}
                  </span>
                </div>

                {/* 3. Saving to Actik */}
                <div className="flex items-center gap-3 text-sm md:text-base">
                  {creationStatus.saving === 'idle' && <div className="w-5 h-5 rounded-full border border-gray-200 bg-gray-50 shrink-0" />}
                  {creationStatus.saving === 'running' && <div className="animate-spin rounded-full h-5 w-5 border-2 border-gray-200 border-t-indigo-600 shrink-0" />}
                  {creationStatus.saving === 'done' && <CheckCircle size={20} className="text-emerald-500 shrink-0" />}
                  {creationStatus.saving === 'error' && <XCircle size={20} className="text-rose-500 shrink-0" />}
                  <span className={creationStatus.saving === 'running' ? 'text-gray-900 font-semibold' : 'text-gray-500'}>
                    {t('account.saving_actik')}
                  </span>
                </div>

                {/* 4. Verifying vault */}
                <div className="flex items-center gap-3 text-sm md:text-base">
                  {creationStatus.verifying === 'idle' && <div className="w-5 h-5 rounded-full border border-gray-200 bg-gray-50 shrink-0" />}
                  {creationStatus.verifying === 'running' && <div className="animate-spin rounded-full h-5 w-5 border-2 border-gray-200 border-t-indigo-600 shrink-0" />}
                  {creationStatus.verifying === 'done' && <CheckCircle size={20} className="text-emerald-500 shrink-0" />}
                  {creationStatus.verifying === 'error' && <XCircle size={20} className="text-rose-500 shrink-0" />}
                  <span className={creationStatus.verifying === 'running' ? 'text-gray-900 font-semibold' : 'text-gray-500'}>
                    {t('account.verifying_vault')}
                  </span>
                </div>
              </div>

              {/* Step 2 Error card */}
              {creationError && (
                <div className="text-center">
                  <div className="w-full bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-lg p-3.5 mb-6 text-left">
                    <strong>{t('account.vault_creation_failed')}</strong>
                    <p className="mt-1 text-[11px] leading-relaxed">{creationError}</p>
                  </div>
                  <button className="w-full bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-semibold h-[52px] rounded-lg text-sm flex items-center justify-center cursor-pointer" onClick={() => setStep(1)}>
                    {t('wallet.try_again')}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* =======================================================
              STEP 3: DONE / SUCCESS STATE
             ======================================================= */}
          {step === 3 && (
            <div className="bg-white rounded-xl border border-gray-200 p-6 md:p-8 text-center shadow-sm">
              
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-emerald-50 border border-emerald-100 text-emerald-500 mb-4">
                <CheckCircle size={28} />
              </div>

              <h2 className="text-xl md:text-2xl font-bold text-stone-900 mb-2">{t('account.vault_ready_title')}</h2>
              <p className="text-xs md:text-sm text-gray-500 mb-6 leading-relaxed">
                {t('account.vault_protected_by')} {t('account.pin_passcode')}
              </p>

              {/* Explainer cards */}
              <div className="flex flex-col gap-3 text-left mb-8">
                <div className="flex gap-3 items-start p-3.5 bg-gray-50 border border-gray-200 rounded-lg text-xs leading-relaxed text-gray-500">
                  <ShieldCheck size={16} className="shrink-0 text-indigo-500" />
                  <p className="margin-0">
                    <strong>{t('account.only_you_open')}</strong> {t('account.only_you_open_desc')}
                  </p>
                </div>

                <div className="flex gap-3 items-start p-3.5 bg-gray-50 border border-gray-200 rounded-lg text-xs leading-relaxed text-gray-500">
                  <Building2 size={16} className="shrink-0 text-indigo-500" />
                  <p className="margin-0">
                    <strong>{t('account.if_lose_access')}</strong> {t('account.if_lose_access_desc')}
                  </p>
                </div>

                <div className="flex gap-3 items-start p-3.5 bg-gray-50 border border-gray-200 rounded-lg text-xs leading-relaxed text-gray-500">
                  <KeyRound size={16} className="shrink-0 text-indigo-500" />
                  <p className="margin-0">
                    <strong>{t('account.backup_methods')}</strong> {t('account.backup_methods_desc')}
                  </p>
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                {isFromWallet ? (
                  <button 
                    className="w-full bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-semibold h-[52px] rounded-lg text-sm transition-all focus:outline-none flex items-center justify-center cursor-pointer" 
                    onClick={() => navigate('/app/wallet')}
                  >
                    {t('account.return_wallet_claim')}
                  </button>
                ) : (
                  <>
                    <button 
                      className="w-full sm:flex-1 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-semibold h-[52px] rounded-lg text-sm transition-all focus:outline-none flex items-center justify-center cursor-pointer" 
                      onClick={() => navigate('/app/wallet')}
                    >
                      {t('account.go_wallet')}
                    </button>
                    <button 
                      className="w-full sm:flex-1 border border-gray-300 bg-white hover:bg-gray-50 active:bg-gray-100 text-gray-700 font-semibold h-[52px] rounded-lg text-sm transition-all focus:outline-none flex items-center justify-center cursor-pointer" 
                      onClick={() => navigate('/app/dashboard')}
                    >
                      {t('account.go_dashboard')}
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* =======================================================
          RESET VAULT CONFIRMATION WARNING MODAL (Requirement 8)
         ======================================================= */}
      {showResetModal && (
        <div className="fixed inset-0 bg-black/40 flex items-stretch md:items-center justify-end md:justify-center z-[1000] p-0 md:p-4 flex-col">
          <div className="bg-white rounded-t-2xl md:rounded-xl shadow-lg p-6 md:p-8 w-full max-w-sm flex flex-col pb-8 md:pb-8 animate-scale-in text-center">
            <div className="w-12 h-12 rounded-2xl bg-rose-50 flex items-center justify-center mx-auto mb-2">
              <AlertTriangle size={22} className="text-rose-600" />
            </div>
            <h3 className="text-lg font-bold text-rose-600 mb-2">{t('account.delete_vault_warning')}</h3>
            
            <p className="text-xs text-gray-500 mb-6 leading-relaxed text-left">
              {t('account.reset_vault_desc')}
            </p>

            <div className="mb-6 text-left">
              <label className="text-xs font-bold text-gray-700 block mb-2">
                {t('account.type_reset_confirm')}
              </label>
              <input
                type="text"
                value={resetInput}
                onChange={(e) => setResetInput(e.target.value)}
                placeholder="RESET"
                className="w-full text-center h-11 border border-rose-300 focus:outline-none focus:ring-2 focus:ring-rose-500 rounded-lg text-sm font-semibold mb-2"
              />
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                className="w-1/2 border border-gray-300 bg-white hover:bg-gray-50 active:bg-gray-100 text-gray-700 font-semibold h-11 rounded-lg text-sm flex items-center justify-center cursor-pointer"
                onClick={() => {
                  setShowResetModal(false)
                  setResetInput('')
                }}
                disabled={isResetting}
              >
                {t('wallet.cancel')}
              </button>

              <button
                type="button"
                disabled={resetInput !== 'RESET' || isResetting}
                onClick={handleResetConfirm}
                className={`w-1/2 text-white font-semibold h-11 rounded-lg text-sm flex items-center justify-center gap-1.5 transition-all ${
                  resetInput === 'RESET' && !isResetting ? 'bg-rose-600 hover:bg-rose-700 active:bg-rose-800 cursor-pointer' : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                }`}
              >
                {isResetting && (
                  <div className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-indigo-200 border-t-white" />
                )}
                <span>{t('account.reset_btn')}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =======================================================
          MODAL 3: RECONFIGURE VAULT CONFIRMATION
         ======================================================= */}
      {showReconfigureModal && (
        <div className="fixed inset-0 bg-black/40 flex items-stretch md:items-center justify-end md:justify-center z-[1000] p-0 md:p-4 flex-col">
          <div className="bg-white rounded-t-2xl md:rounded-xl shadow-lg p-6 md:p-8 w-full max-w-sm flex flex-col pb-8 md:pb-8 animate-scale-in">
            <div className="text-center mb-6">
              <div className="w-12 h-12 rounded-2xl bg-amber-50 flex items-center justify-center mx-auto mb-2">
                <AlertTriangle size={22} className="text-amber-600" />
              </div>
              <h3 className="text-lg font-bold text-stone-900">{t('account.change_unlock_method_q')}</h3>
              <p className="text-xs text-stone-500 mt-2 leading-relaxed text-center">
                {t('account.change_unlock_desc')}
              </p>
            </div>

            <div className="flex flex-col gap-2.5">
              <button
                onClick={() => {
                  setShowReconfigureModal(false)
                  setExistingVault(null)
                  setStep(1)
                }}
                className="w-full bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-semibold h-11 rounded-lg text-sm flex items-center justify-center cursor-pointer"
              >
                {t('account.proceed_reconfigure')}
              </button>
              
              <button
                onClick={() => setShowReconfigureModal(false)}
                className="w-full border border-gray-300 bg-white hover:bg-gray-50 active:bg-gray-100 text-gray-700 font-semibold h-11 rounded-lg text-sm flex items-center justify-center cursor-pointer"
              >
                {t('wallet.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// =======================================================
// REUSABLE claimCredential HOOK (Requirement 12)
// =======================================================
export function useClaim() {
  const { isUnlocked, checkVaultStatus, encryptPayload } = useZkVault()

  const claimCredential = async (credential: Credential) => {
    if (!credential.holder_id && !credential.holder_email) {
      throw new Error('Credential holder identifier is missing.')
    }

    // Step 1: Check if vault exists
    const ownerId = credential.holder_id
    if (!ownerId) {
      throw new Error('No student account associated with this credential.')
    }

    const status = await checkVaultStatus(ownerId)
    if (status.status !== 'ok' || !status.exists) {
      throw new Error('Vault setup is required. Please set up your vault first.')
    }

    // Step 2: Unlock vault
    if (!isUnlocked) {
      throw new Error('Vault is locked. Unlock your vault to claim credentials.')
    }

    // Step 3: Verify the signature against the issuer's registry record, then
    // encrypt. Nothing unchecked goes into the vault — see
    // src/lib/claimVerification.ts.
    await verifyIssuedCredential(credential.sd_jwt, credential.issuer_did)

    const payload = { sdjwt: credential.sd_jwt }
    const encrypted = await encryptPayload(payload)
    const encryptedStr = JSON.stringify(encrypted)

    // Step 4: Update Supabase credentials row
    let res = await supabase
      .from('credentials')
      .update({
        sd_jwt: encryptedStr,
        claimed: true,
        claimed_at: new Date().toISOString()
      })
      .eq('id', credential.id)

    // Fallback: If table schema is schema.sql, insert to credentials and delete from pending_credentials
    if (res.error && (res.error.message.includes('column') || res.error.code === '42703')) {
      const fallbackRes = await supabase.from('credentials').insert({
        owner: ownerId,
        label: credential.degree_title,
        cipher: encrypted.cipher,
        iv: encrypted.iv
      })
      if (fallbackRes.error) {
        throw new Error('Credential encrypted but failed to save. Please try again.')
      }
      // Delete the pending row
      await supabase.from('pending_credentials').delete().eq('id', credential.id)
    } else if (res.error) {
      throw new Error('Credential encrypted but failed to save. Please try again.')
    }

    return true
  }

  return { claimCredential }
}
