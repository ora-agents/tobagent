from types import SimpleNamespace

from src.api.fastapi_app import _remove_agent_profile_links


class _FakeQuery:
    def __init__(self, profiles):
        self._profiles = profiles

    def filter(self, *_args, **_kwargs):
        return self

    def all(self):
        return self._profiles


class _FakeSession:
    def __init__(self, profiles):
        self._profiles = profiles

    def query(self, _table):
        return _FakeQuery(self._profiles)


def test_remove_agent_profile_links_removes_deleted_skill_ids():
    """Deleted skills are detached from every owned agent profile."""
    profile = SimpleNamespace(
        skill_ids=["skill_keep", "skill_delete", "skill_delete"],
        updated_at="old",
    )

    changed = _remove_agent_profile_links(
        _FakeSession([profile]),
        "user_1",
        "skill_ids",
        ["skill_delete"],
    )

    assert changed == 1
    assert profile.skill_ids == ["skill_keep"]
    assert profile.updated_at != "old"


def test_remove_agent_profile_links_cleans_knowledge_base_mcp_and_agent_refs():
    """The same cleanup helper works for all profile link arrays."""
    profile = SimpleNamespace(
        knowledge_base_ids=["kb_keep", "kb_delete"],
        mcp_ids=["mcp_delete", "mcp_keep"],
        agent_ids=["agent_keep", "agent_delete"],
        updated_at="old",
    )
    db = _FakeSession([profile])

    kb_changed = _remove_agent_profile_links(
        db,
        "user_1",
        "knowledge_base_ids",
        ["kb_delete"],
    )
    mcp_changed = _remove_agent_profile_links(db, "user_1", "mcp_ids", ["mcp_delete"])
    agent_changed = _remove_agent_profile_links(
        db,
        "user_1",
        "agent_ids",
        ["agent_delete"],
    )

    assert kb_changed == 1
    assert mcp_changed == 1
    assert agent_changed == 1
    assert profile.knowledge_base_ids == ["kb_keep"]
    assert profile.mcp_ids == ["mcp_keep"]
    assert profile.agent_ids == ["agent_keep"]


def test_remove_agent_profile_links_ignores_profiles_without_matching_ids():
    """Profiles without matching ids are left unchanged."""
    profile = SimpleNamespace(skill_ids=["skill_keep"], updated_at="old")

    changed = _remove_agent_profile_links(
        _FakeSession([profile]),
        "user_1",
        "skill_ids",
        ["missing"],
    )

    assert changed == 0
    assert profile.skill_ids == ["skill_keep"]
    assert profile.updated_at == "old"
