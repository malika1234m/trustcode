// Pinned licence verification keys (Ed25519, raw 32 bytes, base64url), by key id. Only the TrustCode server holds
// the matching private keys. To rotate: generate a key with `python -m app.admin licence-keygen`, add it here under
// a new id, release the extension, then switch TRUSTCODE_LICENCE_KEY_ID on the server. Keep old ids until every
// licence signed with them has passed its offline period.
export const LICENCE_KEYS: Readonly<Record<string, string>> = Object.freeze({
  k1: 'jqYKTcghJcQBq8rZppt8TxyuzzNC9X_Bb1yoenlwIH0',
});
