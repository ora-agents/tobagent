from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from src.api.deps import hash_password, verify_password
from src.api.fastapi_app import app
from src.api.sms_verification import _sms_template_code_for_purpose, issue_sms_code
from src.utils.db import (
    Base,
    SkillTable,
    SmsVerificationCodeTable,
    UserApiKeyTable,
    UserTable,
    get_db,
)


@pytest.fixture()
def auth_sms_client(monkeypatch):
    monkeypatch.setenv("ALIYUN_SMS_TEMPLATE_CODE", "SMS_REGISTER_TEST")
    monkeypatch.setenv("ALIYUN_SMS_RESET_PASSWORD_TEMPLATE_CODE", "SMS_RESET_TEST")

    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    sent_codes: list[tuple[str, str, str]] = []

    def fake_send(phone: str, code: str, purpose: str) -> None:
        sent_codes.append((phone, code, purpose))

    monkeypatch.setattr("src.api.sms_verification._send_aliyun_sms", fake_send)

    def override_get_db():
        session = TestingSessionLocal()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_db] = override_get_db
    try:
        with TestClient(app) as test_client:
            yield test_client, TestingSessionLocal, sent_codes
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_sms_register_creates_user_and_consumes_code(auth_sms_client):
    client, Session, sent_codes = auth_sms_client

    response = client.post(
        "/api/auth/sms-code",
        json={"phone": "13800138000", "purpose": "register"},
    )
    assert response.status_code == 200
    assert sent_codes[-1][0] == "13800138000"

    register = client.post(
        "/api/auth/register",
        json={
            "username": "alice",
            "phone": "13800138000",
            "code": sent_codes[-1][1],
            "password": "secret123",
        },
    )
    assert register.status_code == 200
    body = register.json()
    assert body["username"] == "alice"
    assert body["phone"] == "13800138000"

    with Session() as db:
        user = db.query(UserTable).filter(UserTable.phone == "13800138000").first()
        code = db.query(SmsVerificationCodeTable).first()
        assert user is not None
        assert user.password_hash is not None
        assert verify_password("secret123", user.password_hash)
        assert code.consumed_at is not None


def test_password_login(auth_sms_client):
    client, Session, _sent_codes = auth_sms_client
    now = datetime.now(UTC).isoformat().replace("+00:00", "Z")
    with Session() as db:
        db.add(UserTable(
            id="user-password",
            username="password-user",
            phone="13800138009",
            password_hash=hash_password("secret123"),
            created_at=now,
        ))
        db.commit()

    login = client.post(
        "/api/auth/login",
        json={"phone": "13800138009", "password": "secret123"},
    )
    assert login.status_code == 200
    assert login.json()["id"] == "user-password"

    username_login = client.post(
        "/api/auth/login",
        json={"account": "password-user", "password": "secret123"},
    )
    assert username_login.status_code == 200
    assert username_login.json()["id"] == "user-password"

    bad_login = client.post(
        "/api/auth/login",
        json={"phone": "13800138009", "password": "wrong-password"},
    )
    assert bad_login.status_code == 401


def test_sms_template_purpose_selection(auth_sms_client):
    client, Session, sent_codes = auth_sms_client
    now = datetime.now(UTC).isoformat().replace("+00:00", "Z")

    register = client.post(
        "/api/auth/sms-code",
        json={"phone": "13800138010", "purpose": "register"},
    )
    assert register.status_code == 200
    assert sent_codes[-1][2] == "register"

    with Session() as db:
        db.add(UserTable(
            id="user-reset-template",
            username="reset-template",
            phone="13800138011",
            password_hash=hash_password("old-secret"),
            created_at=now,
        ))
        db.commit()

    reset = client.post(
        "/api/auth/sms-code",
        json={"phone": "13800138011", "purpose": "reset_password"},
        headers={"Authorization": "Bearer user-reset-template"},
    )
    assert reset.status_code == 200
    assert sent_codes[-1][2] == "reset_password"
    assert _sms_template_code_for_purpose("register") == "SMS_REGISTER_TEST"
    assert _sms_template_code_for_purpose("reset_password") == "SMS_RESET_TEST"


def test_sms_login_consumes_code_once(auth_sms_client):
    client, Session, sent_codes = auth_sms_client
    now = datetime.now(UTC).isoformat().replace("+00:00", "Z")
    with Session() as db:
        db.add(UserTable(
            id="user-existing",
            username="existing",
            phone="13800138001",
            password_hash="unused",
            created_at=now,
        ))
        db.commit()
        issue_sms_code(db, "13800138001", "login")

    code = sent_codes[-1][1]
    login = client.post(
        "/api/auth/login",
        json={"phone": "13800138001", "code": code},
    )
    assert login.status_code == 200
    assert login.json()["id"] == "user-existing"

    replay = client.post(
        "/api/auth/login",
        json={"phone": "13800138001", "code": code},
    )
    assert replay.status_code == 401


