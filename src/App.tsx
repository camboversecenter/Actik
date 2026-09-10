import { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import Layout from './components/Layout'
import GoogleAuth, { GoogleCallback } from './pages/auth/GoogleAuth'
import RegisterIssuer from './pages/app/RegisterIssuer'
import IssueCredential from './pages/app/IssueCredential'
import Wallet from './pages/app/Wallet'
import VaultSetup from './pages/app/VaultSetup'
import ShareCredential from './pages/app/ShareCredential'
import VerifyCredential from './pages/verify/VerifyCredential'
import AdminDashboard from './pages/admin/AdminDashboard'
import Notifications from './pages/app/Notifications'
import InstitutionSettings from './pages/app/InstitutionSettings'
import Landing from './pages/public/Landing'
import Activity from './pages/app/Activity'
import WalletCategory from './pages/app/WalletCategory'
import CredentialDetail from './pages/app/CredentialDetail'
import IssuedCredentials from './pages/app/IssuedCredentials'
import IssuedCredentialsCategory from './pages/app/IssuedCredentialsCategory'
import { VaultProvider } from './vault/zk-vault'
import { supabaseVaultAdapter } from './vault/vaultAdapter'
import { issuerVaultAdapter } from './vault/issuerVaultAdapter'

// ==========================================
// 6. Placeholder Page Components
// ==========================================
import IssuerDashboard from './pages/app/IssuerDashboard'

// ==========================================
// 1. Loading Screen Component
// ==========================================
export function LoadingScreen() {
  const spinnerStyle = `
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
  `
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', backgroundColor: 'var(--paper)', fontFamily: 'inherit' }}>
      <style>{spinnerStyle}</style>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
        <div style={{
          width: 44,
          height: 44,
          border: '4px solid var(--forest-soft)',
          borderTop: '4px solid var(--forest)',
          borderRadius: '50%',
          animation: 'spin 1s linear infinite'
        }}></div>
        <p style={{ color: 'var(--forest)', fontWeight: 500, fontSize: '1.1rem', margin: 0 }}>Loading Actik...</p>
      </div>
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
  useEffect(() => {
  }, [])

  return (
    <BrowserRouter>
      <Routes>
        {/* Root redirect route */}
        <Route path="/" element={<RootRedirect />} />

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
          {/* Student routes */}
          <Route path="wallet" element={<Wallet />} />
          <Route path="wallet/type/:credentialType" element={<WalletCategory />} />
          <Route path="credential/:id" element={<CredentialDetail />} />
          <Route path="vault-setup" element={<VaultSetup />} />
          <Route path="share/:credentialId" element={<ShareCredential />} />
          <Route path="notifications" element={<Notifications />} />
          <Route path="activity" element={<Activity />} />
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

        {/* Global fallback route */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

