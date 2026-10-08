import { Suspense, useEffect, useState } from 'react'
import { Outlet, NavLink, useLocation, useNavigationType } from 'react-router-dom'
import { useLanguage } from '../lib/i18n'
import { Session } from '@supabase/supabase-js'
import { getIssuerKey, subscribeIssuerKey } from '../lib/issuerKeyStore'
import { supabase } from '../lib/supabase'
import NotificationsBell from './NotificationsBell'
import InstallPwaButton from './InstallPwaButton'
import {
  Wallet, Activity, LayoutDashboard, FileSignature, Settings,
  ShieldCheck, Building2, Lock, Briefcase, UserCheck, LucideIcon,
} from 'lucide-react'

interface NavItem {
  to: string
  icon: LucideIcon
  label: string
  end?: boolean
}

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
  const [scrolled, setScrolled] = useState(false)
  // Only one of the sidebar / mobile bar is ever visible; mount the
  // notifications bell (realtime channel + 20s poll) in that one only.
  const [isDesktop, setIsDesktop] = useState(() => window.matchMedia('(min-width: 768px)').matches)
  const { pathname } = useLocation()
  const navigationType = useNavigationType()
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

  // BrowserRouter doesn't reset scroll: without this, opening a
  // credential from the bottom of a long list lands mid-way down the
  // detail page. Back/forward (POP) is left to the browser so the user
  // returns to where they were.
  useEffect(() => {
    if (navigationType !== 'POP') window.scrollTo(0, 0)
  }, [pathname, navigationType])

  // Scroll-edge: the top bar only gets its hairline once content is
  // actually underneath it.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)')
    const onChange = () => setIsDesktop(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  if (loading) {
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center gap-4 bg-stone-100">
        <img src="/logo.png" alt="" className="h-10 w-auto opacity-90" />
        <div className="w-6 h-6 border-[2.5px] border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
        <p className="sr-only">{t('layout.loading')}</p>
      </div>
    )
  }

  const roleLabel =
    role === 'admin' ? 'Admin'
    : role === 'issuer' ? t('role.issuer')
    : role === 'student' ? t('role.student')
    : role

  const renderRoleBadge = () => {
    if (!roleLabel) return null
    const tone =
      role === 'admin' ? 'bg-stone-100 text-stone-700 border-stone-200'
      : role === 'issuer' ? 'bg-indigo-50 text-indigo-700 border-indigo-100'
      : 'bg-teal-50 text-teal-800 border-teal-100'
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${tone}`}>
        {role === 'admin' && <ShieldCheck size={11} />}
        {roleLabel}
      </span>
    )
  }

  const navItems: NavItem[] =
    role === 'student' ? [
      { to: '/app/wallet', icon: Wallet, label: t('nav.wallet'), end: true },
      { to: '/app/activity', icon: Activity, label: t('nav.activity') },
      { to: '/app/requests', icon: Briefcase, label: t('nav.requests') },
      { to: '/app/contacts', icon: UserCheck, label: t('nav.contacts') },
    ]
    : role === 'issuer' ? [
      { to: '/app/dashboard', icon: LayoutDashboard, label: t('nav.dashboard'), end: true },
      { to: '/app/issued', icon: FileSignature, label: t('nav.issued') },
      { to: '/app/requests', icon: Briefcase, label: t('nav.requests') },
      { to: '/app/institution-settings', icon: Settings, label: t('nav.settings') },
    ]
    : role === 'admin' ? [
      { to: '/admin', icon: ShieldCheck, label: 'Manage issuers', end: true },
    ]
    : []

  // A tab bar with a single destination is just a label; admins get the
  // top bar only on phones.
  const showTabBar = navItems.length > 1

  // Desktop sidebar link — icon + label, same icon set as the mobile tab
  // bar below so the two stay one navigation vocabulary.
  const sidebarLinkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 px-3 h-10 rounded-xl text-sm font-medium ${
      isActive
        ? 'bg-indigo-600/10 text-indigo-700 font-semibold'
        : 'text-stone-600 hover:bg-stone-100 hover:text-stone-900'
    }`

  const tabLinkClass = ({ isActive }: { isActive: boolean }) =>
    `group relative flex flex-col items-center justify-center flex-1 min-w-0 h-full gap-0.5 ${
      isActive ? 'text-indigo-600' : 'text-stone-500'
    }`

  // The avatar (top bar) and the sidebar's user row both open the role's
  // account page, which ends with who's signed in and the Sign out button.
  const accountPath =
    role === 'issuer' ? '/app/institution-settings'
    : role === 'admin' ? '/admin'
    : '/app/vault-setup'

  const email = session?.user?.email ?? ''
  const initial = email.charAt(0).toUpperCase()

  return (
    <div className="min-h-[100dvh] flex bg-stone-100">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex md:w-64 md:flex-col md:fixed md:inset-y-0 bg-white/80 border-r border-stone-200/80 z-20">
        <div className="h-16 flex items-center px-6">
          <img src="/logo.png" alt="Actik" className="h-8 w-auto" />
        </div>
        <nav className="flex-1 flex flex-col gap-0.5 px-3 pt-2 pb-4 overflow-y-auto" aria-label="Primary">
          {role === 'issuer' && issuerCard && (
            <div className="mb-4 rounded-2xl bg-stone-50 border border-stone-200/80 p-3">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-indigo-600/10 flex items-center justify-center shrink-0">
                  <Building2 size={15} className="text-indigo-600" strokeWidth={1.9} />
                </div>
                <div className="min-w-0">
                  <p className="font-khmer text-[13px] font-semibold text-stone-900 truncate leading-tight">{issuerCard.name}</p>
                  <p className={`text-[11px] font-semibold mt-0.5 ${issuerCard.accredited ? 'text-emerald-700' : 'text-amber-700'}`}>
                    {issuerCard.accredited ? t('dashboard.accredited_pill') : t('dashboard.pending_approval_pill')}
                  </p>
                </div>
              </div>
            </div>
          )}
          {navItems.map(({ to, icon: Icon, label, end }) => (
            <NavLink key={to} to={to} end={end} className={sidebarLinkClass}>
              <Icon size={19} strokeWidth={1.9} className="shrink-0" />
              <span className="truncate">{label}</span>
            </NavLink>
          ))}
          <InstallPwaButton variant="sidebar" />
        </nav>
        {role === 'issuer' && hasSigningKey && (
          <div className="mx-3 mb-3 flex items-center gap-2 bg-teal-50 border border-teal-200 rounded-xl px-3 py-2.5">
            <Lock size={13} className="text-teal-600 shrink-0" strokeWidth={2} />
            <span className="font-mono text-[10px] font-bold tracking-wide text-teal-700 uppercase">{t('dashboard.signing_key_active')}</span>
          </div>
        )}
        {session?.user && (
          <div className="border-t border-stone-200/80 p-3 flex items-center gap-1">
            <NavLink
              to={accountPath}
              end
              title={email}
              className={({ isActive }) =>
                `flex-1 min-w-0 flex items-center gap-3 p-2 rounded-xl ${isActive ? 'bg-indigo-600/10' : 'hover:bg-stone-100'}`
              }
            >
              <span className="w-9 h-9 rounded-full bg-indigo-600 text-white flex items-center justify-center text-sm font-semibold shrink-0">
                {initial}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] text-stone-800 font-medium truncate">{email}</span>
                <span className="block mt-0.5">{renderRoleBadge()}</span>
              </span>
            </NavLink>
            {role === 'student' && isDesktop && <NotificationsBell email={session.user.email} />}
          </div>
        )}
      </aside>

      {/* Right column: mobile top bar + page content */}
      <div className="flex-1 flex flex-col min-w-0 md:pl-64">
        {/* Top bar — mobile only. Translucent and sticky: content scrolls
            under it, and the hairline appears only once it does. */}
        <header
          data-scrolled={scrolled}
          className="md:hidden sticky top-0 z-30 material-bar scroll-edge pt-[env(safe-area-inset-top)] no-print"
        >
          <div className="flex justify-between items-center h-14 px-4">
            <img src="/logo.png" alt="Actik" className="h-8 w-auto" />
            <div className="flex items-center gap-1">
              <InstallPwaButton variant="icon" />
              {session?.user && role === 'student' && !isDesktop && (
                <NotificationsBell email={session.user.email} />
              )}
              {session?.user && (
                <NavLink
                  to={accountPath}
                  end
                  className="w-10 h-10 flex items-center justify-center rounded-full"
                  aria-label={t('nav.account')}
                >
                  {({ isActive }) => (
                    <span
                      className={`w-8 h-8 rounded-full bg-indigo-600 text-white flex items-center justify-center text-[13px] font-semibold ${
                        isActive ? 'ring-2 ring-indigo-600/30 ring-offset-2 ring-offset-stone-50' : ''
                      }`}
                    >
                      {initial}
                    </span>
                  )}
                </NavLink>
              )}
            </div>
          </div>
        </header>

        {/* Main content. On phones the bottom padding clears the floating
            tab bar plus the home indicator. */}
        <main
          className={`flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 lg:px-10 pt-5 md:pt-10 md:pb-12 ${
            showTabBar ? 'pb-[calc(var(--tabbar-h)+var(--safe-bottom)+28px)]' : 'pb-[calc(var(--safe-bottom)+28px)]'
          }`}
        >
          <Suspense
            fallback={
              <div className="flex justify-center py-24">
                <div className="w-6 h-6 border-[2.5px] border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
              </div>
            }
          >
            <Outlet />
          </Suspense>
        </main>

        {/* Footer — desktop only; on phones it was a block of marketing
            copy the user had to scroll past inside their own wallet. */}
        <footer className="hidden md:block no-print">
          <div className="max-w-6xl mx-auto py-6 px-10">
            <p className="text-xs text-stone-400">
              Actik — {t('layout.tagline_footer')}
            </p>
          </div>
        </footer>
      </div>

      {/* Tab bar (mobile). Sits below modal scrims (z-30 vs their z-40+)
          so sheets are never covered by it. */}
      {showTabBar && (
        <nav
          aria-label="Primary"
          className="md:hidden fixed bottom-0 inset-x-0 z-30 material-bar border-t border-stone-900/[0.06] pb-safe no-print"
        >
          <div className="flex items-stretch h-[var(--tabbar-h)] px-1">
            {navItems.map(({ to, icon: Icon, label, end }) => (
              <NavLink key={to} to={to} end={end} className={tabLinkClass}>
                {({ isActive }) => (
                  <>
                    <span
                      className={`flex items-center justify-center w-14 h-8 rounded-full transition-colors duration-200 ${
                        isActive ? 'bg-indigo-600/10' : 'group-active:bg-stone-900/5'
                      }`}
                    >
                      <Icon size={21} strokeWidth={isActive ? 2.2 : 1.8} />
                    </span>
                    <span className={`text-[10px] leading-tight truncate max-w-full px-1 ${isActive ? 'font-semibold' : 'font-medium'}`}>
                      {label}
                    </span>
                  </>
                )}
              </NavLink>
            ))}
          </div>
        </nav>
      )}
    </div>
  )
}
