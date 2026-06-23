"""Model list proxy routes."""

import asyncio
import copy
import hashlib
import logging
import os
import time

import httpx
from fastapi import APIRouter, HTTPException

logger = logging.getLogger(__name__)
router = APIRouter(tags=["models"])

_MODEL_LIST_CACHE: dict[tuple[str, str], tuple[float, dict]] = {}
_MODEL_LIST_CACHE_LOCK = asyncio.Lock()
_DEFAULT_MODEL_LIST_CACHE_TTL_SECONDS = 300.0


def _get_model_list_cache_ttl_seconds() -> float:
    """Return the configured model-list cache TTL in seconds."""
    raw_ttl = os.getenv("MODEL_LIST_CACHE_TTL_SECONDS", "").strip()
    if not raw_ttl:
        return _DEFAULT_MODEL_LIST_CACHE_TTL_SECONDS

    try:
        return max(float(raw_ttl), 0.0)
    except ValueError:
        logger.warning("Invalid MODEL_LIST_CACHE_TTL_SECONDS=%r; using default", raw_ttl)
        return _DEFAULT_MODEL_LIST_CACHE_TTL_SECONDS


def _get_model_list_cache_key(base_url: str, api_key: str) -> tuple[str, str]:
    """Build a cache key without storing the raw API key."""
    api_key_hash = hashlib.sha256(api_key.encode("utf-8")).hexdigest() if api_key else ""
    return (base_url.rstrip("/"), api_key_hash)


def clear_model_list_cache() -> None:
    """Clear the backend model-list cache."""
    _MODEL_LIST_CACHE.clear()


@router.get(
    "/api/models",
    summary="List available upstream models",
    description=(
        "Proxies the configured OpenAI-compatible `/models` endpoint using server-side "
        "environment variables, so browser clients do not receive the upstream API key."
    ),
)
async def list_models():
    """Proxy to the OpenAI-compatible /models endpoint.

    Reads OPENAI base URL and API key from server-side env vars so that
    the frontend never sees the API key.
    """
    base_url = (
        os.getenv("OPENAI_COMPATIBLE_BASE_URL", "").strip()
        or os.getenv("NEXT_PUBLIC_OPENAI_BASE_URL", "").strip()
    )
    api_key = (
        os.getenv("OPENAI_COMPATIBLE_API_KEY", "").strip()
        or os.getenv("NEXT_PUBLIC_OPENAI_API_KEY", "").strip()
        or os.getenv("OPENAI_API_KEY", "").strip()
    )

    if not base_url:
        raise HTTPException(status_code=503, detail="OPENAI_BASE_URL is not configured on the server")

    cache_ttl_seconds = _get_model_list_cache_ttl_seconds()
    cache_key = _get_model_list_cache_key(base_url, api_key)
    now = time.monotonic()
    if cache_ttl_seconds > 0:
        cached = _MODEL_LIST_CACHE.get(cache_key)
        if cached and now - cached[0] < cache_ttl_seconds:
            return copy.deepcopy(cached[1])

    url = f"{base_url.rstrip('/')}/models"
    headers: dict[str, str] = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    try:
        async with _MODEL_LIST_CACHE_LOCK:
            if cache_ttl_seconds > 0:
                cached = _MODEL_LIST_CACHE.get(cache_key)
                now = time.monotonic()
                if cached and now - cached[0] < cache_ttl_seconds:
                    return copy.deepcopy(cached[1])

            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.get(url, headers=headers)
                resp.raise_for_status()
                payload = resp.json()

            if cache_ttl_seconds > 0:
                _MODEL_LIST_CACHE[cache_key] = (time.monotonic(), copy.deepcopy(payload))

            return payload
    except httpx.HTTPStatusError as e:
        logger.error(f"Upstream /models returned {e.response.status_code}: {e.response.text[:200]}")
        raise HTTPException(status_code=e.response.status_code, detail="Upstream model list request failed")
    except Exception as e:
        logger.error(f"Failed to proxy /models: {e}")
        raise HTTPException(status_code=502, detail=f"Failed to reach model API: {e}")

