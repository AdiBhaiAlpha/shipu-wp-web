/**
 * ShiPu WP - data access layer.
 *
 * One module owns three things so the rest of the site never touches them:
 *   * Firebase (Auth + Realtime Database), always under SHIPU_NAMESPACE
 *   * the Render backend client (bearer-token JSON over fetch)
 *   * normalisation of errors into messages a human can act on
 *
 * Rule that this module exists to enforce: the browser NEVER decides a payment
 * succeeded and NEVER grants a plan. Reads are for display; anything that
 * matters is a server endpoint.
 */

import {
  firebaseConfig,
  SHIPU_NAMESPACE,
  BACKEND_URL,
  FIREBASE_CDN,
  emailForUsername,
  usernameFromEmail,
  PRICING_FALLBACK,
  FREE_DAILY_REPLIES_FALLBACK,
  PAYMENT_METHODS_FALLBACK,
  STORAGE_KEYS
} from "./firebase-config.js";

/* ------------------------------------------------------------------ *
 * Deployment override for BACKEND_URL
 * ------------------------------------------------------------------ */

/**
 * Resolve the backend base URL. Priority:
 *   window.SHIPU_BACKEND_URL  >  <meta name="shipu-backend">  >  BACKEND_URL
 * Returns "" when nothing is configured - callers must handle that honestly.
 */
export function backendUrl() {
  const fromWindow =
    typeof window !== "undefined" && window.SHIPU_BACKEND_URL
      ? String(window.SHIPU_BACKEND_URL)
      : "";
  const fromMeta =
    typeof document !== "undefined"
      ? document.querySelector('meta[name="shipu-backend"]')?.content || ""
      : "";
  const raw = (fromWindow || fromMeta || BACKEND_URL || "").trim();
  return raw ? raw.replace(/\/+$/, "") : "";
}

export function isBackendConfigured() {
  return backendUrl() !== "";
}

/* ------------------------------------------------------------------ *
 * Firebase bootstrap
 *
 * Loading the SDK is done inside a promise rather than at module top level so
 * that a blocked CDN degrades into an explicit error banner instead of a blank
 * page. Every exported function awaits `firebaseReady()` before using `auth`.
 * ------------------------------------------------------------------ */

export let auth = null;
export let db = null;
export let firebaseError = null;

let firebaseBoot = null;

function bootFirebase() {
  if (firebaseBoot) return firebaseBoot;
  firebaseBoot = (async () => {
    const [appModule, authModule, dbModule] = await Promise.all([
      import(`${FIREBASE_CDN}/firebase-app.js`),
      import(`${FIREBASE_CDN}/firebase-auth.js`),
      import(`${FIREBASE_CDN}/firebase-database.js`)
    ]);

    const app = appModule.initializeApp(firebaseConfig);
    auth = authModule.getAuth(app);
    db = dbModule.getDatabase(app);

    try {
      await authModule.setPersistence(auth, authModule.browserLocalPersistence);
    } catch {
      /* private-mode browsers fall back to in-memory persistence */
    }
    return true;
  })().catch((error) => {
    firebaseError = error instanceof Error ? error : new Error(String(error));
    throw firebaseError;
  });
  return firebaseBoot;
}

/** Resolves once Firebase is usable; rejects with a human-readable failure. */
export function firebaseReady() {
  return bootFirebase();
}

function firebaseLibraries() {
  return Promise.all([
    import(`${FIREBASE_CDN}/firebase-auth.js`),
    import(`${FIREBASE_CDN}/firebase-database.js`)
  ]);
}

