import logging

from langchain_core.tools import BaseTool

logger = logging.getLogger(__name__)

class McpPoolManager:
    # A global cache to hold MultiServerMCPClient instances
    # Key: agent_id, Value: (MultiServerMCPClient, mcp_ids_tuple)
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
        from src.utils.db import AgentProfileTable, McpServerTable, SessionLocal
        
        db = SessionLocal()
        mcp_ids = []
        try:
            agent_profile = db.query(AgentProfileTable).filter(AgentProfileTable.id == agent_id).first()
            if agent_profile and agent_profile.mcp_ids:
                mcp_ids = agent_profile.mcp_ids or []
        except Exception as e:
            logger.error(f"Failed to query AgentProfileTable for MCP in agent {agent_id}: {e}")
        finally:
            db.close()

        if not mcp_ids:
            return []

        # Check cache: if we already have a client with the EXACT same mcp_ids, reuse it
        mcp_ids_tuple = tuple(sorted(mcp_ids))
        cached = cls._clients.get(agent_id)
        if cached:
            cached_client, cached_ids = cached
            if cached_ids == mcp_ids_tuple:
                logger.info(f"Reusing cached MCP client for agent {agent_id}")
                try:
                    return await cached_client.get_tools()
                except Exception as e:
                    logger.error(f"Failed to fetch tools from cached MCP client for agent {agent_id}: {e}. Will recreate client.")
                    # Fallthrough to recreate client

        # 2. Query MCP server details from DB
        db = SessionLocal()
        servers = []
        try:
            servers = db.query(McpServerTable).filter(McpServerTable.id.in_(mcp_ids)).all()
        except Exception as e:
            logger.error(f"Failed to query McpServerTable: {e}")
        finally:
            db.close()

        if not servers:
            return []

        # 3. Build MultiServerMCPClient config dict
        # MultiServerMCPClient takes a dictionary mapping server_name -> configuration
        client_config = {}
        for s in servers:
            if s.url:
                client_config[s.name] = {
                    "transport": "sse",
                    "url": s.url,
                    "headers": s.headers or {},
                }

        if not client_config:
            return []

        # 4. Create and initialize MultiServerMCPClient
        try:
            from langchain_mcp_adapters.client import MultiServerMCPClient
            logger.info(f"Creating new MultiServerMCPClient for agent {agent_id} with configs: {list(client_config.keys())}")
            client = MultiServerMCPClient(client_config)
            
            # Retrieve tools (get_tools implicitly connects/initializes the client)
            tools = await client.get_tools()
            
            # Cache it
            cls._clients[agent_id] = (client, mcp_ids_tuple)
            logger.info(f"Successfully cached {len(tools)} MCP tools for agent {agent_id}")
            return tools
        except Exception as e:
            logger.error(f"Failed to initialize MultiServerMCPClient for agent {agent_id}: {e}")
            return []
