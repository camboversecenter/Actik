import { Globe } from 'lucide-react'
import { useLanguage } from '../lib/i18n'

interface LanguageSwitcherProps {
  prefix: 'settings' | 'account'
  /** 'card' (default) — the original full card: heading, native <select>,
   *  helper text. Used on InstitutionSettings, untouched by the redesign.
   *  'compact-row' — a single bordered row with a two-way segmented toggle,
   *  matching the rest of the Account page's row-card rhythm. */
  variant?: 'card' | 'compact-row'
}

export default function LanguageSwitcher({ prefix, variant = 'card' }: LanguageSwitcherProps) {
  const { t, language, setLanguage } = useLanguage()

  if (variant === 'compact-row') {
    return (
      <div className="bg-white border border-stone-200 rounded-2xl px-4 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Globe size={16} strokeWidth={1.85} className="text-indigo-600" />
          <span className="font-khmer text-[12.5px] font-semibold text-stone-700">{t(`${prefix}.language`)}</span>
        </div>
        <div className="inline-flex border border-stone-200 rounded-lg overflow-hidden">
          <button
            type="button"
            onClick={() => setLanguage('km')}
            aria-pressed={language === 'km'}
            className={`font-khmer px-3.5 py-1.5 text-[11.5px] font-bold transition-colors cursor-pointer ${
              language === 'km' ? 'bg-indigo-600 text-white' : 'bg-white text-stone-500 hover:bg-stone-50'
            }`}
          >
            ខ្មែរ
          </button>
          <button
            type="button"
            onClick={() => setLanguage('en')}
            aria-pressed={language === 'en'}
            className={`px-3.5 py-1.5 text-[11.5px] font-semibold border-l border-stone-200 transition-colors cursor-pointer ${
              language === 'en' ? 'bg-indigo-600 text-white' : 'bg-white text-stone-500 hover:bg-stone-50'
            }`}
          >
            EN
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
      <div className="mb-4">
        <h3 className="text-sm font-bold text-stone-900 tracking-tight flex items-center gap-2">
          <Globe size={18} className="text-indigo-500" />
          <span>{t(`${prefix}.language`)}</span>
        </h3>
      </div>

      <div className="flex items-center gap-4">
        <select
          value={language}
          onChange={(e) => setLanguage(e.target.value as 'en' | 'km')}
          className="block w-full max-w-xs rounded-lg border border-gray-300 px-3 h-11 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white text-stone-900 cursor-pointer"
        >
          <option value="en">EN / English</option>
          <option value="km">ខ្មែរ / Khmer</option>
        </select>
      </div>
      <p className="text-xs text-stone-500 mt-3 leading-relaxed">
        {t(`${prefix}.language_desc`)}
      </p>
    </div>
  )
}
