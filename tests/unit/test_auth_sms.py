from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from src.api.fastapi_app import app
from src.api.sms_verification import issue_sms_code
from src.utils.db import Base, SmsVerificationCodeTable, UserTable, get_db


@pytest.fixture()
def auth_sms_client(monkeypatch):
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    sent_codes: list[tuple[str, str]] = []

    def fake_send(phone: str, code: str) -> None:
        sent_codes.append((phone, code))

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
        assert code.consumed_at is not None


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
