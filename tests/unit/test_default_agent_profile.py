from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from src.api.routes.agent_profiles import _reject_system_agent_profile
from src.utils.assets_import import (
    DEFAULT_AGENT_GRAPH_ID,
    DEFAULT_AGENT_NAME,
    DEFAULT_AGENT_TOOLS,
    default_agent_profile_id,
    ensure_default_agent_profile,
)
from src.utils.db import AgentProfileTable, Base


def _session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    return sessionmaker(bind=engine)()


def test_ensure_default_agent_profile_creates_system_builder_agent():
    db = _session()
    try:
        profile = ensure_default_agent_profile(db, "user_1")
        db.commit()

        saved = db.get(AgentProfileTable, default_agent_profile_id("user_1"))

        assert saved is not None
        assert profile.id == saved.id
        assert saved.owner_user_id == "user_1"
        assert saved.graph_id == DEFAULT_AGENT_GRAPH_ID
        assert saved.enabled_tools == DEFAULT_AGENT_TOOLS
        assert saved.name == DEFAULT_AGENT_NAME
    finally:
        db.close()


def test_ensure_default_agent_profile_repairs_builder_graph_and_tools():
    db = _session()
    try:
        profile = AgentProfileTable(
            id=default_agent_profile_id("user_1"),
            owner_user_id="user_1",
            name="old",
            description="old",
            system_prompt="old",
            graph_id="generic_agent",
            enabled_tools=["fetch"],
            knowledge_base_ids=[],
            skill_ids=[],
            mcp_ids=[],
            agent_ids=[],
            form_ids=[],
            wake_words=[],
            created_at="old",
            updated_at="old",
        )
        db.add(profile)
        db.commit()

        ensure_default_agent_profile(db, "user_1")
        db.commit()

        saved = db.get(AgentProfileTable, default_agent_profile_id("user_1"))
        assert saved.graph_id == DEFAULT_AGENT_GRAPH_ID
        assert saved.enabled_tools == DEFAULT_AGENT_TOOLS
        assert saved.updated_at != "old"
    finally:
        db.close()


def test_system_builder_profile_rejects_mutation():
    profile = AgentProfileTable(
        id=default_agent_profile_id("user_1"),
        owner_user_id="user_1",
        name=DEFAULT_AGENT_NAME,
        description="system",
        system_prompt="system",
        graph_id=DEFAULT_AGENT_GRAPH_ID,
        enabled_tools=DEFAULT_AGENT_TOOLS,
        knowledge_base_ids=[],
        skill_ids=[],
        mcp_ids=[],
        agent_ids=[],
        form_ids=[],
        wake_words=[],
        created_at="now",
        updated_at="now",
    )

    try:
        _reject_system_agent_profile(profile)
    except HTTPException as exc:
        assert exc.status_code == 403
    else:
        raise AssertionError("system profile mutation should be rejected")
