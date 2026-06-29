"""Read-only Langfuse trace browser routes."""

from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime
from functools import lru_cache
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from langfuse import Langfuse
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from src.api.deps import get_current_user
from src.utils.db import AgentProfileTable, UserTable, get_db

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/traces", tags=["traces"])

TraceSource = Literal["all", "main", "agent_app", "shared_agent_app", "api_key"]


class TraceListResponse(BaseModel):
    """Paginated trace list for the browser UI."""

    traces: list[dict[str, Any]]
    meta: dict[str, Any] = Field(default_factory=dict)
    source: TraceSource
    langfuseConfigured: bool
    ownedSharedThreadCount: int = 0


class TraceDetailResponse(BaseModel):
    """Trace detail with row-level observations."""

    trace: dict[str, Any]
    observations: list[dict[str, Any]] = Field(default_factory=list)
    observationsMeta: dict[str, Any] = Field(default_factory=dict)
    langfuseConfigured: bool


def _langfuse_base_url() -> str | None:
    return (
        os.getenv("LANGFUSE_BASE_URL", "").strip()
        or os.getenv("LANGFUSE_HOST", "").strip()
        or None
    )


def _langfuse_credentials() -> tuple[str, str] | None:
    public_key = os.getenv("LANGFUSE_PUBLIC_KEY", "").strip()
    secret_key = os.getenv("LANGFUSE_SECRET_KEY", "").strip()
    if not public_key or not secret_key:
        return None
    return public_key, secret_key


def _langfuse_is_configured() -> bool:
    return _langfuse_credentials() is not None


@lru_cache(maxsize=1)
def _get_langfuse_query_client() -> Langfuse:
    credentials = _langfuse_credentials()
    if credentials is None:
        raise HTTPException(status_code=503, detail="Langfuse is not configured")
    public_key, secret_key = credentials
    kwargs: dict[str, Any] = {
        "public_key": public_key,
        "secret_key": secret_key,
    }
    if base_url := _langfuse_base_url():
        kwargs["host"] = base_url
    return Langfuse(**kwargs)


def _dump_model(value: Any) -> Any:
    if hasattr(value, "model_dump"):
        return value.model_dump(mode="json")
    if isinstance(value, list):
        return [_dump_model(item) for item in value]
    if isinstance(value, dict):
        return {key: _dump_model(item) for key, item in value.items()}
    return value


def _parse_datetime(value: str | None, field_name: str) -> datetime | None:
    if not value:
        return None
    try:
        normalized = value.replace("Z", "+00:00")
        return datetime.fromisoformat(normalized)
    except ValueError as exc:
        raise HTTPException(
            status_code=422,
            detail=f"{field_name} must be an ISO timestamp",
        ) from exc


def _metadata(trace: dict[str, Any]) -> dict[str, Any]:
    metadata = trace.get("metadata")
    return metadata if isinstance(metadata, dict) else {}


def _local_thread_metadata(trace: dict[str, Any]) -> dict[str, Any]:
    metadata = _metadata(trace)
    local_metadata = metadata.get("local_thread_metadata")
    return local_metadata if isinstance(local_metadata, dict) else {}


def _combined_metadata(trace: dict[str, Any]) -> dict[str, Any]:
    combined = dict(_local_thread_metadata(trace))
    combined.update(_metadata(trace))
    return combined


def _trace_user_id(trace: dict[str, Any]) -> str:
    """Return the Langfuse trace user id across SDK/API field variants."""
    return str(trace.get("user_id") or trace.get("userId") or "")


def _trace_session_id(trace: dict[str, Any]) -> str:
    """Return the Langfuse trace session id across SDK/API field variants."""
    return str(trace.get("session_id") or trace.get("sessionId") or "")


def _normalize_observation(observation: dict[str, Any]) -> dict[str, Any]:
    """Expose Langfuse observation fields in the shape expected by the UI."""
    field_aliases = {
        "traceId": "trace_id",
        "parentObservationId": "parent_observation_id",
        "startTime": "start_time",
        "endTime": "end_time",
        "statusMessage": "status_message",
        "providedModelName": "provided_model_name",
        "usageDetails": "usage_details",
        "costDetails": "cost_details",
        "totalCost": "total_cost",
    }
    normalized = dict(observation)
    for source, target in field_aliases.items():
        if target not in normalized and source in normalized:
            normalized[target] = normalized[source]
    return normalized


