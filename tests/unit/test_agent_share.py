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
    assert copied_mcp.headers == {"Authorization": "Bearer secret"}
