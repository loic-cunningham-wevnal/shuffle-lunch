// HMAC-signed session token, format: `v1.<expiresAtMs>.<base64url(hmacSha256)>`
//
// Web Crypto APIs are used so the same code works in the Edge runtime
// (middleware) and the Node runtime (route handlers / tRPC).

import { SESSION_MAX_AGE_SECONDS } from "./env";

const TEXT = new TextEncoder();

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    TEXT.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function base64UrlEncode(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]!);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(str: string): Uint8Array {
  const pad = str.length % 4 === 0 ? "" : "=".repeat(4 - (str.length % 4));
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

export function timingSafeEqualString(a: string, b: string): boolean {
  return timingSafeEqualBytes(TEXT.encode(a), TEXT.encode(b));
}

export async function createSessionToken(secret: string): Promise<string> {
  const expiresAtMs = Date.now() + SESSION_MAX_AGE_SECONDS * 1000;
  const payload = `v1.${expiresAtMs}`;
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, TEXT.encode(payload));
  return `${payload}.${base64UrlEncode(sig)}`;
}

export async function verifySessionToken(
  token: string,
  secret: string,
): Promise<boolean> {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [version, expiresAtRaw, sigB64] = parts;
  if (version !== "v1") return false;
  const expiresAtMs = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAtMs)) return false;
  if (Date.now() > expiresAtMs) return false;

  const payload = `${version}.${expiresAtRaw}`;
  let providedSig: Uint8Array;
  try {
    providedSig = base64UrlDecode(sigB64!);
  } catch {
    return false;
  }
  const key = await hmacKey(secret);
  const expectedSigBuf = await crypto.subtle.sign(
    "HMAC",
    key,
    TEXT.encode(payload),
  );
  return timingSafeEqualBytes(providedSig, new Uint8Array(expectedSigBuf));
}
