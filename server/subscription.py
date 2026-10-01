"""Subscription arithmetic for ShiPu WP.

Pure functions only - no Firebase imports, no I/O. That makes the money rules
directly unit-testable, which matters because these are the rules that decide
whether a customer loses paid days.

See firebase/schema.md for the renewal contract (idea.txt item 15).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Optional

DAY_MS = 86_400_000

PLAN_FREE = "free"
PLAN_PRO = "pro"

SUB_NONE = "none"
SUB_ACTIVE = "active"
SUB_EXPIRED = "expired"

PAY_PENDING = "pending"
PAY_VERIFIED = "verified"
PAY_REJECTED = "rejected"


def now_ms() -> int:
    """Current epoch milliseconds (UTC)."""
    return int(datetime.now(timezone.utc).timestamp() * 1000)


def to_datetime(epoch_ms: Optional[int]) -> Optional[datetime]:
    if not epoch_ms:
        return None
    return datetime.fromtimestamp(epoch_ms / 1000, tz=timezone.utc)


def format_date(epoch_ms: Optional[int]) -> str:
    """``YYYY-MM-DD`` in UTC, or ``-`` when unset."""
    moment = to_datetime(epoch_ms)
    return moment.strftime("%Y-%m-%d") if moment else "-"


def compute_new_expiry(
    current_expires_at: Optional[int],
    duration_days: int,
    reference_ms: Optional[int] = None,
) -> int:
    """Return the new ``expiresAt`` after a verified purchase.

    The critical rule: an *active* subscription extends from its existing
    expiry, never from today, so a renewal can never delete days the user
    already paid for. An *expired* (or absent) subscription restarts from now.

    >>> compute_new_expiry(None, 30, 0)
    2592000000
    >>> compute_new_expiry(1000, 30, 0)
    2592001000
    """
    reference = now_ms() if reference_ms is None else reference_ms
    duration_ms = max(1, duration_days) * DAY_MS
    base = max(reference, int(current_expires_at or 0))
    return base + duration_ms


@dataclass(frozen=True)
class EffectiveSubscription:
    """Authoritative, server-derived view of a user's entitlement."""

    plan: str
    status: str
    started_at: Optional[int]
    expires_at: Optional[int]
    days_remaining: int

    @property
    def is_pro(self) -> bool:
        return self.plan == PLAN_PRO and self.status == SUB_ACTIVE

    @property
    def replies_label(self) -> str:
        return "UNLIMITED" if self.is_pro else ""

    @property
    def expires_label(self) -> str:
        return format_date(self.expires_at)


def effective_subscription(
    plan: Optional[str],
    subscription: Optional[dict],
    free_daily_replies: int,
    reference_ms: Optional[int] = None,
) -> EffectiveSubscription:
    """Derive the plan a user is *actually* entitled to right now.

    Local files are never trusted (idea.txt item 16): this runs on the server
    and is the only source the tool may display as authoritative.
    """
    reference = now_ms() if reference_ms is None else reference_ms
    subscription = subscription or {}
    status = subscription.get("status") or SUB_NONE
    expires_at = subscription.get("expiresAt")

    if plan != PLAN_PRO or status != SUB_ACTIVE:
        return EffectiveSubscription(
            plan=PLAN_FREE,
            status=SUB_ACTIVE if plan == PLAN_FREE else status,
            started_at=None,
            expires_at=None,
            days_remaining=free_daily_replies,
        )

    # A pro entitlement whose expiry has passed is effectively free again.
    if not expires_at or expires_at <= reference:
        return EffectiveSubscription(
            plan=PLAN_FREE,
            status=SUB_EXPIRED,
            started_at=subscription.get("startedAt"),
            expires_at=expires_at,
            days_remaining=free_daily_replies,
        )

    remaining = expires_at - reference
    return EffectiveSubscription(
        plan=PLAN_PRO,
        status=SUB_ACTIVE,
        started_at=subscription.get("startedAt"),
        expires_at=expires_at,
        days_remaining=max(0, int(-(-remaining // DAY_MS))),
    )


def quota_remaining(
    subscription: EffectiveSubscription,
    replies_used: int,
    free_daily_replies: int,
    replies_needed: int = 1,
) -> bool:
    """True when another AI reply is allowed right now (idea.txt item 25).

    Pro is unlimited. Free must have budget for *all* replies in the batch, so
    a 3-reply run never partially completes.
    """
    if subscription.is_pro:
        return True
    return max(0, free_daily_replies - replies_used) >= replies_needed