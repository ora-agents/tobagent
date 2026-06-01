"""Test external LangGraph SDK calls with a user API key and agent profile ID."""

# ruff: noqa: T201

from __future__ import annotations

import argparse
import asyncio
import os
from collections.abc import AsyncIterator
from typing import Any

from langgraph_sdk import get_client

DEFAULT_AGENT_PROFILE_ID = "c63c8408-a1e7-4e9a-b636-e549f4343300"
DEFAULT_ASSISTANT_ID = "generic_agent"
DEFAULT_API_URL = "http://localhost:2025"
USER_API_KEY_ENV = "USER_API_KEY"


def _text_from_messages(messages: Any) -> str:
    """Extract the latest assistant text from a LangGraph state payload."""
    if not isinstance(messages, list):
        return ""

    for message in reversed(messages):
        if not isinstance(message, dict):
            continue
        role = message.get("role") or message.get("type")
        if role not in {"assistant", "ai"}:
            continue
        content = message.get("content")
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            parts = []
            for block in content:
                if isinstance(block, str):
                    parts.append(block)
                elif isinstance(block, dict) and isinstance(block.get("text"), str):
                    parts.append(block["text"])
            return "".join(parts)
    return ""


async def _stream_response(chunks: AsyncIterator[Any]) -> str:
    """Print stream events and return the final assistant text if present."""
    final_text = ""
    async for chunk in chunks:
        event = getattr(chunk, "event", None)
        data = getattr(chunk, "data", None)

        if isinstance(data, dict) and "run_id" in data:
            print(f"[run] {data['run_id']}")
            continue

        if event == "values" and isinstance(data, dict):
            text = _text_from_messages(data.get("messages"))
            if text:
                final_text = text
            continue

    return final_text


async def main() -> None:
    """Run one SDK-backed agent request and print the streamed result."""
    parser = argparse.ArgumentParser(
        description="Call a LangGraph agent through the SDK using USER_API_KEY.",
    )
    parser.add_argument("--api-url", default=os.getenv("LANGGRAPH_API_URL", DEFAULT_API_URL))
    parser.add_argument("--api-key", default=os.getenv(USER_API_KEY_ENV))
    parser.add_argument("--assistant-id", default=os.getenv("LANGGRAPH_ASSISTANT_ID", DEFAULT_ASSISTANT_ID))
    parser.add_argument("--agent-id", default=os.getenv("TOB_AGENT_ID", DEFAULT_AGENT_PROFILE_ID))
    parser.add_argument("--message", default="你是什么智能体？")
    args = parser.parse_args()

    if not args.api_key:
        raise SystemExit(f"Missing API key. Set {USER_API_KEY_ENV} or pass --api-key.")

    client = get_client(
        url=args.api_url,
        api_key=args.api_key,
        headers={
            "Authorization": f"Bearer {args.api_key}",
        },
    )

    print(f"[assistant] {args.assistant_id}")
    print(f"[agent] {args.agent_id}")

    thread = await client.threads.create(metadata={"agent_id": args.agent_id})
    thread_id = thread["thread_id"]
    print(f"[thread] {thread_id}")

    context = {
        "agent_id": args.agent_id,
    }
    stream = client.runs.stream(
        thread_id,
        args.assistant_id,
        input={"messages": [{"role": "user", "content": args.message}]},
        context=context,
        config={
            "configurable": context,
            "metadata": {"agent_id": args.agent_id},
        },
        metadata={"agent_id": args.agent_id},
        stream_mode=["messages", "updates", "values"],
    )

    final_text = await _stream_response(stream)
    print("\n\n[final]")
    print(final_text or "(no assistant text found)")


if __name__ == "__main__":
    asyncio.run(main())
