"""Call the LangGraph deployment through the SDK with a user API key.

This script exercises the same external path as third-party callers: it sends
business runtime fields through the graph context schema, while keeping
LangGraph run configuration in ``config``.
"""

# ruff: noqa: T201

from __future__ import annotations

import argparse
import asyncio
import json
import os
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import dotenv
from langgraph_sdk import get_client

DEFAULT_AGENT_PROFILE_ID = "c63c8408-a1e7-4e9a-b636-e549f4343300"
DEFAULT_ASSISTANT_ID = "generic_agent"
DEFAULT_API_URL = "http://localhost:2025"
USER_API_KEY_ENV = "USER_API_KEY"
AUTH_SECRET_ENV = "LANGGRAPH_AUTH_SECRET"
DEFAULT_LOG_FILE = "logs/test-agent-sdk.log"


def _redact_secret(value: str | None, *, keep: int = 6) -> str:
    """Return a non-sensitive representation of a secret-like value."""
    if not value:
        return ""
    if len(value) <= keep * 2:
        return "***"
    return f"{value[:keep]}...{value[-keep:]}"


def _write_log(log_file: str, event: str, **fields: Any) -> None:
    """Append one JSONL event to the local SDK debug log."""
    if not log_file:
        return
    payload = {
        "ts": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "event": event,
        **fields,
    }
    path = Path(log_file)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(payload, ensure_ascii=False, default=str) + "\n")


def _content_to_text(content: Any) -> str:
    """Convert LangChain message content into displayable text."""
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ""

    parts: list[str] = []
    for block in content:
        if isinstance(block, str):
            parts.append(block)
        elif isinstance(block, dict):
            if isinstance(block.get("text"), str):
                parts.append(block["text"])
            elif isinstance(block.get("content"), str):
                parts.append(block["content"])
    return "".join(parts)


def _message_role(message: Any) -> str:
    """Return a normalized message role/type from dict or object messages."""
    if isinstance(message, dict):
        return str(message.get("role") or message.get("type") or "")
    return str(getattr(message, "role", None) or getattr(message, "type", "") or "")


def _message_content(message: Any) -> Any:
    """Return content from dict or object messages."""
    if isinstance(message, dict):
        if "content" in message:
            return message["content"]
        kwargs = message.get("kwargs")
        if isinstance(kwargs, dict):
            return kwargs.get("content")
        return None
    return getattr(message, "content", None)


def _text_from_messages(messages: Any) -> str:
    """Extract the latest assistant text from a LangGraph state payload."""
    if not isinstance(messages, list):
        return ""

    for message in reversed(messages):
        role = _message_role(message)
        if role not in {"assistant", "ai"}:
            continue
        text = _content_to_text(_message_content(message))
        if text:
            return text
    return ""


def _text_from_message_event(data: Any) -> str:
    """Extract streamed token text from a LangGraph messages event."""
    message = data
    if isinstance(data, (list, tuple)) and data:
        message = data[0]
    role = _message_role(message)
    if role and role not in {"assistant", "ai", "AIMessageChunk"}:
        return ""
    return _content_to_text(_message_content(message))


async def _stream_response(
    chunks: AsyncIterator[Any],
    *,
    verbose: bool,
    log_file: str,
) -> str:
    """Print stream events and return the final assistant text if present."""
    final_text = ""
    streamed_text = ""
    printed_any_token = False

    async for chunk in chunks:
        event = getattr(chunk, "event", None)
        data = getattr(chunk, "data", None)
        _write_log(log_file, "sdk.stream.event", event_type=event, data=data)

        if isinstance(data, dict) and "run_id" in data:
            print(f"[run] {data['run_id']}")
            _write_log(log_file, "sdk.run", run_id=data["run_id"])
            continue

        if event == "messages":
            token = _text_from_message_event(data)
            if token:
                printed_any_token = True
                streamed_text += token
                print(token, end="", flush=True)
            continue

        if event == "values" and isinstance(data, dict):
            text = _text_from_messages(data.get("messages"))
            if text:
                final_text = text
            continue

        if verbose:
            print(f"\n[event:{event}] {data!r}")

    if printed_any_token:
        print()
    _write_log(
        log_file,
        "sdk.stream.final_text",
        final_text_len=len(final_text),
        streamed_text_len=len(streamed_text),
    )
    return final_text or streamed_text


def _json_object_arg(raw: str | None, *, name: str) -> dict[str, Any]:
    """Parse an optional JSON object CLI argument."""
    if not raw:
        return {}
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise SystemExit(f"--{name} must be valid JSON: {exc}") from exc
    if not isinstance(value, dict):
        raise SystemExit(f"--{name} must be a JSON object.")
    return value


