import { useEffect, useState } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useLanguage } from '../lib/i18n'
import { Session } from '@supabase/supabase-js'
import { getIssuerKey, subscribeIssuerKey, forgetIssuerKey } from '../lib/issuerKeyStore'
import { forgetHolderKey } from '../lib/holderKey'
import { supabase } from '../lib/supabase'
import NotificationsBell from './NotificationsBell'
import InstallPwaButton from './InstallPwaButton'
import {
  Wallet, Activity, Fingerprint, LayoutDashboard, FileSignature, Settings,
  ShieldCheck, LogOut, Building2, Lock, Briefcase, UserCheck,
} from 'lucide-react'

export default function Layout() {
  const [session, setSession] = useState<Session | null>(null)
  const [role, setRole] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  // Sidebar institution card (issuer role only) — name + accreditation
  // status, purely for the sidebar chip; not used anywhere else in this
  // component, so kept separate from the role-fetch effect above rather
  // than folding it into that shared, more heavily-relied-on state.
  const [issuerCard, setIssuerCard] = useState<{ name: string; accredited: boolean } | null>(null)
  // Signing-key chip — sessionStorage only (no expiry is tracked anywhere in
  // this app today, so this is a static "present/absent" indicator, not a
  // countdown). Re-checked whenever role/session changes, same as issuerCard.
  const [hasSigningKey, setHasSigningKey] = useState(false)
  const navigate = useNavigate()
  const { t } = useLanguage()

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

    // onAuthStateChange fires far more often than real sign-in/sign-out
    // (token refreshes, and in practice this project has been observed
    // re-firing SIGNED_IN every couple seconds with no real change) — this
    // guard skips the role refetch unless the signed-in user actually
    // changed, instead of re-querying on every firing.
    let lastUserId: string | null = null

    // Get initial session & role
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
      // Do not set loading=true here to prevent remounting Outlet
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

  // Sidebar institution card — only fetched for the issuer role, only once
  // per session/user (a name+accredited flag doesn't need the live-refresh
  // treatment the role check above has to defend against).
  useEffect(() => {
    let active = true
    if (role !== 'issuer' || !session?.user) {
      setIssuerCard(null)
      setHasSigningKey(false)
      return
    }

    // The key lives in memory now (issuerKeyStore.ts); follow it as it is
    // unlocked or forgotten rather than reading it once.
    setHasSigningKey(!!getIssuerKey())
    const unsubscribeKey = subscribeIssuerKey(() => setHasSigningKey(!!getIssuerKey()))

    supabase
      .from('issuers')
      .select('name, accredited')
      .eq('owner', session.user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (active && data) {
          setIssuerCard({ name: data.name, accredited: !!data.accredited })
        }
      })

    return () => {
      active = false
      unsubscribeKey()
    }
  }, [role, session?.user?.id])

  const handleSignOut = async () => {
    // The signing key must not outlive the session that unlocked it.
    forgetIssuerKey()
    forgetHolderKey()
    await supabase.auth.signOut()
    navigate('/auth/login', { replace: true })
  }

  if (loading) {
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
          <p style={{ color: 'var(--forest)', fontWeight: 500, fontSize: '1.1rem', margin: 0 }}>{t('layout.loading')}</p>
        </div>
      </div>
    )
  }

  const renderRoleBadge = () => {
    if (role === 'admin') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-800 border border-gray-200">
          <ShieldCheck size={12} className="text-gray-500" />
          Admin
        </span>
      )
    }
    if (role === 'issuer') {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-100 text-purple-800">
          {t('role.issuer')}
        </span>
      )
    }
    if (role === 'student') {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-teal-100 text-teal-800">
          {t('role.student')}
        </span>
      )
    }
    return role ? (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-800">
        {role}
      </span>
    ) : null
  }

  const bottomNavLinkClass = ({ isActive }: { isActive: boolean }) =>
    `flex flex-col items-center justify-center flex-1 h-full text-[10px] font-medium transition-colors ${
      isActive ? 'text-indigo-600' : 'text-gray-500 active:text-indigo-600'
    }`

  // Desktop sidebar link — icon + label, same icon set as the mobile bottom
  // nav below so the two stay visually consistent instead of drifting into
  // two different navigation vocabularies.
  const sidebarLinkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
      isActive ? 'bg-indigo-50 text-indigo-700' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
    }`

  const sidebarNav = (
    <>
      {role === 'student' && (
        <>
          <NavLink to="/app/wallet" end className={sidebarLinkClass}>
            <Wallet size={20} strokeWidth={1.9} className="shrink-0" />
            {t('nav.wallet')}
          </NavLink>
          <NavLink to="/app/activity" className={sidebarLinkClass}>
            <Activity size={20} strokeWidth={1.9} className="shrink-0" />
            {t('nav.activity')}
          </NavLink>
          <NavLink to="/app/requests" className={sidebarLinkClass}>
            <Briefcase size={20} strokeWidth={1.9} className="shrink-0" />
            {t('nav.requests')}
          </NavLink>
          <NavLink to="/app/contacts" className={sidebarLinkClass}>
            <UserCheck size={20} strokeWidth={1.9} className="shrink-0" />
            {t('nav.contacts')}
          </NavLink>
          <NavLink to="/app/vault-setup" className={sidebarLinkClass}>
            <Fingerprint size={20} strokeWidth={1.9} className="shrink-0" />
            {t('nav.account')}
          </NavLink>
        </>
      )}
      {role === 'issuer' && (
        <>
          <NavLink to="/app/dashboard" end className={sidebarLinkClass}>
            <LayoutDashboard size={20} strokeWidth={1.9} className="shrink-0" />
            {t('nav.dashboard')}
          </NavLink>
          <NavLink to="/app/issued" className={sidebarLinkClass}>
            <FileSignature size={20} strokeWidth={1.9} className="shrink-0" />
            {t('nav.issued')}
          </NavLink>
          <NavLink to="/app/requests" className={sidebarLinkClass}>
            <Briefcase size={20} strokeWidth={1.9} className="shrink-0" />
            {t('nav.requests')}
          </NavLink>
          <NavLink to="/app/institution-settings" className={sidebarLinkClass}>
            <Settings size={20} strokeWidth={1.9} className="shrink-0" />
            {t('nav.settings')}
          </NavLink>
        </>
      )}
      {role === 'admin' && (
        <NavLink to="/admin" end className={sidebarLinkClass}>
          <ShieldCheck size={20} strokeWidth={1.9} className="shrink-0" />
          Manage issuers
        </NavLink>
      )}
    </>
  )

  return (
    <div className="min-h-screen flex bg-gray-50">
      {/* Desktop sidebar — replaces the top nav bar at md+. Logo has no
          tagline here (or on the mobile bar below); it only ever showed at
          md+ and just added height without adding anything mobile didn't
          already communicate with the logo alone. */}
      <aside className="hidden md:flex md:w-60 md:flex-col md:fixed md:inset-y-0 bg-white border-r border-gray-200">
        <div className="h-16 flex items-center px-5 border-b border-gray-100">
          <img src="/logo.png" alt="Actik" className="h-9 w-auto" />
        </div>
        <nav className="flex-1 flex flex-col gap-1 px-3 py-4 overflow-y-auto">
          {role === 'issuer' && issuerCard && (
            <div className="mb-3 bg-white border border-stone-200 rounded-xl p-3">
              <div className="flex items-center gap-2 mb-1.5">
                <div className="w-7 h-7 rounded-lg bg-indigo-50 flex items-center justify-center shrink-0">
                  <Building2 size={14} className="text-indigo-600" strokeWidth={1.9} />
                </div>
                <span className="font-khmer text-[13px] font-semibold text-stone-900 truncate">{issuerCard.name}</span>
              </div>
              {issuerCard.accredited ? (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                  {t('dashboard.accredited_pill')}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                  {t('dashboard.pending_approval_pill')}
                </span>
              )}
            </div>
          )}
          {sidebarNav}
          <InstallPwaButton variant="sidebar" />
        </nav>
        {role === 'issuer' && hasSigningKey && (
          <div className="mx-3 mb-3 flex items-center gap-2 bg-teal-50 border border-teal-200 rounded-xl px-3 py-2.5">
            <Lock size={13} className="text-teal-600 shrink-0" strokeWidth={2} />
            <span className="font-mono text-[10px] font-bold tracking-wide text-teal-700 uppercase">{t('dashboard.signing_key_active')}</span>
          </div>
        )}
        {session?.user && (
          <div className="border-t border-gray-100 p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs text-gray-700 font-medium truncate">{session.user.email}</p>
                <div className="mt-1">{renderRoleBadge()}</div>
              </div>
              {role === 'student' && <NotificationsBell email={session.user.email} />}
            </div>
            <button
              onClick={handleSignOut}
              className="w-full inline-flex items-center justify-center gap-2 text-sm font-semibold text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 transition-colors rounded-lg h-9 cursor-pointer"
            >
              {t('layout.sign_out')}
            </button>
          </div>
        )}
      </aside>

      {/* Right column: mobile top bar + page content + footer */}
      <div className="flex-1 flex flex-col min-w-0 md:pl-60">
        {/* Top bar — mobile only; desktop uses the sidebar above instead */}
        <nav className="md:hidden bg-white border-b border-gray-200 shadow-sm">
          <div className="px-4 sm:px-6">
            <div className="flex justify-between items-center h-14">
              <img src="/logo.png" alt="Actik" className="h-10 w-auto" />
              <div className="flex items-center space-x-4">
                {session?.user && renderRoleBadge()}
                <InstallPwaButton variant="icon" />
                {session?.user && role === 'student' && (
                  <NotificationsBell email={session.user.email} />
                )}
                <button
                  onClick={handleSignOut}
                  className="inline-flex items-center text-sm font-semibold text-indigo-600 p-2"
                  aria-label="Sign out"
                >
                  <LogOut size={20} strokeWidth={1.9} />
                </button>
                {session?.user?.email && (
                  <div
                    className="w-7 h-7 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-[11px] font-semibold shrink-0"
                    title={session.user.email}
                  >
                    {session.user.email.charAt(0).toUpperCase()}
                  </div>
                )}
              </div>
            </div>
          </div>
        </nav>

        {/* Main Content Area */}
        <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 pb-20 md:pb-8">
          <Outlet />
        </main>

        {/* Footer */}
        <footer className="bg-white border-t border-gray-200 no-print pb-20 md:pb-0">
          <div className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8 text-center">
            <p className="text-xs text-gray-500">
              Actik MVP — Digital proof of ownership, starting with certificates, backed by W3C VC and SD-JWT
            </p>
          </div>
        </footer>
      </div>

      {/* Bottom navigation bar (mobile only) */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 h-[calc(64px+env(safe-area-inset-bottom))] pb-[env(safe-area-inset-bottom)] bg-white border-t border-gray-200 flex items-center justify-around z-50 shadow-lg">
        {role === 'student' && (
          <>
            <NavLink to="/app/wallet" end className={bottomNavLinkClass}>
              <Wallet size={20} strokeWidth={1.9} />
              <span className="mt-1">{t('nav.wallet')}</span>
            </NavLink>
            <NavLink to="/app/activity" className={bottomNavLinkClass}>
              <Activity size={20} strokeWidth={1.9} />
              <span className="mt-1">{t('nav.activity')}</span>
            </NavLink>
            <NavLink to="/app/requests" className={bottomNavLinkClass}>
              <Briefcase size={20} strokeWidth={1.9} />
              <span className="mt-1">{t('nav.requests')}</span>
            </NavLink>
            <NavLink to="/app/contacts" className={bottomNavLinkClass}>
              <UserCheck size={20} strokeWidth={1.9} />
              <span className="mt-1">{t('nav.contacts')}</span>
            </NavLink>
            <NavLink to="/app/vault-setup" className={bottomNavLinkClass}>
              <Fingerprint size={20} strokeWidth={1.9} />
              <span className="mt-1">{t('nav.account')}</span>
            </NavLink>
          </>
        )}
        {role === 'issuer' && (
          <>
            <NavLink to="/app/dashboard" end className={bottomNavLinkClass}>
              <LayoutDashboard size={20} strokeWidth={1.9} />
              <span className="mt-1">{t('nav.dashboard')}</span>
            </NavLink>
            <NavLink to="/app/issued" className={bottomNavLinkClass}>
              <FileSignature size={20} strokeWidth={1.9} />
              <span className="mt-1">{t('nav.issued')}</span>
            </NavLink>
            <NavLink to="/app/requests" className={bottomNavLinkClass}>
              <Briefcase size={20} strokeWidth={1.9} />
              <span className="mt-1">{t('nav.requests')}</span>
            </NavLink>
            <NavLink to="/app/institution-settings" className={bottomNavLinkClass}>
              <Settings size={20} strokeWidth={1.9} />
              <span className="mt-1">{t('nav.settings')}</span>
            </NavLink>
          </>
        )}
        {role === 'admin' && (
          <>
            <NavLink to="/admin" end className={bottomNavLinkClass}>
              <ShieldCheck size={20} strokeWidth={1.9} />
              <span className="mt-1">Registry</span>
            </NavLink>
          </>
        )}
      </div>
    </div>
  )
}
