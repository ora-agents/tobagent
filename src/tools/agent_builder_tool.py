"""Tools used by the system agent-builder graph to maintain configuration."""

from __future__ import annotations

import asyncio
import json
import uuid
from datetime import UTC, datetime
from typing import Any, Literal

from langchain_core.tools import BaseTool
from pydantic import BaseModel, Field
from sqlalchemy import or_

from src.api.services import _create_agent_profile_version, _invalidate_runtime_caches
from src.utils.assets_import import DEFAULT_AGENT_GRAPH_ID, is_default_agent_profile_id
from src.utils.db import (
    AgentProfileTable,
    FormTable,
    KnowledgeBaseTable,
    McpServerTable,
    SessionLocal,
    SkillTable,
)
from src.utils.form_permissions import normalize_form_permissions
from src.utils.mcp import discover_mcp_capabilities
from src.utils.runtime_context import get_runtime_context_value
from src.utils.skill_validation import (
    SkillValidationError,
    normalize_skill_content,
    skill_identity_from_content,
)


def _now() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def _new_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4()}"


def _owner_user_id() -> str:
    owner = get_runtime_context_value("user_id", "")
    if not isinstance(owner, str) or not owner.strip():
        raise ValueError("Authenticated user_id is required to edit configuration.")
    return owner.strip()


def _json(data: Any) -> str:
    return json.dumps(data, ensure_ascii=False, indent=2)


def _is_system_agent_profile(profile: AgentProfileTable) -> bool:
    return profile.graph_id == DEFAULT_AGENT_GRAPH_ID or is_default_agent_profile_id(profile.id)


class ListConfigResourcesInput(BaseModel):
    """Input for listing available configuration resources."""

    resource_type: Literal["all", "agents", "skills", "knowledge_bases", "forms", "mcp_servers"] = "all"


class ListConfigResourcesTool(BaseTool):
    """List existing resources that can be edited or linked by the builder."""

    name: str = "list_config_resources"
    description: str = (
        "List the user's configurable agents, skills, knowledge bases, forms, and MCP servers. "
        "Use this before editing or linking resources so IDs are exact."
    )
    args_schema: type[BaseModel] = ListConfigResourcesInput

    def _run(self, resource_type: str = "all", **_: Any) -> str:
        owner = _owner_user_id()
        db = SessionLocal()
        try:
            payload: dict[str, Any] = {}
            if resource_type in ("all", "agents"):
                payload["agents"] = [
                    {
                        "id": row.id,
                        "name": row.name,
                        "description": row.description,
                        "graphId": row.graph_id,
                        "enabledTools": row.enabled_tools or [],
                        "knowledgeBaseIds": row.knowledge_base_ids or [],
                        "skillIds": row.skill_ids or [],
                        "mcpIds": row.mcp_ids or [],
                        "agentIds": row.agent_ids or [],
                        "formIds": row.form_ids or [],
                        "formPermissions": normalize_form_permissions(
                            row.form_ids,
                            row.form_permissions,
                        ),
                    }
                    for row in db.query(AgentProfileTable)
                    .filter(AgentProfileTable.owner_user_id == owner)
                    .all()
                ]
            if resource_type in ("all", "skills"):
                payload["skills"] = [
                    {"id": row.id, "name": row.name, "description": row.description}
                    for row in db.query(SkillTable).filter(SkillTable.owner_user_id == owner).all()
                ]
            if resource_type in ("all", "knowledge_bases"):
                payload["knowledgeBases"] = [
                    {
                        "id": row.id,
                        "name": row.name,
                        "description": row.description,
                        "isSystem": row.owner_user_id is None,
                    }
                    for row in db.query(KnowledgeBaseTable)
                    .filter(or_(KnowledgeBaseTable.owner_user_id == owner, KnowledgeBaseTable.owner_user_id.is_(None)))
                    .all()
                ]
            if resource_type in ("all", "forms"):
                payload["forms"] = [
                    {
                        "id": row.id,
                        "name": row.name,
                        "description": row.description,
                        "category": row.category or "",
                        "fields": row.fields or [],
                    }
                    for row in db.query(FormTable).filter(FormTable.owner_user_id == owner).all()
                ]
            if resource_type in ("all", "mcp_servers"):
                payload["mcpServers"] = [
                    {"id": row.id, "name": row.name, "url": row.url}
                    for row in db.query(McpServerTable).filter(McpServerTable.owner_user_id == owner).all()
                ]
            return _json(payload)
        finally:
            db.close()

    async def _arun(self, **kwargs: Any) -> str:
        return await asyncio.to_thread(self._run, **kwargs)


