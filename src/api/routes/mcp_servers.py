"""MCP server routes."""
# ruff: noqa: D103

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from src.api.deps import get_current_user
from src.api.schemas import McpServerSchema
from src.api.services import (
    _invalidate_runtime_caches,
    _mcp_schema,
    _remove_agent_profile_links,
)
from src.utils.db import McpServerTable, UserTable, get_db

router = APIRouter(tags=["mcp-servers"])


# ---------------------------------------------------------------------------
# MCP Server CRUD
# ---------------------------------------------------------------------------

@router.get(
    "/api/mcp-servers",
    response_model=list[McpServerSchema],
    summary="List MCP servers",
    description="Lists MCP server configurations owned by the authenticated user.",
)
async def get_mcp_servers(
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    servers = db.query(McpServerTable).filter(
        McpServerTable.owner_user_id == current_user.id
    ).all()
    return [_mcp_schema(s) for s in servers]


@router.post(
    "/api/mcp-servers",
    response_model=McpServerSchema,
    summary="Create an MCP server",
    description="Creates a streamable HTTP MCP server configuration and clears MCP runtime caches.",
)
async def create_mcp_server(
    server_data: McpServerSchema,
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    # Check duplicate
    existing = db.query(McpServerTable).filter(McpServerTable.id == server_data.id).first()
    if existing:
        raise HTTPException(status_code=400, detail="MCP Server already exists")
    
    new_server = McpServerTable(
        id=server_data.id,
        owner_user_id=current_user.id,
        name=server_data.name,
        type="streamable_http",
        url=server_data.url,
        headers=server_data.headers,
        created_at=server_data.createdAt,
        updated_at=server_data.updatedAt,
    )
    db.add(new_server)
    db.commit()
    db.refresh(new_server)
    
    # Clear pool cache on updates to trigger reloading
    try:
        from src.utils.mcp import McpPoolManager
        McpPoolManager.clear_cache()
    except Exception:
        pass
    _invalidate_runtime_caches(owner_user_id=current_user.id)
        
    return _mcp_schema(new_server)


@router.put(
    "/api/mcp-servers/{id}",
    response_model=McpServerSchema,
    summary="Update an MCP server",
    description="Updates one owned MCP server configuration and clears MCP runtime caches.",
)
async def update_mcp_server(
    id: str,
    server_data: McpServerSchema,
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    server = db.query(McpServerTable).filter(
        McpServerTable.id == id,
        McpServerTable.owner_user_id == current_user.id,
    ).first()
    if not server:
        raise HTTPException(status_code=404, detail="MCP Server not found")
    
    server.name = server_data.name
    server.type = "streamable_http"
    server.url = server_data.url
    server.headers = server_data.headers
    server.updated_at = server_data.updatedAt
    
    db.commit()
    db.refresh(server)
    
    # Clear pool cache on updates to trigger reloading
    try:
        from src.utils.mcp import McpPoolManager
        McpPoolManager.clear_cache()
    except Exception:
        pass
    _invalidate_runtime_caches(owner_user_id=current_user.id)

    return _mcp_schema(server)


@router.delete(
    "/api/mcp-servers/{id}",
    summary="Delete an MCP server",
    description="Deletes one owned MCP server, removes agent links to it, and clears MCP runtime caches.",
)
async def delete_mcp_server(
    id: str,
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    server = db.query(McpServerTable).filter(
        McpServerTable.id == id,
        McpServerTable.owner_user_id == current_user.id,
    ).first()
    if not server:
        raise HTTPException(status_code=404, detail="MCP Server not found")
    
    _remove_agent_profile_links(db, current_user.id, "mcp_ids", [id])
    db.delete(server)
    db.commit()
    
    # Clear pool cache on updates to trigger reloading
    try:
        from src.utils.mcp import McpPoolManager
        McpPoolManager.clear_cache()
    except Exception:
        pass
    _invalidate_runtime_caches(owner_user_id=current_user.id)

    return {"status": "success", "message": f"MCP Server {id} deleted"}

