import { Fingerprint, Delete } from 'lucide-react'

interface NumericKeypadProps {
  value: string
  onChange: (value: string) => void
  length?: number
  onBiometric?: () => void
  disabled?: boolean
  className?: string
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9']
// Khmer numerals — matches the mockup's small secondary digit under each key.
const KHMER_DIGITS: Record<string, string> = {
  '0': '០', '1': '១', '2': '២', '3': '៣', '4': '៤',
  '5': '៥', '6': '៦', '7': '៧', '8': '៨', '9': '៩',
}

// Decorative on-screen numeric pad for the dark vault-unlock/PIN-entry
// screens — writes into the same controlled value as PinDotsInput rather
// than replacing it, so the real <input> underneath (and the OS
// autofill/Face ID/Touch ID affordance it gets — see PinDotsInput.tsx) stays
// the actual source of truth. This is purely an alternate way to fill it.
export default function NumericKeypad({
  value,
  onChange,
  length = 6,
  onBiometric,
  disabled = false,
  className = '',
}: NumericKeypadProps) {
  const press = (digit: string) => {
    if (disabled || value.length >= length) return
    onChange((value + digit).slice(0, length))
  }
  const backspace = () => {
    if (disabled) return
    onChange(value.slice(0, -1))
  }

  const keyClasses =
    'h-14 rounded-2xl bg-white/8 hover:bg-white/14 active:bg-white/20 flex flex-col items-center justify-center transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed'

  return (
    <div className={`grid grid-cols-3 gap-3 ${className}`} role="group" aria-label="Numeric keypad">
      {KEYS.map((k) => (
        <button
          key={k}
          type="button"
          disabled={disabled}
          onClick={() => press(k)}
          className={keyClasses}
        >
          <span className="font-mono text-xl font-normal text-white">{k}</span>
          <span className="font-khmer text-[9px] text-white/45 -mt-0.5">{KHMER_DIGITS[k]}</span>
        </button>
      ))}

      {onBiometric ? (
        <button
          type="button"
          disabled={disabled}
          onClick={onBiometric}
          className="h-14 flex items-center justify-center cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          aria-label="Unlock with biometrics"
        >
          <Fingerprint size={24} className="text-teal-400" strokeWidth={1.7} />
        </button>
      ) : (
        <div aria-hidden="true" />
      )}

      <button
        type="button"
        disabled={disabled}
        onClick={() => press('0')}
        className={keyClasses}
      >
        <span className="font-mono text-xl font-normal text-white">0</span>
      </button>

      <button
        type="button"
        disabled={disabled || value.length === 0}
        onClick={backspace}
        className="h-14 flex items-center justify-center cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        aria-label="Delete last digit"
      >
        <Delete size={22} className="text-white/70" strokeWidth={1.7} />
      </button>
    </div>
  )
}
