import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useLanguage } from '../lib/i18n'

// Bell icon with a live pending-credential count badge. Clicking always goes
// straight to the full /app/notifications page — there used to be an
// anchored preview dropdown/modal here first, but every item in it routed to
// that same page anyway, so it was just an extra hop. Removed rather than
// kept as a "peek without navigating" convenience: simplicity won out over
// that tradeoff.
interface NotificationsBellProps {
  email: string | undefined
}

export default function NotificationsBell({ email }: NotificationsBellProps) {
  const navigate = useNavigate()
  const { t } = useLanguage()
  const [count, setCount] = useState(0)
  const [shouldPulse, setShouldPulse] = useState(false)
  const prevCount = useRef(0)

  const fetchCount = async (addr: string) => {
    try {
      // head: true — count only, no rows returned. The badge never needs
      // row data now that there's no preview list to render.
      const { count: total, error } = await supabase
        .from('pending_credentials')
        .select('id', { count: 'exact', head: true })
        .eq('recipient_email', addr.toLowerCase())

      if (!error) {
        setCount(total ?? 0)
      }
    } catch (err) {
      console.error('Error fetching notifications count:', err)
    }
  }

  useEffect(() => {
    if (count > prevCount.current) {
      setShouldPulse(true)
      const timer = setTimeout(() => setShouldPulse(false), 2000)
      prevCount.current = count
      return () => clearTimeout(timer)
    }
    prevCount.current = count
  }, [count])

  useEffect(() => {
    if (!email) {
      setCount(0)
      return
    }

    fetchCount(email)

    // Unique per-mount topic name — supabase.channel() reuses any existing
    // channel already registered under the same name, and removeChannel()
    // is async, so a fixed name racing React StrictMode's dev-mode
    // mount→cleanup→mount can still hand back a channel that's already
    // subscribed (see the "cannot add postgres_changes callbacks... after
    // subscribe()" error). A unique name sidesteps the race entirely.
    const channel = supabase
      .channel(`pending_credentials_bell:${email.toLowerCase()}:${Math.random().toString(36).slice(2)}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'pending_credentials',
          filter: `recipient_email=eq.${email.toLowerCase()}`,
        },
        () => fetchCount(email)
      )
      .subscribe()

    // Belt-and-suspenders alongside the realtime subscription above: that
    // channel only ever fires if pending_credentials was explicitly added to
    // the supabase_realtime publication (not guaranteed — nothing in this
    // repo's migrations does it), and Layout.tsx never unmounts this
    // component across in-app navigation, so without this the badge could
    // go stale for an entire session with no way to self-correct short of a
    // full reload. A same-tab claim also updates instantly via the
    // 'actik:pending-credentials-changed' event Notifications.tsx fires.
    const poll = setInterval(() => fetchCount(email), 20000)
    const onLocalChange = () => fetchCount(email)
    window.addEventListener('actik:pending-credentials-changed', onLocalChange)

    return () => {
      // removeChannel (not channel.unsubscribe) actually deregisters the
      // channel from the client instead of just closing its socket.
      supabase.removeChannel(channel)
      clearInterval(poll)
      window.removeEventListener('actik:pending-credentials-changed', onLocalChange)
    }
  }, [email])

  return (
    <button
      onClick={() => navigate('/app/notifications')}
      className="relative p-1.5 rounded-full text-gray-500 hover:text-indigo-600 hover:bg-gray-100 transition-all focus:outline-none flex items-center justify-center cursor-pointer"
      aria-label={t('wallet.notifications_title')}
    >
      <Bell size={22} strokeWidth={2} />
      {count > 0 && (
        <span
          className={`absolute -top-1.5 -right-1.5 bg-rose-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-[10px] font-bold shadow-sm ${
            shouldPulse ? 'animate-pulse' : ''
          }`}
        >
          {count > 9 ? '9+' : count}
        </span>
      )}
    </button>
  )
}
