import logging
import asyncio

# Eagerly import MCP and networking modules to prevent importlib from executing synchronous
# ScandirIterator call inside the active asyncio event loop when client.get_tools() is first called.
try:
    import httpx
    import anyio
    import anyio._backends._asyncio
    import mcp
    import mcp.client
    import mcp.client.sse
    import mcp.client.stdio
    import langchain_mcp_adapters.client
except ImportError:
    pass

from langchain_core.tools import BaseTool
from langchain_mcp_adapters.client import MultiServerMCPClient
from src.utils.db import AgentProfileTable, McpServerTable, SessionLocal

logger = logging.getLogger(__name__)

class McpPoolManager:
    # A global cache to hold fetched MCP tools.
    # Key: agent_id, Value: (tools, mcp_ids_tuple)
    _clients = {}

    @classmethod
    def clear_cache(cls):
        """Clear all active MCP clients from cache, effectively forcing reload."""
        logger.info("Clearing MCP Pool Manager client cache")
        cls._clients.clear()

    @classmethod
    async def get_tools_for_agent(cls, agent_id: str) -> list[BaseTool]:
        """Fetch and return LangChain BaseTools from all MCP servers linked to this agent."""
        if not agent_id or agent_id == "default":
            return []

        # 1. Fetch agent profile to get linked mcp_ids
        mcp_ids = await asyncio.to_thread(cls._load_agent_mcp_ids, agent_id)

        if not mcp_ids:
            return []

        # Check cache: if we already have a client with the EXACT same mcp_ids, reuse it
        mcp_ids_tuple = tuple(sorted(mcp_ids))
        cached = cls._clients.get(agent_id)
        if cached:
            cached_tools, cached_ids = cached
            if cached_ids == mcp_ids_tuple:
                logger.info(f"Reusing cached MCP client for agent {agent_id}")
                return cached_tools

        # 2. Query MCP server details from DB
        servers = await asyncio.to_thread(cls._load_mcp_servers, mcp_ids)

        if not servers:
            return []

        # 3. Build MultiServerMCPClient config dict
        # MultiServerMCPClient takes a dictionary mapping server_name -> configuration
        client_config = {}
        for s in servers:
            if s.url:
                # ModelScope remote MCP servers utilize the Streamable HTTP protocol.
                # Standard sse transport GET request to '/mcp' yields application/json instead of text/event-stream,
                # causing SSEError. We dynamically switch to 'streamable_http' when ModelScope URL is detected.
                transport = s.type or "sse"
                if s.url and "mcp.api-inference.modelscope.net" in s.url:
                    transport = "streamable_http"

                client_config[s.name] = {
                    "transport": transport,
                    "url": s.url,
                    "headers": s.headers or {},
                }


        if not client_config:
            return []

        # 4. Create and initialize MultiServerMCPClient
        try:
            logger.info(f"Creating new MultiServerMCPClient for agent {agent_id} with configs: {list(client_config.keys())}")
            
            # Define a helper function to run both client instantiation and get_tools() 
            # on a dedicated worker thread with an isolated event loop. This completely
            # avoids synchronous filesystem scans (ScandirIterator) and dynamic imports
            # from blocking the main ASGI server's event loop.
            def _fetch_in_thread():
                import asyncio
                loop = asyncio.new_event_loop()
                try:
                    c = MultiServerMCPClient(client_config)
                    t = loop.run_until_complete(c.get_tools())
                    return c, t
                finally:
                    loop.close()

            _client, tools = await asyncio.to_thread(_fetch_in_thread)
            
            # Cache it
            cls._clients[agent_id] = (tools, mcp_ids_tuple)
            logger.info(f"Successfully cached {len(tools)} MCP tools for agent {agent_id}")
            return tools
        except Exception as e:
            logger.error(f"Failed to initialize MultiServerMCPClient for agent {agent_id}: {e}")
            return []

    @staticmethod
    def _load_agent_mcp_ids(agent_id: str) -> list[str]:
        db = SessionLocal()
        try:
            agent_profile = db.query(AgentProfileTable).filter(AgentProfileTable.id == agent_id).first()
            if agent_profile and agent_profile.mcp_ids:
                return list(agent_profile.mcp_ids or [])
        except Exception as e:
            logger.error(f"Failed to query AgentProfileTable for MCP in agent {agent_id}: {e}")
        finally:
            db.close()
        return []

    @staticmethod
    def _load_mcp_servers(mcp_ids: list[str]) -> list[McpServerTable]:
        db = SessionLocal()
        try:
            servers = db.query(McpServerTable).filter(McpServerTable.id.in_(mcp_ids)).all()
            return list(servers)
        except Exception as e:
            logger.error(f"Failed to query McpServerTable: {e}")
        finally:
            db.close()
        return []
