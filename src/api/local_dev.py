"""Helpers for local-only development bypasses."""

from __future__ import annotations

import os
from urllib.parse import urlsplit

from fastapi import Request

LOCAL_HOSTNAMES = {"localhost", "127.0.0.1", "::1", "0.0.0.0"}


def _hostname_from_header(value: str | None) -> str:
    if not value:
        return ""
    candidate = value.strip()
    if not candidate:
        return ""
    if "://" not in candidate:
        candidate = f"http://{candidate}"
    return (urlsplit(candidate).hostname or "").lower()


def is_local_dev_request(request: Request | None) -> bool:
    """Return whether this API request targets a local development backend."""
    if os.getenv("TOB_LOCAL_DEV_BYPASS", "").lower() in {"1", "true", "yes", "on"}:
        return True
    if request is None:
        return False
    host = _hostname_from_header(request.headers.get("host"))
    return host in LOCAL_HOSTNAMES
