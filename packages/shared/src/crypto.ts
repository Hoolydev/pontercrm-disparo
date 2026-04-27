import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12; // recommended for GCM
const TAG_LEN = 16;

/**
 * Derive a 32-byte key from the ENCRYPTION_KEY env value.
 * Accepts either a raw 32-byte string or a base64-encoded string.
 */
function deriveKey(envKey: string): Buffer {
  // Try base64 first
  const fromB64 = Buffer.from(envKey, "base64");
  if (fromB64.length === 32) return fromB64;

  // Fallback: raw UTF-8 (must be exactly 32 bytes)
  const raw = Buffer.from(envKey, "utf8");
  if (raw.length >= 32) return raw.subarray(0, 32);

  throw new Error(
    `ENCRYPTION_KEY must be at least 32 bytes (got ${raw.length}). ` +
      `Use: openssl rand -base64 32`
  );
}

/**
 * Encrypt a JSON-serializable object using AES-256-GCM.
 * Returns a compact string: `<iv_hex>.<ciphertext_b64>.<tag_hex>`
 */
export function encryptJson(
  obj: Record<string, unknown>,
  encryptionKey: string
): Record<string, unknown> {
  const key = deriveKey(encryptionKey);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);

  const plaintext = JSON.stringify(obj);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final()
  ]);
  const tag = cipher.getAuthTag();

  const packed = `${iv.toString("hex")}.${encrypted.toString("base64")}.${tag.toString("hex")}`;

  // Store inside JSONB as a wrapper so the column type doesn't change
  return { __encrypted: packed };
}

/**
 * Decrypt a configJson value previously encrypted with `encryptJson`.
 * If the value is NOT encrypted (legacy plaintext), returns it as-is.
 */
export function decryptJson(
  stored: unknown,
  encryptionKey: string
): Record<string, unknown> {
  // Handle null/undefined
  if (!stored || typeof stored !== "object") return {};

  const obj = stored as Record<string, unknown>;

  // Not encrypted (legacy data) — return as-is
  if (!obj.__encrypted || typeof obj.__encrypted !== "string") {
    return obj;
  }

  const key = deriveKey(encryptionKey);
  const parts = obj.__encrypted.split(".");
  if (parts.length !== 3) throw new Error("malformed encrypted payload");

  const ivHex = parts[0]!;
  const ciphertextB64 = parts[1]!;
  const tagHex = parts[2]!;
  const iv = Buffer.from(ivHex, "hex");
  const ciphertext = Buffer.from(ciphertextB64, "base64");
  const tag = Buffer.from(tagHex, "hex");

  if (iv.length !== IV_LEN) throw new Error("invalid IV length");
  if (tag.length !== TAG_LEN) throw new Error("invalid auth tag length");

  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final()
  ]);

  return JSON.parse(decrypted.toString("utf8"));
}
