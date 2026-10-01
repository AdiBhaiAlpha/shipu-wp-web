# ShiPu WP - Firebase data model

Shared by the Termux tool, the website (`dist/`) and the backend (`server/`).
There is exactly **one** account record per person (idea.txt item 37).

All paths below are relative to the **`shipuwp/` namespace**, e.g.
`shipuwp/users/{uid}`. This is NOT the database root: the `shipu-ai` project is
shared with another app that owns the root `users/` and `bot/` nodes, so ShiPu
must never write there.

```
shipuwp/users
  {UID}/
    username            string   display name, e.g. "Rahim"
    usernameLower       string   unique, lowercase, used for lookups
    accountStatus       string   "active" | "suspended"
    createdAt           number   epoch ms
    lastLoginAt         number   epoch ms (client-writable)
    plan                string   "free" | "pro"        (backend-only write)
    subscription/
      status            string   "none" | "active" | "expired"
      startedAt         number   epoch ms
      expiresAt         number   epoch ms
      paymentId         string
    usage/
      date              string   "YYYY-MM-DD" (local to the user)
      repliesUsed       number   0..free_daily_replies
    devices/
      {DEVICE_ID}/
        createdAt       number
        lastSeenAt      number
        appVersion      string

usernameIndex/
  {usernameLower}/
    uid                 string   reverse lookup username -> UID

admins/
  {UID}/
    role                string   "admin"
    active              bool     only active admins get any privilege
    createdAt           number

payments/
  {PAYMENT_ID}/
    uid                 string
    username            string
    plan                string   "pro"
    amount              number   minor units, snapshot at submission time
    currency            string
    method              string   "bkash" | "nagad" | "manual" | ...
    transactionId       string   user-supplied reference
    status              string   "pending" | "verified" | "rejected"
    createdAt           number
    verifiedAt          number   set by backend on verify
    verifiedBy          string   admin UID
    expiresAt           number   entitlement end timestamp after verification

purchaseSessions/
  {SESSION_ID}/
    uid                 string
    plan                string
    createdAt           number
    expiresAt           number   short TTL (minutes)
    usedAt              number   set once the website opens it

pricing/
  pro/
    priceCents          number
    currency            string
    durationDays        number
    updatedAt           number

config/
  paymentMethods       map      enabled methods for the website
  announcement         string   optional banner text
```

## Who may write what

| Path | Client (Termux / website) | Backend (Admin SDK) |
|---|---|---|
| `shipuwp/users/{uid}/plan` | never | authoritative |
| `shipuwp/users/{uid}/subscription/**` | never | authoritative |
| `shipuwp/payments/**/status` | never | authoritative |
| `shipuwp/payments/**/verifiedAt` | never | authoritative |
| `shipuwp/users/{uid}/username` | never | on registration |
| `shipuwp/users/{uid}/usage/**` | own row only | authoritative daily reset |
| `shipuwp/admins/**` | never | bootstrap only |
| `shipuwp/usernameIndex/**` | never | on registration |
| `shipuwp/pricing/**` | never | yes |

Enforced by `database.rules.json`.

> **Deploy these rules.** Before they existed the database accepted reads *and*
> writes from anyone holding the public web API key, which would let any user
> grant themselves `plan: "pro"`. The `bot`, `bot-selftest` and `system_health`
> nodes still need their own review - they now inherit the root deny. Client SDK rules are a defence-in-depth
layer; the Admin SDK bypasses them by design, which is exactly why **every**
privileged mutation must live behind a server endpoint.

## Daily free-quota reset

The quota is date-keyed (`usage.date`). A user is free again as soon as
`usage.date != today`. The tool additionally keeps a local mirror of the
counter so the UI works offline, but the server copy wins on refresh.

## Subscription renewal rule (idea.txt item 15)

A verified purchase must never delete days the user already paid for:

```text
active  -> newExpiry = max(currentExpiry, now) + durationDays
expired -> newExpiry = now + durationDays
```

Implemented in `server/subscription.py:compute_new_expiry` and covered by
`server/test_renewal.py` and `tests/`.