class UpsertAgentProfileInput(BaseModel):
    """Input for creating or updating an agent profile."""

    agent_id: str = Field(default="", description="Existing agent ID to update. Leave empty to create a new agent.")
    name: str
    description: str = ""
    system_prompt: str = ""
    model: str = ""
    enabled_tools: list[str] = Field(default_factory=list)
    role_template_id: str = ""
    persona_style: str = ""
    boundary_mode: str = ""
    wake_words: list[str] = Field(default_factory=list)
    tts_voice: str = ""
    is_hidden: bool = False


class UpsertAgentProfileTool(BaseTool):
    """Create or update an agent role/profile."""

    name: str = "upsert_agent_profile"
    description: str = "Create or update a configurable agent role/profile and return its saved ID."
    args_schema: type[BaseModel] = UpsertAgentProfileInput

    def _run(self, **kwargs: Any) -> str:
        owner = _owner_user_id()
        now = _now()
        db = SessionLocal()
        try:
            agent_id = str(kwargs.get("agent_id") or "").strip()
            profile = None
            if agent_id:
                profile = db.query(AgentProfileTable).filter(
                    AgentProfileTable.id == agent_id,
                    AgentProfileTable.owner_user_id == owner,
                ).first()
                if profile is None:
                    return f"Agent '{agent_id}' was not found for this user."
                if _is_system_agent_profile(profile):
                    return "System agent profiles cannot be modified."
            if profile is None:
                profile = AgentProfileTable(
                    id=_new_id("agent"),
                    owner_user_id=owner,
                    created_at=now,
                    knowledge_base_ids=[],
                    skill_ids=[],
                    mcp_ids=[],
                    agent_ids=[],
                    form_ids=[],
                    form_permissions={},
                )
                db.add(profile)

            profile.name = str(kwargs.get("name") or "").strip()
            profile.description = str(kwargs.get("description") or "")
            profile.system_prompt = str(kwargs.get("system_prompt") or "")
            profile.model = str(kwargs.get("model") or "").strip() or None
            profile.graph_id = "generic_agent"
            profile.enabled_tools = list(kwargs.get("enabled_tools") or [])
            profile.role_template_id = str(kwargs.get("role_template_id") or "").strip() or None
            profile.persona_style = str(kwargs.get("persona_style") or "").strip() or None
            profile.boundary_mode = str(kwargs.get("boundary_mode") or "").strip() or None
            profile.wake_words = list(kwargs.get("wake_words") or [])
            profile.tts_voice = str(kwargs.get("tts_voice") or "").strip() or None
            profile.is_hidden = bool(kwargs.get("is_hidden", False))
            profile.updated_at = now
            _create_agent_profile_version(db, profile, now)
            db.commit()
            _invalidate_runtime_caches(profile.id, owner)
            return _json({"agentId": profile.id, "status": "saved"})
        finally:
            db.close()

    async def _arun(self, **kwargs: Any) -> str:
        return await asyncio.to_thread(self._run, **kwargs)


class UpsertSkillInput(BaseModel):
    """Input for creating or updating a skill."""

    skill_id: str = Field(
        default="",
        description="Optional stable skill ID. When omitted, a new skill ID is generated.",
    )
    name: str = Field(
        default="",
        description="Fallback skill name. The saved name is read from the skill frontmatter when present.",
    )
    description: str = ""
    version: str = Field(
        default="1.0.0",
        description="Skill version written to the top-level YAML frontmatter.",
    )
    category: str = Field(
        default="general",
        description="Short skill category written to the top-level YAML frontmatter.",
    )
    content: str = Field(
        description=(
            "Skill Markdown using the standard template: YAML frontmatter with "
            "name, description, version, and category, followed by headed Markdown sections. "
            "Optional allowed-tools and parameters may be declared when non-empty; omit empty arrays."
        )
    )


