"""Renewal / entitlement rules - the money-critical tests.

Run:  python -m server.test_renewal
      (or `python server/test_renewal.py`)
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from server.subscription import (  # noqa: E402
    DAY_MS,
    PAY_VERIFIED,
    PLAN_FREE,
    PLAN_PRO,
    SUB_ACTIVE,
    SUB_EXPIRED,
    compute_new_expiry,
    effective_subscription,
    format_date,
    quota_remaining,
)

T = 1_700_000_000_000  # fixed reference so the tests are deterministic
FREE_LIMIT = 25


def test_renewal_from_nothing() -> None:
    assert compute_new_expiry(None, 30, T) == T + 30 * DAY_MS


def test_renewal_when_expired_restarts_from_now() -> None:
    past = T - 10 * DAY_MS
    assert compute_new_expiry(past, 30, T) == T + 30 * DAY_MS


def test_renewal_when_active_extends_from_expiry() -> None:
    """The rule that protects existing customers from losing paid days."""
    future = T + 12 * DAY_MS
    assert compute_new_expiry(future, 30, T) == future + 30 * DAY_MS


def test_renewal_never_shortens_an_expiry() -> None:
    far_future = T + 400 * DAY_MS
    assert compute_new_expiry(far_future, 30, T) >= far_future


def test_expired_subscription_is_effectively_free() -> None:
    result = effective_subscription(
        PLAN_PRO,
        {"status": SUB_ACTIVE, "expiresAt": T - DAY_MS},
        FREE_LIMIT,
        T,
    )
    assert result.plan == PLAN_FREE
    assert result.status == SUB_EXPIRED
    assert not result.is_pro
    assert result.days_remaining == FREE_LIMIT


def test_active_subscription_is_pro_and_unlimited() -> None:
    result = effective_subscription(
        PLAN_PRO,
        {"status": SUB_ACTIVE, "expiresAt": T + 10 * DAY_MS},
        FREE_LIMIT,
        T,
    )
    assert result.is_pro
    assert result.days_remaining == 10
    assert result.replies_label == "UNLIMITED"


def test_plan_pro_without_active_status_is_free() -> None:
    result = effective_subscription(PLAN_PRO, {"status": "none"}, FREE_LIMIT, T)
    assert result.plan == PLAN_FREE
    assert not result.is_pro


def test_free_quota_requires_full_batch() -> None:
    free = effective_subscription(PLAN_FREE, None, FREE_LIMIT, T)
    assert quota_remaining(free, 0, FREE_LIMIT, replies_needed=3)
    assert not quota_remaining(free, 23, FREE_LIMIT, replies_needed=3)
    assert quota_remaining(free, 24, FREE_LIMIT, replies_needed=1)


def test_pro_quota_is_unlimited() -> None:
    pro = effective_subscription(
        PLAN_PRO, {"status": SUB_ACTIVE, "expiresAt": T + DAY_MS}, FREE_LIMIT, T
    )
    assert quota_remaining(pro, 99_999, FREE_LIMIT, replies_needed=50)


def test_date_formatting() -> None:
    assert format_date(None) == "-"
    assert len(format_date(T)) == 10


def main() -> int:
    tests = [value for name, value in sorted(globals().items()) if name.startswith("test_")]
    failed = 0
    for test in tests:
        try:
            test()
            print(f"  PASS  {test.__name__}")
        except AssertionError as exc:
            failed += 1
            print(f"  FAIL  {test.__name__}: {exc}")
    print(f"\n{len(tests) - failed}/{len(tests)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())