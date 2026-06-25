import json

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from src.tools.agent_builder_tool import UpsertSkillTool
from src.utils.db import Base, SkillTable
from src.utils.skill_validation import (
    SkillValidationError,
    normalize_skill_content,
    parse_skill_markdown,
    validate_skill_content,
)

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


def test_normalize_skill_content_filters_empty_arrays_and_adds_metadata():
    content = """---
name: normalized-skill
description: Normalize generated frontmatter.
allowed-tools: []
parameters:
  query:
    type: string
    enum: []
tags: []
---

# Purpose

Normalize platform-agent output.
"""

    normalized = normalize_skill_content(
        content,
        version="1.0.0",
        category="workflow",
    )
    frontmatter, _ = parse_skill_markdown(normalized)

    assert frontmatter["version"] == "1.0.0"
    assert frontmatter["category"] == "workflow"
    assert "allowed-tools" not in frontmatter
    assert "tags" not in frontmatter
    assert "enum" not in frontmatter["parameters"]["query"]


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
        version="2.1.0",
        category="crm",
        content=VALID_SKILL,
    )

    payload = json.loads(result)
    assert payload["status"] == "saved"

    db = Session()
    try:
        saved = db.query(SkillTable).one()
        assert saved.name == "customer-intake"
        assert saved.description == "Collect customer intake details before routing."
        frontmatter, _ = parse_skill_markdown(saved.content)
        assert frontmatter["version"] == "2.1.0"
        assert frontmatter["category"] == "crm"
    finally:
        db.close()


def test_upsert_skill_tool_creates_skill_with_explicit_id(monkeypatch):
    Session = _session_factory()
    monkeypatch.setattr("src.tools.agent_builder_tool.SessionLocal", Session)
    monkeypatch.setattr(
        "src.tools.agent_builder_tool.get_runtime_context_value",
        lambda key, default=None: "user_1" if key == "user_id" else default,
    )

    result = UpsertSkillTool()._run(skill_id="ticket_followup_01", content=VALID_SKILL)

    payload = json.loads(result)
    assert payload == {"skillId": "ticket_followup_01", "status": "saved"}

    db = Session()
    try:
        saved = db.query(SkillTable).one()
        assert saved.id == "ticket_followup_01"
        assert saved.owner_user_id == "user_1"
    finally:
        db.close()


def test_upsert_skill_tool_updates_existing_explicit_id(monkeypatch):
    Session = _session_factory()
    monkeypatch.setattr("src.tools.agent_builder_tool.SessionLocal", Session)
    monkeypatch.setattr(
        "src.tools.agent_builder_tool.get_runtime_context_value",
        lambda key, default=None: "user_1" if key == "user_id" else default,
    )

    tool = UpsertSkillTool()
    create_result = tool._run(skill_id="ticket_followup_01", content=VALID_SKILL)
    update_result = tool._run(
        skill_id="ticket_followup_01",
        content=VALID_SKILL_WITHOUT_ALLOWED_TOOLS,
    )

    assert json.loads(create_result)["skillId"] == "ticket_followup_01"
    assert json.loads(update_result)["skillId"] == "ticket_followup_01"

    db = Session()
    try:
        saved = db.query(SkillTable).one()
        assert saved.name == "no-tool-skill"
        assert saved.description == "A skill that only provides behavioral instructions."
    finally:
        db.close()


def test_upsert_skill_tool_rejects_explicit_id_owned_by_another_user(monkeypatch):
    Session = _session_factory()
    db = Session()
    try:
        db.add(
            SkillTable(
                id="ticket_followup_01",
                owner_user_id="user_2",
                name="Existing",
                description="",
                content=VALID_SKILL,
                created_at="2026-01-01T00:00:00Z",
                updated_at="2026-01-01T00:00:00Z",
            )
        )
        db.commit()
    finally:
        db.close()

    monkeypatch.setattr("src.tools.agent_builder_tool.SessionLocal", Session)
    monkeypatch.setattr(
        "src.tools.agent_builder_tool.get_runtime_context_value",
        lambda key, default=None: "user_1" if key == "user_id" else default,
    )

    result = UpsertSkillTool()._run(skill_id="ticket_followup_01", content=VALID_SKILL)

    assert result == "Skill 'ticket_followup_01' already exists for another user."


def test_upsert_skill_tool_filters_empty_frontmatter_arrays(monkeypatch):
    Session = _session_factory()
    monkeypatch.setattr("src.tools.agent_builder_tool.SessionLocal", Session)
    monkeypatch.setattr(
        "src.tools.agent_builder_tool.get_runtime_context_value",
        lambda key, default=None: "user_1" if key == "user_id" else default,
    )
    content = VALID_SKILL_WITHOUT_ALLOWED_TOOLS.replace(
        "description: A skill that only provides behavioral instructions.",
        "description: A skill that only provides behavioral instructions.\nallowed-tools: []",
    )

    result = UpsertSkillTool()._run(content=content)

    assert json.loads(result)["status"] == "saved"
    db = Session()
    try:
        frontmatter, _ = parse_skill_markdown(db.query(SkillTable).one().content)
        assert "allowed-tools" not in frontmatter
    finally:
        db.close()