class UpsertSkillTool(BaseTool):
    """Create or update a prompt skill."""

    name: str = "upsert_skill"
    description: str = "Create or update a prompt-based skill that can be linked to agents."
    args_schema: type[BaseModel] = UpsertSkillInput

    def _run(self, **kwargs: Any) -> str:
        owner = _owner_user_id()
        now = _now()
        db = SessionLocal()
        try:
            skill_id = str(kwargs.get("skill_id") or "").strip()
            skill = db.query(SkillTable).filter(SkillTable.id == skill_id).first() if skill_id else None
            if skill is not None and skill.owner_user_id != owner:
                return f"Skill '{skill_id}' already exists for another user."
            if skill is None:
                skill = SkillTable(id=skill_id or _new_id("skill"), owner_user_id=owner, created_at=now)
                db.add(skill)
            content = str(kwargs.get("content") or "")
            try:
                content = normalize_skill_content(
                    content,
                    version=str(kwargs.get("version") or "").strip() or "1.0.0",
                    category=str(kwargs.get("category") or "").strip() or "general",
                )
                skill_name, skill_description = skill_identity_from_content(
                    content,
                    fallback_name=str(kwargs.get("name") or ""),
                    fallback_description=str(kwargs.get("description") or ""),
                )
            except SkillValidationError as exc:
                return f"Skill validation failed: {exc}"
            skill.name = skill_name
            skill.description = skill_description
            skill.content = content
            skill.updated_at = now
            db.commit()
            _invalidate_runtime_caches(owner_user_id=owner)
            return _json({"skillId": skill.id, "status": "saved"})
        finally:
            db.close()

    async def _arun(self, **kwargs: Any) -> str:
        return await asyncio.to_thread(self._run, **kwargs)


class FormFieldInput(BaseModel):
    """One form field definition."""

    id: str
    label: str
    type: str = "text"
    required: bool = False
    options: list[str] = Field(default_factory=list)


class UpsertFormInput(BaseModel):
    """Input for creating or updating a form definition."""

    form_id: str = ""
    name: str
    description: str = ""
    category: str = ""
    fields: list[FormFieldInput] = Field(default_factory=list)


class UpsertFormTool(BaseTool):
    """Create or update a structured form definition."""

    name: str = "upsert_form"
    description: str = "Create or update a structured form definition that can be linked to agents."
    args_schema: type[BaseModel] = UpsertFormInput

    def _run(self, **kwargs: Any) -> str:
        owner = _owner_user_id()
        now = _now()
        db = SessionLocal()
        try:
            form_id = str(kwargs.get("form_id") or "").strip()
            form = db.query(FormTable).filter(FormTable.id == form_id, FormTable.owner_user_id == owner).first() if form_id else None
            if form_id and form is None:
                return f"Form '{form_id}' was not found for this user."
            if form is None:
                form = FormTable(id=_new_id("form"), owner_user_id=owner, created_at=now)
                db.add(form)
            form.name = str(kwargs.get("name") or "").strip()
            form.description = str(kwargs.get("description") or "")
            form.category = str(kwargs.get("category") or "").strip()
            form.fields = [
                field.model_dump(mode="json") if isinstance(field, FormFieldInput) else dict(field)
                for field in kwargs.get("fields", [])
            ]
            form.updated_at = now
            db.commit()
            _invalidate_runtime_caches(owner_user_id=owner)
            return _json({"formId": form.id, "status": "saved"})
        finally:
            db.close()

    async def _arun(self, **kwargs: Any) -> str:
        return await asyncio.to_thread(self._run, **kwargs)