async def main() -> None:
    """Run one SDK-backed agent request and print the streamed result."""
    dotenv.load_dotenv()

    parser = argparse.ArgumentParser(
        description="Call a LangGraph agent through the SDK using USER_API_KEY.",
    )
    parser.add_argument("--api-url", default=os.getenv("LANGGRAPH_API_URL", DEFAULT_API_URL))
    parser.add_argument("--api-key", default=os.getenv(USER_API_KEY_ENV))
    parser.add_argument("--auth-secret", default=os.getenv(AUTH_SECRET_ENV))
    parser.add_argument("--assistant-id", default=os.getenv("LANGGRAPH_ASSISTANT_ID", DEFAULT_ASSISTANT_ID))
    parser.add_argument("--agent-id", default=os.getenv("TOB_AGENT_ID", DEFAULT_AGENT_PROFILE_ID))
    parser.add_argument("--message", default="你是什么智能体？")
    parser.add_argument("--model", default=os.getenv("TOB_MODEL", ""))
    parser.add_argument(
        "--additional-system-prompt",
        default=os.getenv("TOB_ADDITIONAL_SYSTEM_PROMPT", ""),
    )
    parser.add_argument("--user-preferences", default=os.getenv("TOB_USER_PREFERENCES", ""))
    parser.add_argument("--safety-enabled", action="store_true")
    parser.add_argument("--thread-id", default="")
    parser.add_argument(
        "--context-json",
        default="",
        help="Extra JSON object merged into the graph context schema.",
    )
    parser.add_argument(
        "--metadata-json",
        default="",
        help="Extra JSON object merged into run metadata.",
    )
    parser.add_argument("--verbose", action="store_true")
    parser.add_argument(
        "--log-file",
        default=os.getenv("TOB_AGENT_SDK_LOG_FILE", DEFAULT_LOG_FILE),
        help="Write SDK request/stream diagnostics as JSONL.",
    )
    args = parser.parse_args()

    if not args.api_key:
        raise SystemExit(f"Missing API key. Set {USER_API_KEY_ENV} or pass --api-key.")

    headers = {"Authorization": f"Bearer {args.api_key}"}
    if args.auth_secret:
        headers["X-Auth-Key"] = args.auth_secret

    _write_log(
        args.log_file,
        "sdk.start",
        api_url=args.api_url,
        assistant_id=args.assistant_id,
        agent_id=args.agent_id,
        api_key=_redact_secret(args.api_key),
        has_auth_secret=bool(args.auth_secret),
        message_len=len(args.message),
    )
    print(f"[log] {args.log_file}")

    client = get_client(
        url=args.api_url,
        headers=headers,
    )

    print(f"[assistant] {args.assistant_id}")
    print(f"[agent] {args.agent_id}")

    metadata = {
        "agent_id": args.agent_id,
        "source_type": "external-sdk-script",
        **_json_object_arg(args.metadata_json, name="metadata-json"),
    }

    if args.thread_id:
        thread_id = args.thread_id
        _write_log(args.log_file, "sdk.thread.reuse", thread_id=thread_id)
    else:
        thread = await client.threads.create(metadata=metadata)
        thread_id = thread["thread_id"]
        _write_log(args.log_file, "sdk.thread.create", thread=thread)
    print(f"[thread] {thread_id}")

    context = {
        "agent_id": args.agent_id,
        **_json_object_arg(args.context_json, name="context-json"),
    }
    if args.model:
        context["model"] = args.model
    if args.additional_system_prompt:
        context["additional_system_prompt"] = args.additional_system_prompt
    if args.user_preferences:
        context["user_preferences"] = args.user_preferences
    if args.safety_enabled:
        context["safety_enabled"] = True

    if args.verbose:
        print(f"[context] {json.dumps(context, ensure_ascii=False)}")

    input_payload = {"messages": [{"role": "user", "content": args.message}]}
    config = {"metadata": metadata}
    _write_log(
        args.log_file,
        "sdk.run.request",
        thread_id=thread_id,
        assistant_id=args.assistant_id,
        input=input_payload,
        context=context,
        config=config,
        metadata=metadata,
    )

    try:
        stream = client.runs.stream(
            thread_id,
            args.assistant_id,
            input=input_payload,
            context=context,
            config=config,
            metadata=metadata,
            stream_mode=["messages", "updates", "values"],
        )

        final_text = await _stream_response(
            stream,
            verbose=args.verbose,
            log_file=args.log_file,
        )
    except Exception as exc:
        _write_log(
            args.log_file,
            "sdk.error",
            error_type=type(exc).__name__,
            error=str(exc),
        )
        raise

    print("\n\n[final]")
    print(final_text or "(no assistant text found)")
    _write_log(args.log_file, "sdk.done", final_text=final_text)


if __name__ == "__main__":
    asyncio.run(main())