def _extract_observations(value: Any) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Return normalized observations from Langfuse response variants."""
    dumped = _dump_model(value)
    meta: dict[str, Any] = {}

    if isinstance(dumped, list):
        candidates = dumped
    elif isinstance(dumped, dict):
        raw_meta = dumped.get("meta")
        if isinstance(raw_meta, dict):
            meta = raw_meta

        data = dumped.get("data")
        if isinstance(data, list):
            candidates = data
        else:
            observations = dumped.get("observations")
            candidates = observations if isinstance(observations, list) else []
    else:
        candidates = []

    observations = [
        _normalize_observation(observation)
        for observation in candidates
        if isinstance(observation, dict)
    ]
    observations.sort(key=lambda item: str(item.get("start_time") or item.get("startTime") or ""))
    return observations, meta


def _trace_source(trace: dict[str, Any], owned_shared_thread_ids: set[str]) -> TraceSource:
    metadata = _combined_metadata(trace)
    source_type = str(metadata.get("source_type") or "").lower()
    conversation_source = str(metadata.get("conversation_source") or "").lower()
    auth_source = str(metadata.get("auth_source") or "").lower()
    session_id = _trace_session_id(trace)

    is_api_key = (
        "api" in source_type
        or metadata.get("created_via_api_key") is True
        or auth_source in {"api_key", "apikey"}
        or conversation_source in {"api_key", "apikey"}
    )
    if is_api_key:
        return "api_key"

    shared_owner = metadata.get("shared_agent_owner_user_id")
    shared_viewer = metadata.get("shared_agent_viewer_user_id")
    is_shared_agent_app = (
        bool(shared_owner and shared_viewer and shared_owner != shared_viewer)
        or bool(session_id and session_id in owned_shared_thread_ids)
    )
    if is_shared_agent_app:
        return "shared_agent_app"

    is_agent_app = (
        "agent app" in source_type
        or source_type in {"agent_app", "agentapp"}
        or conversation_source in {"agent_app", "agentapp", "agent app"}
    )
    if is_agent_app:
        return "agent_app"

    return "main"


def _matches_source(
    trace: dict[str, Any],
    source: TraceSource,
    owned_shared_thread_ids: set[str],
) -> bool:
    if source == "all":
        return True
    trace_source = _trace_source(trace, owned_shared_thread_ids)
    if source == "agent_app":
        return trace_source in {"agent_app", "shared_agent_app"}
    return trace_source == source


def _matches_search(trace: dict[str, Any], query: str | None) -> bool:
    if not query:
        return True
    haystack = " ".join(
        str(value)
        for value in (
            trace.get("id"),
            trace.get("name"),
            _trace_session_id(trace),
            trace.get("input"),
            trace.get("output"),
            _combined_metadata(trace),
            trace.get("tags"),
        )
        if value is not None
    ).lower()
    return query.lower() in haystack


def _may_read_trace(
    trace: dict[str, Any],
    *,
    current_user_id: str,
    owned_shared_thread_ids: set[str],
    thread_metadata: dict[str, dict[str, Any]],
) -> bool:
    metadata = _combined_metadata(trace)
    session_id = _trace_session_id(trace)
    return (
        _trace_user_id(trace) == current_user_id
        or metadata.get("user_id") == current_user_id
        or metadata.get("langfuse_user_id") == current_user_id
        or metadata.get("shared_agent_owner_user_id") == current_user_id
        or metadata.get("shared_agent_viewer_user_id") == current_user_id
        or bool(session_id and session_id in owned_shared_thread_ids)
        or bool(session_id and session_id in thread_metadata)
    )


async def _call_langfuse(operation: Any, *args: Any, attempts: int = 3, **kwargs: Any) -> Any:
    """Call Langfuse with a short retry for transient self-hosted TLS failures."""
    last_exc: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            return await asyncio.to_thread(operation, *args, **kwargs)
        except Exception as exc:
            last_exc = exc
            if attempt >= attempts:
                break
            await asyncio.sleep(0.25 * attempt)
    assert last_exc is not None
    raise last_exc


def _owned_shared_thread_ids(db: Session, user_id: str) -> set[str]:
    dialect = db.bind.dialect.name if db.bind is not None else ""
    statements = []
    if dialect == "postgresql":
        statements.append(
            text(
                'SELECT thread_id FROM "thread" '
                "WHERE metadata_json->>'shared_agent_owner_user_id' = :user_id"
            )
        )
    elif dialect == "sqlite":
        statements.append(
            text(
                'SELECT thread_id FROM "thread" '
                "WHERE json_extract(metadata_json, '$.shared_agent_owner_user_id') = :user_id"
            )
        )
    statements.append(text('SELECT thread_id, metadata_json FROM "thread"'))

    for statement in statements:
        try:
            rows = db.execute(statement, {"user_id": user_id}).all()
        except Exception as exc:
            logger.debug("Shared thread lookup failed: %s", exc)
            continue

        ids: set[str] = set()
        for row in rows:
            if len(row) == 1:
                ids.add(str(row[0]))
                continue

            metadata = row[1]
            if not isinstance(metadata, dict):
                import json

                try:
                    metadata = json.loads(metadata or "{}")
                except (TypeError, ValueError):
                    metadata = {}
            if isinstance(metadata, dict) and metadata.get("shared_agent_owner_user_id") == user_id:
                ids.add(str(row[0]))
        return ids

    return set()


def _visible_thread_metadata(db: Session, user_id: str) -> dict[str, dict[str, Any]]:
    try:
        rows = db.execute(text('SELECT thread_id, user_id, metadata_json FROM "thread"')).all()
    except Exception as exc:
        logger.debug("Visible thread metadata lookup failed: %s", exc)
        return {}

    import json

    metadata_by_thread_id: dict[str, dict[str, Any]] = {}
    for row in rows:
        metadata = row[2]
        if not isinstance(metadata, dict):
            try:
                metadata = json.loads(metadata or "{}")
            except (TypeError, ValueError):
                metadata = {}
        if not isinstance(metadata, dict):
            metadata = {}
        if (
            row[1] == user_id
            or metadata.get("user_id") == user_id
            or metadata.get("shared_agent_owner_user_id") == user_id
            or metadata.get("shared_agent_viewer_user_id") == user_id
        ):
            metadata_by_thread_id[str(row[0])] = metadata
    return metadata_by_thread_id


def _agent_profile_names(
    db: Session,
    thread_metadata: dict[str, dict[str, Any]],
) -> dict[str, str]:
    agent_ids = {
        str(metadata.get("agent_id"))
        for metadata in thread_metadata.values()
        if metadata.get("agent_id")
    }
    if not agent_ids:
        return {}
    try:
        rows = db.query(AgentProfileTable).filter(AgentProfileTable.id.in_(agent_ids)).all()
    except Exception as exc:
        logger.debug("Agent profile name lookup failed: %s", exc)
        return {}
    return {row.id: row.name for row in rows}


def _enrich_with_thread_metadata(
    traces: list[dict[str, Any]],
    thread_metadata: dict[str, dict[str, Any]],
    agent_names: dict[str, str],
) -> None:
    for trace in traces:
        session_id = _trace_session_id(trace)
        if not session_id or session_id not in thread_metadata:
            continue
        local_metadata = dict(thread_metadata[session_id])
        agent_id = str(local_metadata.get("agent_id") or "")
        if agent_id and agent_id in agent_names:
            local_metadata["agent_name"] = agent_names[agent_id]
        metadata = _metadata(trace)
        metadata.setdefault("local_thread_metadata", local_metadata)
        metadata.setdefault("agent_name", local_metadata.get("agent_name"))
        trace["metadata"] = metadata


def _safe_limit(limit: int) -> int:
    return min(max(limit, 1), 100)


@router.get("", response_model=TraceListResponse)
async def list_traces(
    source: TraceSource = "all",
    limit: int = Query(default=50, ge=1, le=100),
    page: int = Query(default=1, ge=1),
    query: str | None = Query(default=None, max_length=200),
    fromTimestamp: str | None = None,
    toTimestamp: str | None = None,
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    """List traces visible to the current user."""
    if not _langfuse_is_configured():
        return TraceListResponse(
            traces=[],
            meta={"page": page, "limit": limit, "totalItems": 0, "totalPages": 0},
            source=source,
            langfuseConfigured=False,
        )

    client = _get_langfuse_query_client()
    safe_limit = _safe_limit(limit)
    from_timestamp = _parse_datetime(fromTimestamp, "fromTimestamp")
    to_timestamp = _parse_datetime(toTimestamp, "toTimestamp")
    owned_shared_ids = _owned_shared_thread_ids(db, current_user.id)
    thread_metadata = _visible_thread_metadata(db, current_user.id)
    agent_names = _agent_profile_names(db, thread_metadata)

    fetch_limit = safe_limit if source not in {"all", "agent_app", "shared_agent_app"} else min(100, safe_limit * 2)
    try:
        primary_response = await _call_langfuse(
            client.api.trace.list,
            page=page,
            limit=fetch_limit,
            user_id=current_user.id,
            from_timestamp=from_timestamp,
            to_timestamp=to_timestamp,
            order_by="timestamp.desc",
            fields="core,io,metrics,scores",
        )
    except Exception as exc:
        logger.exception("Failed to list Langfuse traces")
        raise HTTPException(status_code=502, detail=f"Failed to query Langfuse: {exc}") from exc

    traces = _dump_model(primary_response).get("data", [])
    meta = _dump_model(primary_response).get("meta", {})

    if source in {"all", "agent_app", "shared_agent_app"} and owned_shared_ids:
        for session_id in list(owned_shared_ids)[:30]:
            try:
                shared_response = await _call_langfuse(
                    client.api.trace.list,
                    limit=10,
                    session_id=session_id,
                    from_timestamp=from_timestamp,
                    to_timestamp=to_timestamp,
                    order_by="timestamp.desc",
                    fields="core,io,metrics,scores",
                )
                traces.extend(_dump_model(shared_response).get("data", []))
            except Exception as exc:
                logger.debug("Failed to fetch shared session traces %s: %s", session_id, exc)

    _enrich_with_thread_metadata(traces, thread_metadata, agent_names)
    deduped = {str(trace.get("id")): trace for trace in traces if trace.get("id")}
    filtered = [
        trace
        for trace in deduped.values()
        if _matches_source(trace, source, owned_shared_ids) and _matches_search(trace, query)
    ]
    filtered.sort(key=lambda item: str(item.get("timestamp") or ""), reverse=True)

    return TraceListResponse(
        traces=filtered[:safe_limit],
        meta=meta,
        source=source,
        langfuseConfigured=True,
        ownedSharedThreadCount=len(owned_shared_ids),
    )


@router.get("/{trace_id}", response_model=TraceDetailResponse)
async def read_trace(
    trace_id: str,
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    """Read a trace and its observations when the current user may see it."""
    if not _langfuse_is_configured():
        raise HTTPException(status_code=503, detail="Langfuse is not configured")

    client = _get_langfuse_query_client()
    owned_shared_ids = _owned_shared_thread_ids(db, current_user.id)
    thread_metadata = _visible_thread_metadata(db, current_user.id)
    agent_names = _agent_profile_names(db, thread_metadata)
    try:
        trace_response = await _call_langfuse(
            client.api.trace.get,
            trace_id,
            fields="core,io,metrics,scores",
        )
    except Exception:
        try:
            trace_response = await _call_langfuse(client.api.trace.get, trace_id)
        except Exception as fallback_exc:
            if "404" in str(fallback_exc) or "not found" in str(fallback_exc).lower():
                raise HTTPException(status_code=404, detail="Trace not found") from fallback_exc
            logger.exception("Failed to read Langfuse trace")
            raise HTTPException(
                status_code=502,
                detail=f"Failed to query Langfuse: {fallback_exc}",
            ) from fallback_exc

    trace = _dump_model(trace_response)
    _enrich_with_thread_metadata([trace], thread_metadata, agent_names)
    if not _may_read_trace(
        trace,
        current_user_id=current_user.id,
        owned_shared_thread_ids=owned_shared_ids,
        thread_metadata=thread_metadata,
    ):
        raise HTTPException(status_code=403, detail="Trace is not available for this user")

    observations: list[dict[str, Any]] = []
    observations_meta: dict[str, Any] = {}
    tried_default_observation_query = False
    try:
        observation_response = await _call_langfuse(
            client.api.observations.get_many,
            trace_id=trace_id,
            fields="core,basic,io,usage,model,metadata",
            limit=100,
        )
        observations, observations_meta = _extract_observations(observation_response)
    except Exception as exc:
        logger.warning("Failed to fetch Langfuse observations for %s: %s", trace_id, exc)
        tried_default_observation_query = True
        try:
            observation_response = await _call_langfuse(
                client.api.observations.get_many,
                trace_id=trace_id,
                limit=100,
            )
            observations, observations_meta = _extract_observations(observation_response)
        except Exception as fallback_exc:
            logger.warning(
                "Failed to fetch Langfuse observations without field selection for %s: %s",
                trace_id,
                fallback_exc,
            )

    if not observations and not tried_default_observation_query:
        try:
            observation_response = await _call_langfuse(
                client.api.observations.get_many,
                trace_id=trace_id,
                limit=100,
            )
            observations, observations_meta = _extract_observations(observation_response)
        except Exception as exc:
            logger.warning(
                "Failed to fetch empty Langfuse observations without field selection for %s: %s",
                trace_id,
                exc,
            )

    if not observations:
        embedded_observations, _ = _extract_observations(trace)
        observations = embedded_observations

    return TraceDetailResponse(
        trace=trace,
        observations=observations,
        observationsMeta=observations_meta,
        langfuseConfigured=True,
    )
