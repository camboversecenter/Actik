// Makes sure an unlocked wallet has its holder key (src/lib/holderKey.ts), so
// an issuer can bind the next credential to it. Renders nothing; failures are
// retried on the next unlock and never block the wallet.

import { useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useZkVault } from '../vault/zk-vault'
import { ensureHolderKey } from '../lib/holderKey'

export default function HolderKeyKeeper() {
  const { isUnlocked, encryptPayload, decryptPayload } = useZkVault()
  useEffect(() => {
    if (!isUnlocked) return
    supabase.auth.getSession().then(({ data }) => {
      const userId = data.session?.user?.id
      if (!userId) return
      ensureHolderKey(userId, encryptPayload, (p) => decryptPayload(p)).catch((e) =>
        console.warn('[holder key]', e instanceof Error ? e.message : 'unavailable')
      )
    })
  }, [isUnlocked, encryptPayload, decryptPayload])
  return null
}
