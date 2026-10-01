"""Backend API surface for ShiPu WP (Render Web Service).

This module defines the *contract* and the authorisation rules. The Firebase
Admin SDK wiring is intentionally behind :func:`get_db`, which raises a clear
"not configured" error until real credentials exist in the Render dashboard.

Every privileged action lives here and nowhere else:

    POST /admin/payments/:id/verify     -> activate pro (30 days, extended)
    POST /admin/payments/:id/reject
    GET  /admin/payments?status=pending
    GET  /admin/users
    GET  /admin/stats
    POST /purchase/session              -> short-lived signed token
    POST /payments                      -> user-submitted payment (pending)

Security invariants (idea.txt items 31-33)
-------------------------------------------
* The caller's UID is taken from a verified Firebase ID token - never from a
  request body field, and never from a client-supplied ``isAdmin`` flag.
* Admin access is checked against ``admins/{uid}.active == true``.
* The Admin SDK is never imported by the Termux tool or the static site.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from .subscription import (
    PAY_PENDING,
    PAY_REJECTED,
    PAY_VERIFIED,
    PLAN_PRO,
    SUB_ACTIVE,
    SUB_EXPIRED,
    compute_new_expiry,
    effective_subscription,
    now_ms,
)

DEFAULT_FREE_DAILY_REPLIES = 25
DEFAULT_PRO_DURATION_DAYS = 30

# Every ShiPu path lives under this namespace. The ``shipu-ai`` project is
# shared with another app that owns the root ``users/`` and ``bot/`` nodes, so
# the Admin SDK must never touch them. Keep in sync with
# ``firebase/database.rules.json``, ``tool/auth/firebase.py`` and
# ``dist/assets/firebase-config.js``.
SHIPU_ROOT = "shipuwp"


def path(*parts: str) -> str:
    """Build a ShiPu-namespaced database path for the Admin SDK."""
    segments = [SHIPU_ROOT] + [str(x).strip("/") for x in parts if str(x).strip("/")]
    return "/".join(segments)


class BackendError(Exception):
    """Any failure that should become a 4xx/5xx response."""

    status_code = 400


class NotConfigured(BackendError):
    """Raised when server credentials are missing (renders as 503)."""

    status_code = 503


class Forbidden(BackendError):
    status_code = 403


class NotFound(BackendError):
    status_code = 404


# --------------------------------------------------------------------------
# Firebase Admin access
# --------------------------------------------------------------------------
def get_db() -> Any:
    """Return the Firebase Admin database handle.

    Initialises the Admin SDK from ``FIREBASE_ADMIN_CREDENTIALS`` (a service
    account JSON string or a path to one) on first use. Raises
    :class:`NotConfigured` instead of pretending to work, so a misconfigured
    deploy fails loudly rather than silently granting access.
    """
    try:
        import firebase_admin  # type: ignore
        from firebase_admin import credentials, db  # type: ignore
    except ImportError as exc:
        raise NotConfigured(
            "firebase-admin is not installed on the server"
        ) from exc

    if not firebase_admin._apps:
        raw = os.environ.get("FIREBASE_ADMIN_CREDENTIALS", "").strip()
        if not raw:
            raise NotConfigured("FIREBASE_ADMIN_CREDENTIALS is not set")
        try:
            if raw.startswith("{"):
                cred = credentials.Certificate(json.loads(raw))
            else:
                cred = credentials.Certificate(raw)
            firebase_admin.initialize_app(cred)
        except Exception as exc:
            raise NotConfigured(
                f"FIREBASE_ADMIN_CREDENTIALS is not usable: {exc}"
            ) from exc
    return db


# --------------------------------------------------------------------------
# Authorisation helpers
# --------------------------------------------------------------------------
def require_uid(auth_token: Optional[str]) -> str:
    """Verify a Firebase ID token and return the caller's UID."""
    if not auth_token:
        raise Forbidden("missing authentication token")
    try:
        import firebase_admin  # type: ignore
        from firebase_admin import auth  # type: ignore
    except ImportError as exc:
        raise NotConfigured("firebase-admin is not installed") from exc

    try:
        decoded = auth.get_auth().verify_id_token(auth_token, check_revoked=True)
    except Exception as exc:
        raise Forbidden(f"invalid authentication token: {exc}") from exc
    return str(decoded["uid"])


def require_admin(db: Any, uid: str) -> None:
    """Authorise admin work against the server-side admin list.

    A client cannot escalate: ``admins/*`` is write-locked in
    ``firebase/database.rules.json``, so only the Admin SDK can create an admin.
    """
    record = db.child(path(f"admins/{uid}")).get().val() or {}
    if not record.get("active"):
        raise Forbidden("administrator access required")


