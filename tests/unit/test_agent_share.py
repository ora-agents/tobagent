from datetime import UTC, datetime

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from starlette.requests import Request

from src.api.fastapi_app import (
    AgentShareImportRequest,
    AgentShareLinkRequest,
    AgentShareOptions,
    create_agent_share_link,
    import_agent_share,
)
from src.api.routes.agent_profiles import (
    delete_agent_share_link,
    get_agent_share_preview,
    list_agent_share_links,
    list_agent_share_testimonials,
    update_agent_share_link,
    upsert_agent_share_testimonial,
)
from src.api.routes.payments import (
    _grant_paid_access,
    _wechat_configured,
    get_agent_share_access,
    pay_payment_order,
    purchase_agent_share,
)
from src.api.schemas import (
    AgentShareFaqItem,
    AgentSharePurchaseRequest,
    AgentShareSubscriptionPlan,
    SiteTestimonialRequest,
)
from src.utils.db import (
    AgentProfileTable,
    AgentPurchaseTable,
    AgentShareLinkTable,
    AgentShareTestimonialTable,
    AgentShareTrialTable,
    Base,
    KnowledgeBaseTable,
    McpServerTable,
    PaymentOrderTable,
    SkillTable,
    UserTable,
    WalletLedgerEntryTable,
)


@pytest.fixture()
def db_session():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    session = Session()
    try:
        yield session
    finally:
        session.close()


def _user(user_id: str) -> UserTable:
    return UserTable(
        id=user_id,
        username=user_id,
        password_hash="hash",
        created_at=datetime.now(UTC).isoformat(),
    )


def _agent(agent_id: str, owner_user_id: str) -> AgentProfileTable:
    now = datetime.now(UTC).isoformat()
    return AgentProfileTable(
        id=agent_id,
        owner_user_id=owner_user_id,
        name="Source Agent",
        description="Source description",
        system_prompt="You are useful.",
        model="gpt-test",
        enabled_tools=["rag_search", "fetch"],
        knowledge_base_ids=["kb-source"],
        skill_ids=["skill-source"],
        mcp_ids=["mcp-source"],
        agent_ids=["agent-linked"],
        wake_words=["hello agent"],
        role_template_id="custom",
        persona_style="professional",
        boundary_mode="business_only",
        tts_voice="Cherry",
        voice_interruption_enabled=True,
        speaker_verification_enabled=True,
        user_voiceprint_id="voiceprint-source",
        created_at=now,
        updated_at=now,
    )


def _local_request() -> Request:
    return Request({
        "type": "http",
        "method": "POST",
        "path": "/",
        "headers": [(b"host", b"localhost:8000")],
    })


def _remote_request() -> Request:
    return Request({
        "type": "http",
        "method": "POST",
        "path": "/",
        "headers": [(b"host", b"api.example.com")],
    })


@pytest.mark.anyio
async def test_create_agent_share_link_allows_multiple_links_per_agent(db_session):
    owner = _user("user-owner")
    db_session.add(owner)
    db_session.add(_agent("agent-source", owner.id))
    db_session.commit()

    first = await create_agent_share_link(
        "agent-source",
        AgentShareLinkRequest(include=AgentShareOptions(skills=True)),
        db_session,
        owner,
    )
    second = await create_agent_share_link(
        "agent-source",
        AgentShareLinkRequest(include=AgentShareOptions(mcpServers=True)),
        db_session,
        owner,
    )

    shares = db_session.query(AgentShareLinkTable).all()
    listed = await list_agent_share_links("agent-source", db_session, owner)

    assert len(shares) == 2
    assert len(listed) == 2
    assert second.token != first.token
    assert first.include.skills is True
    assert second.include.mcpServers is True


