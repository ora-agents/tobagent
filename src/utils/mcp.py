"""Utilities for loading dynamic MCP tools linked to agent profiles."""

import asyncio
import importlib
import logging
from time import monotonic
from urllib.parse import urlsplit, urlunsplit

from langchain_core.tools import BaseTool
from langchain_mcp_adapters.client import MultiServerMCPClient

from src.utils.db import AgentProfileTable, McpServerTable, SessionLocal

# Eagerly import MCP and networking modules to prevent importlib from executing synchronous
# ScandirIterator call inside the active asyncio event loop when client.get_tools() is first called.
for module_name in (
    "anyio",
    "anyio._backends._asyncio",
    "httpx",
    "langchain_mcp_adapters.client",
    "mcp",
    "mcp.client",
    "mcp.client.sse",
    "mcp.client.stdio",
    "mcp.client.streamable_http",
):
    try:
        importlib.import_module(module_name)
    except ImportError:
        pass

logger = logging.getLogger(__name__)


class McpPoolManager:
    """Load, cache, and refresh MCP tools for configured agent profiles."""

    # A global cache to hold fetched MCP tools.
    # Key: (owner_user_id, agent_id), Value: (tools, mcp_ids_tuple[, failed_servers_tuple, retry_at])
    _clients = {}
    _STREAMABLE_TRANSPORTS = {"http", "streamable_http", "streamable-http"}
    _FAILED_SERVER_CACHE_TTL_SECONDS = 300

    @classmethod
    def clear_cache(cls):
        """Clear all active MCP clients from cache, effectively forcing reload."""
        logger.info("Clearing MCP Pool Manager client cache")
        cls._clients.clear()

    @classmethod
    async def get_tools_for_agent(cls, agent_id: str, owner_user_id: str) -> list[BaseTool]:
        """Fetch and return LangChain BaseTools from all MCP servers linked to this agent."""
        if not agent_id or agent_id == "default" or not owner_user_id:
            return []

        # 1. Fetch agent profile to get linked mcp_ids
        mcp_ids = await asyncio.to_thread(cls._load_agent_mcp_ids, agent_id, owner_user_id)

        if not mcp_ids:
            return []

        # Check cache: if we already have a client with the EXACT same mcp_ids, reuse it
        mcp_ids_tuple = tuple(sorted(mcp_ids))
        cache_key = (owner_user_id, agent_id)
        cached = cls._clients.get(cache_key)
        if cached:
            cached_tools, cached_ids, *failure_state = cached
            if cached_ids == mcp_ids_tuple:
                if failure_state:
                    failed_servers, retry_at = failure_state
                    if monotonic() < retry_at:
                        logger.info(
                            "Reusing MCP tools for agent %s while failed servers are cooling down: %s",
                            agent_id,
                            list(failed_servers),
                        )
                        return cached_tools
                else:
                    logger.info(f"Reusing cached MCP client for agent {agent_id}")
                    return cached_tools

        # 2. Query MCP server details from DB
        servers = await asyncio.to_thread(cls._load_mcp_servers, mcp_ids, owner_user_id)

        if not servers:
            return []

        # 3. Build MultiServerMCPClient config dict.
        # MultiServerMCPClient takes a dictionary mapping server_name -> configuration.
        client_config = {}
        for s in servers:
            config = cls._build_client_config(s)
            if config:
                client_config[s.name] = config

        if not client_config:
            return []

        # 4. Create and initialize MultiServerMCPClient
        try:
            logger.info(f"Creating new MultiServerMCPClient for agent {agent_id} with configs: {list(client_config.keys())}")
            
            # Run client initialization on a dedicated worker thread with an isolated
            # event loop. This completely
            # avoids synchronous filesystem scans (ScandirIterator) and dynamic imports
            # from blocking the main ASGI server's event loop.
            def _fetch_in_thread():
                async def _fetch_all_tools():
                    all_tools = []
                    failed_servers = []
                    for server_name, config in client_config.items():
                        tools, failed = await cls._get_tools_for_server(server_name, config)
                        if failed:
                            failed_servers.append(server_name)
                        all_tools.extend(tools)
                    return all_tools, failed_servers

                return asyncio.run(_fetch_all_tools())

            tools, failed_servers = await asyncio.to_thread(_fetch_in_thread)
            
            if failed_servers:
                logger.warning(
                    "Caching partial MCP tools for agent %s for %s seconds because these servers failed: %s",
                    agent_id,
                    cls._FAILED_SERVER_CACHE_TTL_SECONDS,
                    failed_servers,
                )
                cls._clients[cache_key] = (
                    tools,
                    mcp_ids_tuple,
                    tuple(failed_servers),
                    monotonic() + cls._FAILED_SERVER_CACHE_TTL_SECONDS,
                )
            else:
                # Cache successful loads, including servers that intentionally expose no tools.
                cls._clients[cache_key] = (tools, mcp_ids_tuple)
                logger.info(f"Successfully cached {len(tools)} MCP tools for agent {agent_id}")
            return tools
        except Exception as e:
            logger.exception(
                "Failed to initialize MultiServerMCPClient for agent %s: %s",
                agent_id,
                cls._format_exception(e),
            )
            return []

    @classmethod
    async def _get_tools_for_server(cls, server_name: str, config: dict) -> tuple[list[BaseTool], bool]:
        try:
            return await cls._fetch_tools_for_config(server_name, config), False
        except Exception as first_error:
            fallback_config = cls._streamable_http_retry_config(config)
            if fallback_config:
                logger.warning(
                    "MCP server '%s' failed as SSE (%s): %s. Retrying as streamable_http.",
                    server_name,
                    cls._safe_url(config.get("url")),
                    cls._format_exception(first_error),
                )
                try:
                    return await cls._fetch_tools_for_config(server_name, fallback_config), False
                except Exception as retry_error:
                    logger.exception(
                        "MCP server '%s' failed after streamable_http retry (%s). "
                        "SSE error: %s; streamable_http error: %s",
                        server_name,
                        cls._safe_url(config.get("url")),
                        cls._format_exception(first_error),
                        cls._format_exception(retry_error),
                    )
                    return [], True

            logger.exception(
                "MCP server '%s' failed to initialize (transport=%s, url=%s): %s",
                server_name,
                config.get("transport"),
                cls._safe_url(config.get("url")),
                cls._format_exception(first_error),
            )
            return [], True

    @staticmethod
    async def _fetch_tools_for_config(server_name: str, config: dict) -> list[BaseTool]:
        client = MultiServerMCPClient({server_name: config})
        return await client.get_tools(server_name=server_name)

    @classmethod
    def _build_client_config(cls, server: McpServerTable) -> dict | None:
        if not server.url:
            return None

        transport = cls._normalize_transport(server.type, server.url)
        headers = server.headers if isinstance(server.headers, dict) else {}

        return {
            "transport": transport,
            "url": server.url,
            "headers": headers,
        }

    @classmethod
    def _normalize_transport(cls, transport: str | None, url: str | None) -> str:
        # ModelScope remote MCP servers use Streamable HTTP at /mcp. Treating them
        # as SSE produces a content-type mismatch before tools can be listed.
        if url and "mcp.api-inference.modelscope.net" in url:
            return "streamable_http"

        normalized = (transport or "sse").strip().lower()
        if normalized in cls._STREAMABLE_TRANSPORTS:
            return "streamable_http"
        if normalized in {"sse", "websocket"}:
            return normalized

        logger.warning("Unsupported MCP transport '%s'; defaulting to SSE", transport)
        return "sse"

    @classmethod
    def _streamable_http_retry_config(cls, config: dict) -> dict | None:
        if config.get("transport") != "sse":
            return None

        url = config.get("url")
        if not isinstance(url, str):
            return None

        if urlsplit(url).path.rstrip("/") != "/mcp":
            return None

        return {**config, "transport": "streamable_http"}

    @staticmethod
    def _safe_url(url: object) -> str:
        if not isinstance(url, str):
            return ""

        parts = urlsplit(url)
        return urlunsplit((parts.scheme, parts.netloc, parts.path, "", ""))

    @classmethod
    def _format_exception(cls, exc: BaseException) -> str:
        if isinstance(exc, BaseExceptionGroup):
            return "; ".join(cls._format_exception(sub_exc) for sub_exc in exc.exceptions)
        return f"{type(exc).__name__}: {exc}"

    @staticmethod
    def _load_agent_mcp_ids(agent_id: str, owner_user_id: str) -> list[str]:
        db = SessionLocal()
        try:
            agent_profile = db.query(AgentProfileTable).filter(
                AgentProfileTable.id == agent_id,
                AgentProfileTable.owner_user_id == owner_user_id,
            ).first()
            if agent_profile and agent_profile.mcp_ids:
                return list(agent_profile.mcp_ids or [])
        except Exception as e:
            logger.error(f"Failed to query AgentProfileTable for MCP in agent {agent_id}: {e}")
        finally:
            db.close()
        return []

    @staticmethod
    def _load_mcp_servers(mcp_ids: list[str], owner_user_id: str) -> list[McpServerTable]:
        db = SessionLocal()
        try:
            servers = db.query(McpServerTable).filter(
                McpServerTable.id.in_(mcp_ids),
                McpServerTable.owner_user_id == owner_user_id,
            ).all()
            return list(servers)
        except Exception as e:
            logger.error(f"Failed to query McpServerTable: {e}")
        finally:
            db.close()
        return []
