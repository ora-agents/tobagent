from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from src.api.routes.skills import _delete_default_imported_skills
from src.utils.db import AgentProfileTable, Base, SkillTable


def _session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    return sessionmaker(bind=engine)()


def test_delete_default_imported_skills_removes_rows_and_profile_links():
    db = _session()
    try:
        db.add_all(
            [
                SkillTable(
                    id="default_skill_phone_user1",
                    owner_user_id="user_1",
                    name="电话接待",
                    description="default",
                    content="default content",
                    created_at="now",
                    updated_at="now",
                ),
                SkillTable(
                    id="skill_custom",
                    owner_user_id="user_1",
                    name="Custom",
                    description="custom",
                    content="custom content",
                    created_at="now",
                    updated_at="now",
                ),
                SkillTable(
                    id="default_skill_phone_user2",
                    owner_user_id="user_2",
                    name="Other Default",
                    description="default",
                    content="other content",
                    created_at="now",
                    updated_at="now",
                ),
                AgentProfileTable(
                    id="agent_1",
                    owner_user_id="user_1",
                    name="Agent",
                    description="agent",
                    system_prompt="prompt",
                    skill_ids=["default_skill_phone_user1", "skill_custom"],
                    knowledge_base_ids=[],
                    mcp_ids=[],
                    agent_ids=[],
                    form_ids=[],
                    wake_words=[],
                    created_at="now",
                    updated_at="old",
                ),
            ],
        )
        db.commit()

        changed = _delete_default_imported_skills(db, "user_1")
        db.commit()

        assert changed is True
        assert db.get(SkillTable, "default_skill_phone_user1") is None
        assert db.get(SkillTable, "skill_custom") is not None
        assert db.get(SkillTable, "default_skill_phone_user2") is not None
        profile = db.get(AgentProfileTable, "agent_1")
        assert profile.skill_ids == ["skill_custom"]
        assert profile.updated_at != "old"
    finally:
        db.close()
