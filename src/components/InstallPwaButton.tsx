import { useEffect, useState } from 'react'
import { MonitorSmartphone } from 'lucide-react'
import { useLanguage } from '../lib/i18n'

// Chrome/Edge/Android fire this before showing their own install UI; calling
// preventDefault() suppresses that and lets us trigger it from our own
// button instead. Not in the DOM lib types, so declared locally.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

function isStandalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS Safari's home-screen flag — there's no beforeinstallprompt on iOS
    // at all, so this only matters for hiding the button post-install there.
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

interface InstallPwaButtonProps {
  variant?: 'sidebar' | 'icon'
}

// Renders nothing until the browser actually offers an install prompt (no
// beforeinstallprompt support — Safari, Firefox desktop — means no button,
// rather than a dead one), and nothing once the app is already installed.
export default function InstallPwaButton({ variant = 'sidebar' }: InstallPwaButtonProps) {
  const { t } = useLanguage()
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [installed, setInstalled] = useState(false)

  useEffect(() => {
    setInstalled(isStandalone())

    const handlePrompt = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e as BeforeInstallPromptEvent)
    }
    const handleInstalled = () => {
      setInstalled(true)
      setDeferredPrompt(null)
    }

    window.addEventListener('beforeinstallprompt', handlePrompt)
    window.addEventListener('appinstalled', handleInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', handlePrompt)
      window.removeEventListener('appinstalled', handleInstalled)
    }
  }, [])

  if (installed || !deferredPrompt) return null

  const handleClick = async () => {
    await deferredPrompt.prompt()
    // The prompt can only be used once regardless of outcome — accepted or
    // dismissed, drop it either way; a fresh beforeinstallprompt will fire
    // later if the browser decides to offer it again.
    await deferredPrompt.userChoice
    setDeferredPrompt(null)
  }

  if (variant === 'icon') {
    return (
      <button
        onClick={handleClick}
        className="relative p-1.5 rounded-full text-gray-500 hover:text-indigo-600 hover:bg-gray-100 transition-all focus:outline-none flex items-center justify-center cursor-pointer"
        aria-label={t('layout.install_app')}
      >
        <MonitorSmartphone size={22} strokeWidth={2} />
      </button>
    )
  }

  return (
    <button
      onClick={handleClick}
      className="w-full flex items-center gap-3 px-3 pb-2.5 pt-4 mt-2 border-t border-gray-100 rounded-lg text-sm font-medium text-indigo-600 hover:bg-indigo-50 transition-colors cursor-pointer"
    >
      <MonitorSmartphone size={20} className="shrink-0" />
      {t('layout.install_app')}
    </button>
  )
}
