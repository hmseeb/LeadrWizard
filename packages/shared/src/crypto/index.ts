/**
 * Application-level AES-256-GCM encryption for per-org credential storage.
 * Uses Node.js built-in crypto module. Zero external dependencies.
 *
 * Encrypted format: v1:iv:tag:ciphertext (all base64)
 * - v1 prefix enables future key rotation
 * - iv: 12-byte random initialization vector
 * - tag: 16-byte GCM authentication tag
 * - ciphertext: encrypted data
 *
 * Key strategy:
 * - Primary key is HKDF-SHA256 derived from `SUPABASE_SERVICE_ROLE_KEY`. That
 *   env var is already required for the app to run at all and is stable across
 *   deployments, so the derived encryption key is automatically stable without
 *   any extra configuration. This avoids the "I saved GHL creds, now I can't
 *   read them" class of bug that hits any project whose `ENCRYPTION_KEY` env
 *   var drifts between preview and production (or was never set).
 *
 * - Legacy `ENCRYPTION_KEY` env var is still honored as a decrypt-only
 *   fallback so existing v1 blobs encrypted under the old scheme continue to
 *   read until they're re-saved. New encrypts always use the derived key.
 *
 * To rotate the effective key: rotate `SUPABASE_SERVICE_ROLE_KEY` in Supabase
 * and re-save all credentials in Settings → Integrations.
 */

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const KEY_VERSION = "v1";

// HKDF domain-separation constants. These MUST stay stable forever — changing
// either one rotates every org's encryption key and breaks all stored
// credentials. Salt is a fixed label rather than a random value because we
// need determinism across deployments; the input key material
// (SUPABASE_SERVICE_ROLE_KEY) is already high-entropy so a random salt adds
// nothing meaningful here.
const HKDF_SALT = Buffer.from("leadrwizard-credential-encryption-v1");
const HKDF_INFO = Buffer.from("aes-256-gcm-key");

// Module-level cache for the derived key. HKDF is cheap but called on every
// encrypt/decrypt, so caching avoids thousands of unnecessary hash
// computations under load. The cache is keyed on the raw IKM so a hot-reloaded
// service role key is picked up automatically.
let cachedDerivedKey: { ikm: string; key: Buffer } | null = null;

/**
 * Derive a 32-byte AES-256-GCM key from the Supabase service role key via
 * HKDF-SHA256. Thrown when SUPABASE_SERVICE_ROLE_KEY is missing — at that
 * point the entire app is unusable anyway, so a crypto error is a red herring
 * compared to the underlying config bug.
 */
function deriveKeyFromServiceRole(): Buffer {
  const ikm = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!ikm) {
    throw new Error(
      "Missing SUPABASE_SERVICE_ROLE_KEY environment variable. " +
        "Credential encryption derives its key from the Supabase service role key; " +
        "set it in your Vercel project settings."
    );
  }

  if (cachedDerivedKey && cachedDerivedKey.ikm === ikm) {
    return cachedDerivedKey.key;
  }

  // hkdfSync returns an ArrayBuffer — wrap it in a Node Buffer so the rest
  // of the module can treat it like any other key buffer.
  const derived = hkdfSync("sha256", ikm, HKDF_SALT, HKDF_INFO, 32);
  const key = Buffer.from(derived);
  cachedDerivedKey = { ikm, key };
  return key;
}

/**
 * Legacy key loader. Reads the old `ENCRYPTION_KEY` env var if set and
 * returns it as a Buffer. Used only as a decrypt fallback so historical v1
 * blobs encrypted before the HKDF migration can still be read. Returns null
 * when the env var is unset or malformed — the caller is expected to treat
 * that as "no legacy key available" rather than an error, since the common
 * case is simply that the user never set it.
 */
function getLegacyEncryptionKey(): Buffer | null {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) return null;
  try {
    const buf = Buffer.from(key, "hex");
    // AES-256 requires exactly 32 bytes. A malformed env var (wrong length,
    // not actually hex) would produce a different-sized buffer and make
    // createDecipheriv throw "Invalid key length" instead of the expected
    // GCM auth tag error — catching that here keeps the fallback path
    // silent when the env var is set to something nonsensical.
    if (buf.length !== 32) return null;
    return buf;
  } catch {
    return null;
  }
}

/**
 * Encrypt a plaintext string using AES-256-GCM.
 * Returns format: v1:iv:tag:ciphertext (all base64)
 */
export function encrypt(plaintext: string): string {
  const key = deriveKeyFromServiceRole();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    KEY_VERSION,
    iv.toString("base64"),
    tag.toString("base64"),
    encrypted.toString("base64"),
  ].join(":");
}

/**
 * Decrypt an AES-256-GCM encrypted string.
 * Expects format: v1:iv:tag:ciphertext (all base64)
 *
 * Tries the HKDF-derived primary key first, then falls back to the legacy
 * `ENCRYPTION_KEY` env var. Throws only if both strategies fail to
 * authenticate the tag.
 */
export function decrypt(encoded: string): string {
  const parts = encoded.split(":");
  if (parts.length !== 4 || parts[0] !== KEY_VERSION) {
    throw new Error("Invalid encrypted format. Expected v1:iv:tag:ciphertext");
  }

  const [, ivB64, tagB64, dataB64] = parts;
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const data = Buffer.from(dataB64, "base64");

  // Build the list of candidate keys in priority order. Primary first so the
  // hot path stays fast; legacy key only attempted if the primary fails. We
  // deliberately swallow the primary-key error and let the legacy attempt
  // surface the final failure so the error message is actionable.
  const candidates: Array<{ label: string; key: Buffer }> = [
    { label: "derived", key: deriveKeyFromServiceRole() },
  ];
  const legacy = getLegacyEncryptionKey();
  if (legacy) {
    candidates.push({ label: "legacy-ENCRYPTION_KEY", key: legacy });
  }

  let lastErr: unknown;
  for (const candidate of candidates) {
    try {
      const decipher = createDecipheriv(ALGORITHM, candidate.key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
    } catch (err) {
      lastErr = err;
      // Try the next candidate. A GCM auth failure on the primary key just
      // means this blob was encrypted under a previous key — expected during
      // migration. We only surface an error after all candidates are
      // exhausted.
    }
  }

  throw lastErr instanceof Error
    ? lastErr
    : new Error("Failed to decrypt credential with any known key");
}

/**
 * Encrypt org credentials object. Only encrypts non-null values.
 * Returns an object with the same keys but encrypted values.
 */
export function encryptCredentials(
  credentials: Record<string, string | null>
): Record<string, string | null> {
  const result: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(credentials)) {
    result[key] = value ? encrypt(value) : null;
  }
  return result;
}

/**
 * Decrypt org credentials object. Only decrypts non-null values.
 * Returns an object with the same keys but decrypted values.
 */
export function decryptCredentials(
  encrypted: Record<string, string | null>
): Record<string, string | null> {
  const result: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(encrypted)) {
    result[key] = value ? decrypt(value) : null;
  }
  return result;
}
