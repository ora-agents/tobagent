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


def test_get_tools_for_agent_reuses_partial_cache_during_failed_server_cooldown():
    calls = []
    servers = [
        SimpleNamespace(name="good", url="http://good.test/mcp", type="streamable_http", headers={}),
        SimpleNamespace(name="bad", url="http://bad.test/mcp", type="streamable_http", headers={}),
    ]

    async def fake_get_tools_for_server(server_name, config):
        calls.append((server_name, config["url"]))
        if server_name == "bad":
            return [], True
        return [f"{server_name}_tool"], False

    original_load_agent_mcp_ids = McpPoolManager._load_agent_mcp_ids
    original_load_mcp_servers = McpPoolManager._load_mcp_servers
    original_get_tools_for_server = McpPoolManager._get_tools_for_server
    McpPoolManager.clear_cache()
    McpPoolManager._load_agent_mcp_ids = staticmethod(lambda agent_id: ["good_id", "bad_id"])
    McpPoolManager._load_mcp_servers = staticmethod(lambda mcp_ids: servers)
    McpPoolManager._get_tools_for_server = classmethod(
        lambda cls, server_name, config: fake_get_tools_for_server(server_name, config)
    )
    try:
        first_tools = asyncio.run(McpPoolManager.get_tools_for_agent("agent_1"))
        second_tools = asyncio.run(McpPoolManager.get_tools_for_agent("agent_1"))
    finally:
        McpPoolManager._load_agent_mcp_ids = original_load_agent_mcp_ids
        McpPoolManager._load_mcp_servers = original_load_mcp_servers
        McpPoolManager._get_tools_for_server = original_get_tools_for_server
        McpPoolManager.clear_cache()

    assert first_tools == ["good_tool"]
    assert second_tools == ["good_tool"]
    assert calls == [
        ("good", "http://good.test/mcp"),
        ("bad", "http://bad.test/mcp"),
    ]
