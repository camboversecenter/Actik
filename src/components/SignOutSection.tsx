import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { LogOut } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { forgetIssuerKey } from '../lib/issuerKeyStore'
import { forgetHolderKey } from '../lib/holderKey'
import { useLanguage } from '../lib/i18n'

// The last block of every role's account page (student Account, issuer
// Institution settings, admin registry): who is signed in, and the one
// place to sign out. The avatar in the top bar opens the page this sits on.
export default function SignOutSection({ className = '' }: { className?: string }) {
  const { t } = useLanguage()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [signingOut, setSigningOut] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setEmail(data.session?.user?.email ?? ''))
  }, [])

  const handleSignOut = async () => {
    setSigningOut(true)
    // The signing key and wallet key must not outlive the session that
    // unlocked them.
    forgetIssuerKey()
    forgetHolderKey()
    await supabase.auth.signOut()
    navigate('/auth/login', { replace: true })
  }

  return (
    <section className={`mt-10 ${className}`}>
      <div className="bg-white rounded-2xl border border-stone-200/80 overflow-hidden">
        {email && (
          <div className="px-5 py-4 flex items-center gap-3">
            <span className="w-10 h-10 rounded-full bg-indigo-600 text-white flex items-center justify-center text-[15px] font-semibold shrink-0">
              {email.charAt(0).toUpperCase()}
            </span>
            <div className="min-w-0">
              <p className="text-[12px] text-stone-500">{t('layout.signed_in_as')}</p>
              <p className="text-[15px] font-semibold text-stone-900 truncate">{email}</p>
            </div>
          </div>
        )}
        <button
          onClick={handleSignOut}
          disabled={signingOut}
          className={`w-full h-14 flex items-center justify-center gap-2 text-[15px] font-semibold text-rose-600 hover:bg-rose-50 active:bg-rose-100 disabled:opacity-50 cursor-pointer ${email ? 'border-t border-stone-200/80' : ''}`}
        >
          <LogOut size={18} strokeWidth={2} />
          {t('layout.sign_out')}
        </button>
      </div>
    </section>
  )
}
