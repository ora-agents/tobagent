"""Authentication and user account routes."""
# ruff: noqa: D103

import secrets
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Cookie, Depends, Header, HTTPException, Response
from sqlalchemy import or_
from sqlalchemy.orm import Session

from src.api.deps import (
    AVATAR_COLORS,
    _require_same_user,
    _resolve_authorization_user_id,
    get_current_user,
    hash_api_key,
    hash_password,
    verify_password,
)
from src.api.schemas import (
    AuthSessionResponse,
    CreateUserApiKeyRequest,
    CreateUserApiKeyResponse,
    PasswordResetRequest,
    SmsCodeRequest,
    SmsCodeResponse,
    SmsCodeVerifyRequest,
    UserApiKeySchema,
    UserBindPhoneRequest,
    UserLoginRequest,
    UserPasswordUpdateRequest,
    UserRegisterRequest,
    UserResponse,
    UserUpdateRequest,
)
from src.api.session_auth import (
    DESKTOP_SESSION_HEADER,
    SESSION_COOKIE_NAME,
    clear_session_cookie,
    create_session_token,
    set_session_cookie,
    verify_session_token,
    wants_desktop_session_token,
)
from src.api.sms_verification import consume_sms_code, issue_sms_code
from src.api.workspace_utils import ensure_default_workspace
from src.utils.db import (
    AgentProfileTable,
    AgentProfileVersionTable,
    AgentShareLinkTable,
    FormRecordTable,
    FormTable,
    KnowledgeBaseTable,
    McpServerTable,
    SiteTestimonialTable,
    SkillTable,
    UserApiKeyTable,
    UserTable,
    UserVoiceprintTable,
    WorkspaceChangeRequestTable,
    WorkspaceMemberTable,
    WorkspaceTable,
    get_db,
)

router = APIRouter(tags=["auth"])


def _api_key_schema(api_key: UserApiKeyTable) -> UserApiKeySchema:
    return UserApiKeySchema(
        id=api_key.id,
        name=api_key.name,
        keyPrefix=api_key.key_prefix,
        createdAt=api_key.created_at,
        lastUsedAt=api_key.last_used_at,
    )


def _user_response(user: UserTable) -> UserResponse:
    return UserResponse(
        id=user.id,
        username=user.username,
        phone=user.phone,
        email=user.email,
        avatarColor=user.avatar_color,
        preferences=getattr(user, 'preferences', None),
        safetyEnabled=getattr(user, 'safety_enabled', 'false') == 'true',
        createdAt=user.created_at,
    )


def _auth_session_response(user: UserTable, include_session_token: bool) -> AuthSessionResponse:
    return AuthSessionResponse(
        **_user_response(user).model_dump(),
        sessionToken=create_session_token(user.id) if include_session_token else None,
    )


def _current_user_from_authorization(
    authorization: str | None,
    db: Session,
    session_cookie: str | None = None,
) -> UserTable:
    credential = verify_session_token(session_cookie)
    if not credential:
        user_id, _api_key = _resolve_authorization_user_id(authorization, db)
    else:
        user_id = credential
    current_user = db.query(UserTable).filter(UserTable.id == user_id).first()
    if not current_user:
        raise HTTPException(status_code=401, detail="Invalid user")
    return current_user


@router.post(
    "/api/auth/sms-code",
    response_model=SmsCodeResponse,
    summary="Send an SMS verification code",
    description="Sends a short-lived verification code via Aliyun Dysmsapi SendSms.",
)
async def send_sms_code(
    req: SmsCodeRequest,
    db: Session = Depends(get_db),
    authorization: str | None = Header(default=None),
    session_cookie: str | None = Cookie(default=None, alias=SESSION_COOKIE_NAME),
):
    if req.purpose == "register":
        existing_user = db.query(UserTable).filter(UserTable.phone == req.phone).first()
        if existing_user:
            raise HTTPException(status_code=400, detail="Phone already exists")
    elif req.purpose == "bind_phone":
        current_user = _current_user_from_authorization(authorization, db, session_cookie)
        if current_user.phone:
            raise HTTPException(status_code=400, detail="Phone already bound")
        existing_user = db.query(UserTable).filter(UserTable.phone == req.phone).first()
        if existing_user:
            raise HTTPException(status_code=400, detail="Phone already exists")
    elif req.purpose == "reset_password":
        existing_user = db.query(UserTable).filter(UserTable.phone == req.phone).first()
        if not existing_user:
            raise HTTPException(status_code=400, detail="Phone is not registered")
    else:
        current_user = _current_user_from_authorization(authorization, db, session_cookie)
        if current_user.phone != req.phone:
            raise HTTPException(status_code=403, detail="Cannot verify another account")

    issue_sms_code(db, req.phone, req.purpose)
    return SmsCodeResponse(ok=True)


