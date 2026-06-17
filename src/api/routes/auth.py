"""Authentication and user account routes."""
# ruff: noqa: D103

import secrets
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from src.api.deps import (
    AVATAR_COLORS,
    _require_same_user,
    get_current_user,
    hash_api_key,
    hash_password,
    verify_password,
)
from src.api.schemas import (
    CreateUserApiKeyRequest,
    CreateUserApiKeyResponse,
    UserApiKeySchema,
    UserLoginRequest,
    UserRegisterRequest,
    UserResponse,
    UserUpdateRequest,
)
from src.utils.db import UserApiKeyTable, UserTable, get_db
from src.utils.default_skills import ensure_default_skills

router = APIRouter()


def _api_key_schema(api_key: UserApiKeyTable) -> UserApiKeySchema:
    return UserApiKeySchema(
        id=api_key.id,
        name=api_key.name,
        keyPrefix=api_key.key_prefix,
        createdAt=api_key.created_at,
        lastUsedAt=api_key.last_used_at,
    )


@router.post("/api/auth/register", response_model=UserResponse)
async def register_user(req: UserRegisterRequest, db: Session = Depends(get_db)):
    # Check if username already exists
    existing_user = db.query(UserTable).filter(UserTable.username == req.username).first()
    if existing_user:
        raise HTTPException(status_code=400, detail="Username already exists")
    
    # Generate UUID and a random nice avatar color
    user_id = f"user-{uuid.uuid4()}"
    avatar_color = secrets.choice(AVATAR_COLORS)
    hashed_pwd = hash_password(req.password)
    
    user = UserTable(
        id=user_id,
        username=req.username,
        password_hash=hashed_pwd,
        email=req.email,
        avatar_color=avatar_color,
        created_at=datetime.utcnow().isoformat(),
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    ensure_default_skills(db, user.id)
    db.commit()
    
    return UserResponse(
        id=user.id,
        username=user.username,
        email=user.email,
        avatarColor=user.avatar_color,
        preferences=getattr(user, 'preferences', None),
        safetyEnabled=getattr(user, 'safety_enabled', 'false') == 'true',
        createdAt=user.created_at,
    )


@router.post("/api/auth/login", response_model=UserResponse)
async def login_user(req: UserLoginRequest, db: Session = Depends(get_db)):
    user = db.query(UserTable).filter(UserTable.username == req.username).first()
    if not user or not verify_password(req.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid username or password")

    return UserResponse(
        id=user.id,
        username=user.username,
        email=user.email,
        avatarColor=user.avatar_color,
        preferences=getattr(user, 'preferences', None),
        safetyEnabled=getattr(user, 'safety_enabled', 'false') == 'true',
        createdAt=user.created_at,
    )


@router.get("/api/auth/users/{user_id}", response_model=UserResponse)
async def get_user_profile(
    user_id: str,
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    _require_same_user(current_user, user_id)
    user = db.query(UserTable).filter(UserTable.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return UserResponse(
        id=user.id,
        username=user.username,
        email=user.email,
        avatarColor=user.avatar_color,
        preferences=getattr(user, 'preferences', None),
        safetyEnabled=getattr(user, 'safety_enabled', 'false') == 'true',
        createdAt=user.created_at,
    )


@router.put("/api/auth/users/{user_id}", response_model=UserResponse)
async def update_user_profile(
    user_id: str,
    req: UserUpdateRequest,
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    _require_same_user(current_user, user_id)
    user = db.query(UserTable).filter(UserTable.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if req.username is not None and req.username != user.username:
        raise HTTPException(status_code=400, detail="Username cannot be changed")

    if req.email is not None:
        user.email = req.email
    if req.preferences is not None:
        user.preferences = req.preferences
    if req.safety_enabled is not None:
        user.safety_enabled = "true" if req.safety_enabled else "false"

    db.commit()
    db.refresh(user)

    return UserResponse(
        id=user.id,
        username=user.username,
        email=user.email,
        avatarColor=user.avatar_color,
        preferences=getattr(user, 'preferences', None),
        safetyEnabled=getattr(user, 'safety_enabled', 'false') == 'true',
        createdAt=user.created_at,
    )


@router.get("/api/auth/api-keys", response_model=list[UserApiKeySchema])
async def list_user_api_keys(
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    keys = db.query(UserApiKeyTable).filter(
        UserApiKeyTable.owner_user_id == current_user.id,
    ).all()
    return [_api_key_schema(key) for key in keys]


@router.post("/api/auth/api-keys", response_model=CreateUserApiKeyResponse)
async def create_user_api_key(
    req: CreateUserApiKeyRequest,
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    key_name = req.name.strip()
    if not key_name:
        raise HTTPException(status_code=400, detail="API key name is required")

    raw_key = f"tob_{secrets.token_urlsafe(32)}"
    now = datetime.now(UTC).isoformat().replace("+00:00", "Z")
    api_key = UserApiKeyTable(
        id=f"apikey-{uuid.uuid4()}",
        owner_user_id=current_user.id,
        name=key_name,
        key_hash=hash_api_key(raw_key),
        key_prefix=f"{raw_key[:8]}...",
        created_at=now,
    )
    db.add(api_key)
    db.commit()
    db.refresh(api_key)

    return CreateUserApiKeyResponse(
        **_api_key_schema(api_key).model_dump(),
        apiKey=raw_key,
    )


@router.delete("/api/auth/api-keys/{key_id}")
async def delete_user_api_key(
    key_id: str,
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    api_key = db.query(UserApiKeyTable).filter(
        UserApiKeyTable.id == key_id,
        UserApiKeyTable.owner_user_id == current_user.id,
    ).first()
    if not api_key:
        raise HTTPException(status_code=404, detail="API key not found")

    db.delete(api_key)
    db.commit()
    return {"ok": True}

