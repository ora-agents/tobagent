from datetime import UTC, datetime

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from src.api.fastapi_app import (
    AgentShareImportRequest,
    AgentShareLinkRequest,
    AgentShareOptions,
    create_agent_share_link,
    import_agent_share,
)
from src.api.routes.agent_profiles import (
    get_agent_share_preview,
    list_agent_share_testimonials,
    upsert_agent_share_testimonial,
)
from src.api.routes.payments import _grant_paid_access, _wechat_configured
from src.api.schemas import AgentShareFaqItem, SiteTestimonialRequest
from src.utils.db import (
    AgentProfileTable,
    AgentPurchaseTable,
    AgentShareLinkTable,
    AgentShareTestimonialTable,
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


@pytest.mark.anyio
async def test_create_agent_share_link_updates_existing_options(db_session):
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
    assert len(shares) == 1
    assert second.token == first.token
    assert second.include.skills is False
    assert second.include.mcpServers is True


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
        ),
        db_session,
        owner,
    )
    preview = await get_agent_share_preview("user-owner-sales-helper", db_session)

    assert share.customSlug == "user-owner-sales-helper"
    assert share.priceCents == 1999
    assert preview.token == share.token
    assert preview.customSlug == "user-owner-sales-helper"
    assert preview.isPaid is True


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