def test_sensitive_sms_requires_matching_authenticated_phone(auth_sms_client):
    client, Session, sent_codes = auth_sms_client
    now = datetime.now(UTC).isoformat().replace("+00:00", "Z")
    with Session() as db:
        db.add(UserTable(
            id="user-sensitive",
            username="sensitive",
            phone="13800138002",
            password_hash="unused",
            created_at=now,
        ))
        db.commit()

    unauthenticated = client.post(
        "/api/auth/sms-code",
        json={"phone": "13800138002", "purpose": "sensitive"},
    )
    assert unauthenticated.status_code == 401

    sent = client.post(
        "/api/auth/sms-code",
        json={"phone": "13800138002", "purpose": "sensitive"},
        headers={"Authorization": "Bearer user-sensitive"},
    )
    assert sent.status_code == 200

    verified = client.post(
        "/api/auth/sms-code/verify",
        json={"phone": "13800138002", "purpose": "sensitive", "code": sent_codes[-1][1]},
        headers={"Authorization": "Bearer user-sensitive"},
    )
    assert verified.status_code == 200


def test_bind_phone_for_account_without_phone(auth_sms_client):
    client, Session, sent_codes = auth_sms_client
    now = datetime.now(UTC).isoformat().replace("+00:00", "Z")
    with Session() as db:
        db.add(UserTable(
            id="user-no-phone",
            username="nop",
            phone=None,
            password_hash=hash_password("secret123"),
            created_at=now,
        ))
        db.commit()

    sent = client.post(
        "/api/auth/sms-code",
        json={"phone": "13800138003", "purpose": "bind_phone"},
        headers={"Authorization": "Bearer user-no-phone"},
    )
    assert sent.status_code == 200

    bound = client.post(
        "/api/auth/users/user-no-phone/phone",
        json={"phone": "13800138003", "code": sent_codes[-1][1]},
        headers={"Authorization": "Bearer user-no-phone"},
    )
    assert bound.status_code == 200
    assert bound.json()["phone"] == "13800138003"


def test_reset_password_requires_bound_phone_code(auth_sms_client):
    client, Session, sent_codes = auth_sms_client
    now = datetime.now(UTC).isoformat().replace("+00:00", "Z")
    with Session() as db:
        db.add(UserTable(
            id="user-reset-password",
            username="reset",
            phone="13800138004",
            password_hash=hash_password("old-secret"),
            created_at=now,
        ))
        db.commit()
        issue_sms_code(db, "13800138004", "reset_password")

    changed = client.post(
        "/api/auth/users/user-reset-password/password",
        json={"phone": "13800138004", "code": sent_codes[-1][1], "password": "new-secret"},
        headers={"Authorization": "Bearer user-reset-password"},
    )
    assert changed.status_code == 200

    login = client.post(
        "/api/auth/login",
        json={"phone": "13800138004", "password": "new-secret"},
    )
    assert login.status_code == 200


def test_delete_account_removes_owned_auth_data(auth_sms_client):
    client, Session, _sent_codes = auth_sms_client
    now = datetime.now(UTC).isoformat().replace("+00:00", "Z")
    with Session() as db:
        db.add(UserTable(
            id="user-delete",
            username="delete-me",
            phone="13800138005",
            password_hash=hash_password("secret123"),
            created_at=now,
        ))
        db.add(UserApiKeyTable(
            id="apikey-delete",
            owner_user_id="user-delete",
            name="key",
            key_hash="hash",
            key_prefix="tob_...",
            created_at=now,
        ))
        db.add(SkillTable(
            id="skill-delete",
            owner_user_id="user-delete",
            name="skill",
            description=None,
            content="content",
            created_at=now,
            updated_at=now,
        ))
        db.commit()

    deleted = client.delete(
        "/api/auth/users/user-delete",
        headers={"Authorization": "Bearer user-delete"},
    )
    assert deleted.status_code == 200

    with Session() as db:
        assert db.query(UserTable).filter(UserTable.id == "user-delete").first() is None
        assert db.query(UserApiKeyTable).filter(UserApiKeyTable.owner_user_id == "user-delete").first() is None
        assert db.query(SkillTable).filter(SkillTable.owner_user_id == "user-delete").first() is None
