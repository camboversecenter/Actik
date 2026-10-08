import { useState, useEffect, lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import Layout from './components/Layout'
import { VaultProvider } from './vault/zk-vault'
import HolderKeyKeeper from './components/HolderKeyKeeper'
import PresencePrompt from './components/PresencePrompt'
import { supabaseVaultAdapter } from './vault/vaultAdapter'
import { issuerVaultAdapter } from './vault/issuerVaultAdapter'



// Pages load on demand: the PDF, QR-scanning and image libraries only some
// pages need were all in one 1.3 MB bundle that had to download and parse
// before the wallet could show. Layout keeps the app shell on screen while a
// page chunk loads (see the Suspense around its <Outlet />).
const GoogleAuth = lazy(() => import('./pages/auth/GoogleAuth'))
const GoogleCallback = lazy(() => import('./pages/auth/GoogleAuth').then((m) => ({ default: m.GoogleCallback })))
const RegisterIssuer = lazy(() => import('./pages/app/RegisterIssuer'))
const IssueCredential = lazy(() => import('./pages/app/IssueCredential'))
const Wallet = lazy(() => import('./pages/app/Wallet'))
const VaultSetup = lazy(() => import('./pages/app/VaultSetup'))
const WalletKey = lazy(() => import('./pages/app/WalletKey'))
const ShareCredential = lazy(() => import('./pages/app/ShareCredential'))
const ScanCertificate = lazy(() => import('./pages/scan/ScanCertificate'))
const VerifyCredential = lazy(() => import('./pages/verify/VerifyCredential'))
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard'))
const Notifications = lazy(() => import('./pages/app/Notifications'))
const InstitutionSettings = lazy(() => import('./pages/app/InstitutionSettings'))
const Landing = lazy(() => import('./pages/public/Landing'))
const Activity = lazy(() => import('./pages/app/Activity'))
const WalletCategory = lazy(() => import('./pages/app/WalletCategory'))
const CredentialDetail = lazy(() => import('./pages/app/CredentialDetail'))
const IssuedCredentials = lazy(() => import('./pages/app/IssuedCredentials'))
const IssuedCredentialsCategory = lazy(() => import('./pages/app/IssuedCredentialsCategory'))
const Withdrawals = lazy(() => import('./pages/app/Withdrawals'))
const ReissueRequests = lazy(() => import('./pages/app/ReissueRequests'))
const ProofRequests = lazy(() => import('./pages/requests/ProofRequests'))
const NewProofRequest = lazy(() => import('./pages/requests/NewProofRequest'))
const ProofRequestDetail = lazy(() => import('./pages/requests/ProofRequestDetail'))
const ProofRequestPublic = lazy(() => import('./pages/requests/ProofRequestPublic'))
const AnswerProofRequest = lazy(() => import('./pages/requests/AnswerProofRequest'))
const Contacts = lazy(() => import('./pages/app/Contacts'))
const IssuerDashboard = lazy(() => import('./pages/app/IssuerDashboard'))

// ==========================================
// 1. Loading Screen Component
// ==========================================
export function LoadingScreen() {
  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center gap-4 bg-stone-100">
      <img src="/logo.png" alt="" className="h-10 w-auto opacity-90" />
      <div className="w-6 h-6 border-[2.5px] border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
      <p className="sr-only">Loading Actik...</p>
    </div>
  )
}

// ==========================================
// 2. Private Route Component
// ==========================================
interface RouteProps {
  children: React.ReactNode
}

export function PrivateRoute({ children }: RouteProps) {
  const [session, setSession] = useState<Session | null>(null)
  const [role, setRole] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true

    async function fetchRole(userId: string) {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', userId)
          .single()

        if (active) {
          if (!error && data) {
            setRole(data.role)
          } else {
            setRole(null)
          }
          setLoading(false)
        }
      } catch (err) {
        if (active) {
          setRole(null)
          setLoading(false)
        }
      }
    }

    // Tracks the last user id we actually fetched a role for — a plain
    // closure variable, not state, since it only needs to be read inside
    // this effect's own callbacks. onAuthStateChange fires on far more than
    // just real sign-in/sign-out (token refreshes, and in practice this
    // project has been observed re-firing SIGNED_IN every couple seconds
    // with no real change), and every one of those was triggering a fresh
    // profiles query — this guard makes that a no-op unless the signed-in
    // user actually changed.
    let lastUserId: string | null = null

    // Fetch initial session
    supabase.auth.getSession().then(({ data }) => {
      if (active) {
        setSession(data.session)
        if (data.session?.user) {
          lastUserId = data.session.user.id
          fetchRole(data.session.user.id)
        } else {
          setLoading(false)
        }
      }
    })

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      if (!active) return
      // Do NOT set loading=true here — that unmounts VaultProvider and all
      // descendant state (decryptedSDJwt, form inputs, etc.) on every token
      // refresh (which fires when the user switches back to this tab).
      // Silently refresh role without showing the loading screen.
      setSession(currentSession)
      const nextUserId = currentSession?.user?.id ?? null
      if (nextUserId === lastUserId) return
      lastUserId = nextUserId
      if (currentSession?.user) {
        fetchRole(currentSession.user.id)
      } else {
        setRole(null)
        setLoading(false)
      }
    })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  if (loading) {
    return <LoadingScreen />
  }

  if (!session) {
    return <Navigate to="/auth/login" replace />
  }

  if (role === 'admin') {
    return <Navigate to="/admin" replace />
  }

  return <>{children}</>
}

