from datetime import UTC, datetime

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from src.api.fastapi_app import (
    AgentShareImportRequest,
    AgentShareLinkRequest,
    AgentShareOptions,
    create_agent_share_link,
    import_agent_share,
)
from src.utils.db import (
    AgentProfileTable,
    AgentShareLinkTable,
    Base,
    KnowledgeBaseTable,
    McpServerTable,
    SkillTable,
    UserTable,
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
