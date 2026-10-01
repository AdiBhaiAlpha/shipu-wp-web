"""Short-lived purchase session tokens (idea.txt item 8).

Why this exists
---------------
The Termux tool must never be trusted to prove *who* is paying, and it must
never receive a backend secret. So the flow is:

    Termux  --(authenticated request)-->  Backend
    Backend  --(HMAC-signed, 10-minute token)-->  Termux
    Termux  --(termux-open-url)-->  Browser: /purchase?session=<token>
    Browser --(exchanges the token, server-side)-->  knows the real UID

A raw ``?username=foo`` is explicitly *not* accepted anywhere.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
from dataclasses import dataclass
from typing import Optional

from .subscription import now_ms

TOKEN_TTL_MS = 10 * 60 * 1000  # 10 minutes


class PurchaseError(Exception):
    """Raised when a purchase session cannot be created or trusted."""


@dataclass(frozen=True)
class PurchaseSession:
    session_id: str
    uid: str
    username: str
    plan: str
    created_at: int
    expires_at: int

    def to_dict(self) -> dict:
        return {
            "sessionId": self.session_id,
            "uid": self.uid,
            "username": self.username,
            "plan": self.plan,
            "createdAt": self.created_at,
            "expiresAt": self.expires_at,
        }


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _unb64(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


def sign(payload: dict, secret: str) -> str:
    """Return ``base64(payload).base64(hmac)`` - a compact signed token."""
    if not secret:
        raise PurchaseError("PAYMENT_SECRET is not configured on the server")
    body = _b64(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode())
    signature = hmac.new(secret.encode(), body.encode(), hashlib.sha256).digest()
    return f"{body}.{_b64(signature)}"


def verify(token: str, secret: str) -> dict:
    """Validate a token's signature *and* expiry, returning its payload."""
    if not token or "." not in token:
        raise PurchaseError("malformed session token")
    body, _, signature = token.partition(".")
    expected = hmac.new(secret.encode(), body.encode(), hashlib.sha256).digest()
    try:
        provided = _unb64(signature)
    except Exception as exc:
        raise PurchaseError("malformed signature") from exc
    if not hmac.compare_digest(expected, provided):
        raise PurchaseError("signature mismatch")
    try:
        payload = json.loads(_unb64(body))
    except Exception as exc:
        raise PurchaseError("malformed payload") from exc
    if int(payload.get("expiresAt", 0)) <= now_ms():
        raise PurchaseError("session expired")
    return payload


def create_session(
    uid: str,
    username: str,
    plan: str,
    secret: str,
    reference_ms: Optional[int] = None,
) -> PurchaseSession:
    """Mint a purchase session for an *authenticated* user.

    The caller is responsible for establishing ``uid`` from a verified token -
    never from client-supplied parameters.
    """
    if not uid:
        raise PurchaseError("uid is required")
    created = now_ms() if reference_ms is None else reference_ms
    session = PurchaseSession(
        session_id=secrets.token_urlsafe(18),
        uid=uid,
        username=username,
        plan=plan,
        created_at=created,
        expires_at=created + TOKEN_TTL_MS,
    )
    sign(session.to_dict(), secret)  # fail fast if the secret is missing
    return session


def token_for(session: PurchaseSession, secret: str) -> str:
    return sign(session.to_dict(), secret)


def resolve_uid(token: str, secret: str) -> str:
    """Server-side helper used by the website: token -> authenticated UID."""
    return str(verify(token, secret).get("uid", ""))