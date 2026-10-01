# ShiPu WP database rules

These rules are deployed from `firebase/database.rules.json`.

## Why everything is under `shipuwp/`

The `shipu-ai` project is shared with another app that already owns the
root `users/` and `bot/` nodes. Namespacing ShiPu lets us lock our
payment/subscription data down without breaking that app.

## Security

Before these rules existed the database accepted reads *and* writes from
anyone holding the public web API key, which would let any user grant
themselves `plan: "pro"`. These rules close that.

Privileged fields are write-locked:

- `shipuwp/users/{uid}/plan` - server only
- `shipuwp/users/{uid}/subscription` - server only
- `shipuwp/payments/**` - server only
- `shipuwp/admins/**` - server only
- `shipuwp/usernameIndex/**` - server only

The pre-existing `bot`, `bot-selftest` and `system_health` nodes now
inherit the root deny. Review and lock them down separately.
