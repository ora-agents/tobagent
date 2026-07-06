from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from src.api.fastapi_app import app
from src.utils.db import Base, SiteTestimonialTable, UserTable, get_db


@pytest.fixture()
def testimonials_client():
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


def _add_user(Session, user_id: str = "user-testimonial", username: str = "alice") -> None:
    now = datetime.now(UTC).isoformat().replace("+00:00", "Z")
    with Session() as db:
        db.add(UserTable(
            id=user_id,
            username=username,
            phone=f"138{len(username):08d}",
            created_at=now,
        ))
        db.commit()


def test_public_testimonials_start_empty(testimonials_client):
    client, _Session = testimonials_client

    response = client.get("/api/site-testimonials")

    assert response.status_code == 200
    assert response.json() == []


def test_testimonial_requires_login(testimonials_client):
    client, _Session = testimonials_client

    response = client.post(
        "/api/site-testimonials",
        json={"rating": 5, "quote": "这是一条真实使用后的评价内容。"},
    )

    assert response.status_code == 401


def test_logged_in_user_can_publish_and_update_one_testimonial(testimonials_client):
    client, Session = testimonials_client
    _add_user(Session)

    first = client.post(
        "/api/site-testimonials",
        headers={"Authorization": "Bearer user-testimonial"},
        json={
            "role": "客服主管",
            "company": "智能硬件企业",
            "rating": 5,
            "quote": "知识库和 Agent 配置让客服团队的回复更稳定。",
        },
    )

    assert first.status_code == 200
    body = first.json()
    assert body["authorName"] == "alice"
    assert body["isOwn"] is True
    assert body["quote"] == "知识库和 Agent 配置让客服团队的回复更稳定。"

    second = client.post(
        "/api/site-testimonials",
        headers={"Authorization": "Bearer user-testimonial"},
        json={
            "role": "运营负责人",
            "company": "连锁服务品牌",
            "rating": 4,
            "quote": "更新后的评价仍然只保留同一账号的一条记录。",
        },
    )

    assert second.status_code == 200
    updated = second.json()
    assert updated["id"] == body["id"]
    assert updated["rating"] == 4
    assert updated["role"] == "运营负责人"

    list_response = client.get("/api/site-testimonials")
    assert list_response.status_code == 200
    testimonials = list_response.json()
    assert len(testimonials) == 1
    assert testimonials[0]["quote"] == "更新后的评价仍然只保留同一账号的一条记录。"

    with Session() as db:
        assert db.query(SiteTestimonialTable).count() == 1
