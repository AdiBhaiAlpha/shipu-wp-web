/**
 * ShiPu WP - hash router.
 *
 * One `index.html` serves every page, which is what a Render static site wants:
 * no server rewrites, no `_redirects`, and links that work from any sub-path.
 *
 * Routes look like `#/purchase?session=abc`. Query parameters are also read
 * from `location.search` so a deep link of the form
 * `index.html?session=abc#/purchase` (what the Termux tool opens) works too.
 */

const routes = new Map();
let notFoundHandler = null;
let beforeEach = null;
let current = { path: "/", query: {}, hash: "" };
let started = false;

/** Register a route. `path` is like `/dashboard` or `/purchase`. */
export function route(path, handler) {
  routes.set(normalise(path), handler);
  return handler;
}

export function setNotFound(handler) {
  notFoundHandler = handler;
}

export function onBeforeNavigate(handler) {
  beforeEach = handler;
}

function normalise(path) {
  const value = String(path || "/").trim();
  const withSlash = value.startsWith("/") ? value : `/${value}`;
  return withSlash.length > 1 ? withSlash.replace(/\/+$/, "") : withSlash;
}

export function parseLocation() {
  const raw = location.hash.replace(/^#/, "") || "/";
  const [pathPart, queryPart = ""] = raw.split("?");
  const query = {};
  for (const pair of queryPart.split("&")) {
    if (!pair) continue;
    const index = pair.indexOf("=");
    const key = decodeURIComponent(index < 0 ? pair : pair.slice(0, index));
    const value = index < 0 ? "" : decodeURIComponent(pair.slice(index + 1).replace(/\+/g, " "));
    if (key) query[key] = value;
  }

  // Pre-hash query params (the Termux deep-link shape) are merged in, with the
  // hash query winning because it is more specific.
  for (const pair of location.search.replace(/^\?/, "").split("&")) {
    if (!pair) continue;
    const index = pair.indexOf("=");
    const key = decodeURIComponent(index < 0 ? pair : pair.slice(0, index));
    const value = index < 0 ? "" : decodeURIComponent(pair.slice(index + 1).replace(/\+/g, " "));
    if (key && !(key in query)) query[key] = value;
  }

  return { path: normalise(pathPart), query, hash: raw };
}

export function currentRoute() {
  return current;
}

/** Build a hash href for a route (keeps query params in the hash). */
export function href(path, query = null) {
  const base = `#${normalise(path)}`;
  if (!query) return base;
  const pairs = Object.entries(query)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
  return pairs.length ? `${base}?${pairs.join("&")}` : base;
}

export function navigate(path, query = null, { replace = false } = {}) {
  const target = href(path, query);
  if (location.hash === target) {
    return resolve();
  }
  if (replace) location.replace(target);
  else location.hash = target;
  return undefined;
}

/** Plain in-page navigation (same document). */
export function to(path, query = null) {
  location.hash = href(path, query);
}

let resolving = false;

async function resolve() {
  if (resolving) return;
  resolving = true;
  try {
    const next = parseLocation();
    if (beforeEach) {
      const redirect = await beforeEach(next, current);
      if (redirect !== undefined && redirect !== null && redirect !== false) {
        resolving = false;
        if (typeof redirect === "string") navigate(redirect);
        return;
      }
    }
    current = next;
    const handler = routes.get(next.path);
    if (handler) await handler(next);
    else if (notFoundHandler) await notFoundHandler(next);
  } catch (error) {
    console.error("[shipuwp] route failed", error);
  } finally {
    resolving = false;
  }
}

/** Start listening. Call once, after routes are registered. */
export function start() {
  if (started) return;
  started = true;
  window.addEventListener("hashchange", resolve);
  if (!location.hash) {
    location.replace("#/");
  }
  resolve();
}

export { resolve as refresh };