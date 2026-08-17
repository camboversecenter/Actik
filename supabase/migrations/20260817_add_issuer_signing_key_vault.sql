-- zk-vault envelope for the issuer's signing private key (ciphertext only).
-- signing_key_ciphertext holds the encrypted privateJwk payload, separate
-- from the vault library's own envelope contract (pin/passkey wrapping keys).
alter table issuers add column if not exists vault_envelope_pin text;
alter table issuers add column if not exists vault_pin_salt text;
alter table issuers add column if not exists vault_envelope_passkey text;
alter table issuers add column if not exists passkey_id text;
alter table issuers add column if not exists signing_key_ciphertext jsonb;