# --------------------------------------------------------------------------
# Registration
# --------------------------------------------------------------------------
USERNAME_RE = __import__("re").compile(r"^[A-Za-z0-9._-]{3,32}$")


def register_account(
    db: Any,
    auth_token: Optional[str],
    username: str,
    free_daily_replies: int = DEFAULT_FREE_DAILY_REPLIES,
) -> ApiResponse:
    """``POST /account/register`` - claim a username and create the profile.

    Username uniqueness is enforced here with an Admin SDK transaction, never
    by the client: ``shipuwp/usernameIndex`` is write-locked in the rules, so
    this is the only place a username can be reserved. A lost race returns a
    clear 409 instead of silently overwriting the existing account.
    """
    uid = require_uid(auth_token)
    clean = (username or "").strip()
    if not USERNAME_RE.match(clean):
        raise BackendError("username must be 3-32 characters: letters, digits, _ . -")

    username_lower = clean.lower()
    index_ref = db.child(path("usernameIndex", username_lower))

    def _claim(current: Any) -> Any:
        if current is not None:
            raise ValueError("USERNAME_TAKEN")
        return {"uid": uid, "username": clean, "createdAt": now_ms()}

    try:
        index_ref.transaction(_claim)
    except ValueError:
        raise BackendError("that username is already taken", ) from None
    except Exception as exc:
        raise BackendError(f"could not reserve username: {exc}") from exc

    record = {
        "uid": uid,
        "username": clean,
        "usernameLower": username_lower,
        "plan": "free",
        "accountStatus": "active",
        "createdAt": now_ms(),
        "usage": {"date": "", "repliesUsed": 0},
    }
    db.child(path("users", uid)).set(record)
    return ApiResponse(201, {"uid": uid, "username": clean, "plan": "free"})


# --------------------------------------------------------------------------
# Endpoints
# --------------------------------------------------------------------------
@dataclass
class ApiResponse:
    status: int
    payload: Dict[str, Any]

    def json(self) -> Dict[str, Any]:
        return self.payload


def create_purchase_session(
    db: Any,
    auth_token: Optional[str],
    plan: str = PLAN_PRO,
    secret: str = "",
) -> ApiResponse:
    """``POST /purchase/session`` - mint a signed, 10-minute session token."""
    from .purchase import create_session, token_for

    if plan != PLAN_PRO:
        raise BackendError("only the pro plan is purchasable")

    uid = require_uid(auth_token)
    user = db.child(path(f"users/{uid}")).get().val() or {}
    username = user.get("username") or uid

    session = create_session(uid, username, plan, secret)
    db.child(path(f"purchaseSessions/{session.session_id}")).set(session.to_dict())
    return ApiResponse(200, {"session": token_for(session, secret), **session.to_dict()})


def submit_payment(
    db: Any,
    auth_token: Optional[str],
    plan: str,
    amount: int,
    currency: str,
    method: str,
    transaction_id: str,
    username: Optional[str] = None,
) -> ApiResponse:
    """``POST /payments`` - record a payment as PENDING.

    A submitted payment grants nothing. Only :func:`verify_payment` activates
    the subscription (idea.txt item 10).
    """
    import secrets as _secrets

    uid = require_uid(auth_token)
    if not transaction_id.strip():
        raise BackendError("transaction id is required")

    user = db.child(path(f"users/{uid}")).get().val() or {}
    payment_id = _secrets.token_urlsafe(12)
    record = {
        "uid": uid,
        "username": username or user.get("username") or uid,
        "plan": plan,
        "amount": int(amount),
        "currency": currency,
        "method": method,
        "transactionId": transaction_id.strip(),
        "status": PAY_PENDING,
        "createdAt": now_ms(),
    }
    db.child(path(f"payments/{payment_id}")).set(record)
    return ApiResponse(201, {"paymentId": payment_id, "status": PAY_PENDING})


def verify_payment(
    db: Any,
    auth_token: Optional[str],
    payment_id: str,
    duration_days: int = DEFAULT_PRO_DURATION_DAYS,
) -> ApiResponse:
    """``POST /admin/payments/:id/verify`` - authoritative pro activation.

    Applies the renewal rule so an existing customer keeps their remaining days.
    """
    uid = require_admin(db, require_uid(auth_token))

    payment_ref = db.child(path(f"payments/{payment_id}"))
    payment = payment_ref.get().val()
    if not payment:
        raise NotFound(f"payment {payment_id} not found")
    if payment.get("status") == PAY_VERIFIED:
        raise BackendError("payment already verified")

    target_uid = str(payment.get("uid") or "")
    user_ref = db.child(path(f"users/{target_uid}"))
    user = user_ref.get().val() or {}
    existing = (user.get("subscription") or {})

    reference = now_ms()
    new_expiry = compute_new_expiry(existing.get("expiresAt"), duration_days, reference)

    user_ref.update(
        {
            "plan": PLAN_PRO,
            "subscription": {
                "status": SUB_ACTIVE,
                "startedAt": existing.get("startedAt") or reference,
                "expiresAt": new_expiry,
                "paymentId": payment_id,
            },
        }
    )
    payment_ref.update(
        {
            "status": PAY_VERIFIED,
            "verifiedAt": reference,
            "verifiedBy": uid,
            "expiresAt": new_expiry,
        }
    )
    return ApiResponse(
        200,
        {
            "paymentId": payment_id,
            "uid": target_uid,
            "status": SUB_ACTIVE,
            "expiresAt": new_expiry,
        },
    )


