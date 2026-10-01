/**
 * ShiPu WP - static site configuration.
 *
 * Everything in this file is a *public client* identifier or a deployment knob.
 * There are no secrets here and there must never be any: the Firebase Admin
 * SDK and the payment HMAC secret live on the Render Web Service only.
 */

/* ------------------------------------------------------------------ *
 * Firebase (public client config - safe to embed)
 * ------------------------------------------------------------------ */
export const firebaseConfig = {
  apiKey: "AIzaSyBIuJFn74hJK1LT_Shcl-Y5DMgiOArB8Ps",
  authDomain: "shipu-ai.firebaseapp.com",
  databaseURL: "https://shipu-ai-default-rtdb.firebaseio.com",
  projectId: "shipu-ai",
  storageBucket: "shipu-ai.firebasestorage.app",
  messagingSenderId: "953122849300",
  appId: "1:953122849300:web:f821f1a161ce7879001d01",
  measurementId: "G-N2WMSS3MNG"
};

/**
 * ShiPu owns a *namespaced* subtree of the shared `shipu-ai` Realtime Database.
 * Another application owns the root `users/` and `bot/` nodes, so every read and
 * write from this site is prefixed - never bare `users/...`.
 *
 * Deploying against a database without the namespace only requires the rules in
 * `firebase/database.rules.json` to be re-rooted under `shipuwp/`.
 */
export const SHIPU_NAMESPACE = "shipuwp";

/**
 * Base URL of the Render Web Service that owns every privileged operation.
 *
 * EMPTY BY DESIGN. While this is empty the site refuses to pretend: the
 * dashboard shows a "Not configured" notice, the purchase page refuses to
 * continue, and the admin panel shows an explicit "Admin API not configured"
 * state. Nothing is ever faked client-side.
 *
 * Fill in one of these at deploy time:
 *   1. edit this constant, or
 *   2. set <meta name="shipu-backend" content="https://..."> in index.html,
 *      or
 *   3. define window.SHIPU_BACKEND_URL before any module loads.
 */
export const BACKEND_URL = "";

/** Firebase JS SDK version served from the gstatic CDN (ESM). */
export const FIREBASE_SDK_VERSION = "10.12.5";
export const FIREBASE_CDN = `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}`;

/* ------------------------------------------------------------------ *
 * Synthetic email mapping
 * ------------------------------------------------------------------ */
export const AUTH_EMAIL_DOMAIN = "shipu-wp.local";

/** `Rahim` -> `rahim@shipu-wp.local` (the only mapping the site will make). */
export function emailForUsername(username) {
  return `${String(username || "").trim().toLowerCase()}@${AUTH_EMAIL_DOMAIN}`;
}

export function usernameFromEmail(email) {
  const raw = String(email || "");
  const at = raw.lastIndexOf("@");
  return at > 0 ? raw.slice(0, at) : raw;
}

/* ------------------------------------------------------------------ *
 * Username rules (mirrored client-side only to give fast feedback)
 * ------------------------------------------------------------------ */
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 24;
export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

export function validateUsername(raw) {
  const value = String(raw || "").trim().toLowerCase();
  if (!value) return "Username is required.";
  if (value.length < USERNAME_MIN) return `Username must be at least ${USERNAME_MIN} characters.`;
  if (value.length > USERNAME_MAX) return `Username must be at most ${USERNAME_MAX} characters.`;
  if (!USERNAME_PATTERN.test(value)) {
    return "Use lowercase letters, numbers, dot, dash or underscore only.";
  }
  return "";
}

export function validatePassword(raw) {
  const value = String(raw || "");
  if (!value) return "Password is required.";
  if (value.length < 6) return "Password must be at least 6 characters.";
  return "";
}

/* ------------------------------------------------------------------ *
 * Pricing - read from the database, never hard-coded in markup
 * ------------------------------------------------------------------ */

/**
 * Fallback used only while `shipuwp/pricing/pro` is unreadable (offline, or the
 * path does not exist yet). A `priceCents` of 0 means "not published yet" and
 * the UI says exactly that instead of inventing a number.
 *
 * Tune these three numbers to your deployment - they are the only prices the
 * site will ever display.
 */
export const PRICING_FALLBACK = {
  priceCents: 0,
  currency: "USD",
  durationDays: 30
};

/** Free-tier allowance, used when `shipuwp/config/freeDailyReplies` is absent. */
export const FREE_DAILY_REPLIES_FALLBACK = 25;

/** Pro duration used by the purchase copy when pricing is unavailable. */
export const PRO_DURATION_DAYS_FALLBACK = PRICING_FALLBACK.durationDays;

/**
 * Payment methods offered when `shipuwp/config/paymentMethods` is absent.
 * Each entry is `{ id, label, hint }`; the admin SDK owns the real list.
 */
export const PAYMENT_METHODS_FALLBACK = [
  { id: "bkash", label: "bKash", hint: "Send to the number in the confirmation SMS." },
  { id: "nagad", label: "Nagad", hint: "Send to the number in the confirmation SMS." },
  { id: "manual", label: "Manual / Bank transfer", hint: "Include your username in the reference." }
];

/** Plan identifiers as the authoritative backend stores them. */
export const PLAN_FREE = "free";
export const PLAN_PRO = "pro";

export const PAYMENT_PENDING = "pending";
export const PAYMENT_VERIFIED = "verified";
export const PAYMENT_REJECTED = "rejected";

export const SUB_ACTIVE = "active";
export const SUB_EXPIRED = "expired";
export const SUB_NONE = "none";

/* ------------------------------------------------------------------ *
 * Site copy
 * ------------------------------------------------------------------ */
export const APP_NAME = "ShiPu WP";
export const APP_TAGLINE = "AI-powered WhatsApp Assistant";
export const APP_DESCRIPTION =
  "Automatically generate intelligent replies to your WhatsApp messages using AI.";
export const APP_VERSION = "1.0.0";

/** Storage key for the in-flight purchase session and last submitted payment. */
export const STORAGE_KEYS = {
  purchase: "shipuwp.purchase.intent",
  lastPayment: "shipuwp.payment.last"
};