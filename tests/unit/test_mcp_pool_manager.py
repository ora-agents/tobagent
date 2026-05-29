import asyncio
from types import SimpleNamespace

from src.utils.mcp import McpPoolManager


def test_build_client_config_normalizes_streamable_http_aliases():
    server = SimpleNamespace(
        url="https://example.com/mcp",
        type="http",
        headers={"Authorization": "Bearer token"},
    )

    config = McpPoolManager._build_client_config(server)

    assert config == {
        "transport": "streamable_http",
        "url": "https://example.com/mcp",
        "headers": {"Authorization": "Bearer token"},
    }


def test_build_client_config_forces_modelscope_to_streamable_http():
    server = SimpleNamespace(
        url="https://mcp.api-inference.modelscope.net/example/mcp",
        type="sse",
        headers=None,
    )

    config = McpPoolManager._build_client_config(server)

    assert config["transport"] == "streamable_http"
    assert config["headers"] == {}


def test_streamable_http_retry_config_only_applies_to_sse_mcp_urls():
    fallback = McpPoolManager._streamable_http_retry_config(
        {"transport": "sse", "url": "http://localhost:8000/mcp", "headers": {}}
    )
    non_mcp_fallback = McpPoolManager._streamable_http_retry_config(
        {"transport": "sse", "url": "http://localhost:8000/sse", "headers": {}}
    )
    already_http_fallback = McpPoolManager._streamable_http_retry_config(
        {
            "transport": "streamable_http",
            "url": "http://localhost:8000/mcp",
            "headers": {},
        }
    )

    assert fallback["transport"] == "streamable_http"
    assert non_mcp_fallback is None
    assert already_http_fallback is None


def test_get_tools_for_server_retries_sse_mcp_url_as_streamable_http():
    calls = []

    async def fake_fetch_tools(server_name, config):
        calls.append((server_name, config["transport"]))
        if len(calls) == 1:
            raise ExceptionGroup("mcp failed", [ValueError("bad content type")])
        return ["tool"]

    original_fetch_tools = McpPoolManager._fetch_tools_for_config
    McpPoolManager._fetch_tools_for_config = staticmethod(fake_fetch_tools)
    try:
        tools, failed = asyncio.run(
            McpPoolManager._get_tools_for_server(
                "local",
                {
                    "transport": "sse",
                    "url": "http://localhost:8000/mcp",
                    "headers": {},
                },
            )
        )
    finally:
        McpPoolManager._fetch_tools_for_config = original_fetch_tools

    assert tools == ["tool"]
    assert failed is False
    assert calls == [("local", "sse"), ("local", "streamable_http")]