@pytest.mark.anyio
async def test_update_and_delete_agent_share_link_are_scoped_to_one_share(db_session):
    owner = _user("user-owner")
    db_session.add(owner)
    db_session.add(_agent("agent-source", owner.id))
    db_session.commit()

    first = await create_agent_share_link(
        "agent-source",
        AgentShareLinkRequest(customSlug="first-share", include=AgentShareOptions(skills=True)),
        db_session,
        owner,
    )
    second = await create_agent_share_link(
        "agent-source",
        AgentShareLinkRequest(customSlug="second-share", include=AgentShareOptions(mcpServers=True)),
        db_session,
        owner,
    )

    updated = await update_agent_share_link(
        first.token,
        AgentShareLinkRequest(customSlug="first-edited", include=AgentShareOptions(forms=True), priceCents=900),
        db_session,
        owner,
    )
    second_preview = await get_agent_share_preview(second.customSlug or second.token, db_session)

    assert updated.token == first.token
    assert updated.customSlug == "user-owner-first-edited"
    assert updated.include.forms is True
    assert updated.priceCents == 900
    assert second_preview.include.mcpServers is True

    await delete_agent_share_link(updated.token, db_session, owner)
    remaining = await list_agent_share_links("agent-source", db_session, owner)

    assert [share.token for share in remaining] == [second.token]
    with pytest.raises(HTTPException) as exc_info:
        await get_agent_share_preview(updated.token, db_session)
    assert exc_info.value.status_code == 404


@pytest.mark.anyio
async def test_create_agent_share_link_prefixes_custom_slug_and_price(db_session):
    owner = _user("user-owner")
    db_session.add(owner)
    db_session.add(_agent("agent-source", owner.id))
    db_session.commit()

    share = await create_agent_share_link(
        "agent-source",
        AgentShareLinkRequest(
            include=AgentShareOptions(skills=True),
            customSlug="sales-helper",
            priceCents=1999,
            trialDurationMinutes=30,
        ),
        db_session,
        owner,
    )
    preview = await get_agent_share_preview("user-owner-sales-helper", db_session)

    assert share.customSlug == "user-owner-sales-helper"
    assert share.priceCents == 1999
    assert share.trialDurationMinutes == 30
    assert preview.token == share.token
    assert preview.customSlug == "user-owner-sales-helper"
    assert preview.isPaid is True
    assert preview.trialDurationMinutes == 30


@pytest.mark.anyio
async def test_create_subscription_agent_share_saves_trial_duration(db_session):
    owner = _user("user-owner")
    db_session.add(owner)
    db_session.add(_agent("agent-source", owner.id))
    db_session.commit()

    share = await create_agent_share_link(
        "agent-source",
        AgentShareLinkRequest(
            customSlug="subscription-helper",
            pricingMode="subscription",
            subscriptionPlans=[
                AgentShareSubscriptionPlan(
                    id="monthly",
                    label="月度订阅",
                    durationDays=30,
                    priceCents=9900,
                ),
            ],
            trialDurationMinutes=60,
        ),
        db_session,
        owner,
    )
    preview = await get_agent_share_preview("user-owner-subscription-helper", db_session)

    assert share.trialDurationMinutes == 60
    assert preview.isPaid is True
    assert preview.trialDurationMinutes == 60


@pytest.mark.anyio
async def test_paid_agent_share_access_starts_configured_trial(db_session):
    owner = _user("user-owner")
    receiver = _user("user-receiver")
    db_session.add_all([owner, receiver])
    db_session.add(_agent("agent-source", owner.id))
    db_session.commit()

    share = await create_agent_share_link(
        "agent-source",
        AgentShareLinkRequest(customSlug="paid-agent", priceCents=500, trialDurationMinutes=45),
        db_session,
        owner,
    )

    access = await get_agent_share_access(share.customSlug, db_session, receiver)

    assert access.requiresPurchase is True
    assert access.purchased is False
    assert access.trialDurationMinutes == 45
    assert access.trialActive is True
    assert access.trialExpiresAt is not None
    assert db_session.query(AgentShareTrialTable).count() == 1


@pytest.mark.anyio
async def test_create_agent_share_link_saves_landing_intro_and_faq(db_session):
    owner = _user("user-owner")
    db_session.add(owner)
    db_session.add(_agent("agent-source", owner.id))
    db_session.commit()

    share = await create_agent_share_link(
        "agent-source",
        AgentShareLinkRequest(
            customSlug="sales-helper",
            introductionText="这个 Agent 面向售前线索跟进。",
            faqItems=[
                AgentShareFaqItem(
                    question="适合谁使用？",
                    answer="适合销售和客服团队。",
                ),
            ],
        ),
        db_session,
        owner,
    )
    preview = await get_agent_share_preview("user-owner-sales-helper", db_session)

    assert share.introductionText == "这个 Agent 面向售前线索跟进。"
    assert share.faqItems[0].question == "适合谁使用？"
    assert preview.introductionText == "这个 Agent 面向售前线索跟进。"
    assert preview.faqItems[0].answer == "适合销售和客服团队。"


