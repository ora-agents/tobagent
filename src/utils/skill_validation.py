"""Validation helpers for user-defined skill Markdown."""

from __future__ import annotations

import re
from typing import Any

import yaml


class SkillValidationError(ValueError):
    """Raised when skill Markdown does not match the standard template."""


_FRONTMATTER_RE = re.compile(r"\A---\r?\n(?P<yaml>[\s\S]*?)\r?\n---\r?\n?(?P<body>[\s\S]*)\Z")
_REQUIRED_FRONTMATTER_FIELDS = ("name", "description")
_OPTIONAL_PARAMETER_FIELDS = {"type", "description", "required", "default", "enum"}


def parse_skill_markdown(content: str) -> tuple[dict[str, Any], str]:
    """Return frontmatter and body from a skill Markdown document."""
    text = str(content or "")
    match = _FRONTMATTER_RE.match(text)
    if not match:
        raise SkillValidationError(
            "Skill content must start with YAML frontmatter delimited by ---."
        )

    try:
        raw_frontmatter = yaml.safe_load(match.group("yaml")) or {}
    except yaml.YAMLError as exc:
        raise SkillValidationError(f"Skill frontmatter is not valid YAML: {exc}") from exc

    if not isinstance(raw_frontmatter, dict):
        raise SkillValidationError("Skill frontmatter must be a YAML mapping.")

    return raw_frontmatter, match.group("body")


def validate_skill_content(content: str) -> dict[str, Any]:
    """Validate skill Markdown and return parsed frontmatter."""
    frontmatter, body = parse_skill_markdown(content)

    missing = [
        field
        for field in _REQUIRED_FRONTMATTER_FIELDS
        if not _has_non_empty_value(frontmatter.get(field))
    ]
    if missing:
        raise SkillValidationError(
            "Skill frontmatter is missing required field(s): " + ", ".join(missing)
        )

    if "allowed-tools" in frontmatter and not _allowed_tools(frontmatter["allowed-tools"]):
        raise SkillValidationError(
            "Skill frontmatter field 'allowed-tools' must contain at least one tool."
        )

    if "parameters" in frontmatter:
        _validate_parameters(frontmatter["parameters"])

    if not re.search(r"(?m)^#{1,3}\s+\S", body):
        raise SkillValidationError(
            "Skill body must include at least one Markdown heading such as '# Purpose'."
        )

    return frontmatter


def skill_identity_from_content(
    content: str,
    fallback_name: str = "",
    fallback_description: str = "",
) -> tuple[str, str]:
    """Return canonical skill name and description from frontmatter."""
    frontmatter = validate_skill_content(content)
    return (
        str(frontmatter.get("name") or fallback_name).strip(),
        str(frontmatter.get("description") or fallback_description or ""),
    )


def _has_non_empty_value(value: Any) -> bool:
    return value is not None and str(value).strip() != ""


def _allowed_tools(value: Any) -> list[str]:
    if isinstance(value, str):
        return [item for item in re.split(r"[\s,]+", value.strip()) if item]
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    return []


def _validate_parameters(parameters: Any) -> None:
    """Validate optional skill parameters when the template declares them."""
    if parameters is None:
        return

    if isinstance(parameters, dict):
        for name, spec in parameters.items():
            _validate_parameter_spec(str(name), spec)
        return

    if isinstance(parameters, list):
        for index, item in enumerate(parameters):
            if not isinstance(item, dict):
                raise SkillValidationError(
                    f"Skill parameter at index {index} must be a mapping."
                )
            name = item.get("name")
            if not _has_non_empty_value(name):
                raise SkillValidationError(
                    f"Skill parameter at index {index} is missing required field 'name'."
                )
            _validate_parameter_spec(str(name), item)
        return

    raise SkillValidationError(
        "Skill frontmatter field 'parameters' must be a mapping or a list."
    )


def _validate_parameter_spec(name: str, spec: Any) -> None:
    if not name.strip():
        raise SkillValidationError("Skill parameter names must not be empty.")
    if not isinstance(spec, dict):
        raise SkillValidationError(
            f"Skill parameter '{name}' must be defined as a mapping."
        )

    unknown_fields = sorted(set(spec) - _OPTIONAL_PARAMETER_FIELDS - {"name"})
    if unknown_fields:
        raise SkillValidationError(
            f"Skill parameter '{name}' has unsupported field(s): "
            + ", ".join(unknown_fields)
        )

    required = spec.get("required")
    if required is not None and not isinstance(required, bool):
        raise SkillValidationError(
            f"Skill parameter '{name}' field 'required' must be a boolean when provided."
        )

    enum = spec.get("enum")
    if enum is not None and not isinstance(enum, list):
        raise SkillValidationError(
            f"Skill parameter '{name}' field 'enum' must be a list when provided."
        )
