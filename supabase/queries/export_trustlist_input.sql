-- Input for scripts/build-trustlist.ts. Run in the Supabase SQL editor and
-- save the single JSON cell as trustlist-input.json.
--
-- Every registered institution and every key it has ever used. The build
-- script — not this query — decides who goes on the list: accredited and not
-- revoked. Keeping the decision in the signed step means the Root holder sees
-- the whole registry and signs the part that is trusted.
select coalesce(json_agg(json_build_object(
         'did',        i.did,
         'name',       i.name,
         'domain',     i.domain,
         'accredited', i.accredited,
         'kind',       coalesce(i.kind, 'institution'),
         'revoked_at', i.revoked_at,
         'keys', coalesce((
           select json_agg(json_build_object(
                    'public_jwk', k.public_jwk,
                    'created_at', k.created_at,
                    'retired_at', k.retired_at,
                    'revoked_at', k.revoked_at
                  ) order by k.created_at)
           from public.issuer_keys k
           where k.issuer_id = i.id
         ), '[]'::json)
       ) order by i.did), '[]'::json) as trustlist_input
from public.issuers i;
