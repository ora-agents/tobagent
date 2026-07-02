"""Workspace authorization helpers."""

import uuid
from datetime import UTC, datetime
from typing import Literal

from fastapi import Header, HTTPException
from sqlalchemy import or_
from sqlalchemy.orm import Session

from src.utils.db import (
    UserTable,
    WorkspaceChangeRequestTable,
    WorkspaceMemberTable,
    WorkspaceTable,
)

WorkspaceRole = Literal["owner", "admin", "member"]
MANAGER_ROLES: set[str] = {"owner", "admin"}


def utc_now() -> str:
    """Return an ISO UTC timestamp."""
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def default_workspace_id(user_id: str) -> str:
    """Return the stable default workspace id for a user."""
    return f"workspace-default-{user_id}"


def workspace_scoped_resource_filter(table, owner_user_id: str, workspace_id: str):
    """Scope a resource to one workspace, with legacy unscoped rows only in the default workspace."""
    conditions = [table.workspace_id == workspace_id]
    if workspace_id == default_workspace_id(owner_user_id):
        conditions.append(table.workspace_id.is_(None))
    return or_(*conditions)


def ensure_default_workspace(db: Session, user: UserTable) -> WorkspaceTable:
    """Create and return the user's personal default workspace."""
    workspace_id = default_workspace_id(user.id)
    workspace = db.query(WorkspaceTable).filter(WorkspaceTable.id == workspace_id).first()
    now = utc_now()
    if not workspace:
        workspace = WorkspaceTable(
            id=workspace_id,
            name=f"{user.username}'s Workspace",
            owner_user_id=user.id,
            created_at=now,
            updated_at=now,
        )
        db.add(workspace)

    member = db.query(WorkspaceMemberTable).filter(
        WorkspaceMemberTable.workspace_id == workspace_id,
        WorkspaceMemberTable.user_id == user.id,
    ).first()
    if not member:
        db.add(WorkspaceMemberTable(
            id=f"workspace-member-{uuid.uuid4()}",
            workspace_id=workspace_id,
            user_id=user.id,
            role="owner",
            status="active",
            created_at=now,
            updated_at=now,
        ))
    elif member.role != "owner" or member.status != "active":
        member.role = "owner"
        member.status = "active"
        member.updated_at = now

    return workspace


def get_workspace_header(
    x_workspace_id: str | None = Header(default=None, alias="X-Workspace-ID"),
) -> str | None:
    """Read the optional workspace id header."""
    return x_workspace_id.strip() if x_workspace_id and x_workspace_id.strip() else None


def get_active_workspace(
    db: Session,
    current_user: UserTable,
    workspace_id: str | None = None,
) -> tuple[WorkspaceTable, WorkspaceMemberTable]:
    """Return the selected workspace and the current user's active membership."""
    ensure_default_workspace(db, current_user)
    target_workspace_id = workspace_id or default_workspace_id(current_user.id)
    member = db.query(WorkspaceMemberTable).filter(
        WorkspaceMemberTable.workspace_id == target_workspace_id,
        WorkspaceMemberTable.user_id == current_user.id,
        WorkspaceMemberTable.status == "active",
    ).first()
    if not member:
        raise HTTPException(status_code=403, detail="Workspace access denied")

    workspace = db.query(WorkspaceTable).filter(WorkspaceTable.id == target_workspace_id).first()
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")
    return workspace, member


def require_workspace_role(
    db: Session,
    current_user: UserTable,
    workspace_id: str | None,
    allowed_roles: set[str],
) -> tuple[WorkspaceTable, WorkspaceMemberTable]:
    """Return workspace context only if current user has an allowed role."""
    workspace, member = get_active_workspace(db, current_user, workspace_id)
    if member.role not in allowed_roles:
        raise HTTPException(
            status_code=403,
            detail="Workspace role cannot modify resources; submit a change request",
        )
    return workspace, member


def require_workspace_manager(
    db: Session,
    current_user: UserTable,
    workspace_id: str | None,
) -> tuple[WorkspaceTable, WorkspaceMemberTable]:
    """Require owner or admin permissions in a workspace."""
    return require_workspace_role(db, current_user, workspace_id, MANAGER_ROLES)


def create_workspace_change_request_row(
    db: Session,
    workspace_id: str,
    requester_user_id: str,
    target_type: str,
    target_id: str | None,
    action: str,
    payload: dict,
) -> WorkspaceChangeRequestTable:
    """Persist a pending workspace change request."""
    change = WorkspaceChangeRequestTable(
        id=f"workspace-change-{uuid.uuid4()}",
        workspace_id=workspace_id,
        requester_user_id=requester_user_id,
        target_type=target_type,
        target_id=target_id,
        action=action,
        payload=payload,
        status="pending",
        created_at=utc_now(),
    )
    db.add(change)
    db.commit()
    db.refresh(change)
    return change
