import { useNavigate } from 'react-router-dom'
import { ShieldCheck, KeyRound, QrCode, GraduationCap, Building2, Briefcase, Globe } from 'lucide-react'
import { useLanguage } from '../../lib/i18n'

export default function Landing() {
  const navigate = useNavigate()
  const { t, language, setLanguage } = useLanguage()

  const steps = [
    { icon: Building2, title: t('landing.how_step1_title'), desc: t('landing.how_step1_desc') },
    { icon: KeyRound, title: t('landing.how_step2_title'), desc: t('landing.how_step2_desc') },
    { icon: QrCode, title: t('landing.how_step3_title'), desc: t('landing.how_step3_desc') },
  ]

  const trustPoints = [
    { title: t('landing.trust_1_title'), desc: t('landing.trust_1_desc') },
    { title: t('landing.trust_2_title'), desc: t('landing.trust_2_desc') },
    { title: t('landing.trust_3_title'), desc: t('landing.trust_3_desc') },
  ]

  return (
    <div className="min-h-screen bg-white text-stone-900 font-sans">
      {/* Nav */}
      <header className="sticky top-0 z-10 bg-white/90 backdrop-blur border-b border-stone-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <img src="/logo.png" alt="Actik" className="h-8 w-auto" />
            <span className="font-bold text-lg tracking-tight text-stone-900">Actik</span>
          </div>
          <div className="flex items-center gap-2 sm:gap-4">
            <button
              onClick={() => setLanguage(language === 'en' ? 'km' : 'en')}
              className="flex items-center gap-1.5 text-sm font-medium text-stone-500 hover:text-stone-900 px-2.5 h-9 rounded-lg hover:bg-stone-100 transition-colors cursor-pointer"
              aria-label="Switch language"
            >
              <Globe size={16} />
              {language === 'en' ? 'ខ្មែរ' : 'EN'}
            </button>
            <button
              onClick={() => navigate('/auth/login')}
              className="bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-semibold text-sm h-9 px-4 rounded-lg transition-colors cursor-pointer"
            >
              {t('landing.nav_signin')}
            </button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-indigo-50 via-white to-white pointer-events-none" />
        <div className="relative max-w-4xl mx-auto px-4 sm:px-6 pt-16 sm:pt-24 pb-14 sm:pb-20 text-center">
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-indigo-600 bg-indigo-50 border border-indigo-100 rounded-full px-3 py-1.5">
            {t('landing.hero_eyebrow')}
          </span>
          <h1 className="mt-6 text-4xl sm:text-5xl md:text-6xl font-extrabold tracking-tight text-stone-900 leading-[1.08]">
            {t('landing.hero_title')}
          </h1>
          <p className="mt-5 text-base sm:text-lg text-stone-600 leading-relaxed max-w-2xl mx-auto">
            {t('landing.hero_subtitle')}
          </p>
          <div className="mt-8 flex flex-col items-center gap-3">
            <button
              onClick={() => navigate('/auth/login')}
              className="bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-semibold text-base h-13 px-8 rounded-xl shadow-sm transition-colors cursor-pointer"
              style={{ height: 52 }}
            >
              {t('landing.hero_cta')}
            </button>
            <p className="text-xs text-stone-500">{t('landing.hero_cta_sub')}</p>
          </div>
          <div className="mt-10 flex items-center justify-center gap-2 text-xs font-medium text-stone-500">
            <ShieldCheck size={15} className="text-teal-600" />
            {t('landing.trust_badge')}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-14 sm:py-20">
        <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-center text-stone-900">
          {t('landing.how_title')}
        </h2>
        <div className="mt-10 grid grid-cols-1 md:grid-cols-3 gap-6">
          {steps.map((step, i) => (
            <div key={i} className="bg-white border border-stone-200 rounded-2xl p-6 shadow-sm relative">
              <div className="absolute -top-3 -left-3 w-7 h-7 rounded-full bg-indigo-600 text-white text-xs font-bold flex items-center justify-center">
                {i + 1}
              </div>
              <div className="w-11 h-11 rounded-xl bg-indigo-50 flex items-center justify-center mb-4">
                <step.icon size={22} className="text-indigo-600" />
              </div>
              <h3 className="font-bold text-stone-900 text-base leading-snug">{step.title}</h3>
              <p className="mt-2 text-sm text-stone-600 leading-relaxed">{step.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Trust */}
      <section className="bg-stone-50 border-y border-stone-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-14 sm:py-20">
          <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-center text-stone-900">
            {t('landing.trust_title')}
          </h2>
          <div className="mt-10 grid grid-cols-1 md:grid-cols-3 gap-6">
            {trustPoints.map((point, i) => (
              <div key={i} className="border-l-4 border-teal-500 bg-white rounded-r-xl p-5">
                <h3 className="font-bold text-stone-900 text-sm">{point.title}</h3>
                <p className="mt-1.5 text-sm text-stone-600 leading-relaxed">{point.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Who it's for */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-14 sm:py-20">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-stone-900">
            {t('landing.for_title')}
          </h2>
          <p className="mt-3 text-stone-600 leading-relaxed">{t('landing.for_desc')}</p>
        </div>
        <div className="mt-10 grid grid-cols-1 sm:grid-cols-3 gap-6 max-w-4xl mx-auto">
          <div className="bg-white border border-stone-200 rounded-2xl p-6">
            <GraduationCap size={24} className="text-indigo-600" />
            <h3 className="mt-3 font-bold text-stone-900">{t('landing.for_students_title')}</h3>
            <p className="mt-1.5 text-sm text-stone-600 leading-relaxed">{t('landing.for_students_desc')}</p>
          </div>
          <div className="bg-white border border-stone-200 rounded-2xl p-6">
            <Building2 size={24} className="text-indigo-600" />
            <h3 className="mt-3 font-bold text-stone-900">{t('landing.for_institutions_title')}</h3>
            <p className="mt-1.5 text-sm text-stone-600 leading-relaxed">{t('landing.for_institutions_desc')}</p>
          </div>
          <div className="bg-white border border-stone-200 rounded-2xl p-6">
            <Briefcase size={24} className="text-indigo-600" />
            <h3 className="mt-3 font-bold text-stone-900">{t('landing.for_employers_title')}</h3>
            <p className="mt-1.5 text-sm text-stone-600 leading-relaxed">{t('landing.for_employers_desc')}</p>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="bg-indigo-900 relative overflow-hidden">
        <div className="absolute top-0 right-0 p-10 opacity-10 pointer-events-none">
          <ShieldCheck size={220} className="text-white" />
        </div>
        <div className="relative max-w-3xl mx-auto px-4 sm:px-6 py-16 sm:py-20 text-center">
          <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
            {t('landing.final_cta_title')}
          </h2>
          <p className="mt-3 text-indigo-200">{t('landing.final_cta_desc')}</p>
          <button
            onClick={() => navigate('/auth/login')}
            className="mt-7 bg-white hover:bg-indigo-50 text-indigo-900 font-semibold text-base px-8 rounded-xl shadow-sm transition-colors cursor-pointer"
            style={{ height: 52 }}
          >
            {t('landing.final_cta_button')}
          </button>
        </div>
      </section>

      {/* Footer */}
      <footer className="max-w-6xl mx-auto px-4 sm:px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <img src="/logo.png" alt="Actik" className="h-6 w-auto opacity-80" />
          <span className="text-sm font-semibold text-stone-700">Actik</span>
        </div>
        <p className="text-xs text-stone-500">{t('landing.footer_rights')}</p>
      </footer>
    </div>
  )
}