// ==========================================
// 3. Admin Route Component
// ==========================================
export function AdminRoute({ children }: RouteProps) {
  const [session, setSession] = useState<Session | null>(null)
  const [role, setRole] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true

    async function fetchRole(userId: string) {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', userId)
          .single()

        console.log('[AdminRoute] fetchRole for:', userId, 'data:', data, 'error:', error)
        if (active) {
          if (!error && data) {
            setRole(data.role)
          } else {
            setRole(null)
          }
          setLoading(false)
        }
      } catch (err) {
        if (active) {
          setRole(null)
          setLoading(false)
        }
      }
    }

    // See PrivateRoute above for why this guard exists — onAuthStateChange
    // fires far more often than real sign-in/sign-out, and without this
    // every one of those firings re-ran the profiles query.
    let lastUserId: string | null = null

    // Fetch initial session & role
    supabase.auth.getSession().then(({ data }) => {
      if (active) {
        setSession(data.session)
        if (data.session?.user) {
          lastUserId = data.session.user.id
          fetchRole(data.session.user.id)
        } else {
          setLoading(false)
        }
      }
    })

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      if (!active) return
      setSession(currentSession)
      const nextUserId = currentSession?.user?.id ?? null
      if (nextUserId === lastUserId) return
      lastUserId = nextUserId
      if (currentSession?.user) {
        fetchRole(currentSession.user.id)
      } else {
        setRole(null)
        setLoading(false)
      }
    })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  if (loading) {
    return <LoadingScreen />
  }

  if (!session) {
    return <Navigate to="/auth/login" replace />
  }

  if (role !== 'admin') {
    return <Navigate to="/app/dashboard" replace />
  }

  return <>{children}</>
}

// ==========================================
// 4. Root Redirect Component
// ==========================================
export function RootRedirect() {
  const [session, setSession] = useState<Session | null>(null)
  const [role, setRole] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true

    async function fetchRole(userId: string) {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', userId)
          .single()

        console.log('[RootRedirect] fetchRole for:', userId, 'data:', data, 'error:', error)
        if (active) {
          if (!error && data) {
            setRole(data.role)
          } else {
            setRole(null)
          }
          setLoading(false)
        }
      } catch (err) {
        if (active) {
          setRole(null)
          setLoading(false)
        }
      }
    }

    // See PrivateRoute above for why this guard exists — onAuthStateChange
    // fires far more often than real sign-in/sign-out, and without this
    // every one of those firings re-ran the profiles query.
    let lastUserId: string | null = null

    // Fetch initial session & role
    supabase.auth.getSession().then(({ data }) => {
      if (active) {
        setSession(data.session)
        if (data.session?.user) {
          lastUserId = data.session.user.id
          fetchRole(data.session.user.id)
        } else {
          setLoading(false)
        }
      }
    })

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      if (!active) return
      setSession(currentSession)
      const nextUserId = currentSession?.user?.id ?? null
      if (nextUserId === lastUserId) return
      lastUserId = nextUserId
      if (currentSession?.user) {
        fetchRole(currentSession.user.id)
      } else {
        setRole(null)
        setLoading(false)
      }
    })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  if (loading) {
    return <LoadingScreen />
  }

  if (!session) {
    return <Landing />
  }

  // Redirect based on user role
  if (role === 'admin') {
    return <Navigate to="/admin" replace />
  }
  if (role === 'issuer') {
    return <Navigate to="/app/dashboard" replace />
  }
  if (role === 'student') {
    return <Navigate to="/app/wallet" replace />
  }

  // Default redirect if role is unknown or not set
  return <Navigate to="/app/dashboard" replace />
}

