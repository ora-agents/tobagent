"""Lightweight JSONL debug logging for cross-process agent diagnostics."""

from __future__ import annotations

import json
import os
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

DEBUG_LOG_ENV = "TOB_AGENT_DEBUG_LOG_FILE"


def redact_secret(value: str | None, *, keep: int = 6) -> str:
    """Return a non-sensitive representation of a secret-like value."""
    if not value:
        return ""
    if len(value) <= keep * 2:
        return "***"
    return f"{value[:keep]}...{value[-keep:]}"


def write_debug_event(event: str, **fields: Any) -> None:
    """Append one JSONL debug event when TOB_AGENT_DEBUG_LOG_FILE is set."""
    log_file = os.getenv(DEBUG_LOG_ENV, "").strip()
    if not log_file:
        return

    payload = {
        "ts": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "event": event,
        **fields,
    }

    try:
        path = Path(log_file)
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(payload, ensure_ascii=False, default=str) + "\n")
    except Exception:
        return
