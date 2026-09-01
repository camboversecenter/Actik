import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, Inbox } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useLanguage } from '../lib/i18n'

interface PreviewItem {
  id: string
  institution_name: string
  degree_title: string
  created_at: string
}

const PREVIEW_LIMIT = 5

// Bell icon + anchored dropdown preview of pending credential claims, in
// place of navigating straight to the full /app/notifications page. There's
// no "archive" or "delete" here — a pending credential is a real row another
// institution issued to this person, not a dismissible feed item, so the
// only actions are "claim it" (on the full page, which already owns the
// vault-unlock flow) or "view all". No shadcn/Radix/framer-motion — every
// other overlay in this app is a hand-rolled Tailwind panel, so this matches
// that rather than introducing a new UI dependency for one component.
export default function NotificationsBell({ email }: { email: string | undefined }) {
  const navigate = useNavigate()
  const { t } = useLanguage()
  const [count, setCount] = useState(0)
  const [items, setItems] = useState<PreviewItem[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [shouldPulse, setShouldPulse] = useState(false)
  const prevCount = useRef(0)
  const wrapperRef = useRef<HTMLDivElement>(null)

  const fetchPreview = async (addr: string) => {
    try {
      const { data, count: total, error } = await supabase
        .from('pending_credentials')
        .select('id, institution_name, degree_title, created_at', { count: 'exact' })
        .eq('recipient_email', addr.toLowerCase())
        .order('created_at', { ascending: false })
        .limit(PREVIEW_LIMIT)

      if (!error) {
        setItems(data || [])
        setCount(total ?? 0)
      }
    } catch (err) {
      console.error('Error fetching notifications preview:', err)
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
      setItems([])
      return
    }

    fetchPreview(email)

    const channel = supabase
      .channel('pending_credentials_bell')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'pending_credentials',
          filter: `recipient_email=eq.${email.toLowerCase()}`,
        },
        () => fetchPreview(email)
      )
      .subscribe()

    return () => {
      channel.unsubscribe()
    }
  }, [email])

  useEffect(() => {
    if (!isOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [isOpen])

  const goToNotifications = () => {
    setIsOpen(false)
    navigate('/app/notifications')
  }

  return (
    <div className="relative" ref={wrapperRef}>
      <button
        onClick={() => setIsOpen((v) => !v)}
        className="relative p-1.5 rounded-full text-gray-500 hover:text-indigo-600 hover:bg-gray-100 transition-all focus:outline-none flex items-center justify-center cursor-pointer"
        aria-label={t('wallet.notifications_title')}
        aria-expanded={isOpen}
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

      {isOpen && (
        <div
          role="menu"
          aria-label={t('wallet.notifications_title')}
          className="absolute right-0 top-full mt-2 w-80 max-w-[calc(100vw-2rem)] bg-white rounded-xl border border-stone-200 shadow-lg overflow-hidden z-50 animate-scale-in"
        >
          <div className="px-4 py-3 border-b border-stone-100">
            <h3 className="text-sm font-bold text-stone-900">{t('wallet.notifications_title')}</h3>
          </div>

          {items.length === 0 ? (
            <div className="p-6 text-center">
              <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-indigo-50 text-indigo-600 mb-2">
                <Inbox size={18} />
              </div>
              <p className="text-sm font-semibold text-stone-900">{t('wallet.all_caught_up')}</p>
            </div>
          ) : (
            <ul className="max-h-80 overflow-y-auto divide-y divide-stone-100">
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    onClick={goToNotifications}
                    className="w-full text-left p-4 hover:bg-stone-50 transition-colors cursor-pointer"
                  >
                    <div className="flex justify-between items-start gap-2">
                      <span className="text-sm font-semibold text-stone-900 leading-snug">
                        {item.institution_name ? `${item.institution_name} — ` : ''}
                        {item.degree_title}
                      </span>
                      <span className="text-[10px] text-stone-400 shrink-0 mt-0.5">
                        {new Date(item.created_at).toLocaleDateString()}
                      </span>
                    </div>
                    <span className="mt-1.5 inline-block text-xs font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">
                      {t('wallet.claim_to_vault_btn')}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <button
            onClick={goToNotifications}
            className="w-full text-center text-sm font-semibold text-indigo-600 hover:bg-indigo-50 py-3 border-t border-stone-100 transition-colors cursor-pointer"
          >
            {t('wallet.view_all_notifications')}
          </button>
        </div>
      )}
    </div>
  )
}
