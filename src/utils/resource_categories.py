"""Helpers for dynamic resource category links."""

from __future__ import annotations

from src.utils.db import FormTable, SkillTable
from src.utils.skill_validation import SkillValidationError, parse_skill_markdown

UNCATEGORIZED_SKILL_CATEGORY = "__uncategorized__"
UNCATEGORIZED_FORM_CATEGORY = "__uncategorized_form__"


def normalize_category_key(value: str | None, *, uncategorized_key: str) -> str:
    """Return the persisted category key used by the frontend."""
    category = str(value or "").strip()
    return category.lower() if category else uncategorized_key


def skill_category_key(skill: SkillTable) -> str:
    """Return the normalized category key for a skill row."""
    try:
        frontmatter, _body = parse_skill_markdown(skill.content or "")
    except SkillValidationError:
        frontmatter = {}
    metadata = frontmatter.get("metadata")
    raw_category = ""
    if isinstance(metadata, dict):
        raw_category = metadata.get("category", "")
    raw_category = raw_category or frontmatter.get("category", "")
    return normalize_category_key(
        str(raw_category or ""),
        uncategorized_key=UNCATEGORIZED_SKILL_CATEGORY,
    )


def form_category_key(form: FormTable) -> str:
    """Return the normalized category key for a form row."""
    return normalize_category_key(
        form.category or "",
        uncategorized_key=UNCATEGORIZED_FORM_CATEGORY,
    )


def resolve_skill_ids(
    skills: list[SkillTable],
    explicit_ids: list[str] | None,
    category_ids: list[str] | None,
) -> list[str]:
    """Merge explicit skill links with current members of linked categories."""
    selected = list(dict.fromkeys(explicit_ids or []))
    linked_categories = set(category_ids or [])
    if linked_categories:
        selected.extend(
            skill.id
            for skill in skills
            if skill.id not in selected and skill_category_key(skill) in linked_categories
        )
    return selected


def resolve_form_ids(
    forms: list[FormTable],
    explicit_ids: list[str] | None,
    category_ids: list[str] | None,
) -> list[str]:
    """Merge explicit form links with current members of linked categories."""
    selected = list(dict.fromkeys(explicit_ids or []))
    linked_categories = set(category_ids or [])
    if linked_categories:
        selected.extend(
            form.id
            for form in forms
            if form.id not in selected and form_category_key(form) in linked_categories
        )
    return selected
