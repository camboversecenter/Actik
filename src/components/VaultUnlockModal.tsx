import { Lock, Fingerprint } from 'lucide-react'
import { useLanguage } from '../lib/i18n'
import PinDotsInput from './PinDotsInput'
import NumericKeypad from './ui/NumericKeypad'

type UnlockMethod = 'pin' | 'passkey' | 'biometric' | 'both' | null

interface VaultUnlockModalProps {
  unlockMethod: UnlockMethod
  pinInput: string
  onPinChange: (value: string) => void
  onSubmitPin: (e: React.FormEvent) => void
  onPasskeyClick: () => void
  isUnlocking: boolean
  unlockError: string | null
  onCancel: () => void
  title?: string
  desc?: string
  cancelLabel?: string
  submitLabel?: string
  passkeyLabel?: string
}

// The recurring "enter your vault PIN" dialog — same dark full-bleed
// treatment as the mockup's dedicated unlock screen (1d), kept as a modal
// (not a separate route) so it still layers over whatever the user was
// doing, same as it always has. One shared component instead of the
// near-identical block that used to be copy-pasted across five screens
// (Wallet, WalletCategory, CredentialDetail, Notifications, ShareCredential).
export default function VaultUnlockModal({
  unlockMethod,
  pinInput,
  onPinChange,
  onSubmitPin,
  onPasskeyClick,
  isUnlocking,
  unlockError,
  onCancel,
  title,
  desc,
  cancelLabel,
  submitLabel,
  passkeyLabel,
}: VaultUnlockModalProps) {
  const { t } = useLanguage()

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[100] p-4">
      <div className="max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain bg-indigo-950 rounded-3xl shadow-2xl p-6 [@media(max-height:700px)]:p-5 md:p-8 w-full max-w-sm flex flex-col items-center animate-scale-in text-white">
        <div className="w-14 h-14 [@media(max-height:700px)]:w-11 [@media(max-height:700px)]:h-11 rounded-2xl bg-teal-400/15 border border-teal-400/40 flex items-center justify-center mb-4 [@media(max-height:700px)]:mb-3">
          <Lock size={24} className="text-teal-400" strokeWidth={1.8} />
        </div>
        <h3 className="font-khmer text-lg font-bold text-center">{title || t('wallet.unlock_vault_title')}</h3>
        {desc && <p className="text-xs text-white/60 mt-1.5 text-center leading-relaxed max-w-[260px]">{desc}</p>}

        {(unlockMethod === 'pin' || unlockMethod === 'both' || !unlockMethod) && (
          <form onSubmit={onSubmitPin} className="w-full flex flex-col items-center gap-5 [@media(max-height:700px)]:gap-3 mt-6 [@media(max-height:700px)]:mt-4">
            <PinDotsInput
              value={pinInput}
              onChange={onPinChange}
              name="vault-pin"
              autoComplete="current-password"
              autoFocus
              required
              tone="dark"
            />
            {unlockError && <p className="text-rose-300 text-xs text-center font-semibold">{unlockError}</p>}

            <NumericKeypad
              value={pinInput}
              onChange={onPinChange}
              disabled={isUnlocking}
              onBiometric={(unlockMethod === 'both' || !unlockMethod) ? onPasskeyClick : undefined}
            />

            <div className="w-full flex flex-col gap-2 mt-1">
              <button
                type="submit"
                disabled={isUnlocking || pinInput.length < 6}
                className="w-full bg-teal-400 hover:bg-teal-300 active:bg-teal-500 text-indigo-950 font-semibold h-11 rounded-xl text-sm flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {isUnlocking ? t('wallet.unlocking') : (submitLabel || t('wallet.unlock_with_pin'))}
              </button>
              <button
                type="button"
                onClick={onCancel}
                disabled={isUnlocking}
                className="w-full text-white/50 hover:text-white/80 font-semibold h-10 rounded-xl text-sm cursor-pointer transition-colors"
              >
                {cancelLabel || t('wallet.cancel')}
              </button>
            </div>
          </form>
        )}

        {(unlockMethod === 'passkey' || unlockMethod === 'biometric') && (
          <div className="w-full flex flex-col gap-3 items-center text-center mt-6">
            <Fingerprint size={40} className="text-teal-400 mb-1" strokeWidth={1.5} />
            {isUnlocking ? (
              <p className="text-sm font-semibold text-white/80">{t('wallet.authenticating')}</p>
            ) : (
              <>
                {unlockError && <p className="text-rose-300 text-xs font-semibold">{unlockError}</p>}
                {!passkeyLabel && <p className="text-sm text-white/60">{t('wallet.biometric_failed')}</p>}
                <button
                  type="button"
                  onClick={onPasskeyClick}
                  disabled={isUnlocking}
                  className="w-full bg-teal-400 hover:bg-teal-300 text-indigo-950 font-semibold h-11 rounded-xl text-sm cursor-pointer transition-colors"
                >
                  {passkeyLabel || t('wallet.try_again')}
                </button>
              </>
            )}
            <button
              type="button"
              onClick={onCancel}
              disabled={isUnlocking}
              className="w-full text-white/50 hover:text-white/80 font-semibold h-10 rounded-xl text-sm cursor-pointer transition-colors"
            >
              {cancelLabel || t('wallet.cancel')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
