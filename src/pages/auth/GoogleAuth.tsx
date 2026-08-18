import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { checkRateLimit, getClientIp } from '../../lib/rateLimit'

// Message types posted from the /auth/callback popup back to this window
const AUTH_COMPLETE = 'actik-auth-complete'
const AUTH_ERROR = 'actik-auth-error'

// Shared keyframe spinner animation
const spinStyles = `
  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
`

// =========================================================
// 1. GoogleAuth Component (Default Export)
// =========================================================
export default function GoogleAuth() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const popupRef = useRef<Window | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopWatchingPopup = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }

  // Redirect logged-in users immediately on mount
  useEffect(() => {
    let active = true
    async function checkExistingSession() {
      const { data: { session } } = await supabase.auth.getSession()
      if (session && session.user && active) {
        // Fetch role to send to correct dashboard
        const { data } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', session.user.id)
          .single()

        if (!active) return

        const role = data?.role
        if (role === 'admin') navigate('/admin', { replace: true })
        else if (role === 'issuer') navigate('/app/dashboard', { replace: true })
        else if (role === 'student') navigate('/app/wallet', { replace: true })
        else navigate('/app/dashboard', { replace: true })
      }
    }
    checkExistingSession()
    return () => { active = false }
  }, [navigate])

  // Listen for the popup posting back its result
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return
      const data = event.data
      if (!data || typeof data !== 'object') return

      if (data.type === AUTH_COMPLETE) {
        stopWatchingPopup()
        popupRef.current = null
        navigate(data.target || '/app/dashboard', { replace: true })
      } else if (data.type === AUTH_ERROR) {
        stopWatchingPopup()
        popupRef.current = null
        setErrorMsg(data.message || 'Sign in failed. Please try again.')
        setLoading(false)
      }
    }
    window.addEventListener('message', handleMessage)
    return () => {
      window.removeEventListener('message', handleMessage)
      stopWatchingPopup()
    }
  }, [navigate])

  const openAuthPopup = (url: string): Window | null => {
    const width = 480
    const height = 640
    const left = window.screenX + (window.outerWidth - width) / 2
    const top = window.screenY + (window.outerHeight - height) / 2
    return window.open(
      url,
      'actik-google-auth',
      `width=${width},height=${height},left=${left},top=${top}`
    )
  }

  const handleGoogleSignIn = async () => {
    setLoading(true)
    setErrorMsg(null)

    // Open the popup synchronously, inside the click handler, so browser
    // popup blockers see it as user-initiated. We point it at the real URL
    // once we've fetched it below.
    const popup = openAuthPopup('about:blank')

    try {
      const clientIp = getClientIp() || 'unknown'
      const limit = await checkRateLimit(clientIp, 'auth/login', 5, 15)

      if (!limit.allowed) {
        if (popup && !popup.closed) popup.close()
        setErrorMsg(`Too many login attempts. Try again in ${Math.ceil((limit.resetTime - Date.now()) / 60000)} minutes.`)
        setLoading(false)
        return
      }

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin + '/auth/callback',
          queryParams: { prompt: 'select_account' },
          skipBrowserRedirect: true,
        },
      })
      if (error) throw error
      if (!data?.url) throw new Error('No auth URL returned')

      if (popup && !popup.closed) {
        popup.location.href = data.url
        popupRef.current = popup
        popup.focus()

        stopWatchingPopup()
        pollRef.current = setInterval(() => {
          // Cross-origin popups under COOP can make `.closed` throw/warn —
          // treat that as "can't tell yet" rather than crashing the poll.
          let closed = false
          try {
            closed = popup.closed
          } catch {
            return
          }
          if (closed) {
            stopWatchingPopup()
            popupRef.current = null
            setLoading(false)
          }
        }, 500)
      } else {
        // Popup blocked by the browser — fall back to a full-page redirect
        window.location.href = data.url
      }
    } catch (err: unknown) {
      if (popup && !popup.closed) popup.close()
      setErrorMsg('Sign in failed. Please try again.')
      setLoading(false)
    }
  }

  const handleCancelSignIn = () => {
    stopWatchingPopup()
    if (popupRef.current && !popupRef.current.closed) {
      popupRef.current.close()
    }
    popupRef.current = null
    setLoading(false)
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 p-4 md:p-6">
      <style>{spinStyles}</style>
      
      <div className="w-full max-w-md p-6 md:p-8 text-center bg-transparent md:bg-white md:rounded-xl md:shadow-sm md:border md:border-gray-200">
        {/* Actik Logo */}
        <div className="flex justify-center mb-4">
          <img src="/logo.png" alt="Actik Logo" className="h-20 md:h-24 w-auto" />
        </div>

        {/* Tagline */}
        <p className="text-xs text-gray-500 uppercase tracking-wider mb-6">
          Proof of ownership
        </p>

        {/* Divider */}
        <div className="h-[1px] bg-gray-200 mb-6 hidden md:block" />

        {/* Heading & Subtext */}
        <h2 className="text-2xl font-semibold text-gray-900 mb-2 mt-8 md:mt-0">
          Welcome
        </h2>
        <p className="text-sm text-gray-500 mb-8">
          Sign in with your Google account to continue
        </p>

        {/* Google sign-in button — Google's own account chooser (with
            "Use another account") handles account selection natively */}
        <button
          onClick={() => handleGoogleSignIn()}
          disabled={loading}
          className="w-full flex items-center justify-center gap-3 bg-white hover:bg-gray-50 active:bg-gray-100 border border-gray-300 text-gray-700 font-semibold h-[52px] rounded-lg shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 cursor-pointer"
        >
          {loading ? (
            <svg
              style={{ animation: 'spin 1s linear infinite', width: 18, height: 18, color: '#4b5563' }}
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle style={{ opacity: 0.25 }} cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path style={{ opacity: 0.75 }} fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 48 48" style={{ display: 'block' }}>
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.08 17.74 9.5 24 9.5z"/>
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-3.58-13.46-8.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
              <path fill="none" d="M0 0h48v48H0z"/>
            </svg>
          )}
          <span>Continue with Google</span>
        </button>

        {/* Cancel button — shown while the Google popup is open */}
        {loading && (
          <button
            onClick={handleCancelSignIn}
            className="text-sm text-gray-500 hover:text-gray-700 mt-4 cursor-pointer underline"
          >
            Cancel
          </button>
        )}

        {/* Error message */}
        {errorMsg && (
          <p className="text-sm text-red-600 mt-4 font-medium">
            {errorMsg}
          </p>
        )}

        {/* Legitimate use reminder */}
        <p className="text-xs text-gray-400 mt-8 leading-relaxed">
          By signing in you agree to use this platform for legitimate credential purposes only
        </p>
      </div>
    </div>
  )
}

