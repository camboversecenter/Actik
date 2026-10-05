# The zk-vault library in this folder

This folder holds Actik's vault integration. The encryption engine itself is the
**zk-vault-react** library, which is distributed as source (not as an npm package).
It is **already vendored here** (MIT, Copyright (c) 2026 sengtha; credited in the
repository's `NOTICE`), so a fresh clone builds without any extra step.

```
src/vault/
  zk-vault/            <- vendored from zk-vault-react
  components/          <- vendored from zk-vault-react (VaultSetup, VaultUnlock, VaultSettings)
  vaultAdapter.ts      <- Actik's Supabase storage adapter
  issuerVaultAdapter.ts<- adapter for an issuer's signing-key vault
  zk-vault-contract.ts <- adapter type contract
```

The app imports `VaultProvider`, `useZkVault`, `encryptData`, `decryptData` from
`./vault/zk-vault`, and `VaultSetup` / `VaultUnlock` from `./vault/components/...`.

## Updating from upstream

1. Clone or download https://github.com/sengtha/zk-vault-react
2. Copy its `src/zk-vault/` over `src/vault/zk-vault/`
3. Copy its `src/components/` over `src/vault/components/`
4. Run `npm run build` and fix any local deviations.

The library is zero-knowledge: encryption keys are derived in the browser from a
PIN or passkey and never reach Supabase. See its README for details, including the
**zero-recovery** caveat — which is why Actik keeps the issuer able to re-issue.
