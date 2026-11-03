// ============================================================================
// auth.js — PBKDF2 password hashing + D1 session tokens
// ============================================================================
// Pattern follows Lawrence's house playbook (ARIA Agent): PBKDF2-SHA256 at
// 100k iterations, random 32-byte session tokens, 14-day sessions. One
// hardening difference: only the SHA-256 HASH of the session token is stored
// in D1, so a database read never yields a usable session.
// ============================================================================
import { dbFirst, dbRun, nowISO } from "./db.js";

export const SESSION_COOKIE = "naptivity_session";
const SESSION_DAYS = 14;

// ---------------------------------------------------------------------------
// SECTION: CRYPTO
// ---------------------------------------------------------------------------
function b64(bytes) { return btoa(String.fromCharCode(...new Uint8Array(bytes))); }
function unb64(s) { return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); }

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" }, key, 256);
  return "pbkdf2$100000$" + b64(salt) + "$" + b64(bits);
}

export async function verifyPassword(password, stored) {
  try {
    const [, iter, saltB64, hashB64] = String(stored).split("$");
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: unb64(saltB64), iterations: parseInt(iter, 10), hash: "SHA-256" }, key, 256);
    const a = unb64(hashB64), b = new Uint8Array(bits);
    if (a.length !== b.length) return false;
    let diff = 0; for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    return diff === 0;
  } catch { return false; }
}

export function newSessionToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hashToken(token) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(token)));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------------------
// SECTION: COOKIES
// ---------------------------------------------------------------------------
export function sessionCookie(token, secure) {
  return SESSION_COOKIE + "=" + token + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=" + (SESSION_DAYS * 86400) + (secure ? "; Secure" : "");
}
export function clearCookie() { return SESSION_COOKIE + "=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"; }
export function parseCookies(request) {
  const out = {};
  for (const part of (request.headers.get("Cookie") || "").split(";")) {
    const i = part.indexOf("="); if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

// ---------------------------------------------------------------------------
// SECTION: SESSIONS + CURRENT USER
// ---------------------------------------------------------------------------
export async function createSession(env, request, userId) {
  const token = newSessionToken();
  const exp = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  await dbRun(env, "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
    await hashToken(token), userId, nowISO(), exp);
  const secure = new URL(request.url).protocol === "https:";
  return sessionCookie(token, secure);
}

export async function destroySession(env, request) {
  const token = parseCookies(request)[SESSION_COOKIE];
  if (token) await dbRun(env, "DELETE FROM sessions WHERE token_hash = ?", await hashToken(token));
}

export async function currentUser(env, request) {
  const token = parseCookies(request)[SESSION_COOKIE];
  if (!token) return null;
  const row = await dbFirst(env,
    "SELECT u.id, u.email, u.name, u.is_admin, u.stripe_account_id FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?",
    await hashToken(token), nowISO());
  return row || null;
}

export function adminEmails(env) {
  return String((env && env.ADMIN_EMAILS) || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}
export function isAdminUser(env, user) {
  return !!user && (user.is_admin === 1 || adminEmails(env).includes(String(user.email || "").toLowerCase()));
}