// =========================================================
// 2. GoogleCallback Component (Named Export)
// =========================================================
export function GoogleCallback() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [currentUser, setCurrentUser] = useState<any | null>(null)
  const [showRoleModal, setShowRoleModal] = useState(false)
  const [selectedRole, setSelectedRole] = useState<'student' | 'issuer' | null>(null)
  const [savingRole, setSavingRole] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [debugError, setDebugError] = useState<string | null>(null)

  // When opened as a popup (see GoogleAuth), report the result back to the
  // opener window instead of navigating this window, then close.
  const isPopup = typeof window !== 'undefined' && !!window.opener && window.opener !== window

  const finishAuth = (target: string) => {
    if (isPopup) {
      window.opener?.postMessage({ type: AUTH_COMPLETE, target }, window.location.origin)
      window.close()
    } else {
      navigate(target, { replace: true })
    }
  }

  const failAuth = (message?: string) => {
    if (isPopup) {
      window.opener?.postMessage({ type: AUTH_ERROR, message }, window.location.origin)
      window.close()
    } else {
      navigate('/auth/login?error=session_failed', { replace: true })
    }
  }

  useEffect(() => {
    let active = true
    let unsubscribeFn: (() => void) | null = null
    let timer: ReturnType<typeof setTimeout> | null = null

    // Check for explicit error query/hash params from Google/Supabase
    const searchParams = new URLSearchParams(window.location.search)
    const hashParams = new URLSearchParams(window.location.hash.substring(1))
    const oauthError = searchParams.get('error') || hashParams.get('error')
    const oauthDesc = searchParams.get('error_description') || hashParams.get('error_description')
    if (oauthError || oauthDesc) {
      setDebugError(`OAuth Redirect Error: ${oauthError || 'Unknown error'}\nDescription: ${oauthDesc || 'No description provided'}`)
    }

    // Set up global error logging in window
    const handleError = (e: ErrorEvent) => {
      setDebugError(prev => (prev ? prev + '\n' : '') + `Runtime Error: ${e.message}`);
    }
    const handleRejection = (e: PromiseRejectionEvent) => {
      setDebugError(prev => (prev ? prev + '\n' : '') + `Promise Rejection: ${e.reason?.message || String(e.reason)}`);
    }
    window.addEventListener('error', handleError)
    window.addEventListener('unhandledrejection', handleRejection)

    async function processSession(session: any) {
      try {
        setCurrentUser(session.user)

        // Query profiles role
        const { data, error: profileError } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', session.user.id)
          .single()

        if (!active) return

        // If user already has a role set, redirect them directly
        if (!profileError && data && data.role) {
          const role = data.role
          let target = '/app/dashboard'
          if (role === 'admin') target = '/admin'
          else if (role === 'issuer') target = '/app/dashboard'
          else if (role === 'student') target = '/app/wallet'
          finishAuth(target)
        } else {
          // No role set yet -> show role selector modal (popup stays open for this)
          setShowRoleModal(true)
          setLoading(false)
        }
      } catch (err) {
        console.error('[GoogleCallback] Error during processSession:', err)
        setDebugError(`processSession Exception: ${err instanceof Error ? err.message : String(err)}`)
        if (active) {
          setTimeout(() => {
            if (active) failAuth('Sign in failed. Please try again.')
          }, 8000)
        }
      }
    }

    async function handleAuthCallback() {
      try {
        // 1. Check if session is already present
        const { data: { session }, error: sessionError } = await supabase.auth.getSession()
        if (sessionError) {
          console.error('[GoogleCallback] getSession returned error:', sessionError)
          setDebugError(`getSession Error: ${sessionError.message} (${sessionError.status || 'no status'})`)
          if (active) {
            setTimeout(() => {
              if (active) failAuth('Sign in failed. Please try again.')
            }, 8000)
          }
          return
        }

        if (session) {
          await processSession(session)
          return
        }

        // 2. If no session is present, wait for a SIGNED_IN event (since Supabase is processing the URL hash/code asynchronously)
        const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, currentSession) => {
          if (!active) return
          if (currentSession) {
            if (unsubscribeFn) unsubscribeFn()
            if (timer) clearTimeout(timer)
            await processSession(currentSession)
          }
        })
        unsubscribeFn = subscription.unsubscribe

        // 3. Fallback timeout: if after 8 seconds still no session, redirect to login
        timer = setTimeout(() => {
          if (active) {
            console.warn('[GoogleCallback] 8-second timeout reached: no active session received from Supabase OAuth Callback.')
            setDebugError('Timeout reached (8 seconds): No session was received. Please check if your Google OAuth configuration or Redirect URLs are fully allowed in your Supabase Dashboard.')
            if (unsubscribeFn) unsubscribeFn()
            setTimeout(() => {
              if (active) failAuth('Sign in timed out. Please try again.')
            }, 10000)
          }
        }, 8000)
      } catch (err) {
        console.error('[GoogleCallback] Error inside handleAuthCallback:', err)
        setDebugError(`handleAuthCallback Exception: ${err instanceof Error ? err.message : String(err)}`)
        if (active) {
          setTimeout(() => {
            if (active) failAuth('Sign in failed. Please try again.')
          }, 8000)
        }
      }
    }

    handleAuthCallback()

    return () => {
      active = false
      if (timer) clearTimeout(timer)
      if (unsubscribeFn) unsubscribeFn()
      window.removeEventListener('error', handleError)
      window.removeEventListener('unhandledrejection', handleRejection)
    }
  }, [navigate])

  const handleSaveRole = async () => {
    if (!selectedRole || !currentUser) return
    try {
      setSavingRole(true)
      setSaveError(null)

      // Use upsert to guarantee the row is either created or updated
      const { error: upsertError } = await supabase
        .from('profiles')
        .upsert({ 
          id: currentUser.id, 
          email: currentUser.email, 
          role: selectedRole 
        }, { onConflict: 'id' })

      if (upsertError) {
        console.error('[handleSaveRole] upsert error:', upsertError)
        setSaveError(`Error: ${upsertError.message}`)
        setSavingRole(false)
        return
      }

      // Redirect based on the newly saved role
      if (selectedRole === 'student') {
        finishAuth('/app/wallet')
      } else {
        finishAuth('/app/dashboard')
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[handleSaveRole] unexpected error:', err)
      setSaveError(`Failed to save role: ${msg}`)
      setSavingRole(false)
    }
  }

  // Completing Sign-In Loading Page
  if (loading) {
    return (
      <div 
        className="flex flex-col items-center justify-center min-h-screen bg-gray-50 p-6"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          backgroundColor: '#f9fafb',
          fontFamily: 'inherit'
        }}
      >
        <style>{spinStyles}</style>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem', width: '100%', maxWidth: '450px', textAlign: 'center' }}>
          <div style={{
            width: 44,
            height: 44,
            border: '4px solid #e0e7ff',
            borderTop: '4px solid #4f46e5',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite'
          }}></div>
          <p style={{ color: '#4b5563', fontWeight: 500, fontSize: '1.1rem', margin: 0 }}>
            Completing sign in...
          </p>
          {debugError && (
            <div className="mt-6 p-4 w-full bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs font-mono text-left whitespace-pre-wrap shadow-sm">
              <strong className="block text-red-800 mb-1">Callback Debug Info:</strong>
              {debugError}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-stretch md:items-center justify-end md:justify-center p-0 md:p-4">
      <style>{spinStyles}</style>

      {/* Role Selector Modal */}
      {showRoleModal && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-stretch md:items-center justify-end md:justify-center p-0 md:p-4 z-50 flex-col">
          <div className="bg-white rounded-t-2xl md:rounded-xl shadow-lg border border-gray-100 p-6 md:p-8 max-w-md w-full flex flex-col justify-between md:justify-start pb-8 md:pb-8">
            <div>
              {/* Modal Headers */}
              <h3 className="text-xl font-semibold text-gray-900 mb-1">
                One more step
              </h3>
              <p className="text-sm text-gray-500 mb-6">
                Tell us how you will use Actik
              </p>

              {/* Role Options */}
              <div className="flex flex-col md:flex-row gap-4 mb-6">
                
                {/* Option A: Student */}
                <div
                  onClick={() => setSelectedRole('student')}
                  className={`flex-1 p-4 border rounded-lg cursor-pointer transition-all flex flex-row md:flex-col items-center gap-4 md:gap-2 text-left md:text-center ${
                    selectedRole === 'student' ? 'border-2 border-indigo-600 bg-indigo-50/50' : 'border-gray-300 bg-white active:bg-gray-100'
                  }`}
                >
                  {/* Graduation Cap Icon */}
                  <div className="text-3xl md:text-4xl">🎓</div>
                  <div>
                    <h4 className="text-sm md:text-base font-semibold text-gray-900 mb-0.5">Student</h4>
                    <p className="text-xs text-gray-500 leading-normal">
                      Receive and share digital certificates from your institution
                    </p>
                  </div>
                </div>

                {/* Option B: Issuer */}
                <div
                  onClick={() => setSelectedRole('issuer')}
                  className={`flex-1 p-4 border rounded-lg cursor-pointer transition-all flex flex-row md:flex-col items-center gap-4 md:gap-2 text-left md:text-center ${
                    selectedRole === 'issuer' ? 'border-2 border-indigo-600 bg-indigo-50/50' : 'border-gray-300 bg-white active:bg-gray-100'
                  }`}
                >
                  {/* Institution Building Icon */}
                  <div className="text-3xl md:text-4xl">🏛️</div>
                  <div>
                    <h4 className="text-sm md:text-base font-semibold text-gray-900 mb-0.5">Institution</h4>
                    <p className="text-xs text-gray-500 leading-normal">
                      Issue certificates to students on behalf of a university
                    </p>
                  </div>
                </div>

              </div>

              {/* Error Message */}
              {saveError && (
                <p className="text-sm text-red-600 mb-4 font-medium">
                  {saveError}
                </p>
              )}
            </div>

            {/* Continue Button */}
            <button
              onClick={handleSaveRole}
              disabled={!selectedRole || savingRole}
              className={`w-full text-white font-semibold h-[52px] rounded-lg transition-all flex items-center justify-center gap-2 ${
                selectedRole ? 'bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 cursor-pointer' : 'bg-gray-200 text-gray-400 cursor-not-allowed'
              }`}
            >
              {savingRole && (
                <svg 
                  style={{ animation: 'spin 1s linear infinite', width: 16, height: 16, color: '#ffffff' }} 
                  fill="none" 
                  viewBox="0 0 24 24"
                >
                  <circle style={{ opacity: 0.25 }} cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path style={{ opacity: 0.75 }} fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              )}
              <span>Continue</span>
            </button>

          </div>
        </div>
      )}
    </div>
  )
}