class UpsertMcpServerInput(BaseModel):
    """Input for creating or updating an MCP server."""

    mcp_id: str = ""
    name: str
    url: str
    headers: dict[str, str] = Field(default_factory=dict)


class UpsertMcpServerTool(BaseTool):
    """Create or update a streamable HTTP MCP server config."""

    name: str = "upsert_mcp_server"
    description: str = "Create or update a streamable HTTP MCP server configuration."
    args_schema: type[BaseModel] = UpsertMcpServerInput

    def _run(self, **kwargs: Any) -> str:
        owner = _owner_user_id()
        now = _now()
        db = SessionLocal()
        try:
            mcp_id = str(kwargs.get("mcp_id") or "").strip()
            server = db.query(McpServerTable).filter(McpServerTable.id == mcp_id, McpServerTable.owner_user_id == owner).first() if mcp_id else None
            if mcp_id and server is None:
                return f"MCP server '{mcp_id}' was not found for this user."
            name = str(kwargs.get("name") or "").strip()
            url = str(kwargs.get("url") or "").strip()
            headers = dict(kwargs.get("headers") or {})
            try:
                capabilities = asyncio.run(
                    discover_mcp_capabilities(name, url, headers)
                )
            except Exception as exc:
                return f"Failed to discover MCP capabilities: {type(exc).__name__}: {exc}"
            if server is None:
                server = McpServerTable(id=_new_id("mcp"), owner_user_id=owner, created_at=now)
                db.add(server)
            server.name = name
            server.type = "streamable_http"
            server.url = url
            server.headers = headers
            server.tools = capabilities["tools"]
            server.resources = capabilities["resources"]
            server.prompts = capabilities["prompts"]
            server.updated_at = now
            db.commit()
            _invalidate_runtime_caches(owner_user_id=owner)
            return _json({"mcpId": server.id, "status": "saved"})
        finally:
            db.close()

    async def _arun(self, **kwargs: Any) -> str:
        return await asyncio.to_thread(self._run, **kwargs)


class UpsertKnowledgeBaseInput(BaseModel):
    """Input for creating or updating knowledge-base metadata."""

    knowledge_base_id: str = ""
    name: str
    description: str = ""


class UpsertKnowledgeBaseTool(BaseTool):
    """Create or update knowledge-base metadata."""

    name: str = "upsert_knowledge_base"
    description: str = "Create or update a user-owned knowledge base metadata record. File ingestion still uses the upload API/UI."
    args_schema: type[BaseModel] = UpsertKnowledgeBaseInput

    def _run(self, **kwargs: Any) -> str:
        owner = _owner_user_id()
        now = _now()
        db = SessionLocal()
        try:
            kb_id = str(kwargs.get("knowledge_base_id") or "").strip()
            kb = db.query(KnowledgeBaseTable).filter(KnowledgeBaseTable.id == kb_id, KnowledgeBaseTable.owner_user_id == owner).first() if kb_id else None
            if kb_id and kb is None:
                return f"Knowledge base '{kb_id}' was not found for this user."
            if kb is None:
                kb = KnowledgeBaseTable(id=_new_id("kb"), owner_user_id=owner, files=[], created_at=now)
                db.add(kb)
            kb.name = str(kwargs.get("name") or "").strip()
            kb.description = str(kwargs.get("description") or "")
            kb.updated_at = now
            db.commit()
            _invalidate_runtime_caches(owner_user_id=owner)
            return _json({"knowledgeBaseId": kb.id, "status": "saved"})
        finally:
            db.close()

    async def _arun(self, **kwargs: Any) -> str:
        return await asyncio.to_thread(self._run, **kwargs)


class LinkAgentResourcesInput(BaseModel):
    """Input for replacing or merging linked resources on an agent."""

    agent_id: str
    knowledge_base_ids: list[str] = Field(default_factory=list)
    skill_ids: list[str] = Field(default_factory=list)
    mcp_ids: list[str] = Field(default_factory=list)
    form_ids: list[str] = Field(default_factory=list)
    form_permissions: dict[str, list[Literal["create", "read", "update", "delete"]]] = Field(
        default_factory=dict,
        description="CRUD record permissions by form ID. Legacy form links default to read-only.",
    )
    agent_ids: list[str] = Field(default_factory=list)
    mode: Literal["merge", "replace"] = "merge"