@pytest.mark.anyio
async def test_agent_share_testimonials_are_scoped_to_share(db_session):
    owner = _user("user-owner")
    reviewer = _user("user-reviewer")
    db_session.add_all([owner, reviewer])
    db_session.add(_agent("agent-source", owner.id))
    db_session.add(_agent("agent-other", owner.id))
    db_session.commit()

    first_share = await create_agent_share_link(
        "agent-source",
        AgentShareLinkRequest(customSlug="sales-helper"),
        db_session,
        owner,
    )
    db_session.add(
        AgentShareLinkTable(
            id="share-other",
            token="other-token",
            owner_user_id=owner.id,
            agent_profile_id="agent-other",
            include_options={},
            custom_slug="user-owner-other",
            price_cents=0,
            currency="CNY",
            created_at=datetime.now(UTC).isoformat(),
            updated_at=datetime.now(UTC).isoformat(),
        )
    )
    db_session.commit()

    created = await upsert_agent_share_testimonial(
        "user-owner-sales-helper",
        SiteTestimonialRequest(rating=5, quote="这个销售 Agent 对线索跟进很有帮助。"),
        db_session,
        reviewer,
    )
    updated = await upsert_agent_share_testimonial(
        "user-owner-sales-helper",
        SiteTestimonialRequest(rating=4, quote="更新后的评价仍然只属于这个 Agent。"),
        db_session,
        reviewer,
    )
    testimonials = await list_agent_share_testimonials("user-owner-sales-helper", db_session)
    other_testimonials = await list_agent_share_testimonials("user-owner-other", db_session)

    assert created.id == updated.id
    assert updated.rating == 4
    assert len(testimonials) == 1
    assert testimonials[0].quote == "更新后的评价仍然只属于这个 Agent。"
    assert other_testimonials == []
    share_row = db_session.query(AgentShareLinkTable).filter(
        AgentShareLinkTable.token == first_share.token,
    ).one()
    assert db_session.query(AgentShareTestimonialTable).filter(
        AgentShareTestimonialTable.share_id == share_row.id,
    ).count() == 1


@pytest.mark.anyio
async def test_create_agent_share_link_allows_same_custom_slug_per_user_prefix(db_session):
    first_owner = _user("first-owner")
    second_owner = _user("second-owner")
    db_session.add_all([first_owner, second_owner])
    db_session.add(_agent("agent-first", first_owner.id))
    db_session.add(_agent("agent-second", second_owner.id))
    db_session.commit()

    first = await create_agent_share_link(
        "agent-first",
        AgentShareLinkRequest(customSlug="sales-helper"),
        db_session,
        first_owner,
    )
    second = await create_agent_share_link(
        "agent-second",
        AgentShareLinkRequest(customSlug="sales-helper"),
        db_session,
        second_owner,
    )

    assert first.customSlug == "first-owner-sales-helper"
    assert second.customSlug == "second-owner-sales-helper"


@pytest.mark.anyio
async def test_create_agent_share_link_does_not_repeat_user_prefix(db_session):
    owner = _user("user-owner")
    db_session.add(owner)
    db_session.add(_agent("agent-source", owner.id))
    db_session.commit()

    share = await create_agent_share_link(
        "agent-source",
        AgentShareLinkRequest(customSlug="user-owner-sales-helper"),
        db_session,
        owner,
    )

    assert share.customSlug == "user-owner-sales-helper"


@pytest.mark.anyio
async def test_import_paid_agent_share_requires_purchase(db_session):
    owner = _user("user-owner")
    receiver = _user("user-receiver")
    db_session.add_all([owner, receiver])
    db_session.add(_agent("agent-source", owner.id))
    db_session.commit()

    share = await create_agent_share_link(
        "agent-source",
        AgentShareLinkRequest(customSlug="paid-agent", priceCents=500),
        db_session,
        owner,
    )

    with pytest.raises(HTTPException) as exc:
        await import_agent_share(
            share.customSlug,
            AgentShareImportRequest(),
            db_session,
            receiver,
        )

    assert exc.value.status_code == 402


