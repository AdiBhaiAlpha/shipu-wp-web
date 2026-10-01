/**
 * ShiPu WP - shared UI primitives.
 *
 * Formatting, DOM helpers and the small component factories used by both the
 * public site (app.js) and the admin panel (admin.js). No business logic lives
 * here, and nothing in this file can grant an entitlement.
 */

import { renderWordmark } from "./wordmark.js";

/* ------------------------------------------------------------------ *
 * DOM helpers
 * ------------------------------------------------------------------ */

export const $ = (selector, scope = document) => scope.querySelector(selector);
export const $$ = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));

/** Deeply flattens nested arrays and drops empty placeholders. */
export function flatten(value, out = []) {
  if (value === undefined || value === null || value === false) return out;
  if (Array.isArray(value)) {
    value.forEach((item) => flatten(item, out));
    return out;
  }
  out.push(value);
  return out;
}

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "html") node.innerHTML = value;
    else if (key === "text") node.textContent = value;
    else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else node.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of flatten(children)) {
    const isNode = typeof Node !== "undefined" && child instanceof Node;
    node.appendChild(isNode ? child : document.createTextNode(String(child)));
  }
  return node;
}

/** Tagged template that escapes interpolations unless marked with `raw()`. */
const RAW = Symbol("raw");
export function raw(value) {
  return { [RAW]: String(value) };
}

export function html(strings, ...values) {
  let out = "";
  strings.forEach((chunk, index) => {
    out += chunk;
    const value = values[index];
    if (value === undefined || value === null || value === false) return;
    if (value && typeof value === "object" && RAW in value) out += value[RAW];
    else if (Array.isArray(value)) out += value.map((item) => escapeHtml(item)).join("");
    else out += escapeHtml(value);
  });
  return out;
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Set innerHTML from a `html` tagged template result. */
export function setContent(node, markup) {
  if (node) node.innerHTML = markup;
  return node;
}

/* ------------------------------------------------------------------ *
 * Formatting
 * ------------------------------------------------------------------ */

const CURRENCY_SYMBOLS = { USD: "$", EUR: "€", GBP: "£", BDT: "৳", INR: "₹", NGN: "₦" };

/** `4500 BDT` -> `BDT 45.00`. Returns a placeholder when unpublished. */
export function formatMoney(priceCents, currency = "USD") {
  const cents = Number(priceCents);
  if (!Number.isFinite(cents) || cents <= 0) return "—";
  const amount = cents / 100;
  const code = String(currency || "USD").toUpperCase();
  const symbol = CURRENCY_SYMBOLS[code];
  const fixed = amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return symbol ? `${symbol}${fixed}` : `${fixed} ${code}`;
}

export function currencyCode(currency = "USD") {
  return String(currency || "USD").toUpperCase();
}

/** epoch ms -> `YYYY-MM-DD` in UTC, or a dash. */
export function formatDate(epochMs) {
  const ms = Number(epochMs);
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  return new Date(ms).toISOString().slice(0, 10);
}

/** epoch ms -> `YYYY-MM-DD HH:MM UTC`. */
export function formatDateTime(epochMs) {
  const ms = Number(epochMs);
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  return `${formatDate(ms)} ${new Date(ms).toISOString().slice(11, 16)} UTC`;
}

export function formatRelative(epochMs) {
  const ms = Number(epochMs);
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  const delta = ms - Date.now();
  const abs = Math.abs(delta);
  const units = [
    [86_400_000, "day"],
    [3_600_000, "hour"],
    [60_000, "min"]
  ];
  for (const [size, name] of units) {
    if (abs >= size) {
      const count = Math.floor(abs / size);
      const plural = count === 1 ? name : `${name}s`;
      return delta > 0 ? `in ${count} ${plural}` : `${count} ${plural} ago`;
    }
  }
  return delta >= 0 ? "in a moment" : "just now";
}

export function clampNumber(value, min = 0, max = 100) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}

export function pluralise(count, singular, plural) {
  // "-y" words become "-ies": reply -> replies.
  const many = plural ?? (/(?:[^aeiou])y$/i.test(singular) ? `${singular.slice(0, -1)}ies` : `${singular}s`);
  return `${count} ${count === 1 ? singular : many}`;
}

/* ------------------------------------------------------------------ *
 * Components
 * ------------------------------------------------------------------ */

/** Section kicker: `// pricing`. */
export function kicker(text) {
  return el("p", { class: "kicker" }, [el("span", { class: "kicker-slash" }, ["//"]), " ", text]);
}

export function chip(text, tone = "neutral") {
  return el("span", { class: `chip chip-${tone}` }, [text]);
}

const STATUS_TONES = {
  active: "success",
  pending: "warning",
  verified: "success",
  rejected: "error",
  expired: "warning",
  none: "neutral",
  pro: "accent",
  free: "neutral",
  unknown: "neutral"
};

export function statusChip(value) {
  const key = String(value || "unknown").toLowerCase();
  return chip(String(value || "unknown").toUpperCase(), STATUS_TONES[key] || "neutral");
}

/**
 * A notice. `tone` is one of info | success | warning | error | muted.
 * Used everywhere the site has to be honest about a limitation.
 */
