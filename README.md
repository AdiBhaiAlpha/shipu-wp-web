# ShiPu WP — Website & Backend

Static site + Flask backend for the ShiPu WP AI WhatsApp assistant.

## Layout

```
dist/            Static site (Render Static Site, no build step)
  index.html     Hash-routed SPA: landing, pricing, login, register,
                 dashboard, purchase, payment, admin
  admin/         Admin console (guarded by shipuwp/admins/{uid}.active)
server/          Flask backend (Render Web Service)
  api.py         HTTP routes
  admin_api.py   Authorisation + privileged operations
  purchase.py    HMAC-signed purchase sessions
  subscription.py Renewal arithmetic
firebase/        Realtime Database rules + schema
```

## Deploy

### Backend (Render Web Service)

1. Create a Web Service from this repo.
2. Build command: `pip install -r requirements.txt`
3. Start command: `gunicorn server.api:app`
4. Set environment variables:
   - `FIREBASE_ADMIN_CREDENTIALS` — service-account JSON or path
   - `PAYMENT_SECRET` — random long string
   - `WEBHOOK_SECRET` — random long string

### Frontend (Render Static Site)

1. Create a Static Site from this repo.
2. Build command: *(none)*
3. Publish directory: `dist`
4. Set `BACKEND_URL` in `dist/assets/firebase-config.js` to the backend URL.

## API

Every route needs `Authorization: Bearer <firebaseIdToken>`.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Liveness (no auth) |
| `POST` | `/account/register` | Claim username, create profile |
| `POST` | `/account/sync` | Authoritative plan/status/usage |
| `POST` | `/purchase/session` | Mint signed 10-minute session |
| `POST` | `/payments` | Submit payment (pending) |
| `GET` | `/admin/payments?status=pending` | List payments |
| `GET` | `/admin/stats` | Dashboard counters |
| `POST` | `/admin/payments/:id/verify` | Activate Pro (30 days) |
| `POST` | `/admin/payments/:id/reject` | Reject with reason |

## Security

- UID comes from a verified Firebase ID token, never the request body.
- Admin actions require `shipuwp/admins/{uid}.active == true` checked server-side.
- `plan`, `subscription`, `payments`, `admins`, `usernameIndex` are write-locked
  in Firebase rules — only the Admin SDK can write them.
- All ShiPu data lives under `shipuwp/`; the shared project's root `users/` and
  `bot/` nodes are never touched.
