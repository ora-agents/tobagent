"""Tests for the environment-key protected platform administration API."""

from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from src.api.fastapi_app import app
from src.utils.db import Base, PaymentOrderTable, UserTable, get_db


@pytest.fixture()
def platform_admin_client(monkeypatch):
    """Provide a clean database and enabled administrator key."""
    monkeypatch.setenv("PLATFORM_ADMIN_KEY", "test-platform-admin-key")
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    def override_get_db():
        session = TestingSessionLocal()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_db] = override_get_db
    try:
        with TestClient(app) as test_client:
            yield test_client, TestingSessionLocal
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_platform_admin_is_hidden_without_environment_key(monkeypatch):
    monkeypatch.delenv("PLATFORM_ADMIN_KEY", raising=False)
    with TestClient(app) as client:
        response = client.post("/api/platform-admin/session", json={"key": "anything"})
    assert response.status_code == 404


def test_platform_admin_requires_key_and_returns_full_user_and_order_data(platform_admin_client):
    client, Session = platform_admin_client
    now = datetime.now(UTC).isoformat().replace("+00:00", "Z")
    with Session() as db:
        db.add_all([
            UserTable(id="buyer-id", username="buyer", phone="13800138000", email="buyer@example.com", created_at=now),
            UserTable(id="seller-id", username="seller", phone="13800138001", email="seller@example.com", created_at=now),
            PaymentOrderTable(
                id="order-id",
                out_trade_no="TOB-ORDER-001",
                buyer_user_id="buyer-id",
                seller_user_id="seller-id",
                agent_profile_id="agent-id",
                share_id="share-id",
                amount_cents=1288,
                status="paid",
                created_at=now,
                updated_at=now,
                paid_at=now,
            ),
        ])
        db.commit()

    assert client.get("/api/platform-admin/overview").status_code == 401
    assert client.post("/api/platform-admin/session", json={"key": "wrong"}).status_code == 401

    login = client.post("/api/platform-admin/session", json={"key": "test-platform-admin-key"})
    assert login.status_code == 200
    assert "tob_platform_admin" in login.cookies
    assert "httponly" in login.headers["set-cookie"].lower()

    overview = client.get("/api/platform-admin/overview")
    assert overview.status_code == 200
    assert overview.json()["users"] == 2
    assert overview.json()["orders"] == 1
    assert overview.json()["paidAmountCents"] == 1288

    users = client.get("/api/platform-admin/users", params={"search": "buyer"})
    assert users.status_code == 200
    assert users.json()["total"] == 1
    assert users.json()["items"][0] == {
        "id": "buyer-id",
        "username": "buyer",
        "phone": "13800138000",
        "email": "buyer@example.com",
        "createdAt": now,
    }

    orders = client.get("/api/platform-admin/orders", params={"search": "TOB-ORDER"})
    assert orders.status_code == 200
    assert orders.json()["total"] == 1
    assert orders.json()["items"][0]["buyerUsername"] == "buyer"
    assert orders.json()["items"][0]["sellerUsername"] == "seller"
    assert orders.json()["items"][0]["amountCents"] == 1288

    logout = client.delete("/api/platform-admin/session")
    assert logout.status_code == 204
    assert client.get("/api/platform-admin/overview").status_code == 401
