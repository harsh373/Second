import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "../config/env";

const KEY = Buffer.from(env.TOKEN_ENCRYPTION_KEY, "hex");

// AES-256-GCM: encrypts and also detects tampering. Output: v1:<iv>:<authTag>:<ciphertext>
export function encrypt(plain: string): string {
  const iv = randomBytes(12); // a fresh random IV for every encryption
  const cipher = createCipheriv("aes-256-gcm", KEY, iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64"), tag.toString("base64"), data.toString("base64")].join(":");
}

export function decrypt(payload: string): string {
  const [version, iv, tag, data] = payload.split(":");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("Unsupported encrypted payload");
  const decipher = createDecipheriv("aes-256-gcm", KEY, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
}

// OAuth "state": a signed, expiring token that says "this connect flow was started by user X".
// A separate signing key is derived from the encryption key, so the two uses never share a key.
const STATE_KEY = createHmac("sha256", KEY).update("oauth-state-v1").digest();
const STATE_TTL_MS = 10 * 60 * 1000;

function sign(payload: string): string {
  return createHmac("sha256", STATE_KEY).update(payload).digest("base64url");
}

export function createOAuthState(userId: string): string {
  const payload = Buffer.from(
    JSON.stringify({ u: userId, n: randomBytes(8).toString("hex"), e: Date.now() + STATE_TTL_MS }),
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

// Returns the user id the state was issued to, or null if it is forged, malformed or expired.
export function verifyOAuthState(state: string): string | null {
  const [payload, signature] = state.split(".");
  if (!payload || !signature) return null;

  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { u?: string; e?: number };
    if (typeof parsed.u !== "string" || typeof parsed.e !== "number" || parsed.e < Date.now()) return null;
    return parsed.u;
  } catch {
    return null;
  }
}