// Shared "your signing key isn't loaded in this session" gate for issuer
// pages. Replaces the two previous ad-hoc screens (Dashboard's "Cryptographic
// Signing Key Expired" and Issue's "Signing Session Expired") with one flow
// that recovers the key from the issuer-scoped zk-vault instead of forcing a
// fresh keypair (and a broken trust chain) every session.

import { useState, useEffect, useCallback } from 'react'
import type { JWK } from 'jose'
import { Loader2, Key, AlertCircle, ShieldCheck } from 'lucide-react'
import { useZkVault } from '../vault/zk-vault/hooks'
import type { EncryptedPayload } from '../vault/zk-vault/crypto'
import { supabase } from '../lib/supabase'
import { generateIssuerKeys } from '../lib/did'

const MIN_LEN = 8
const LOCKOUT_AFTER = 3

function lockoutKey(userId: string) {
  return `issuer-vault:lockout:${userId}`
}
function readLockout(userId: string): { until: number; attempts: number } {
  try {
    const raw = sessionStorage.getItem(lockoutKey(userId))
    if (raw) return JSON.parse(raw)
  } catch {
    /* ignore */
  }
  return { until: 0, attempts: 0 }
}
function writeLockout(userId: string, until: number, attempts: number) {
  try {
    sessionStorage.setItem(lockoutKey(userId), JSON.stringify({ until, attempts }))
  } catch {
    /* ignore */
  }
}
function clearLockout(userId: string) {
  try {
    sessionStorage.removeItem(lockoutKey(userId))
  } catch {
    /* ignore */
  }
}

function scorePasscode(pc: string): { label: string; pct: number; tone: string } {
  let score = 0
  if (pc.length >= MIN_LEN) score++
  if (pc.length >= 12) score++
  if (/[a-z]/.test(pc) && /[A-Z]/.test(pc)) score++
  if (/\d/.test(pc)) score++
  if (/[^A-Za-z0-9]/.test(pc)) score++
  const pct = Math.min(100, (score / 5) * 100)
  if (score <= 1) return { label: 'Weak', pct, tone: 'bg-red-400' }
  if (score <= 3) return { label: 'Fair', pct, tone: 'bg-amber-400' }
  return { label: 'Strong', pct, tone: 'bg-green-500' }
}

function isMissingColumnError(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false
  return !!(error.message?.includes('owner') || error.code === 'PGRST204' || error.code === '42703')
}

async function fetchCiphertext(userId: string): Promise<EncryptedPayload | null> {
  let { data, error } = await supabase
    .from('issuers')
    .select('signing_key_ciphertext')
    .eq('owner', userId)
    .maybeSingle()

  if (isMissingColumnError(error)) {
    const fallback = await supabase
      .from('issuers')
      .select('signing_key_ciphertext')
      .eq('user_id', userId)
      .maybeSingle()
    data = fallback.data
    error = fallback.error
  }
  if (error) throw error
  return (data?.signing_key_ciphertext as EncryptedPayload | undefined) ?? null
}

async function persistKey(userId: string, publicJwk: JWK, ciphertext: EncryptedPayload) {
  let { error } = await supabase
    .from('issuers')
    .update({ public_jwk: publicJwk, signing_key_ciphertext: ciphertext })
    .eq('owner', userId)

  if (isMissingColumnError(error)) {
    ;({ error } = await supabase
      .from('issuers')
      .update({ public_key: JSON.stringify(publicJwk), signing_key_ciphertext: ciphertext })
      .eq('user_id', userId))
  }
  if (error) throw error
}

interface IssuerKeyUnlockProps {
  userId: string
  userEmail: string
  did: string
  onUnlocked: (privateJwk: JWK, did: string) => void
  /** Fires only on the legacy/incomplete first-time-setup path, so the parent can refresh its cached public key. */
  onKeyRegenerated?: (newPublicJwk: JWK) => void
}

type Phase = 'checking' | 'status_error' | 'setup' | 'unlock'