// ==========================================
// 5. Main App Component
// ==========================================
export default function App() {
  // Once the first screen is up, warm the chunks for the main tabs so
  // switching between them never waits on the network.
  useEffect(() => {
    const warm = () => {
      import('./pages/app/Wallet'); import('./pages/app/Activity'); import('./pages/app/Contacts')
      import('./pages/requests/ProofRequests'); import('./pages/app/VaultSetup'); import('./pages/app/CredentialDetail')
      import('./pages/app/IssuerDashboard'); import('./pages/app/IssuedCredentials'); import('./pages/app/InstitutionSettings')
    }
    const ric = (window as any).requestIdleCallback as ((cb: () => void) => number) | undefined
    const id = ric ? ric(warm) : window.setTimeout(warm, 1500)
    return () => { if (!ric) window.clearTimeout(id) }
  }, [])

  return (
    <BrowserRouter>
      <Suspense fallback={<LoadingScreen />}>
      <Routes>
        {/* Root redirect route */}
        <Route path="/" element={<RootRedirect />} />

        {/* A proof request, as anyone with its link sees it */}
        <Route path="/request/:id" element={<ProofRequestPublic />} />

        {/* Public auth routes */}
        <Route path="/auth/login" element={<GoogleAuth />} />
        <Route path="/auth/callback" element={<GoogleCallback />} />

        {/* Authenticated app routes */}
        <Route
          path="/app"
          element={
            <PrivateRoute>
              <VaultProvider
                storageAdapter={supabaseVaultAdapter}
                lockOnWindowBlur={false}
                autoLockTimeoutMs={1800000}
              >
                <HolderKeyKeeper />
                <PresencePrompt />
                <Layout />
              </VaultProvider>
            </PrivateRoute>
          }
        >
          {/* Issuer routes get their own nested vault, scoped to the signing
              key, distinct from the holder wallet vault wrapping all of
              /app above. Nearest VaultProvider wins, so useZkVault() inside
              these 3 pages resolves here without affecting any other route. */}
          <Route
            element={
              <VaultProvider
                storageAdapter={issuerVaultAdapter}
                lockOnWindowBlur={false}
                autoLockTimeoutMs={1800000}
              >
                <Outlet />
              </VaultProvider>
            }
          >
            <Route path="dashboard" element={<IssuerDashboard />} />
            <Route path="register-issuer" element={<RegisterIssuer />} />
            <Route path="issue" element={<IssueCredential />} />
            {/* institution-settings needs the issuer signing-key vault too —
                its Danger Zone (regenerate signing key) lives there. */}
            <Route path="institution-settings" element={<InstitutionSettings />} />
          </Route>
          <Route path="issued" element={<IssuedCredentials />} />
          <Route path="issued/type/:credentialType" element={<IssuedCredentialsCategory />} />
          <Route path="withdrawals" element={<Withdrawals />} />
          <Route path="reissue-requests" element={<ReissueRequests />} />
          {/* Student routes */}
          <Route path="wallet" element={<Wallet />} />
          <Route path="wallet/type/:credentialType" element={<WalletCategory />} />
          <Route path="credential/:id" element={<CredentialDetail />} />
          <Route path="vault-setup" element={<VaultSetup />} />
          <Route path="wallet-key" element={<WalletKey />} />
          <Route path="contacts" element={<Contacts />} />
          <Route path="share/:credentialId" element={<ShareCredential />} />
          <Route path="notifications" element={<Notifications />} />
          <Route path="activity" element={<Activity />} />
          {/* Proof requests: any signed-in account may ask, and any may answer. */}
          <Route path="requests" element={<ProofRequests />} />
          <Route path="requests/new" element={<NewProofRequest />} />
          <Route path="requests/:id" element={<ProofRequestDetail />} />
          <Route path="answer/:id" element={<AnswerProofRequest />} />
          <Route path="*" element={<Navigate to="/app/dashboard" replace />} />
        </Route>

        {/* Admin routes */}
        <Route
          path="/admin"
          element={
            <AdminRoute>
              <Layout />
            </AdminRoute>
          }
        >
          <Route index element={<AdminDashboard />} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Route>

        {/* Public verification route */}
        <Route path="/verify/:token" element={<VerifyCredential />} />

        {/* Printed certificates: scanned and verified in this app, never in a browser */}
        <Route path="/scan" element={<ScanCertificate />} />

        {/* Global fallback route */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
    </BrowserRouter>
  )
}

