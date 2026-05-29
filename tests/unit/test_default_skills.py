from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from src.utils.db import Base, SkillTable
from src.utils.default_skills import (
    DEFAULT_SKILLS,
    default_skill_id,
    ensure_default_skills,
)


def _session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    return sessionmaker(bind=engine)()


def test_ensure_default_skills_creates_bundled_skills_for_user():
    db = _session()
    try:
        rows = ensure_default_skills(db, "user_1")
        db.commit()

        saved = db.query(SkillTable).filter(SkillTable.owner_user_id == "user_1").all()

        assert len(rows) == len(DEFAULT_SKILLS)
        assert len(saved) == len(DEFAULT_SKILLS)
        assert {skill.name for skill in saved} == {skill.name for skill in DEFAULT_SKILLS}
        assert all(skill.id.startswith("default_skill_") for skill in saved)
    finally:
        db.close()


def test_ensure_default_skills_does_not_duplicate_or_overwrite_seeded_user():
    db = _session()
    try:
        existing = SkillTable(
            id=default_skill_id("user_1", DEFAULT_SKILLS[0].slug),
            owner_user_id="user_1",
            name="自定义电话接待",
            description="用户修改过的描述",
            content="custom content",
            created_at="old",
            updated_at="old",
        )
        db.add(existing)
        db.commit()

        ensure_default_skills(db, "user_1")
        db.commit()

        saved = db.query(SkillTable).filter(SkillTable.owner_user_id == "user_1").all()

        assert len(saved) == 1
        assert saved[0].name == "自定义电话接待"
        assert saved[0].content == "custom content"
    finally:
        db.close()