def reject_payment(
    db: Any, auth_token: Optional[str], payment_id: str, reason: str = ""
) -> ApiResponse:
    """``POST /admin/payments/:id/reject``."""
    uid = require_admin(db, require_uid(auth_token))
    payment_ref = db.child(path(f"payments/{payment_id}"))
    if not payment_ref.get().val():
        raise NotFound(f"payment {payment_id} not found")
    payment_ref.update(
        {
            "status": PAY_REJECTED,
            "verifiedAt": now_ms(),
            "verifiedBy": uid,
            "reason": reason,
        }
    )
    return ApiResponse(200, {"paymentId": payment_id, "status": PAY_REJECTED})


def list_payments(db: Any, auth_token: Optional[str], status: Optional[str] = None) -> ApiResponse:
    """``GET /admin/payments``."""
    require_admin(db, require_uid(auth_token))
    snapshot = db.child(path("payments")).get().val() or {}
    rows: List[Dict[str, Any]] = []
    for payment_id, record in snapshot.items():
        if status and record.get("status") != status:
            continue
        rows.append({"id": payment_id, **record})
    rows.sort(key=lambda r: r.get("createdAt", 0), reverse=True)
    return ApiResponse(200, {"payments": rows})


def admin_stats(db: Any, auth_token: Optional[str]) -> ApiResponse:
    """``GET /admin/stats`` - dashboard counters."""
    require_admin(db, require_uid(auth_token))
    users = db.child(path("users")).get().val() or {}
    payments = db.child(path("payments")).get().val() or {}

    free = pro = 0
    for record in users.values():
        effective = effective_subscription(
            record.get("plan"), record.get("subscription"), DEFAULT_FREE_DAILY_REPLIES
        )
        if effective.is_pro:
            pro += 1
        else:
            free += 1

    counts = {PAY_PENDING: 0, PAY_VERIFIED: 0, PAY_REJECTED: 0}
    for record in payments.values():
        key = record.get("status")
        if key in counts:
            counts[key] += 1

    return ApiResponse(
        200,
        {
            "totalUsers": len(users),
            "freeUsers": free,
            "proUsers": pro,
            "pendingPayments": counts[PAY_PENDING],
            "verifiedPayments": counts[PAY_VERIFIED],
            "rejectedPayments": counts[PAY_REJECTED],
        },
    )


def sync_subscription(
    db: Any, auth_token: Optional[str], free_daily_replies: int = DEFAULT_FREE_DAILY_REPLIES
) -> ApiResponse:
    """``POST /account/sync`` - what the Termux ``[R] Refresh Account`` calls.

    Returns the authoritative entitlement so the client never has to trust its
    local mirror (idea.txt items 16 and 20).
    """
    uid = require_uid(auth_token)
    record = db.child(path(f"users/{uid}")).get().val() or {}
    subscription = record.get("subscription") or {}
    usage = record.get("usage") or {}

    effective = effective_subscription(
        record.get("plan"), subscription, free_daily_replies
    )
    used = int(usage.get("repliesUsed", 0) or 0)
    return ApiResponse(
        200,
        {
            "uid": uid,
            "username": record.get("username", uid),
            "plan": effective.plan,
            "status": effective.status if effective.plan == PLAN_PRO else "active",
            "startedAt": subscription.get("startedAt"),
            "expiresAt": effective.expires_at,
            "daysRemaining": effective.days_remaining,
            "usage": {
                "date": usage.get("date"),
                "repliesUsed": used,
                "dailyLimit": None if effective.is_pro else free_daily_replies,
                "remaining": None if effective.is_pro else max(0, free_daily_replies - used),
            },
        },
    )


__all__ = [
    "ApiResponse",
    "BackendError",
    "Forbidden",
    "NotConfigured",
    "NotFound",
    "admin_stats",
    "create_purchase_session",
    "register_account",
    "get_db",
    "list_payments",
    "reject_payment",
    "require_admin",
    "require_uid",
    "submit_payment",
    "sync_subscription",
    "verify_payment",
    "SUB_EXPIRED",
]