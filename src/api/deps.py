"""Shared FastAPI dependencies and auth helpers."""

import hashlib
import secrets

from fastapi import Cookie, Depends, Header, HTTPException
from sqlalchemy.orm import Session

from src.api.session_auth import SESSION_COOKIE_NAME, verify_session_token
from src.utils.db import UserApiKeyTable, UserTable, get_db

AVATAR_COLORS = [
    "#cc785c",  # Coral
    "#a9583e",  # Dark Coral
    "#2e5b82",  # Blue
    "#347a5c",  # Green
    "#8e562c",  # Brown
    "#6b4c9a",  # Purple
    "#cc5c8a",  # Rose
    "#cc995c",  # Sandy Gold
]


def hash_password(password: str) -> str:
    """Hash a plaintext password with a random salt."""
    # 16-byte random salt
    salt = secrets.token_hex(16)
    # 100k iterations PBKDF2 HMAC SHA-256
    pwd_hash = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt.encode("utf-8"),
        100000,
    ).hex()
    return f"{salt}:{pwd_hash}"


def verify_password(password: str, hashed_password: str) -> bool:
    """Verify a plaintext password against a stored salted hash."""
    try:
        salt, pwd_hash = hashed_password.split(":")
        compare_hash = hashlib.pbkdf2_hmac(
            "sha256",
            password.encode("utf-8"),
            salt.encode("utf-8"),
            100000,
        ).hex()
        return pwd_hash == compare_hash
    except Exception:
        return False


def _extract_bearer_user_id(authorization: str | None) -> str:
    if not authorization:
        raise HTTPException(status_code=401, detail="Authentication required")

    user_id = authorization.strip()
    if user_id.lower().startswith("bearer "):
        user_id = user_id.split(" ", 1)[1].strip()
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")
    if user_id == "studio-user" or user_id.startswith("lsv2_"):
        raise HTTPException(status_code=401, detail="User login required")
    return user_id


def hash_api_key(api_key: str) -> str:
    """Hash an API key for storage."""
    return hashlib.sha256(api_key.encode("utf-8")).hexdigest()


def _resolve_authorization_user_id(
    authorization: str | None,
    db: Session,
) -> tuple[str, UserApiKeyTable | None]:
    """Resolve Authorization as a desktop session JWT, API key, or legacy user id."""
    credential = _extract_bearer_user_id(authorization)
    session_user_id = verify_session_token(credential)
    if session_user_id:
        return session_user_id, None

    api_key = db.query(UserApiKeyTable).filter(
        UserApiKeyTable.key_hash == hash_api_key(credential),
    ).first()
    return (api_key.owner_user_id if api_key else credential), api_key


async def get_current_user(
    authorization: str | None = Header(default=None),
    session_cookie: str | None = Cookie(default=None, alias=SESSION_COOKIE_NAME),
    db: Session = Depends(get_db),
) -> UserTable:
    """Require a logged-in account and return the authenticated user."""
    credential = verify_session_token(session_cookie)
    api_key = None
    if not credential:
        credential, api_key = _resolve_authorization_user_id(authorization, db)
    user_id = credential
    user = db.query(UserTable).filter(UserTable.id == user_id).first()
    if not user:
        raise HTTPException(status_code=401, detail="Invalid user")
    if api_key:
        from datetime import UTC, datetime

        api_key.last_used_at = datetime.now(UTC).isoformat().replace("+00:00", "Z")
        db.commit()
    return user


def _require_same_user(current_user: UserTable, user_id: str) -> None:
    if current_user.id != user_id:
        raise HTTPException(status_code=403, detail="Cannot access another account")
