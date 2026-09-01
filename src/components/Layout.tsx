import { useEffect, useState } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useLanguage } from '../lib/i18n'
import { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import NotificationsBell from './NotificationsBell'

export default function Layout() {
  const [session, setSession] = useState<Session | null>(null)
  const [role, setRole] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
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

    // Get initial session & role
    supabase.auth.getSession().then(({ data }) => {
      if (active) {
        setSession(data.session)
        if (data.session?.user) {
          fetchRole(data.session.user.id)
        } else {
          setLoading(false)
        }
      }
    })

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      if (active) {
        setSession(currentSession)
        if (currentSession?.user) {
          // Do not set loading=true here to prevent remounting Outlet
          fetchRole(currentSession.user.id)
        } else {
          setRole(null)
          setLoading(false)
        }
      }
    })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  const handleSignOut = async () => {
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
          <svg className="w-3 h-3 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"></path>
          </svg>
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

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium transition-colors ${
      isActive
        ? 'border-indigo-600 text-gray-900'
        : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 active:text-indigo-600'
    }`

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      {/* Top navigation bar */}
      <nav className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-14">
            <div className="flex">
              {/* Brand Logo & Tagline */}
              <div className="flex flex-col justify-center mr-8">
                <img src="/logo.png" alt="Actik" className="h-10 md:h-12 w-auto mb-0.5" />
                <span className="text-[10px] text-gray-500 font-medium tracking-wide uppercase hidden md:inline">
                  {t('layout.tagline')}
                </span>
              </div>

              {/* Navigation Links based on role */}
              <div className="hidden md:flex md:space-x-8">
                {role === 'issuer' && (
                  <NavLink to="/app/dashboard" className={linkClass}>
                    {t('layout.institution_dashboard')}
                  </NavLink>
                )}
                {role === 'student' && (
                  <>
                    <NavLink to="/app/wallet" end className={linkClass}>
                      {t('nav.wallet')}
                    </NavLink>
                    <NavLink to="/app/activity" className={linkClass}>
                      {t('nav.activity')}
                    </NavLink>
                  </>
                )}
                {role === 'admin' && (
                  <NavLink to="/admin" end className={linkClass}>
                    Manage issuers
                  </NavLink>
                )}
              </div>
            </div>

            {/* Right side user info & Sign out */}
            <div className="flex items-center space-x-4 md:space-x-6">
              {session?.user && (
                <div className="text-right flex-col items-end hidden md:flex">
                  <span className="text-xs text-gray-700 font-medium">{session.user.email}</span>
                  <div className="mt-0.5">{renderRoleBadge()}</div>
                </div>
              )}
              {session?.user && (
                <div className="md:hidden flex items-center">
                  {renderRoleBadge()}
                </div>
              )}
              {session?.user && role === 'student' && (
                <NotificationsBell email={session.user.email} />
              )}
              <button
                onClick={handleSignOut}
                className="inline-flex items-center text-sm font-semibold text-indigo-600 hover:text-indigo-800 transition-colors p-2 md:p-0"
                aria-label="Sign out"
              >
                <span className="hidden md:inline">{t('layout.sign_out')}</span>
                <span className="inline md:hidden">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013-3v1" />
                  </svg>
                </span>
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 pb-20 md:pb-8">
        <Outlet />
      </main>

      {/* Bottom navigation bar (mobile only) */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 h-[calc(64px+env(safe-area-inset-bottom))] pb-[env(safe-area-inset-bottom)] bg-white border-t border-gray-200 flex items-center justify-around z-50 shadow-lg">
        {role === 'student' && (
          <>
            <NavLink to="/app/wallet" end className={bottomNavLinkClass}>
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              <span className="mt-1">{t('nav.wallet')}</span>
            </NavLink>
            <NavLink to="/app/activity" className={bottomNavLinkClass}>
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
              </svg>
              <span className="mt-1">{t('nav.activity')}</span>
            </NavLink>
            <NavLink to="/app/vault-setup" className={bottomNavLinkClass}>
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.121 17.804A13.937 13.937 0 0112 16c2.5 0 4.847.655 6.879 1.804M15 10a3 3 0 11-6 0 3 3 0 016 0zm6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="mt-1">{t('nav.account')}</span>
            </NavLink>
          </>
        )}
        {role === 'issuer' && (
          <>
            <NavLink to="/app/dashboard" end className={bottomNavLinkClass}>
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011-1v5m-4 0h4" />
              </svg>
              <span className="mt-1">{t('nav.dashboard')}</span>
            </NavLink>
            <NavLink to="/app/issued" className={bottomNavLinkClass}>
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <span className="mt-1">{t('nav.issued')}</span>
            </NavLink>
            <NavLink to="/app/institution-settings" className={bottomNavLinkClass}>
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span className="mt-1">{t('nav.settings')}</span>
            </NavLink>
          </>
        )}
        {role === 'admin' && (
          <>
            <NavLink to="/admin" end className={bottomNavLinkClass}>
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
              <span className="mt-1">Registry</span>
            </NavLink>
          </>
        )}
      </div>

      {/* Footer */}
      <footer className="bg-white border-t border-gray-200 no-print pb-20 md:pb-0">
        <div className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8 text-center">
          <p className="text-xs text-gray-500">
            Actik MVP — Digital proof of ownership, starting with certificates, backed by W3C VC and SD-JWT
          </p>
        </div>
      </footer>
    </div>
  )
}