@pytest.mark.anyio
async def test_import_paid_agent_share_allows_active_trial_as_full_copy(db_session):
    owner = _user("user-owner")
    receiver = _user("user-receiver")
    db_session.add_all([owner, receiver])
    db_session.add(_agent("agent-source", owner.id))
    db_session.commit()

    share = await create_agent_share_link(
        "agent-source",
        AgentShareLinkRequest(customSlug="paid-agent", priceCents=500, trialDurationMinutes=30),
        db_session,
        owner,
    )
    await get_agent_share_access(share.customSlug, db_session, receiver)

    imported = await import_agent_share(
        share.customSlug,
        AgentShareImportRequest(),
        db_session,
        receiver,
    )

    assert imported.agent.isHidden is False
    assert imported.agent.ownerUserId == receiver.id

    now = datetime.now(UTC).isoformat()
    order = PaymentOrderTable(
        id="order-trial-upgrade",
        out_trade_no="TOBTRIAL",
        buyer_user_id=receiver.id,
        seller_user_id=owner.id,
        agent_profile_id="agent-source",
        share_id=db_session.query(AgentShareLinkTable).filter_by(token=share.token).one().id,
        amount_cents=500,
        currency="CNY",
        status="pending",
        created_at=now,
        updated_at=now,
    )
    db_session.add(order)
    db_session.commit()
    _grant_paid_access(db_session, order, now)
    db_session.commit()

    upgraded = await import_agent_share(
        share.customSlug,
        AgentShareImportRequest(),
        db_session,
        receiver,
    )

    assert upgraded.agent.id == imported.agent.id
    assert upgraded.agent.isHidden is False


def test_grant_paid_access_creates_purchase_and_wallet_ledger(db_session):
    owner = _user("user-owner")
    receiver = _user("user-receiver")
    now = datetime.now(UTC).isoformat()
    db_session.add_all([owner, receiver])
    db_session.add(_agent("agent-source", owner.id))
    share = AgentShareLinkTable(
        id="share-paid",
        token="paid-token",
        owner_user_id=owner.id,
        agent_profile_id="agent-source",
        include_options={},
        custom_slug="paid-agent",
        price_cents=880,
        currency="CNY",
        created_at=now,
        updated_at=now,
    )
    order = PaymentOrderTable(
        id="order-paid",
        out_trade_no="TOBTEST",
        buyer_user_id=receiver.id,
        seller_user_id=owner.id,
        agent_profile_id="agent-source",
        share_id=share.id,
        amount_cents=880,
        currency="CNY",
        status="pending",
        created_at=now,
        updated_at=now,
    )
    db_session.add_all([share, order])
    db_session.commit()

    _grant_paid_access(db_session, order, now, {"transaction_id": "wx-1"})
    _grant_paid_access(db_session, order, now, {"transaction_id": "wx-1"})
    db_session.commit()

    purchases = db_session.query(AgentPurchaseTable).all()
    ledger = db_session.query(WalletLedgerEntryTable).all()
    assert order.status == "paid"
    assert order.provider_transaction_id == "wx-1"
    assert len(purchases) == 1
    assert purchases[0].buyer_user_id == receiver.id
    assert len(ledger) == 1
    assert ledger[0].user_id == owner.id
    assert ledger[0].amount_cents == 880


def test_grant_paid_access_creates_new_entitlement_for_subscription_renewal(db_session):
    owner = _user("user-owner")
    receiver = _user("user-receiver")
    now = datetime.now(UTC).isoformat()
    db_session.add_all([owner, receiver])
    db_session.add(_agent("agent-source", owner.id))
    db_session.add(AgentPurchaseTable(
        id="purchase-expired",
        buyer_user_id=receiver.id,
        seller_user_id=owner.id,
        agent_profile_id="agent-source",
        share_id="share-paid",
        order_id="order-old",
        pricing_mode="subscription",
        pricing_plan_id="monthly",
        price_cents=500,
        currency="CNY",
        access_expires_at="2020-01-01T00:00:00Z",
        created_at="2019-12-01T00:00:00Z",
    ))
    order = PaymentOrderTable(
        id="order-renewal",
        out_trade_no="TOBRENEWAL",
        buyer_user_id=receiver.id,
        seller_user_id=owner.id,
        agent_profile_id="agent-source",
        share_id="share-paid",
        pricing_mode="subscription",
        pricing_plan_id="monthly",
        amount_cents=500,
        currency="CNY",
        status="pending",
        access_expires_at="2030-01-01T00:00:00Z",
        created_at=now,
        updated_at=now,
    )
    db_session.add(order)
    db_session.commit()

    _grant_paid_access(db_session, order, now)
    db_session.commit()

    purchases = db_session.query(AgentPurchaseTable).filter_by(
        buyer_user_id=receiver.id,
        share_id="share-paid",
    ).all()
    assert len(purchases) == 2
    assert {purchase.order_id for purchase in purchases} == {"order-old", "order-renewal"}


