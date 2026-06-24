import asyncio
from types import SimpleNamespace

from src.utils.mcp import McpPoolManager, discover_mcp_capabilities


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


def test_build_client_config_normalizes_legacy_sse_to_streamable_http():
    server = SimpleNamespace(
        url="https://example.com/sse",
        type="sse",
        headers=None,
    )

    config = McpPoolManager._build_client_config(server)

    assert config["transport"] == "streamable_http"
    assert config["headers"] == {}


def test_get_tools_for_server_does_not_retry_legacy_transport():
    calls = []

    async def fake_fetch_tools(server_name, config):
        calls.append((server_name, config["transport"]))
        raise ExceptionGroup("mcp failed", [ValueError("bad content type")])

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

    assert tools == []
    assert failed is True
    assert calls == [("local", "sse")]


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
    McpPoolManager._load_agent_mcp_ids = staticmethod(
        lambda agent_id, owner_user_id: ["good_id", "bad_id"]
    )
    McpPoolManager._load_mcp_servers = staticmethod(
        lambda mcp_ids, owner_user_id: servers
    )
    McpPoolManager._get_tools_for_server = classmethod(
        lambda cls, server_name, config: fake_get_tools_for_server(server_name, config)
    )
    try:
        first_tools = asyncio.run(McpPoolManager.get_tools_for_agent("agent_1", "user_1"))
        second_tools = asyncio.run(McpPoolManager.get_tools_for_agent("agent_1", "user_1"))
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


def test_discover_mcp_capabilities_records_tools_resources_templates_and_prompts(
    monkeypatch,
):
    class Result:
        def __init__(self, field, values, next_cursor=None):
            setattr(self, field, values)
            self.nextCursor = next_cursor

    class Item:
        def __init__(self, **payload):
            self.payload = payload

        def model_dump(self, **_kwargs):
            return self.payload

    class Session:
        async def initialize(self):
            return None

        def get_server_capabilities(self):
            return SimpleNamespace(
                tools=SimpleNamespace(),
                resources=SimpleNamespace(),
                prompts=SimpleNamespace(),
            )

        async def list_tools(self, cursor=None):
            if cursor is None:
                return Result("tools", [Item(name="search")], "tools-2")
            return Result("tools", [Item(name="fetch")])

        async def list_resources(self, cursor=None):
            return Result(
                "resources",
                [Item(name="Guide", uri="file:///guide.md")],
            )

        async def list_resource_templates(self, cursor=None):
            return Result(
                "resourceTemplates",
                [Item(name="Issue", uriTemplate="issues://{id}")],
            )

        async def list_prompts(self, cursor=None):
            return Result("prompts", [Item(name="review")])

    class SessionContext:
        async def __aenter__(self):
            return Session()

        async def __aexit__(self, *_args):
            return None

    class Client:
        def __init__(self, connections):
            assert connections["Docs"]["transport"] == "streamable_http"
            assert connections["Docs"]["headers"] == {"Authorization": "token"}

        def session(self, server_name):
            assert server_name == "Docs"
            return SessionContext()

    monkeypatch.setattr("src.utils.mcp.MultiServerMCPClient", Client)

    result = asyncio.run(
        discover_mcp_capabilities(
            "Docs",
            "https://example.test/mcp",
            {"Authorization": "token"},
        )
    )

    assert result == {
        "tools": [{"name": "search"}, {"name": "fetch"}],
        "resources": [
            {"name": "Guide", "uri": "file:///guide.md", "kind": "resource"},
            {
                "name": "Issue",
                "uriTemplate": "issues://{id}",
                "kind": "template",
            },
        ],
        "prompts": [{"name": "review"}],
    }


def test_discover_mcp_capabilities_skips_unadvertised_categories(monkeypatch):
    class Session:
        def get_server_capabilities(self):
            return SimpleNamespace(tools=None, resources=None, prompts=None)

    class SessionContext:
        async def __aenter__(self):
            return Session()

        async def __aexit__(self, *_args):
            return None

    class Client:
        def __init__(self, _connections):
            pass

        def session(self, _server_name):
            return SessionContext()

    monkeypatch.setattr("src.utils.mcp.MultiServerMCPClient", Client)

    result = asyncio.run(
        discover_mcp_capabilities("Empty", "https://example.test/mcp")
    )

    assert result == {"tools": [], "resources": [], "prompts": []}
