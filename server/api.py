"""Flask application exposing the ShiPu WP backend on Render.

    pip install -r requirements.txt
    python app.py

Every route funnels through :func:`admin_api.get_db`, which raises
``NotConfigured`` until ``FIREBASE_ADMIN_CREDENTIALS`` is set in the Render
dashboard - so a misconfigured deploy returns 503 instead of pretending.

Authorisation is always a verified Firebase ID token in the
``Authorization: Bearer`` header. The caller's UID is never taken from the
request body, and admin actions additionally require
``shipuwp/admins/{uid}.active == true`` checked server-side.
"""

from __future__ import annotations

import os
import sys
from typing import Any, Dict, Tuple

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from flask import Flask, jsonify, request  # type: ignore

from server.admin_api import (
    DEFAULT_FREE_DAILY_REPLIES,
    DEFAULT_PRO_DURATION_DAYS,
    BackendError,
    NotConfigured,
    admin_stats,
    create_purchase_session,
    get_db,
    list_payments,
    register_account,
    reject_payment,
    submit_payment,
    sync_subscription,
    verify_payment,
)

app = Flask(__name__)


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------
def _bearer() -> str:
    """Extract the ID token from ``Authorization: Bearer <token>``."""
    header = request.headers.get("Authorization", "")
    if header.lower().startswith("bearer "):
        return header[7:].strip()
    return ""


def _json() -> Dict[str, Any]:
    """Body as JSON, or ``{}`` when absent/unparseable."""
    try:
        return request.get_json(force=True, silent=True) or {}
    except Exception:
        return {}


def _error(exc: Exception) -> Tuple[Any, int]:
    """Render a backend failure as JSON with the right status code."""
    if isinstance(exc, BackendError):
        return jsonify({"error": str(exc)}), exc.status_code
    if isinstance(exc, NotConfigured):
        return jsonify({"error": str(exc)}), exc.status_code
    # Never leak internals (stack traces, credential paths) to a client.
    return jsonify({"error": "internal server error"}), 500


@app.errorhandler(Exception)
def _handle(exc: Exception):
    return _error(exc)


def _int(value: Any, fallback: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return fallback


# --------------------------------------------------------------------------
# Health
# --------------------------------------------------------------------------
@app.get("/health")
def health() -> Any:
    """Liveness probe. Does NOT require credentials."""
    return jsonify({"status": "ok", "service": "shipu-wp"})


# --------------------------------------------------------------------------
# Account
# --------------------------------------------------------------------------
@app.post("/account/register")
def account_register() -> Any:
    payload = _json()
    result = register_account(get_db(), _bearer(), str(payload.get("username", "")))
    return jsonify(result.json()), result.status


@app.post("/account/sync")
def account_sync() -> Any:
    result = sync_subscription(get_db(), _bearer())
    return jsonify(result.json()), result.status


# --------------------------------------------------------------------------
# Purchase
# --------------------------------------------------------------------------
@app.post("/purchase/session")
def purchase_session() -> Any:
    payload = _json()
    result = create_purchase_session(
        get_db(),
        _bearer(),
        plan=str(payload.get("plan", "pro")),
        secret=os.environ.get("PAYMENT_SECRET", ""),
    )
    return jsonify(result.json()), result.status


@app.post("/payments")
def payments_submit() -> Any:
    payload = _json()
    result = submit_payment(
        get_db(),
        _bearer(),
        plan=str(payload.get("plan", "pro")),
        amount=_int(payload.get("amount")),
        currency=str(payload.get("currency", "USD")),
        method=str(payload.get("method", "")),
        transaction_id=str(payload.get("transactionId", "")),
        username=payload.get("username"),
    )
    return jsonify(result.json()), result.status


# --------------------------------------------------------------------------
# Admin
# --------------------------------------------------------------------------
@app.get("/admin/payments")
def admin_payments() -> Any:
    result = list_payments(get_db(), _bearer(), request.args.get("status"))
    return jsonify(result.json()), result.status


@app.get("/admin/stats")
def admin_stats_route() -> Any:
    result = admin_stats(get_db(), _bearer())
    return jsonify(result.json()), result.status


@app.post("/admin/payments/<payment_id>/verify")
def admin_verify(payment_id: str) -> Any:
    result = verify_payment(
        get_db(),
        _bearer(),
        payment_id,
        duration_days=_int(_json().get("durationDays"), DEFAULT_PRO_DURATION_DAYS),
    )
    return jsonify(result.json()), result.status


@app.post("/admin/payments/<payment_id>/reject")
def admin_reject(payment_id: str) -> Any:
    result = reject_payment(get_db(), _bearer(), payment_id, str(_json().get("reason", "")))
    return jsonify(result.json()), result.status


# --------------------------------------------------------------------------
# Entry point
# --------------------------------------------------------------------------
if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8080"))
    app.run(host="0.0.0.0", port=port)
