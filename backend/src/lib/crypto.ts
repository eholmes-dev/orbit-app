import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;

function key(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is required");
  return createHash("sha256").update(secret).digest();
}

/** Encrypt with AES-256-GCM; returns `iv:ciphertext:tag` (all hex). */
export function encrypt(plaintext: string): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${ct.toString("hex")}:${tag.toString("hex")}`;
}

export function decrypt(blob: string): string {
  const [ivHex, ctHex, tagHex] = blob.split(":");
  if (!ivHex || !ctHex || !tagHex) throw new Error("Malformed ciphertext");
  const decipher = createDecipheriv(ALGO, key(), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([
    decipher.update(Buffer.from(ctHex, "hex")),
    decipher.final(),
  ]).toString("utf8");
}

/** Opaque session ID — also used as the `orbit_session` cookie value. */
export function newSessionId(): string {
  return randomBytes(32).toString("hex");
}
