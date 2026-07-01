"""Communication-engine model gateway compatibility routes."""
# ruff: noqa: D103

import json
import logging
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from src.api.deps import hash_api_key
from src.utils.db import AgentProfileTable, UserApiKeyTable, get_db

logger = logging.getLogger(__name__)

router = APIRouter(tags=["model-gateway"])


class GatewayMessage(BaseModel):
    """Single communication-engine chat message."""

    role: str
    content: str


class GatewayChatRequest(BaseModel):
    """Communication-engine chat completion request payload."""

    model: str | None = None
    messages: list[GatewayMessage]
    stream: bool = True
    top_p: float | str | None = Field(default=None, alias="top_p")
    topP: float | str | None = None
    top_k: int | str | None = None
    temperature: float | str | None = None
    session_id: str | None = None
    biz_params: dict[str, Any] | None = None
    out_id: str | None = None

    model_config = {"populate_by_name": True}


def _parse_gateway_authorization(authorization: str | None) -> tuple[str, str]:
    if not authorization:
        raise HTTPException(status_code=401, detail="Authentication required")

    credential = authorization.strip()
    if credential.lower().startswith("bearer "):
        credential = credential.split(" ", 1)[1].strip()

    api_key, separator, agent_id = credential.rpartition("--")
    if not separator or not api_key.strip() or not agent_id.strip():
        raise HTTPException(
            status_code=401,
            detail="Authorization must be '<api-key>--<agent-id>'",
        )
    return api_key.strip(), agent_id.strip()


def _resolve_gateway_auth(
    authorization: str | None,
    db: Session,
) -> tuple[str, str, AgentProfileTable]:
    api_key, agent_id = _parse_gateway_authorization(authorization)
    api_key_row = db.query(UserApiKeyTable).filter(
        UserApiKeyTable.key_hash == hash_api_key(api_key),
    ).first()
    if not api_key_row:
        raise HTTPException(status_code=401, detail="Invalid API key")

    profile = db.query(AgentProfileTable).filter(
        AgentProfileTable.id == agent_id,
        AgentProfileTable.owner_user_id == api_key_row.owner_user_id,
    ).first()
    if not profile:
        raise HTTPException(
            status_code=403,
            detail="Agent is not available for this API key",
        )

    api_key_row.last_used_at = datetime.now(UTC).isoformat().replace("+00:00", "Z")
    db.commit()
    return api_key_row.owner_user_id, agent_id, profile


def _gateway_messages(messages: list[GatewayMessage]) -> list[dict[str, str]]:
    if not messages:
        raise HTTPException(status_code=422, detail="Messages are required")

    normalized = []
    for message in messages:
        role = message.role.strip().lower()
        if role not in {"assistant", "user"}:
            raise HTTPException(
                status_code=422,
                detail=f"Only assistant and user messages accepted. Got role {message.role}",
            )
        content = message.content
        if not isinstance(content, str) or not content.strip():
            raise HTTPException(status_code=422, detail="Message content is required")
        normalized.append({"role": role, "content": content})

    if normalized[-1]["role"] != "user":
        raise HTTPException(status_code=422, detail="Last message must be from user")
    return normalized


def _extract_chunk_text(chunk: Any) -> str:
    content = getattr(chunk, "content", None)
    if content is None and isinstance(chunk, dict):
        content = chunk.get("content")
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ""

    parts: list[str] = []
    for block in content:
        if isinstance(block, str):
            parts.append(block)
        elif isinstance(block, dict):
            text = block.get("text") or block.get("content")
            if isinstance(text, str):
                parts.append(text)
    return "".join(parts)


def _sse_payload(
    *,
    content: str,
    model: str,
    finish_reason: str | None = None,
) -> str:
    payload = {
        "choices": [
            {
                "delta": {"content": content},
                "finish_reason": finish_reason,
                "index": 0,
                "logprobs": None,
            }
        ],
        "object": "chat.completion.chunk",
        "usage": None,
        "model": model,
    }
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


def _get_generic_agent():
    from src.agent.generic_agent import generic_agent

    return generic_agent


async def _agent_token_stream(
    *,
    request: GatewayChatRequest,
    user_id: str,
    agent_id: str,
    profile: AgentProfileTable,
) -> AsyncIterator[str]:
    agent = _get_generic_agent()
    model = (request.model or profile.model or "").strip()
    context: dict[str, Any] = {
        "agent_id": agent_id,
        "user_id": user_id,
        "agent_owner_user_id": user_id,
    }
    if model:
        context["model"] = model

    config = {
        "tags": ["model-gateway", f"agent:{agent_id}"],
        "metadata": {
            "source_type": "Communication Engine Gateway",
            "conversation_source": "model_gateway",
            "langfuse_user_id": user_id,
            "langfuse_session_id": request.session_id or request.out_id or "",
            "agent_id": agent_id,
            "out_id": request.out_id or "",
        },
    }
    input_payload = {"messages": _gateway_messages(request.messages)}

    async for event in agent.astream_events(
        input_payload,
        context=context,
        config=config,
        version="v2",
    ):
        if event.get("event") != "on_chat_model_stream":
            continue
        metadata = event.get("metadata")
        if isinstance(metadata, dict) and metadata.get("stream_scope") == "subagent":
            continue
        data = event.get("data") if isinstance(event, dict) else None
        chunk = data.get("chunk") if isinstance(data, dict) else None
        text = _extract_chunk_text(chunk)
        if text:
            yield text


@router.post(
    "/api/model-gateway/chat/completions",
    summary="OpenAI-style streaming gateway for communication-engine integration",
    description=(
        "Accepts the communication engine gateway request shape and streams "
        "`data: {choices:[{delta:{content}}]}` SSE chunks. The Authorization "
        "header must be `<api-key>--<agent-id>`."
    ),
)
async def chat_completions(
    request: GatewayChatRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    user_id, agent_id, profile = _resolve_gateway_auth(authorization, db)
    _gateway_messages(request.messages)
    model = (request.model or profile.model or "").strip()

    if not request.stream:
        content_parts = [
            token
            async for token in _agent_token_stream(
                request=request,
                user_id=user_id,
                agent_id=agent_id,
                profile=profile,
            )
        ]
        return JSONResponse(
            {
                "choices": [
                    {
                        "delta": {"content": "".join(content_parts)},
                    }
                ]
            }
        )

    async def event_stream() -> AsyncIterator[str]:
        try:
            async for token in _agent_token_stream(
                request=request,
                user_id=user_id,
                agent_id=agent_id,
                profile=profile,
            ):
                yield _sse_payload(content=token, model=model)
            yield _sse_payload(content="", model=model, finish_reason="stop")
        except Exception as err:
            logger.exception("Model gateway stream failed: %s", err)
            yield _sse_payload(
                content="抱歉，服务暂时不可用。",
                model=model,
                finish_reason="stop",
            )

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
