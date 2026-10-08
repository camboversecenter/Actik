import { useId } from 'react'

interface PinDotsInputProps {
  value: string
  onChange: (value: string) => void
  length?: number
  name?: string
  autoComplete?: string
  autoFocus?: boolean
  required?: boolean
  disabled?: boolean
  reveal?: boolean
  className?: string
  // 'dark' for the full-bleed navy vault-unlock screen (VaultSetup.tsx) —
  // white-on-transparent dots with a teal fill/focus ring instead of the
  // default light card styling.
  tone?: 'light' | 'dark'
}

// A 6-digit vault PIN field styled as a dot-progress row instead of raw
// "••••••" text. Underneath, it's still a real <input type="password"
// inputMode="numeric">, so browsers can still offer to save/autofill it and
// gate that autofill behind Face ID/Touch ID — see the comment above the PIN
// fields in VaultSetup.tsx for why that real-input requirement matters here.
// The dots are a purely decorative overlay (aria-hidden); the input itself
// carries the accessible name via whatever <label> wraps or points at it.
export default function PinDotsInput({
  value,
  onChange,
  length = 6,
  name,
  autoComplete,
  autoFocus,
  required,
  disabled,
  reveal = false,
  className = '',
  tone = 'light',
}: PinDotsInputProps) {
  const id = useId()
  const dark = tone === 'dark'

  return (
    <div className={`relative mx-auto ${className}`} style={{ width: 220, height: 56 }}>
      <input
        id={id}
        type={reveal ? 'text' : 'password'}
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={length}
        name={name}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        required={required}
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, '').slice(0, length))}
        className="peer absolute inset-0 h-full w-full cursor-text opacity-0 disabled:cursor-not-allowed"
      />
      <div
        aria-hidden="true"
        className={
          dark
            ? 'pointer-events-none flex h-full w-full items-center justify-center gap-2.5 rounded-lg border border-white/20 bg-transparent peer-focus:border-teal-400 peer-focus:ring-2 peer-focus:ring-teal-400/40 peer-disabled:opacity-50'
            : 'pointer-events-none flex h-full w-full items-center justify-center gap-2.5 rounded-lg border border-stone-300 bg-white peer-focus:border-indigo-500 peer-focus:ring-2 peer-focus:ring-indigo-500 peer-disabled:opacity-50'
        }
      >
        {Array.from({ length }).map((_, i) => {
          const filled = i < value.length
          return reveal ? (
            <span key={i} className={`flex h-7 w-4 items-center justify-center text-lg font-bold ${dark ? 'text-white' : 'text-stone-900'}`}>
              {value[i] ?? ''}
            </span>
          ) : (
            <span
              key={i}
              className={`size-3 rounded-full transition-colors ${
                filled
                  ? dark ? 'bg-teal-400' : 'bg-indigo-600'
                  : dark ? 'border border-white/30 bg-transparent' : 'border border-stone-300 bg-transparent'
              }`}
            />
          )
        })}
      </div>
    </div>
  )
}
