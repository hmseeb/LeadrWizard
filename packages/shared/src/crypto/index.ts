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
 * Requires ENCRYPTION_KEY env var: 32-byte hex-encoded key
 * Generate with: openssl rand -hex 32
 */

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const KEY_VERSION = "v1";

function getEncryptionKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error(
      "Missing ENCRYPTION_KEY environment variable. Generate with: openssl rand -hex 32"
    );
  }
  return Buffer.from(key, "hex");
}

/**
 * Encrypt a plaintext string using AES-256-GCM.
 * Returns format: v1:iv:tag:ciphertext (all base64)
 */
export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
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
 */
export function decrypt(encoded: string): string {
  const parts = encoded.split(":");
  if (parts.length !== 4 || parts[0] !== KEY_VERSION) {
    throw new Error("Invalid encrypted format. Expected v1:iv:tag:ciphertext");
  }

  const [, ivB64, tagB64, dataB64] = parts;
  const key = getEncryptionKey();
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const data = Buffer.from(dataB64, "base64");

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([
    decipher.update(data),
    decipher.final(),
  ]).toString("utf8");
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
