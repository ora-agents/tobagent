import json

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from src.tools.agent_builder_tool import UpsertSkillTool
from src.utils.db import Base, SkillTable
from src.utils.skill_validation import SkillValidationError, validate_skill_content

VALID_SKILL = """---
name: customer-intake
description: Collect customer intake details before routing.
license: Apache-2.0
compatibility: Requires configured CRM fields
metadata:
  author: tests
  version: "1.0.0"
  category: crm
allowed-tools: read_skill rag_search
---

# Purpose

Collect the minimum customer details needed for intake.
"""


VALID_SKILL_WITH_PARAMETERS = """---
name: appointment-booking
description: Book appointments when date and contact details are available.
allowed-tools:
  - read_skill
parameters:
  customer_name:
    type: string
    description: Confirmed customer name.
  preferred_date:
    type: string
    required: false
    enum:
      - today
      - tomorrow
---

# Purpose

Help gather optional appointment parameters without requiring all of them.
"""


VALID_SKILL_WITHOUT_ALLOWED_TOOLS = """---
name: no-tool-skill
description: A skill that only provides behavioral instructions.
---

# Purpose

Guide the agent without declaring any tool requirement.
"""


def _session_factory():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    return sessionmaker(bind=engine)


def test_validate_skill_content_accepts_standard_template():
    frontmatter = validate_skill_content(VALID_SKILL)

    assert frontmatter["name"] == "customer-intake"


def test_validate_skill_content_accepts_optional_parameters():
    frontmatter = validate_skill_content(VALID_SKILL_WITH_PARAMETERS)

    assert frontmatter["parameters"]["preferred_date"]["required"] is False


def test_validate_skill_content_accepts_missing_allowed_tools():
    frontmatter = validate_skill_content(VALID_SKILL_WITHOUT_ALLOWED_TOOLS)

    assert frontmatter["name"] == "no-tool-skill"


def test_validate_skill_content_rejects_empty_allowed_tools_when_present():
    content = VALID_SKILL_WITHOUT_ALLOWED_TOOLS.replace(
        "description: A skill that only provides behavioral instructions.",
        "description: A skill that only provides behavioral instructions.\nallowed-tools: []",
    )

    try:
        validate_skill_content(content)
    except SkillValidationError as exc:
        assert "allowed-tools" in str(exc)
    else:
        raise AssertionError("Expected SkillValidationError")


def test_validate_skill_content_rejects_missing_frontmatter():
    try:
        validate_skill_content("# Purpose\nMissing frontmatter.")
    except SkillValidationError as exc:
        assert "frontmatter" in str(exc)
    else:
        raise AssertionError("Expected SkillValidationError")


def test_validate_skill_content_rejects_invalid_parameter_required_type():
    content = VALID_SKILL_WITH_PARAMETERS.replace("required: false", "required: optional")

    try:
        validate_skill_content(content)
    except SkillValidationError as exc:
        assert "required" in str(exc)
    else:
        raise AssertionError("Expected SkillValidationError")


def test_upsert_skill_tool_rejects_invalid_content(monkeypatch):
    Session = _session_factory()
    monkeypatch.setattr(
        "src.tools.agent_builder_tool.SessionLocal",
        Session,
    )
    monkeypatch.setattr(
        "src.tools.agent_builder_tool.get_runtime_context_value",
        lambda key, default=None: "user_1" if key == "user_id" else default,
    )

    result = UpsertSkillTool()._run(
        name="Bad Skill",
        description="No frontmatter.",
        content="# Purpose\nMissing frontmatter.",
    )

    assert result.startswith("Skill validation failed:")
    db = Session()
    try:
        assert db.query(SkillTable).count() == 0
    finally:
        db.close()


def test_upsert_skill_tool_saves_valid_content_with_frontmatter_identity(monkeypatch):
    Session = _session_factory()
    monkeypatch.setattr(
        "src.tools.agent_builder_tool.SessionLocal",
        Session,
    )
    monkeypatch.setattr(
        "src.tools.agent_builder_tool.get_runtime_context_value",
        lambda key, default=None: "user_1" if key == "user_id" else default,
    )

    result = UpsertSkillTool()._run(
        name="Fallback",
        description="Fallback description.",
        content=VALID_SKILL,
    )

    payload = json.loads(result)
    assert payload["status"] == "saved"

    db = Session()
    try:
        saved = db.query(SkillTable).one()
        assert saved.name == "customer-intake"
        assert saved.description == "Collect customer intake details before routing."
    finally:
        db.close()
