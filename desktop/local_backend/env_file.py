"""Utilities for reading and updating dotenv files."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class EnvLine:
    """One parsed line from a dotenv file."""

    kind: str
    raw: str
    key: str | None = None
    value: str | None = None
    export: bool = False


def parse_env_text(text: str) -> list[EnvLine]:
    """Parse dotenv text while preserving comments and unknown lines."""
    lines: list[EnvLine] = []
    for raw in text.splitlines():
        stripped = raw.strip()
        if not stripped:
            lines.append(EnvLine(kind="blank", raw=raw))
            continue
        if stripped.startswith("#"):
            lines.append(EnvLine(kind="comment", raw=raw))
            continue

        export = False
        body = stripped
        if body.startswith("export "):
            export = True
            body = body[len("export ") :].lstrip()

        key, separator, value = body.partition("=")
        key = key.strip()
        if not separator or not key or any(char.isspace() for char in key):
            lines.append(EnvLine(kind="raw", raw=raw))
            continue

        lines.append(
            EnvLine(
                kind="assignment",
                raw=raw,
                key=key,
                value=_unquote_value(value.strip()),
                export=export,
            )
        )
    return lines


def read_env(path: Path) -> dict[str, str]:
    """Read assignments from a dotenv file."""
    if not path.exists():
        return {}
    parsed = parse_env_text(path.read_text(encoding="utf-8"))
    return {
        line.key: line.value or ""
        for line in parsed
        if line.kind == "assignment" and line.key is not None
    }


def update_env_file(path: Path, values: dict[str, str]) -> None:
    """Update or append assignments in a dotenv file."""
    existing_text = path.read_text(encoding="utf-8") if path.exists() else ""
    lines = parse_env_text(existing_text)
    remaining = dict(values)
    rendered: list[str] = []

    for line in lines:
        if line.kind == "assignment" and line.key in remaining:
            prefix = "export " if line.export else ""
            rendered.append(f"{prefix}{line.key}={quote_env_value(remaining.pop(line.key))}")
        else:
            rendered.append(line.raw)

    if remaining:
        if rendered and rendered[-1].strip():
            rendered.append("")
        rendered.extend(f"{key}={quote_env_value(value)}" for key, value in remaining.items())

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(rendered).rstrip() + "\n", encoding="utf-8")


def quote_env_value(value: str) -> str:
    """Quote a dotenv value when plain assignment would be ambiguous."""
    if value == "":
        return '""'
    if any(char.isspace() for char in value) or "#" in value or value[0] in ("'", '"'):
        escaped = value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")
        return f'"{escaped}"'
    return value


def _unquote_value(value: str) -> str:
    if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
        body = value[1:-1]
        if value[0] == '"':
            return (
                body.replace("\\n", "\n")
                .replace('\\"', '"')
                .replace("\\\\", "\\")
            )
        return body
    if " #" in value:
        return value.split(" #", 1)[0].rstrip()
    return value