@router.post(
    "/api/auth/sms-code/verify",
    response_model=SmsCodeResponse,
    summary="Verify an SMS code",
    description="Consumes a verification code for sensitive operation confirmation.",
)
async def verify_sms_code(
    req: SmsCodeVerifyRequest,
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    if current_user.phone != req.phone:
        raise HTTPException(status_code=403, detail="Cannot verify another account")

    consume_sms_code(db, req.phone, req.purpose, req.code)
    db.commit()
    return SmsCodeResponse(ok=True)


@router.post(
    "/api/auth/register",
    response_model=AuthSessionResponse,
    summary="Register a user",
    description="Creates a local user account after validating an SMS code.",
)
async def register_user(
    req: UserRegisterRequest,
    response: Response,
    desktop_session: str | None = Header(default=None, alias=DESKTOP_SESSION_HEADER),
    db: Session = Depends(get_db),
):
    # Check if username already exists
    existing_user = db.query(UserTable).filter(UserTable.username == req.username).first()
    if existing_user:
        raise HTTPException(status_code=400, detail="Username already exists")

    existing_phone = db.query(UserTable).filter(UserTable.phone == req.phone).first()
    if existing_phone:
        raise HTTPException(status_code=400, detail="Phone already exists")

    consume_sms_code(db, req.phone, "register", req.code)
    
    # Generate UUID and a random nice avatar color
    user_id = f"user-{uuid.uuid4()}"
    avatar_color = secrets.choice(AVATAR_COLORS)
    hashed_pwd = hash_password(req.password)
    
    user = UserTable(
        id=user_id,
        username=req.username,
        password_hash=hashed_pwd,
        phone=req.phone,
        avatar_color=avatar_color,
        created_at=datetime.utcnow().isoformat(),
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    ensure_default_workspace(db, user)
    db.commit()
    
    set_session_cookie(response, user.id)
    return _auth_session_response(user, wants_desktop_session_token(desktop_session))


@router.post(
    "/api/auth/login",
    response_model=AuthSessionResponse,
    summary="Log in a user",
    description="Validates an account or phone number with a password and returns the user's profile metadata.",
)
async def login_user(
    req: UserLoginRequest,
    response: Response,
    desktop_session: str | None = Header(default=None, alias=DESKTOP_SESSION_HEADER),
    db: Session = Depends(get_db),
):
    if req.password is None:
        raise HTTPException(status_code=400, detail="Password is required")
    account = req.account or req.phone
    if not account:
        raise HTTPException(status_code=400, detail="Account or phone is required")
    user = db.query(UserTable).filter(
        or_(UserTable.username == account, UserTable.phone == account),
    ).first()
    if not user:
        raise HTTPException(status_code=401, detail="Invalid account or password")
    if not user.password_hash or not verify_password(req.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid account or password")

    set_session_cookie(response, user.id)
    return _auth_session_response(user, wants_desktop_session_token(desktop_session))


@router.post(
    "/api/auth/logout",
    response_model=SmsCodeResponse,
    summary="Log out the current browser session",
    description="Clears the HttpOnly browser session cookie.",
)
async def logout_user(response: Response):
    clear_session_cookie(response)
    return SmsCodeResponse(ok=True)


@router.post(
    "/api/auth/password/reset",
    response_model=AuthSessionResponse,
    summary="Reset password",
    description="Resets a password after verifying an SMS code sent to the registered phone.",
)
async def reset_password(
    req: PasswordResetRequest,
    response: Response,
    desktop_session: str | None = Header(default=None, alias=DESKTOP_SESSION_HEADER),
    db: Session = Depends(get_db),
):
    user = db.query(UserTable).filter(UserTable.phone == req.phone).first()
    if not user:
        raise HTTPException(status_code=400, detail="Phone is not registered")

    consume_sms_code(db, req.phone, "reset_password", req.code)
    user.password_hash = hash_password(req.password)
    db.commit()
    set_session_cookie(response, user.id)
    return _auth_session_response(user, wants_desktop_session_token(desktop_session))


@router.get(
    "/api/auth/session",
    response_model=UserResponse,
    summary="Get the current browser session user",
    description="Returns the authenticated user resolved from the HttpOnly session cookie or API key.",
)
async def get_session_user(current_user: UserTable = Depends(get_current_user)):
    return _user_response(current_user)


@router.get(
    "/api/auth/users/{user_id}",
    response_model=UserResponse,
    summary="Get the current user's profile",
    description="Returns profile settings for the authenticated user. The path user id must match the bearer identity.",
)
async def get_user_profile(
    user_id: str,
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    _require_same_user(current_user, user_id)
    user = db.query(UserTable).filter(UserTable.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return _user_response(user)


@router.post(
    "/api/auth/users/{user_id}/phone",
    response_model=UserResponse,
    summary="Bind a phone number",
    description="Binds a phone number to the authenticated account after SMS verification.",
)
async def bind_user_phone(
    user_id: str,
    req: UserBindPhoneRequest,
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    _require_same_user(current_user, user_id)
    if current_user.phone:
        raise HTTPException(status_code=400, detail="Phone already bound")
    existing_user = db.query(UserTable).filter(UserTable.phone == req.phone).first()
    if existing_user:
        raise HTTPException(status_code=400, detail="Phone already exists")

    consume_sms_code(db, req.phone, "bind_phone", req.code)
    current_user.phone = req.phone
    db.commit()
    db.refresh(current_user)
    return _user_response(current_user)


@router.post(
    "/api/auth/users/{user_id}/password",
    response_model=SmsCodeResponse,
    summary="Change password",
    description="Updates the authenticated account password after verifying a code sent to the bound phone.",
)
async def update_user_password(
    user_id: str,
    req: UserPasswordUpdateRequest,
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    _require_same_user(current_user, user_id)
    if not current_user.phone:
        raise HTTPException(status_code=400, detail="Phone is not bound")
    if current_user.phone != req.phone:
        raise HTTPException(status_code=403, detail="Cannot verify another account")

    consume_sms_code(db, req.phone, "reset_password", req.code)
    current_user.password_hash = hash_password(req.password)
    db.commit()
    return SmsCodeResponse(ok=True)


@router.delete(
    "/api/auth/users/{user_id}",
    response_model=SmsCodeResponse,
    summary="Delete the current account",
    description="Deletes the authenticated account and directly owned workspace configuration data.",
)
async def delete_user_account(
    user_id: str,
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    _require_same_user(current_user, user_id)

    owned_workspaces = db.query(WorkspaceTable.id).filter(
        WorkspaceTable.owner_user_id == current_user.id,
    ).all()
    owned_workspace_ids = [row[0] for row in owned_workspaces]

    for table in (
        AgentProfileVersionTable,
        AgentShareLinkTable,
        AgentProfileTable,
        SkillTable,
        McpServerTable,
        FormRecordTable,
        FormTable,
        KnowledgeBaseTable,
        UserVoiceprintTable,
        UserApiKeyTable,
        SiteTestimonialTable,
    ):
        owner_column = getattr(table, "owner_user_id", None)
        if owner_column is None:
            owner_column = getattr(table, "user_id")
        db.query(table).filter(owner_column == current_user.id).delete(synchronize_session=False)

    if owned_workspace_ids:
        db.query(WorkspaceChangeRequestTable).filter(
            WorkspaceChangeRequestTable.workspace_id.in_(owned_workspace_ids),
        ).delete(synchronize_session=False)
        db.query(WorkspaceMemberTable).filter(
            WorkspaceMemberTable.workspace_id.in_(owned_workspace_ids),
        ).delete(synchronize_session=False)

    db.query(WorkspaceChangeRequestTable).filter(
        WorkspaceChangeRequestTable.requester_user_id == current_user.id,
    ).delete(synchronize_session=False)
    db.query(WorkspaceMemberTable).filter(
        WorkspaceMemberTable.user_id == current_user.id,
    ).delete(synchronize_session=False)
    db.query(WorkspaceTable).filter(
        WorkspaceTable.owner_user_id == current_user.id,
    ).delete(synchronize_session=False)

    db.delete(current_user)
    db.commit()
    return SmsCodeResponse(ok=True)


@router.put(
    "/api/auth/users/{user_id}",
    response_model=UserResponse,
    summary="Update the current user's profile",
    description="Updates mutable profile fields such as email, preferences, and safety settings.",
)
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

    return _user_response(user)


@router.get(
    "/api/auth/api-keys",
    response_model=list[UserApiKeySchema],
    summary="List API keys",
    description="Lists API key metadata for the authenticated user. Raw key values are never returned here.",
)
async def list_user_api_keys(
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    keys = db.query(UserApiKeyTable).filter(
        UserApiKeyTable.owner_user_id == current_user.id,
    ).all()
    return [_api_key_schema(key) for key in keys]


@router.post(
    "/api/auth/api-keys",
    response_model=CreateUserApiKeyResponse,
    summary="Create an API key",
    description="Creates a bearer API key for external integrations. The raw key is returned only once.",
)
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


@router.delete(
    "/api/auth/api-keys/{key_id}",
    summary="Delete an API key",
    description="Deletes one API key owned by the authenticated user.",
)
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
