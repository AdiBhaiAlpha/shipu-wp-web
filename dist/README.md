# ShiPu WP — static site

Static website and payment-review console for ShiPu WP. No build step, no
bundler, no npm install: every file here is served as-is. Upload the whole
`dist/` folder to a static host (Render static site, GitHub Pages, Netlify,
nginx, anything).

```
dist/
├── index.html            single-page app shell (all public routes)
├── admin/index.html      guarded payment-review console
├── purchase.html         shim for legacy /purchase?session=... deep links
├── 404.html              not-found page
├── robots.txt
├── .nojekyll             stops GitHub Pages from eating underscore dirs
└── assets/
    ├── style.css         the entire design system
    ├── firebase-config.js  Firebase config + namespace + fallbacks  ← EDIT THIS
    ├── api.js            Firebase + backend API client
    ├── router.js         hash router
    ├── ui.js             DOM helpers and shared components
    ├── wordmark.js       block-letter "SHIPU WP" renderer
    ├── app.js            public routes
    └── admin.js          admin routes
```

All scripts are ES modules and all paths are relative, so `dist/` can be
served from any sub-path without rewriting anything.

## Routes

Hash routes, so no server rewrite rules are needed.

| Route | What it does |
| --- | --- |
| `#/` | Landing page |
| `#/pricing` | Free vs Pro comparison |
| `#/login`, `#/register` | Firebase email/password auth |
| `#/dashboard` | Plan, quota and usage from the server |
| `#/purchase` | Order summary for a backend-minted session |
| `#/payment` | Payment submission form |
| `#/payment-pending` | Submitted, awaiting admin review |
| `#/payment-success` | Verified by an admin (only if the record really is) |
| `#/payment-failed` | Rejected by an admin, with the reason |
| `/admin/` | Payment review console |

## Configuration

Edit `assets/firebase-config.js`:

```js
export const FIREBASE_CONFIG = { /* apiKey, authDomain, projectId, ... */ };
export const NAMESPACE = "shipuwp";       // keep as "shipuwp"
export const BACKEND_URL = "";             // ← set to your ShiPu WP API
```

`BACKEND_URL` ships **empty on purpose**. Until it is set, the site says so
out loud instead of pretending: checkout and the admin console show
"NOT CONFIGURED" panels, and no request is ever sent.

Two overrides exist so you can deploy without editing files:

```html
<script>window.SHIPU_BACKEND_URL = "https://shipu-api.onrender.com";</script>
```

```html
<meta name="shipu-backend" content="https://shipu-api.onrender.com">
```

### Firebase Realtime Database paths

Everything is namespaced under `shipuwp/`:

| Path | Contents |
| --- | --- |
| `shipuwp/config/freeDailyReplies` | Free-tier daily reply cap |
| `shipuwp/config/paymentMethods` | `{ "bkash": { "label": "bKash", "hint": "..." } }` |
| `shipuwp/pricing/pro` | `{ "priceCents": 1200, "currency": "USD", "durationDays": 30 }` |
| `shipuwp/users/{uid}` | `username`, `plan`, `subscription`, `usage` |
| `shipuwp/payments/{paymentId}` | Client-readable copy of a payment record |
| `shipuwp/admins/{uid}` | `{ "role": "admin", "active": true }` |

> **Deploying note:** the checked-in `firebase/database.rules.json` in this
> repository is written against root-level paths (`users/...`, `bot/...`). The
> site reads and writes `shipuwp/...`, so the ruleset has to be re-rooted under
> `shipuwp/` before this site can read its own config and pricing. Until then
> the site degrades to its honest fallbacks rather than failing silently.

## Backend API contract

Every call sends `Authorization: Bearer <Firebase ID token>`. The UID is always
derived server-side from that token.

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/account/sync` | Authoritative plan, quota and expiry |
| `POST` | `/payments` | Record a payment as `pending` |
| `GET` | `/admin/stats` | User and payment counts |
| `GET` | `/admin/payments` | Payment list, filterable by status |
| `POST` | `/admin/payments/{id}/verify` | Activate Pro (server checks the admin flag) |
| `POST` | `/admin/payments/{id}/reject` | Reject with a reason |

## Security rules this site follows

These are deliberate, not oversights:

- **A payment is never "paid" in the browser.** Submitting records `pending`.
  Only an admin calling the backend flips it to verified, and only the backend
  activates Pro.
- **Purchase sessions are decoded for display only.** The `payload.signature`
  from `server/purchase.py` is never verified client-side, so the decoded values
  are untrusted. The backend re-derives the account from the bearer token.
- **`?username=` is never accepted.** A raw username parameter would let anyone
  pay for someone else's account.
- **Expired sessions (>10 min) are refused.**
- **A session belonging to another UID is refused** when you are signed in as
  someone else.
- **Unpublished prices block checkout.** If `shipuwp/pricing/pro` is missing,
  the checkout is disabled rather than submitting `amount: 0`.
- **The admin guard is a UI convenience, not a security boundary.** Anyone can
  load `/admin/`; only `shipuwp/admins/{uid}.active` plus the server's own check
  and the database rules prevent an unauthorised verify or reject.
- **The frontend never writes `plan`, `subscription` or admin flags.**

## Fallbacks

If Firebase or the backend is unreachable, the site degrades and says so:

| Missing | Shown as |
| --- | --- |
| `BACKEND_URL` empty | "NOT CONFIGURED" panel, features disabled |
| `shipuwp/pricing/pro` | "Not published yet", checkout disabled |
| `shipuwp/config/paymentMethods` | bKash / Nagad / Manual transfer, marked as fallback |
| `POST /account/sync` failing | Error notice with the server message, no invented state |
| `shipuwp/payments/{id}` not readable yet | "Waiting for the server to store this payment" |

The dashboard falls back to reading `shipuwp/users/{uid}` directly and labels
every figure "local mirror", because an offline number must never be mistaken
for server truth.

## Verification performed

- `node --check` passes on all 7 JavaScript files.
- HTML structure, relative asset references and unique IDs pass on all 4 pages.
- CSS braces balanced; every class referenced from JS/HTML exists in the
  stylesheet.
- No horizontal overflow at 320 / 390 / 480 / 600 / 768 / 1024 / 1280 / 1440 /
  1920 px across all pages.
- 22 headless-Chrome scenarios with a mocked Firebase and backend, covering:
  pricing from database, free and Pro dashboards, offline mirror, refresh,
  purchase with valid / expired / mismatched / missing session, unpublished-price
  blocking, payment submission, pending-to-verified redirect, success page
  refusing to claim success while a record is still pending, rejection display,
  admin 403, admin not-configured panel, admin stats and table, and verify
  cancel (no API call) versus verify confirm (one authenticated call).