export default function IssuerKeyUnlock({ userId, userEmail, did, onUnlocked, onKeyRegenerated }: IssuerKeyUnlockProps) {
  const { checkVaultStatus, setupVault, unlockWithPin, encryptPayload, decryptPayload } = useZkVault()

  const [phase, setPhase] = useState<Phase>('checking')
  const [setupReason, setSetupReason] = useState<'legacy' | 'incomplete'>('legacy')
  const [pin, setPin] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const initialLockout = readLockout(userId)
  const [attempts, setAttempts] = useState(initialLockout.attempts)
  const [lockoutUntil, setLockoutUntil] = useState(initialLockout.until)
  const [remainingLockout, setRemainingLockout] = useState(
    Math.max(0, Math.ceil((initialLockout.until - Date.now()) / 1000))
  )

  const runStatusCheck = useCallback(async () => {
    setPhase('checking')
    setError(null)
    const status = await checkVaultStatus(userId)
    if (status.status === 'error') {
      setPhase('status_error')
      return
    }
    if (!status.hasPin) {
      setSetupReason('legacy')
      setPhase('setup')
      return
    }
    setPhase('unlock')
  }, [checkVaultStatus, userId])

  useEffect(() => {
    runStatusCheck()
  }, [runStatusCheck])

  useEffect(() => {
    if (lockoutUntil <= 0) return
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((lockoutUntil - Date.now()) / 1000))
      setRemainingLockout(remaining)
      if (remaining <= 0) setError(null)
    }
    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [lockoutUntil])

  const strength = scorePasscode(pin)

  const handleSetup = async (e: React.FormEvent) => {
    e.preventDefault()
    if (pin.length < MIN_LEN || isProcessing) return
    setIsProcessing(true)
    setError(null)
    try {
      const { publicJwk, privateJwk } = await generateIssuerKeys()
      const ok = await setupVault(pin, userId, userEmail, { skipPasskey: true })
      if (!ok) throw new Error('Failed to secure your signing key. Please try again.')

      const ciphertext = await encryptPayload(privateJwk)
      await persistKey(userId, publicJwk, ciphertext)

      sessionStorage.setItem('issuer_private_key', JSON.stringify(privateJwk))
      sessionStorage.setItem('issuer_did', did)
      clearLockout(userId)

      onKeyRegenerated?.(publicJwk)
      onUnlocked(privateJwk, did)
    } catch (err: any) {
      setError(err.message || 'Failed to set up your signing PIN. Please try again.')
    } finally {
      setIsProcessing(false)
    }
  }

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault()
    if (pin.length < MIN_LEN || isProcessing || remainingLockout > 0) return
    setIsProcessing(true)
    setError(null)

    try {
      const ciphertext = await fetchCiphertext(userId)
      if (!ciphertext) {
        // A PIN envelope exists but the key payload itself never got saved —
        // treat as an incomplete setup rather than attempting a decrypt.
        setSetupReason('incomplete')
        setPhase('setup')
        setPin('')
        setIsProcessing(false)
        return
      }

      const ok = await unlockWithPin(pin, userId)
      if (!ok) {
        const newAttempts = attempts + 1
        setAttempts(newAttempts)
        setPin('')

        if (newAttempts >= LOCKOUT_AFTER) {
          const backoffMs = Math.min(Math.pow(2, newAttempts - LOCKOUT_AFTER) * 1000, 30000)
          const until = Date.now() + backoffMs
          setLockoutUntil(until)
          setRemainingLockout(Math.ceil(backoffMs / 1000))
          writeLockout(userId, until, newAttempts)
          setError(`Too many attempts. Try again in ${Math.ceil(backoffMs / 1000)}s.`)
        } else {
          writeLockout(userId, 0, newAttempts)
          setError('Incorrect PIN.')
        }
        setIsProcessing(false)
        return
      }

      setAttempts(0)
      clearLockout(userId)
      const decrypted = (await decryptPayload(ciphertext)) as JWK
      sessionStorage.setItem('issuer_private_key', JSON.stringify(decrypted))
      sessionStorage.setItem('issuer_did', did)
      onUnlocked(decrypted, did)
    } catch (err: any) {
      setError(err.message || "Couldn't unlock your signing key. Try again, or use Regenerate signing key if the problem persists.")
    } finally {
      setIsProcessing(false)
    }
  }

  if (phase === 'checking') {
    return (
      <div className="bg-white rounded-2xl border border-stone-200 p-8 shadow-sm flex flex-col items-center text-center py-16">
        <Loader2 className="animate-spin text-stone-400 mb-3" size={28} />
        <p className="text-sm text-stone-500">Checking your signing key...</p>
      </div>
    )
  }

  if (phase === 'status_error') {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-red-300 border-l-4 p-6 md:p-8">
        <h2 className="text-lg font-bold text-red-700 mb-2">Couldn&apos;t check your signing key</h2>
        <p className="text-sm text-stone-500 mb-4 leading-relaxed">
          Something went wrong reaching your account. Please try again.
        </p>
        <button
          onClick={runStatusCheck}
          className="w-full bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-semibold h-11 rounded-lg text-sm transition-all cursor-pointer"
        >
          Retry
        </button>
      </div>
    )
  }

  if (phase === 'setup') {
    return (
      <div className="bg-amber-50 border-l-4 border-amber-500 rounded-xl p-6 md:p-8 shadow-sm">
        <div className="flex items-start gap-4">
          <div className="text-3xl mt-0.5">🔑</div>
          <div className="w-full">
            <h2 className="text-lg font-bold text-amber-800">Set up your signing PIN</h2>
            <p className="text-sm text-stone-600 mt-2 leading-relaxed">
              {setupReason === 'legacy'
                ? 'This is a one-time step: choose a PIN to protect your signing key so it survives closing this tab. This is the last time you’ll need to (re)generate it.'
                : 'Your signing key setup looks incomplete. Choose a PIN to finish protecting it.'}
            </p>

            <form onSubmit={handleSetup} className="mt-4 space-y-3">
              <div className="relative max-w-xs">
                <input
                  type="password"
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  placeholder={`Create a ${MIN_LEN}+ character PIN`}
                  autoComplete="new-password"
                  disabled={isProcessing}
                  className="w-full bg-white border border-stone-200 focus:border-indigo-500 rounded-lg px-4 py-3 text-sm focus:outline-none transition-all disabled:opacity-50"
                />
              </div>

              {pin.length > 0 && (
                <div className="max-w-xs space-y-1">
                  <div className="h-1.5 w-full bg-stone-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${strength.tone} transition-all duration-300`}
                      style={{ width: `${strength.pct}%` }}
                    />
                  </div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400 text-right">
                    {strength.label}
                  </p>
                </div>
              )}

              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg p-3 font-semibold">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={pin.length < MIN_LEN || isProcessing}
                className="bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-semibold h-11 px-6 rounded-lg text-sm transition-all focus:outline-none flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {isProcessing && <Loader2 size={16} className="animate-spin" />}
                <span>Set up signing PIN</span>
              </button>
            </form>
          </div>
        </div>
      </div>
    )
  }

  // phase === 'unlock'
  const isLockedOut = remainingLockout > 0
  return (
    <div className="bg-white rounded-xl shadow-sm border border-stone-200 p-6 md:p-8">
      <div className="flex items-start gap-4">
        <div className="inline-flex w-11 h-11 bg-stone-100 text-stone-700 rounded-xl items-center justify-center shrink-0">
          <ShieldCheck size={22} />
        </div>
        <div className="w-full">
          <h2 className="text-lg font-bold text-stone-900">Enter your signing PIN</h2>
          <p className="text-sm text-stone-500 mt-2 leading-relaxed">
            Your signing key is protected and not loaded in this browser session. Enter your PIN to unlock it.
          </p>

          <form onSubmit={handleUnlock} className="mt-4 space-y-3">
            <div className="relative max-w-xs">
              <input
                type="password"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="Enter your signing PIN"
                autoComplete="current-password"
                disabled={isProcessing || isLockedOut}
                className="w-full bg-stone-50 border border-stone-200 focus:border-indigo-500 rounded-lg pl-10 pr-4 py-3 text-sm focus:outline-none transition-all disabled:opacity-50"
              />
              <Key size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-stone-400" />
            </div>

            {error && (
              <div className="flex items-center gap-1.5 text-red-600">
                <AlertCircle size={14} />
                <p className="text-xs font-semibold">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={pin.length < MIN_LEN || isProcessing || isLockedOut}
              className="bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-semibold h-11 px-6 rounded-lg text-sm transition-all focus:outline-none flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {isProcessing ? (
                <Loader2 size={16} className="animate-spin" />
              ) : isLockedOut ? (
                `Locked out (${remainingLockout}s)`
              ) : (
                <span>Unlock</span>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