/** Build a namespaced Realtime Database path: `ns('users', uid)`. */
export function ns(...parts) {
  const clean = parts
    .filter((part) => part !== undefined && part !== null && part !== "")
    .map((part) => String(part).replace(/[.#$/[\]]/g, "_"));
  return [SHIPU_NAMESPACE, ...clean].join("/");
}

export async function refAt(...parts) {
  await firebaseReady();
  const [, dbModule] = await firebaseLibraries();
  return dbModule.ref(db, ns(...parts));
}

export async function readAt(...parts) {
  const [, dbModule] = await firebaseLibraries();
  const snapshot = await dbModule.get(await refAt(...parts));
  return snapshot.val();
}

export async function writeAt(value, ...parts) {
  const [, dbModule] = await firebaseLibraries();
  return dbModule.set(await refAt(...parts), value);
}

export async function patchAt(value, ...parts) {
  const [, dbModule] = await firebaseLibraries();
  return dbModule.update(await refAt(...parts), value);
}

/* ------------------------------------------------------------------ *
 * Authentication
 * ------------------------------------------------------------------ */

export async function onUserChanged(handler) {
  await firebaseReady();
  const authModule = await import(`${FIREBASE_CDN}/firebase-auth.js`);
  return authModule.onAuthStateChanged(auth, (user) =>
    handler(
      user
        ? {
            uid: user.uid,
            email: user.email,
            username: usernameFromEmail(user.email),
            displayName: user.displayName || ""
          }
        : null
    )
  );
}

export async function signIn(username, password) {
  await firebaseReady();
  const authModule = await import(`${FIREBASE_CDN}/firebase-auth.js`);
  const credential = await authModule.signInWithEmailAndPassword(
    auth,
    emailForUsername(username),
    password
  );
  await touchLastLogin(credential.user.uid);
  return credential.user;
}

export async function register(username, password) {
  await firebaseReady();
  const authModule = await import(`${FIREBASE_CDN}/firebase-auth.js`);
  const credential = await authModule.createUserWithEmailAndPassword(
    auth,
    emailForUsername(username),
    password
  );
  // displayName is client-writable; the authoritative `username` under the
  // database namespace is owned by the backend.
  await authModule
    .updateProfile(credential.user, { displayName: String(username).trim() })
    .catch(() => {});
  return credential.user;
}

export async function requestPasswordReset(username) {
  await firebaseReady();
  const authModule = await import(`${FIREBASE_CDN}/firebase-auth.js`);
  return authModule.sendPasswordResetEmail(auth, emailForUsername(username));
}

export async function signOutUser() {
  await firebaseReady();
  const authModule = await import(`${FIREBASE_CDN}/firebase-auth.js`);
  return authModule.signOut(auth);
}

export function currentUser() {
  return auth ? auth.currentUser : null;
}

export async function idToken() {
  const user = currentUser();
  return user ? user.getIdToken() : "";
}

/** Refresh the cached ID token before a privileged call. */
export async function freshIdToken() {
  const user = currentUser();
  if (!user) return "";
  try {
    return await user.getIdToken(true);
  } catch {
    return user.getIdToken();
  }
}

async function touchLastLogin(uid) {
  try {
    await patchAt({ lastLoginAt: Date.now() }, "users", uid);
  } catch {
    /* rules or offline mode - the server refreshes this anyway */
  }
}

const AUTH_MESSAGES = {
  "auth/invalid-email": "That username does not map to a valid address.",
  "auth/user-not-found": "No account exists with that username.",
  "auth/wrong-password": "Incorrect password.",
  "auth/invalid-credential": "Incorrect username or password.",
  "auth/invalid-login-credentials": "Incorrect username or password.",
  "auth/email-already-in-use": "That username is already taken.",
  "auth/weak-password": "Password must be at least 6 characters.",
  "auth/too-many-requests": "Too many attempts. Try again in a moment.",
  "auth/network-request-failed": "Network error. Check your connection.",
  "auth/requires-recent-login": "Please sign in again to continue.",
  "auth/popup-closed-by-user": "The sign-in window was closed.",
  "auth/operation-not-allowed": "Email/password sign-in is disabled for this project."
};

export function humaniseAuthError(error) {
  const code = error?.code || "";
  return AUTH_MESSAGES[code] || error?.message || "Authentication failed.";
}

/* ------------------------------------------------------------------ *
 * Admin authorisation - client-side gate, NOT the security boundary
 * ------------------------------------------------------------------ */

/**
 * The website's own gate before it will even ask for admin data. The server
 * re-checks `admins/{uid}.active` on every call, so this only saves a round
 * trip and never grants anything.
 */
export async function isAdmin(uid) {
  if (!uid) return false;
  try {
    const record = (await readAt("admins", uid)) || {};
    return record.active === true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ *
 * Backend HTTP client
 * ------------------------------------------------------------------ */

export class BackendError extends Error {
  constructor(message, { status = 0, code = "", payload = null } = {}) {
    super(message);
    this.name = "BackendError";
    this.status = status;
    this.code = code;
    this.payload = payload;
  }
}

/** Raised whenever the site is asked to do something the backend must own. */
export class NotConfiguredError extends Error {
  constructor(what = "The ShiPu WP API") {
    super(`${what} is not configured on this deployment.`);
    this.name = "NotConfiguredError";
  }
}

async function request(path, { method = "GET", body = null } = {}) {
  const base = backendUrl();
  if (!base) throw new NotConfiguredError();

  const token = await freshIdToken();
  if (!token) {
    throw new BackendError("You must be signed in to perform this action.", { status: 401 });
  }

  let response;
  try {
    response = await fetch(`${base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {})
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store"
    });
  } catch {
    throw new BackendError("Could not reach the ShiPu WP API. Check your connection.", { status: 0 });
  }

  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { error: text.slice(0, 300) };
    }
  }

  if (!response.ok) {
    throw new BackendError(extractMessage(payload, response.status), {
      status: response.status,
      code: (typeof payload?.error === "string" && payload.error) || payload?.code || "",
      payload
    });
  }
  return payload || {};
}

function extractMessage(payload, status) {
  const raw = payload?.message || payload?.detail || payload?.error_description;
  const message = typeof raw === "string" && raw ? raw : typeof payload?.error === "string" ? payload.error : "";
  if (message) {
    return status === 503 ? `${message} (the backend is not configured)` : message;
  }
  if (status === 403) return "Administrator access required.";
  if (status === 404) return "Not found.";
  if (status === 503) return "The ShiPu WP API is not configured on the server.";
  return `Request failed (HTTP ${status}).`;
}

/* ---- Account ---------------------------------------------------- */

/** Authoritative entitlement: the only source the site displays as truth. */
export function syncAccount() {
  return request("/account/sync", { method: "POST", body: {} });
}

/* ---- Purchase ---------------------------------------------------- */

/** Mint a purchase session. Only the backend can: the UID comes from the token. */
export function createPurchaseSession(plan = "pro") {
  return request("/purchase/session", { method: "POST", body: { plan } });
}

/**
 * Submit a payment. Returns `{ paymentId, status: "pending" }`.
 * A pending payment grants NOTHING - only admin verification activates Pro.
 */
export function submitPayment(payload) {
  return request("/payments", { method: "POST", body: payload });
}

/* ---- Admin ------------------------------------------------------ */

export function adminStats() {
  return request("/admin/stats", { method: "GET" });
}

export function adminPayments(status = "pending") {
  const query = status ? `?status=${encodeURIComponent(status)}` : "";
  return request(`/admin/payments${query}`, { method: "GET" });
}

/** Authoritative Pro activation, including the 30-day renewal arithmetic. */
export function verifyPayment(paymentId) {
  return request(`/admin/payments/${encodeURIComponent(paymentId)}/verify`, {
    method: "POST",
    body: {}
  });
}

export function rejectPayment(paymentId, reason = "") {
  return request(`/admin/payments/${encodeURIComponent(paymentId)}/reject`, {
    method: "POST",
    body: { reason }
  });
}

/* ------------------------------------------------------------------ *
 * Purchase session token (display only)
 * ------------------------------------------------------------------ */

function decodeBase64Url(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/**
 * The session token is `base64url(payload).base64url(hmac)`.
 *
 * The site decodes the payload for DISPLAY ONLY. It cannot and must not verify
 * the signature - the HMAC secret lives on the server. The backend re-verifies
 * the token when the payment is submitted and derives the real UID from the
 * Firebase bearer token, never from anything in this payload.
 */
export function decodeSessionToken(token) {
  const raw = String(token || "").trim();
  if (!raw || !raw.includes(".")) return { ok: false, reason: "malformed" };
  const [body] = raw.split(".");
  try {
    const payload = JSON.parse(decodeBase64Url(body));
    if (!payload || typeof payload !== "object" || !payload.uid) {
      return { ok: false, reason: "malformed" };
    }
    return { ok: true, payload };
  } catch {
    return { ok: false, reason: "malformed" };
  }
}

/** A purchase session is valid for 10 minutes (server/purchase.py:TOKEN_TTL_MS). */
export const PURCHASE_SESSION_TTL_MS = 10 * 60 * 1000;

export function isSessionExpired(payload) {
  const expiresAt = Number(payload?.expiresAt || 0);
  if (!expiresAt) return true;
  return expiresAt <= Date.now();
}

/* ------------------------------------------------------------------ *
 * Purchase intent carried across the auth detour
 * ------------------------------------------------------------------ */

export function savePurchaseIntent(sessionToken) {
  try {
    sessionStorage.setItem(STORAGE_KEYS.purchase, String(sessionToken || ""));
  } catch {
    /* storage disabled - the hash route still carries the session */
  }
}

export function loadPurchaseIntent() {
  try {
    return sessionStorage.getItem(STORAGE_KEYS.purchase) || "";
  } catch {
    return "";
  }
}

export function clearPurchaseIntent() {
  try {
    sessionStorage.removeItem(STORAGE_KEYS.purchase);
  } catch {
    /* ignore */
  }
}

export function rememberPayment(paymentId, username) {
  try {
    sessionStorage.setItem(
      STORAGE_KEYS.lastPayment,
      JSON.stringify({ paymentId, username, at: Date.now() })
    );
  } catch {
    /* ignore */
  }
}

export function recallPayment() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEYS.lastPayment);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && parsed.paymentId ? parsed : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * Public configuration reads (rules allow anonymous reads on these paths)
 * ------------------------------------------------------------------ */

/** Pro price. Never hard-coded in markup. */
export async function loadPricing() {
  const record = (await readAt("pricing", "pro").catch(() => null)) || {};
  const fromDb = Number(record.priceCents);
  const priceCents = Number.isFinite(fromDb) ? fromDb : PRICING_FALLBACK.priceCents;
  return {
    priceCents,
    currency: record.currency || PRICING_FALLBACK.currency,
    durationDays: Number(record.durationDays) || PRICING_FALLBACK.durationDays,
    published: priceCents > 0,
    source: fromDb > 0 ? "database" : "fallback"
  };
}

export async function loadPaymentMethods() {
  const record = (await readAt("config", "paymentMethods").catch(() => null)) || null;
  if (!record || typeof record !== "object") return PAYMENT_METHODS_FALLBACK;
  const list = Object.entries(record)
    .filter(([, value]) => value !== false && value?.enabled !== false)
    .map(([id, value]) => ({
      id,
      label: value?.label || id.toUpperCase(),
      hint: value?.hint || ""
    }));
  return list.length ? list : PAYMENT_METHODS_FALLBACK;
}

export async function loadFreeDailyReplies() {
  const value = Number(await readAt("config", "freeDailyReplies").catch(() => null));
  return Number.isFinite(value) && value > 0 ? value : FREE_DAILY_REPLIES_FALLBACK;
}

/**
 * Local mirror of the caller's own account record. Rules restrict `users/{uid}`
 * to its owner. Used ONLY as a clearly-labelled fallback when the backend is
 * unconfigured - never presented as authoritative.
 */
export function readLocalAccount(uid) {
  return readAt("users", uid).catch(() => null);
}

/**
 * Own payment record read straight from the database. Rules allow the read only
 * when `payments/{id}.uid === auth.uid`, so it can never expose another user's
 * payment. Powers "Refresh Status".
 */
export async function readOwnPayment(paymentId, uid) {
  if (!paymentId || !uid) return null;
  const record = await readAt("payments", paymentId).catch(() => null);
  if (!record) return null;
  return !record.uid || record.uid === uid ? record : null;
}