@pytest.mark.anyio
async def test_local_unconfigured_payment_grants_access_only_after_pay(db_session, monkeypatch):
    monkeypatch.delenv("WECHAT_PAY_APPID", raising=False)
    monkeypatch.delenv("WECHAT_PAY_MCHID", raising=False)
    monkeypatch.delenv("WECHAT_PAY_SERIAL_NO", raising=False)
    monkeypatch.delenv("WECHAT_PAY_NOTIFY_URL", raising=False)
    monkeypatch.delenv("WECHAT_PAY_PRIVATE_KEY_PATH", raising=False)

    owner = _user("user-owner")
    receiver = _user("user-receiver")
    db_session.add_all([owner, receiver])
    db_session.add(_agent("agent-source", owner.id))
    db_session.commit()

    share = await create_agent_share_link(
        "agent-source",
        AgentShareLinkRequest(customSlug="paid-agent", priceCents=500),
        db_session,
        owner,
    )

    response = await purchase_agent_share(
        share.customSlug,
        _local_request(),
        AgentSharePurchaseRequest(),
        db_session,
        receiver,
    )

    assert response.status == "pending"
    assert response.amountCents == 500
    assert response.paymentProvider == "local_dev_direct"
    assert response.paymentConfigured is False
    share_row = db_session.query(AgentShareLinkTable).filter_by(token=share.token).one()
    assert db_session.query(AgentPurchaseTable).filter_by(
        share_id=share_row.id,
        buyer_user_id=receiver.id,
    ).count() == 0

    paid = await pay_payment_order(response.orderId, _local_request(), db_session, receiver)

    assert paid.status == "paid"
    assert paid.paymentProvider == "local_dev_direct"
    assert db_session.query(AgentPurchaseTable).filter_by(
        share_id=share_row.id,
        buyer_user_id=receiver.id,
    ).count() == 1


@pytest.mark.anyio
async def test_wechat_qr_code_is_created_only_after_pay(db_session, monkeypatch):
    owner = _user("user-owner")
    receiver = _user("user-receiver")
    db_session.add_all([owner, receiver])
    db_session.add(_agent("agent-source", owner.id))
    db_session.commit()

    share = await create_agent_share_link(
        "agent-source",
        AgentShareLinkRequest(customSlug="paid-agent", priceCents=500),
        db_session,
        owner,
    )

    async def create_native_order(order, agent_name):
        assert order.status == "pending"
        assert agent_name == "Source Agent"
        return "weixin://wxpay/bizpayurl?pr=test-order"

    monkeypatch.setattr(
        "src.api.routes.payments._create_wechat_native_order",
        create_native_order,
    )

    created = await purchase_agent_share(
        share.customSlug,
        _remote_request(),
        AgentSharePurchaseRequest(),
        db_session,
        receiver,
    )

    assert created.status == "pending"
    assert created.paymentProvider == "wechat_native"
    assert created.codeUrl is None

    payment = await pay_payment_order(
        created.orderId,
        _remote_request(),
        db_session,
        receiver,
    )

    assert payment.status == "pending"
    assert payment.codeUrl == "weixin://wxpay/bizpayurl?pr=test-order"


def test_wechat_configured_requires_private_key_file(monkeypatch, tmp_path):
    monkeypatch.setenv("WECHAT_PAY_APPID", "wx-app")
    monkeypatch.setenv("WECHAT_PAY_MCHID", "mch-id")
    monkeypatch.setenv("WECHAT_PAY_SERIAL_NO", "serial")
    monkeypatch.setenv("WECHAT_PAY_NOTIFY_URL", "https://example.com/notify")
    monkeypatch.setenv("WECHAT_PAY_PRIVATE_KEY_PATH", str(tmp_path / "missing.pem"))

    assert _wechat_configured() is False

    private_key_path = tmp_path / "apiclient_key.pem"
    private_key_path.write_text("private-key")
    monkeypatch.setenv("WECHAT_PAY_PRIVATE_KEY_PATH", str(private_key_path))

    assert _wechat_configured() is True