class LinkAgentResourcesTool(BaseTool):
    """Link configuration resources to a target agent."""

    name: str = "link_agent_resources"
    description: str = "Merge or replace an agent's linked knowledge bases, skills, MCP servers, forms, and subagents."
    args_schema: type[BaseModel] = LinkAgentResourcesInput

    def _run(self, **kwargs: Any) -> str:
        owner = _owner_user_id()
        db = SessionLocal()
        try:
            agent_id = str(kwargs.get("agent_id") or "").strip()
            profile = db.query(AgentProfileTable).filter(
                AgentProfileTable.id == agent_id,
                AgentProfileTable.owner_user_id == owner,
            ).first()
            if not profile:
                return f"Agent '{agent_id}' was not found for this user."
            if _is_system_agent_profile(profile):
                return "System agent profiles cannot be modified."

            checks = [
                ("knowledge_base_ids", KnowledgeBaseTable, "knowledge_base_ids", kwargs.get("knowledge_base_ids") or []),
                ("skill_ids", SkillTable, "skill_ids", kwargs.get("skill_ids") or []),
                ("mcp_ids", McpServerTable, "mcp_ids", kwargs.get("mcp_ids") or []),
                ("form_ids", FormTable, "form_ids", kwargs.get("form_ids") or []),
                ("agent_ids", AgentProfileTable, "agent_ids", [item for item in kwargs.get("agent_ids") or [] if item != agent_id]),
            ]
            for label, table, _field, ids in checks:
                unique_ids = list(dict.fromkeys(str(item).strip() for item in ids if str(item).strip()))
                if not unique_ids:
                    continue
                query = db.query(table).filter(table.id.in_(unique_ids))
                if table is KnowledgeBaseTable:
                    query = query.filter(or_(table.owner_user_id == owner, table.owner_user_id.is_(None)))
                else:
                    query = query.filter(table.owner_user_id == owner)
                found = {row.id for row in query.all()}
                missing = [item for item in unique_ids if item not in found]
                if missing:
                    return f"{label} contains unavailable id(s): {', '.join(missing)}"

            mode = kwargs.get("mode") or "merge"
            for _label, _table, field, ids in checks:
                unique_ids = list(dict.fromkeys(str(item).strip() for item in ids if str(item).strip()))
                current = [] if mode == "replace" else list(getattr(profile, field) or [])
                setattr(profile, field, list(dict.fromkeys([*current, *unique_ids])))

            requested_form_permissions = kwargs.get("form_permissions") or {}
            raw_form_permissions = (
                requested_form_permissions
                if mode == "replace"
                else {
                    **(profile.form_permissions or {}),
                    **requested_form_permissions,
                }
            )
            profile.form_permissions = normalize_form_permissions(
                profile.form_ids,
                raw_form_permissions,
            )

            profile.updated_at = _now()
            _create_agent_profile_version(db, profile, profile.updated_at)
            db.commit()
            _invalidate_runtime_caches(profile.id, owner)
            return _json(
                {
                    "agentId": profile.id,
                    "knowledgeBaseIds": profile.knowledge_base_ids or [],
                    "skillIds": profile.skill_ids or [],
                    "mcpIds": profile.mcp_ids or [],
                    "formIds": profile.form_ids or [],
                    "formPermissions": profile.form_permissions or {},
                    "agentIds": profile.agent_ids or [],
                }
            )
        finally:
            db.close()

    async def _arun(self, **kwargs: Any) -> str:
        return await asyncio.to_thread(self._run, **kwargs)


agent_builder_tools = [
    ListConfigResourcesTool(),
    UpsertAgentProfileTool(),
    UpsertSkillTool(),
    UpsertFormTool(),
    UpsertMcpServerTool(),
    UpsertKnowledgeBaseTool(),
    LinkAgentResourcesTool(),
]
