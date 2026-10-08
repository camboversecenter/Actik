import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  // Fail loudly during development if env vars are missing.
  console.warn('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Copy .env.example to .env.')
}

// Route guards, the layout and most pages each look up the signed-in
// user's role on mount — one page load was firing the same
// `profiles?select=role` request seven times. Rather than thread a shared
// role through every component, the client itself:
//  - shares one network request between identical concurrent REST reads
//    (same URL, same auth, same Accept), handing each caller its own clone;
//  - keeps the role lookup for a few seconds, and drops it on any write to
//    `profiles` so a role change is never served stale.
const inflight = new Map<string, Promise<Response>>()
const roleCache = new Map<string, { at: number; res: Response }>()
const ROLE_TTL_MS = 10_000

function headerOf(input: RequestInfo | URL, init: RequestInit | undefined, name: string): string {
  const h = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
  return h.get(name) ?? ''
}

const dedupingFetch: typeof fetch = (input, init) => {
  const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()

  if (!href.includes('/rest/v1/')) return fetch(input, init)
  if (method !== 'GET') {
    if (href.includes('/rest/v1/profiles')) roleCache.clear()
    return fetch(input, init)
  }

  const key = `${href}|${headerOf(input, init, 'authorization')}|${headerOf(input, init, 'accept')}`

  const isRoleLookup = /\/rest\/v1\/profiles\?select=role&id=eq\./.test(href)
  if (isRoleLookup) {
    const hit = roleCache.get(key)
    if (hit && Date.now() - hit.at < ROLE_TTL_MS) return Promise.resolve(hit.res.clone())
  }

  let pending = inflight.get(key)
  if (!pending) {
    pending = fetch(input, init).then((res) => {
      if (isRoleLookup && res.ok) roleCache.set(key, { at: Date.now(), res: res.clone() })
      return res
    })
    inflight.set(key, pending)
    pending.finally(() => inflight.delete(key)).catch(() => {})
  }
  return pending.then((res) => res.clone())
}

export const supabase = createClient(url ?? '', anonKey ?? '', {
  global: { fetch: dedupingFetch },
})

// Signing out must not leave a cached role behind. (Another account, or a
// refreshed token, carries a different Authorization header and so a
// different cache key already; SIGNED_IN isn't used because this project
// sees it re-fire every few seconds — see Layout.tsx.)
supabase.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT') roleCache.clear()
})