export function notice(tone, title, body, actions = []) {
  const bodyNodes = [];
  if (Array.isArray(body)) {
    body.filter(Boolean).forEach((line) => {
      const isNode = typeof Node !== "undefined" && line instanceof Node;
      bodyNodes.push(isNode ? line : el("p", { class: "notice-text" }, [String(line)]));
    });
  } else if (typeof body === "string" && body) {
    bodyNodes.push(el("p", { class: "notice-text", html: escapeHtml(body) }));
  } else if (body) {
    bodyNodes.push(body);
  }
  const actionNodes = flatten(actions);
  const node = el("div", { class: `notice notice-${tone}`, role: tone === "error" ? "alert" : "status" }, [
    el("div", { class: "notice-icon", "aria-hidden": "true" }, [NOTICE_GLYPH[tone] || "i"]),
    el("div", { class: "notice-body" }, [
      title ? el("p", { class: "notice-title" }, [title]) : null,
      bodyNodes,
      actionNodes.length ? el("div", { class: "notice-actions" }, actionNodes) : null
    ])
  ]);
  return node;
}

const NOTICE_GLYPH = {
  info: "i",
  success: "\u2713",
  warning: "!",
  error: "\u00d7",
  muted: "\u2013"
};

/** Progress meter drawn with CSS - the web twin of the terminal's block meter. */
export function meter(used, limit, tone = "primary") {
  const usedValue = clampNumber(used, 0, limit || 100);
  const percent = limit ? (usedValue / limit) * 100 : 0;
  return el(
    "div",
    {
      class: "meter",
      role: "progressbar",
      "aria-valuenow": String(usedValue),
      "aria-valuemin": "0",
      "aria-valuemax": String(limit || 0),
      "aria-label": `${usedValue} of ${limit || 0} used`
    },
    [
      el("span", { class: `meter-fill meter-${tone}`, style: `width:${percent.toFixed(1)}%` }),
      ...Array.from({ length: 20 }, (_, index) =>
        el("span", { class: `meter-tick${index < Math.round(percent / 5) ? " on" : ""}` })
      )
    ]
  );
}

/** Definition row used across the dashboard and purchase summary. */
export function dataRow(label, value, tone = "") {
  return el("div", { class: "data-row" }, [
    el("span", { class: "data-label" }, [label]),
    el("span", { class: `data-value${tone ? ` is-${tone}` : ""}` }, [value])
  ]);
}

export function statCard(label, value, note = "", tone = "primary") {
  return el("article", { class: `stat stat-${tone}` }, [
    el("p", { class: "stat-label" }, [label]),
    el("p", { class: "stat-value" }, [String(value)]),
    note ? el("p", { class: "stat-note" }, [note]) : null
  ]);
}

/* ------------------------------------------------------------------ *
 * Toasts
 * ------------------------------------------------------------------ */

let toastHost = null;

export function toast(message, tone = "info", ttl = 4200) {
  if (!toastHost) {
    toastHost = el("div", { class: "toast-host", "aria-live": "polite" });
    document.body.appendChild(toastHost);
  }
  const node = el("div", { class: `toast toast-${tone}` }, [
    el("span", { class: "toast-dot", "aria-hidden": "true" }),
    el("span", { class: "toast-text" }, [message])
  ]);
  toastHost.appendChild(node);
  requestAnimationFrame(() => node.classList.add("in"));
  window.setTimeout(() => {
    node.classList.remove("in");
    window.setTimeout(() => node.remove(), 240);
  }, ttl);
  return node;
}

/* ------------------------------------------------------------------ *
 * Confirmation dialog (native <dialog>, no dependency)
 * ------------------------------------------------------------------ */

/**
 * Modal confirmation. Resolves true only when the user confirms.
 * The caller must NOT perform the privileged call from here - it resolves and
 * lets the caller decide.
 */
export function confirmDialog({ title, message, confirmLabel = "Confirm", cancelLabel = "Cancel", tone = "primary" }) {
  return new Promise((resolve) => {
    const dialog = el("dialog", { class: `modal modal-${tone}` }, [
      el("form", { method: "dialog", class: "modal-form" }, [
        el("h2", { class: "modal-title" }, [title]),
        el("p", { class: "modal-message", html: message }),
        el("div", { class: "modal-actions" }, [
          el("button", { class: "btn btn-ghost", value: "cancel", type: "submit" }, [cancelLabel]),
          el("button", { class: `btn btn-${tone}`, value: "confirm", type: "submit" }, [confirmLabel])
        ])
      ])
    ]);
    document.body.appendChild(dialog);
    dialog.addEventListener("close", () => {
      const result = dialog.returnValue === "confirm";
      dialog.remove();
      resolve(result);
    });
    dialog.showModal();
  });
}

/* ------------------------------------------------------------------ *
 * Busy state
 * ------------------------------------------------------------------ */

export function busyLabel(text) {
  return el("p", { class: "busy" }, [el("span", { class: "spinner", "aria-hidden": "true" }), text]);
}

export function setBusy(button, isBusy, busyText = "Working…") {
  if (!button) return;
  if (isBusy) {
    button.dataset.idleLabel = button.dataset.idleLabel || button.textContent;
    button.textContent = busyText;
    button.disabled = true;
    button.classList.add("is-busy");
  } else {
    button.textContent = button.dataset.idleLabel || button.textContent;
    button.disabled = false;
    button.classList.remove("is-busy");
  }
}

/* ------------------------------------------------------------------ *
 * Wordmark convenience re-export
 * ------------------------------------------------------------------ */

export { renderWordmark };