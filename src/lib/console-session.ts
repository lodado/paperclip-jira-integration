const COOKIE_NAME = "dc_console_session";
const TOKEN_VERSION = 1;
const MAX_AGE_SEC = 60 * 60 * 24 * 7;

export type ConsoleSessionPayload = {
  v: number;
  exp: number;
};

function toBase64Url(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]!);
  }
  const b64 = btoa(binary);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): Uint8Array {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - (padded.length % 4)) % 4;
  const b64 = padded + "=".repeat(padLen);
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export function consoleSessionCookieName(): string {
  return COOKIE_NAME;
}

export function consoleSessionMaxAgeSec(): number {
  return MAX_AGE_SEC;
}

export function isConsoleAuthEnabled(): boolean {
  const password = process.env.CONSOLE_LOGIN_PASSWORD?.trim();
  const secret = process.env.CONSOLE_SESSION_SECRET?.trim();
  return Boolean(password && secret);
}

export function getConsoleAuthConfig():
  | { enabled: false }
  | { enabled: true; password: string; secret: string } {
  const password = process.env.CONSOLE_LOGIN_PASSWORD?.trim();
  const secret = process.env.CONSOLE_SESSION_SECRET?.trim();
  if (!password || !secret) {
    return { enabled: false };
  }
  return { enabled: true, password, secret };
}

export async function signConsoleSession(secret: string): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000);
  const payload: ConsoleSessionPayload = {
    v: TOKEN_VERSION,
    exp: nowSec + MAX_AGE_SEC,
  };
  const payloadJson = JSON.stringify(payload);
  const payloadB64 = toBase64Url(new TextEncoder().encode(payloadJson).buffer);
  const key = await importHmacKey(secret);
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payloadB64),
  );
  const sigB64 = toBase64Url(sig);
  return `${payloadB64}.${sigB64}`;
}

export async function verifyConsoleSessionToken(
  token: string,
  secret: string,
): Promise<ConsoleSessionPayload | null> {
  const parts = token.split(".");
  if (parts.length !== 2) {
    return null;
  }
  const [payloadB64, sigB64] = parts;
  if (!payloadB64 || !sigB64) {
    return null;
  }

  let payloadBytes: Uint8Array;
  try {
    payloadBytes = fromBase64Url(payloadB64);
  } catch {
    return null;
  }

  let sigBytes: Uint8Array;
  try {
    sigBytes = fromBase64Url(sigB64);
  } catch {
    return null;
  }

  const key = await importHmacKey(secret);
  const ok = await crypto.subtle.verify(
    "HMAC",
    key,
    sigBytes as globalThis.BufferSource,
    new TextEncoder().encode(payloadB64),
  );
  if (!ok) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    return null;
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as ConsoleSessionPayload).v !== "number" ||
    typeof (parsed as ConsoleSessionPayload).exp !== "number"
  ) {
    return null;
  }

  const payload = parsed as ConsoleSessionPayload;
  if (payload.v !== TOKEN_VERSION) {
    return null;
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (payload.exp <= nowSec) {
    return null;
  }

  return payload;
}
