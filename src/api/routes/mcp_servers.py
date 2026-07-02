"""MCP server routes."""
# ruff: noqa: D103

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from src.api.deps import get_current_user
from src.api.schemas import McpServerSchema, WorkspaceChangeRequestSchema
from src.api.services import (
    _invalidate_runtime_caches,
    _mcp_schema,
    _remove_agent_profile_links,
    _workspace_change_request_schema,
)
from src.api.workspace_utils import (
    MANAGER_ROLES,
    create_workspace_change_request_row,
    get_active_workspace,
    get_workspace_header,
    workspace_scoped_resource_filter,
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
    workspace_id: str | None = Depends(get_workspace_header),
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    workspace, _member = get_active_workspace(db, current_user, workspace_id)
    owner_user_id = workspace.owner_user_id
    servers = db.query(McpServerTable).filter(
        McpServerTable.owner_user_id == owner_user_id,
        workspace_scoped_resource_filter(McpServerTable, owner_user_id, workspace.id),
    ).all()
    return [_mcp_schema(s) for s in servers]


@router.post(
    "/api/mcp-servers",
    response_model=McpServerSchema | WorkspaceChangeRequestSchema,
    summary="Create an MCP server",
    description="Creates a streamable HTTP MCP server configuration and clears MCP runtime caches.",
)
async def create_mcp_server(
    server_data: McpServerSchema,
    workspace_id: str | None = Depends(get_workspace_header),
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    workspace, member = get_active_workspace(db, current_user, workspace_id)
    owner_user_id = workspace.owner_user_id
    if member.role not in MANAGER_ROLES:
        change = create_workspace_change_request_row(
            db,
            workspace_id=workspace.id,
            requester_user_id=current_user.id,
            target_type="mcp_server",
            target_id=server_data.id,
            action="create",
            payload=server_data.model_dump(mode="json"),
        )
        return _workspace_change_request_schema(db, change)
    # Check duplicate
    existing = db.query(McpServerTable).filter(McpServerTable.id == server_data.id).first()
    if existing:
        raise HTTPException(status_code=400, detail="MCP Server already exists")

    capabilities = await _discover_capabilities(server_data)

    new_server = McpServerTable(
        id=server_data.id,
        owner_user_id=owner_user_id,
        workspace_id=workspace.id,
        name=server_data.name,
        type="streamable_http",
        url=server_data.url,
        headers=server_data.headers,
        tools=capabilities["tools"],
        resources=capabilities["resources"],
        prompts=capabilities["prompts"],
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
    _invalidate_runtime_caches(owner_user_id=owner_user_id)
        
    return _mcp_schema(new_server)


@router.put(
    "/api/mcp-servers/{id}",
    response_model=McpServerSchema | WorkspaceChangeRequestSchema,
    summary="Update an MCP server",
    description="Updates one owned MCP server configuration and clears MCP runtime caches.",
)
async def update_mcp_server(
    id: str,
    server_data: McpServerSchema,
    workspace_id: str | None = Depends(get_workspace_header),
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    workspace, member = get_active_workspace(db, current_user, workspace_id)
    owner_user_id = workspace.owner_user_id
    if member.role not in MANAGER_ROLES:
        existing_server = db.query(McpServerTable).filter(
            McpServerTable.id == id,
            McpServerTable.owner_user_id == owner_user_id,
            workspace_scoped_resource_filter(McpServerTable, owner_user_id, workspace.id),
        ).first()
        payload = server_data.model_dump(mode="json")
        if existing_server:
            payload["previousValues"] = _mcp_schema(existing_server).model_dump(mode="json")
        change = create_workspace_change_request_row(
            db,
            workspace_id=workspace.id,
            requester_user_id=current_user.id,
            target_type="mcp_server",
            target_id=id,
            action="update",
            payload=payload,
        )
        return _workspace_change_request_schema(db, change)
    server = db.query(McpServerTable).filter(
        McpServerTable.id == id,
        McpServerTable.owner_user_id == owner_user_id,
        workspace_scoped_resource_filter(McpServerTable, owner_user_id, workspace.id),
    ).first()
    if not server:
        raise HTTPException(status_code=404, detail="MCP Server not found")

    capabilities = await _discover_capabilities(server_data)

    server.name = server_data.name
    server.workspace_id = workspace.id
    server.type = "streamable_http"
    server.url = server_data.url
    server.headers = server_data.headers
    server.tools = capabilities["tools"]
    server.resources = capabilities["resources"]
    server.prompts = capabilities["prompts"]
    server.updated_at = server_data.updatedAt
    
    db.commit()
    db.refresh(server)
    
    # Clear pool cache on updates to trigger reloading
    try:
        from src.utils.mcp import McpPoolManager
        McpPoolManager.clear_cache()
    except Exception:
        pass
    _invalidate_runtime_caches(owner_user_id=owner_user_id)

    return _mcp_schema(server)


async def _discover_capabilities(server_data: McpServerSchema) -> dict[str, list[dict]]:
    """Validate an MCP connection and collect its current advertised metadata."""
    if not server_data.url:
        raise HTTPException(status_code=422, detail="MCP Server URL is required")

    try:
        from src.utils.mcp import discover_mcp_capabilities

        return await discover_mcp_capabilities(
            server_data.name,
            server_data.url,
            server_data.headers,
        )
    except Exception as exc:
        from src.utils.mcp import McpPoolManager

        detail = McpPoolManager._format_exception(exc)
        raise HTTPException(
            status_code=422,
            detail=f"Failed to discover MCP capabilities: {detail}",
        ) from exc


@router.delete(
    "/api/mcp-servers/{id}",
    summary="Delete an MCP server",
    description="Deletes one owned MCP server, removes agent links to it, and clears MCP runtime caches.",
)
async def delete_mcp_server(
    id: str,
    workspace_id: str | None = Depends(get_workspace_header),
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    workspace, member = get_active_workspace(db, current_user, workspace_id)
    owner_user_id = workspace.owner_user_id
    if member.role not in MANAGER_ROLES:
        change = create_workspace_change_request_row(
            db,
            workspace_id=workspace.id,
            requester_user_id=current_user.id,
            target_type="mcp_server",
            target_id=id,
            action="delete",
            payload={},
        )
        return _workspace_change_request_schema(db, change)
    server = db.query(McpServerTable).filter(
        McpServerTable.id == id,
        McpServerTable.owner_user_id == owner_user_id,
        workspace_scoped_resource_filter(McpServerTable, owner_user_id, workspace.id),
    ).first()
    if not server:
        raise HTTPException(status_code=404, detail="MCP Server not found")
    
    _remove_agent_profile_links(db, owner_user_id, "mcp_ids", [id])
    db.delete(server)
    db.commit()
    
    # Clear pool cache on updates to trigger reloading
    try:
        from src.utils.mcp import McpPoolManager
        McpPoolManager.clear_cache()
    except Exception:
        pass
    _invalidate_runtime_caches(owner_user_id=owner_user_id)

    return {"status": "success", "message": f"MCP Server {id} deleted"}
