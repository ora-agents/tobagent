"""HttpOnly cookie session helpers for browser authentication."""

import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from typing import Any

from fastapi import Response

SESSION_COOKIE_NAME = "tob_session"
DESKTOP_SESSION_HEADER = "x-tob-desktop-session"
SESSION_MAX_AGE_SECONDS = int(os.getenv("SESSION_MAX_AGE_SECONDS", str(60 * 60 * 24 * 30)))
SESSION_COOKIE_SAMESITE = os.getenv("SESSION_COOKIE_SAMESITE", "lax").lower()
SESSION_COOKIE_SECURE = os.getenv("SESSION_COOKIE_SECURE", "false").lower() in {"1", "true", "yes"}
SESSION_COOKIE_DOMAIN = os.getenv("SESSION_COOKIE_DOMAIN") or None
JWT_ALGORITHM = "HS256"

_DEV_SESSION_SECRET = secrets.token_urlsafe(32)


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(data: str) -> bytes:
    padding = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(f"{data}{padding}")


def _session_secret() -> str:
    """Return the JWT signing secret.

    SESSION_JWT_SECRET should be set in production. Without it, sessions are
    signed with a process-local development secret and expire on backend restart.
    """
    return os.getenv("SESSION_JWT_SECRET") or _DEV_SESSION_SECRET


def create_session_token(user_id: str) -> str:
    """Create a compact HS256 JWT for the authenticated browser session."""
    now = int(time.time())
    header = {"alg": JWT_ALGORITHM, "typ": "JWT"}
    payload: dict[str, Any] = {
        "sub": user_id,
        "iat": now,
        "exp": now + SESSION_MAX_AGE_SECONDS,
    }
    signing_input = ".".join(
        (
            _b64url_encode(json.dumps(header, separators=(",", ":")).encode("utf-8")),
            _b64url_encode(json.dumps(payload, separators=(",", ":")).encode("utf-8")),
        )
    )
    signature = hmac.new(
        _session_secret().encode("utf-8"),
        signing_input.encode("ascii"),
        hashlib.sha256,
    ).digest()
    return f"{signing_input}.{_b64url_encode(signature)}"


def wants_desktop_session_token(value: str | None) -> bool:
    """Return whether a request explicitly asks for a desktop bearer token."""
    return value is not None and value.lower() in {"1", "true", "yes"}


def verify_session_token(token: str | None) -> str | None:
    """Return the user id from a valid session JWT, otherwise None."""
    if not token:
        return None
    try:
        header_part, payload_part, signature_part = token.split(".", 2)
        signing_input = f"{header_part}.{payload_part}"
        expected = hmac.new(
            _session_secret().encode("utf-8"),
            signing_input.encode("ascii"),
            hashlib.sha256,
        ).digest()
        provided = _b64url_decode(signature_part)
        if not hmac.compare_digest(expected, provided):
            return None

        header = json.loads(_b64url_decode(header_part))
        payload = json.loads(_b64url_decode(payload_part))
        if header.get("alg") != JWT_ALGORITHM:
            return None
        exp = payload.get("exp")
        if not isinstance(exp, int) or exp < int(time.time()):
            return None
        subject = payload.get("sub")
        return subject if isinstance(subject, str) and subject else None
    except Exception:
        return None


def set_session_cookie(response: Response, user_id: str) -> None:
    """Attach a signed HttpOnly session cookie to a response."""
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=create_session_token(user_id),
        max_age=SESSION_MAX_AGE_SECONDS,
        httponly=True,
        secure=SESSION_COOKIE_SECURE,
        samesite=SESSION_COOKIE_SAMESITE,  # type: ignore[arg-type]
        domain=SESSION_COOKIE_DOMAIN,
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    """Clear the browser session cookie."""
    response.delete_cookie(
        key=SESSION_COOKIE_NAME,
        httponly=True,
        secure=SESSION_COOKIE_SECURE,
        samesite=SESSION_COOKIE_SAMESITE,  # type: ignore[arg-type]
        domain=SESSION_COOKIE_DOMAIN,
        path="/",
    )


def extract_session_cookie(cookie_header: str | None) -> str | None:
    """Extract the session cookie value from a raw Cookie header."""
    if not cookie_header:
        return None
    for part in cookie_header.split(";"):
        name, _, value = part.strip().partition("=")
        if name == SESSION_COOKIE_NAME and value:
            return value
    return None