@pytest.mark.anyio
async def test_import_agent_share_copies_selected_resources_and_rewrites_ids(
    db_session,
    monkeypatch,
):
    owner = _user("user-owner")
    receiver = _user("user-receiver")
    now = datetime.now(UTC).isoformat()
    db_session.add_all([owner, receiver])
    db_session.add(_agent("agent-source", owner.id))
    db_session.add(
        AgentProfileTable(
            id="agent-linked",
            owner_user_id=owner.id,
            name="Linked Agent",
            description=None,
            system_prompt="Help as a linked role.",
            model=None,
            enabled_tools=[],
            knowledge_base_ids=[],
            skill_ids=[],
            mcp_ids=[],
            agent_ids=[],
            wake_words=[],
            voice_interruption_enabled=True,
            speaker_verification_enabled=False,
            created_at=now,
            updated_at=now,
        )
    )
    db_session.add(
        KnowledgeBaseTable(
            id="kb-source",
            owner_user_id=owner.id,
            name="Source KB",
            description="KB",
            files=[{"name": "a.md", "size": 10, "uploadedAt": now}],
            created_at=now,
            updated_at=now,
        )
    )
    db_session.add(
        SkillTable(
            id="skill-source",
            owner_user_id=owner.id,
            name="Source Skill",
            description="Skill",
            content="skill body",
            created_at=now,
            updated_at=now,
        )
    )
    db_session.add(
        McpServerTable(
            id="mcp-source",
            owner_user_id=owner.id,
            name="Source MCP",
            type="streamable_http",
            url="http://localhost:8000/mcp",
            headers={"Authorization": "Bearer secret"},
            created_at=now,
            updated_at=now,
        )
    )
    db_session.commit()
    monkeypatch.setattr(
        "src.api.fastapi_app._copy_kb_vector_table_best_effort",
        lambda *_args: None,
    )

    share = await create_agent_share_link(
        "agent-source",
        AgentShareLinkRequest(
            include=AgentShareOptions(
                knowledgeBases=True,
                skills=True,
                mcpServers=True,
                agents=True,
            )
        ),
        db_session,
        owner,
    )

    imported = await import_agent_share(
        share.token,
        AgentShareImportRequest(name="Imported Agent"),
        db_session,
        receiver,
    )

    assert imported.agent.name == "Imported Agent"
    assert imported.agent.speakerVerificationEnabled is False
    assert imported.agent.userVoiceprintId is None
    assert imported.agent.knowledgeBaseIds != ["kb-source"]
    assert imported.agent.skillIds != ["skill-source"]
    assert imported.agent.mcpIds != ["mcp-source"]
    assert imported.agent.agentIds != ["agent-linked"]
    assert imported.resourceIdMap["knowledgeBaseIds"]["kb-source"] in imported.agent.knowledgeBaseIds
    assert imported.resourceIdMap["skillIds"]["skill-source"] in imported.agent.skillIds
    assert imported.resourceIdMap["mcpIds"]["mcp-source"] in imported.agent.mcpIds
    assert imported.resourceIdMap["agentIds"]["agent-linked"] in imported.agent.agentIds

    copied_mcp = db_session.query(McpServerTable).filter(
        McpServerTable.id == imported.agent.mcpIds[0],
    ).one()
    assert copied_mcp.owner_user_id == receiver.id
    assert copied_mcp.name == "Source MCP"
    assert copied_mcp.headers == {"Authorization": "Bearer secret"}

    copied_kb = db_session.query(KnowledgeBaseTable).filter(
        KnowledgeBaseTable.id == imported.agent.knowledgeBaseIds[0],
    ).one()
    assert copied_kb.name == "Source KB"

    copied_skill = db_session.query(SkillTable).filter(
        SkillTable.id == imported.agent.skillIds[0],
    ).one()
    assert copied_skill.name == "Source Skill"

    copied_agent = db_session.query(AgentProfileTable).filter(
        AgentProfileTable.id == imported.agent.agentIds[0],
    ).one()
    assert copied_agent.name == "Linked Agent"


@pytest.mark.anyio
async def test_import_agent_share_defaults_to_source_name_without_shared_suffix(db_session):
    owner = _user("user-owner")
    receiver = _user("user-receiver")
    db_session.add_all([owner, receiver])
    db_session.add(_agent("agent-source", owner.id))
    db_session.commit()

    share = await create_agent_share_link(
        "agent-source",
        AgentShareLinkRequest(),
        db_session,
        owner,
    )

    imported = await import_agent_share(
        share.token,
        AgentShareImportRequest(),
        db_session,
        receiver,
    )

    assert imported.agent.name == "Source Agent"


@pytest.mark.anyio
async def test_import_agent_share_reuses_existing_import_for_same_user(db_session):
    owner = _user("user-owner")
    receiver = _user("user-receiver")
    db_session.add_all([owner, receiver])
    db_session.add(_agent("agent-source", owner.id))
    db_session.commit()

    share = await create_agent_share_link(
        "agent-source",
        AgentShareLinkRequest(),
        db_session,
        owner,
    )

    first = await import_agent_share(
        share.token,
        AgentShareImportRequest(),
        db_session,
        receiver,
    )
    second = await import_agent_share(
        share.token,
        AgentShareImportRequest(name="Should Not Copy Again"),
        db_session,
        receiver,
    )

    receiver_agents = db_session.query(AgentProfileTable).filter(
        AgentProfileTable.owner_user_id == receiver.id,
    ).all()
    assert len(receiver_agents) == 1
    assert second.agent.id == first.agent.id
    assert second.agent.name == "Source Agent"


@pytest.mark.anyio
async def test_import_agent_share_reuses_legacy_copy_without_source_marker(db_session):
    owner = _user("user-owner")
    receiver = _user("user-receiver")
    db_session.add_all([owner, receiver])
    source_agent = _agent("agent-source", owner.id)
    db_session.add(source_agent)
    now = datetime.now(UTC).isoformat()
    db_session.add(
        AgentProfileTable(
            id="agent-legacy-copy",
            owner_user_id=receiver.id,
            name=source_agent.name,
            description=source_agent.description,
            system_prompt=source_agent.system_prompt,
            model=source_agent.model,
            graph_id=source_agent.graph_id,
            enabled_tools=list(source_agent.enabled_tools or []),
            knowledge_base_ids=[],
            skill_ids=[],
            mcp_ids=[],
            agent_ids=[],
            form_ids=[],
            wake_words=list(source_agent.wake_words or []),
            role_template_id=source_agent.role_template_id,
            persona_style=source_agent.persona_style,
            boundary_mode=source_agent.boundary_mode,
            tts_voice=source_agent.tts_voice,
            voice_interruption_enabled=source_agent.voice_interruption_enabled,
            speaker_verification_enabled=False,
            created_at=now,
            updated_at=now,
        )
    )
    db_session.commit()

    share = await create_agent_share_link(
        "agent-source",
        AgentShareLinkRequest(),
        db_session,
        owner,
    )

    imported = await import_agent_share(
        share.token,
        AgentShareImportRequest(),
        db_session,
        receiver,
    )

    receiver_agents = db_session.query(AgentProfileTable).filter(
        AgentProfileTable.owner_user_id == receiver.id,
    ).all()
    legacy_copy = db_session.get(AgentProfileTable, "agent-legacy-copy")
    share_row = db_session.query(AgentShareLinkTable).filter(
        AgentShareLinkTable.token == share.token,
    ).one()
    assert len(receiver_agents) == 1
    assert imported.agent.id == "agent-legacy-copy"
    assert legacy_copy.imported_from_share_id == share_row.id
    assert legacy_copy.imported_from_agent_profile_id == "agent-source"


@pytest.mark.anyio
async def test_import_agent_share_returns_owned_source_without_copying(db_session):
    owner = _user("user-owner")
    db_session.add(owner)
    db_session.add(_agent("agent-source", owner.id))
    db_session.commit()

    share = await create_agent_share_link(
        "agent-source",
        AgentShareLinkRequest(),
        db_session,
        owner,
    )

    imported = await import_agent_share(
        share.token,
        AgentShareImportRequest(name="Should Not Copy"),
        db_session,
        owner,
    )

    owner_agents = db_session.query(AgentProfileTable).filter(
        AgentProfileTable.owner_user_id == owner.id,
    ).all()
    assert len(owner_agents) == 1
    assert imported.agent.id == "agent-source"
    assert imported.agent.name == "Source Agent"
