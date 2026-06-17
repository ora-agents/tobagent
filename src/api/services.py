"""Shared API service helpers for persistence routes."""
# ruff: noqa: D401

import copy
import logging
import uuid
from datetime import UTC, datetime

from fastapi import HTTPException
from sqlalchemy.orm import Session

from src.api.schemas import (
    AgentProfileSchema,
    AgentProfileVersionSchema,
    AgentShareLinkSchema,
    AgentShareOptions,
    KBFileSchema,
    KnowledgeBaseSchema,
    McpServerSchema,
    SkillSchema,
)
from src.utils.db import (
    AgentProfileTable,
    AgentProfileVersionTable,
    AgentShareLinkTable,
    KnowledgeBaseTable,
    McpServerTable,
    SkillTable,
    UserVoiceprintTable,
)

logger = logging.getLogger(__name__)


def _schema_files(files: list[dict] | None) -> list[KBFileSchema]:
    return [
        KBFileSchema(name=f["name"], size=f["size"], uploadedAt=f["uploadedAt"])
        for f in files or []
    ]


def _agent_profile_schema(profile: AgentProfileTable) -> AgentProfileSchema:
    return AgentProfileSchema(
        id=profile.id,
        name=profile.name,
        description=profile.description,
        systemPrompt=profile.system_prompt,
        model=profile.model,
        enabledTools=profile.enabled_tools or [],
        knowledgeBaseIds=profile.knowledge_base_ids or [],
        skillIds=profile.skill_ids or [],
        mcpIds=profile.mcp_ids or [],
        agentIds=profile.agent_ids or [],
        wakeWords=profile.wake_words or [],
        roleTemplateId=profile.role_template_id,
        personaStyle=profile.persona_style,
        boundaryMode=profile.boundary_mode,
        ttsVoice=profile.tts_voice,
        voiceInterruptionEnabled=profile.voice_interruption_enabled is not False,
        speakerVerificationEnabled=bool(profile.speaker_verification_enabled),
        speakerVerificationBound=bool(profile.user_voiceprint_id),
        speakerSampleText=profile.speaker_sample_text,
        speakerEnrolledAt=profile.speaker_enrolled_at,
        userVoiceprintId=profile.user_voiceprint_id,
        createdAt=profile.created_at,
        updatedAt=profile.updated_at,
    )


def _agent_profile_snapshot(profile: AgentProfileTable) -> dict:
    return _agent_profile_schema(profile).model_dump(mode="json")


def _agent_profile_version_schema(version: AgentProfileVersionTable) -> AgentProfileVersionSchema:
    return AgentProfileVersionSchema(
        id=version.id,
        agentProfileId=version.agent_profile_id,
        version=version.version,
        snapshot=AgentProfileSchema.model_validate(version.snapshot),
        createdAt=version.created_at,
    )


def _create_agent_profile_version(
    db: Session,
    profile: AgentProfileTable,
    created_at: str | None = None,
) -> AgentProfileVersionTable:
    latest_version = (
        db.query(AgentProfileVersionTable.version)
        .filter(
            AgentProfileVersionTable.agent_profile_id == profile.id,
            AgentProfileVersionTable.owner_user_id == profile.owner_user_id,
        )
        .order_by(AgentProfileVersionTable.version.desc())
        .first()
    )
    next_version = (latest_version[0] if latest_version else 0) + 1
    version = AgentProfileVersionTable(
        id=str(uuid.uuid4()),
        agent_profile_id=profile.id,
        owner_user_id=profile.owner_user_id,
        version=next_version,
        snapshot=_agent_profile_snapshot(profile),
        created_at=created_at or datetime.now(UTC).isoformat().replace("+00:00", "Z"),
    )
    db.add(version)
    return version


def _skill_schema(skill: SkillTable) -> SkillSchema:
    return SkillSchema(
        id=skill.id,
        name=skill.name,
        description=skill.description,
        content=skill.content,
        createdAt=skill.created_at,
        updatedAt=skill.updated_at,
    )


def _kb_schema(kb: KnowledgeBaseTable) -> KnowledgeBaseSchema:
    return KnowledgeBaseSchema(
        id=kb.id,
        name=kb.name,
        description=kb.description,
        files=_schema_files(kb.files),
        isSystem=kb.owner_user_id is None,
        createdAt=kb.created_at,
        updatedAt=kb.updated_at,
    )


def _mcp_schema(server: McpServerTable) -> McpServerSchema:
    return McpServerSchema(
        id=server.id,
        name=server.name,
        type="streamable_http",
        url=server.url,
        headers=server.headers or {},
        createdAt=server.created_at,
        updatedAt=server.updated_at,
    )


def _share_options_from_row(share: AgentShareLinkTable) -> AgentShareOptions:
    return AgentShareOptions.model_validate(share.include_options or {})


def _share_link_schema(share: AgentShareLinkTable) -> AgentShareLinkSchema:
    return AgentShareLinkSchema(
        token=share.token,
        agentProfileId=share.agent_profile_id,
        include=_share_options_from_row(share),
        createdAt=share.created_at,
        updatedAt=share.updated_at,
    )


def _require_owned_ids(
    db: Session,
    table,
    ids: list[str],
    owner_user_id: str,
    label: str,
) -> None:
    unique_ids = list(dict.fromkeys(ids or []))
    if not unique_ids:
        return
    count = db.query(table).filter(
        table.id.in_(unique_ids),
        table.owner_user_id == owner_user_id,
    ).count()
    if count != len(unique_ids):
        raise HTTPException(
            status_code=400,
            detail=f"{label} contains resources that do not belong to the current user",
        )


def _require_accessible_knowledge_base_ids(
    db: Session,
    ids: list[str],
    owner_user_id: str,
) -> None:
    """Require KB ids to be owned by the user or provided by the system."""
    from sqlalchemy import or_

    unique_ids = list(dict.fromkeys(ids or []))
    if not unique_ids:
        return
    count = db.query(KnowledgeBaseTable).filter(
        KnowledgeBaseTable.id.in_(unique_ids),
        or_(
            KnowledgeBaseTable.owner_user_id == owner_user_id,
            KnowledgeBaseTable.owner_user_id.is_(None),
        ),
    ).count()
    if count != len(unique_ids):
        raise HTTPException(
            status_code=400,
            detail="knowledgeBaseIds contains resources that do not belong to the current user",
        )


def _validate_agent_profile_links(
    db: Session,
    profile_data: AgentProfileSchema,
    owner_user_id: str,
    current_profile_id: str | None = None,
) -> None:
    _require_accessible_knowledge_base_ids(db, profile_data.knowledgeBaseIds, owner_user_id)
    _require_owned_ids(db, SkillTable, profile_data.skillIds, owner_user_id, "skillIds")
    _require_owned_ids(db, McpServerTable, profile_data.mcpIds, owner_user_id, "mcpIds")
    if profile_data.userVoiceprintId:
        _require_owned_ids(
            db,
            UserVoiceprintTable,
            [profile_data.userVoiceprintId],
            owner_user_id,
            "userVoiceprintId",
        )

    agent_ids = list(profile_data.agentIds or [])
    if current_profile_id:
        agent_ids = [agent_id for agent_id in agent_ids if agent_id != current_profile_id]
    _require_owned_ids(db, AgentProfileTable, agent_ids, owner_user_id, "agentIds")


def _remove_agent_profile_links(
    db: Session,
    owner_user_id: str,
    field_name: str,
    deleted_ids: list[str],
) -> int:
    """Remove deleted resource ids from all owned agent profile link arrays."""
    ids_to_remove = set(deleted_ids)
    if not ids_to_remove:
        return 0

    changed_count = 0
    profiles = db.query(AgentProfileTable).filter(
        AgentProfileTable.owner_user_id == owner_user_id,
    ).all()
    for profile in profiles:
        current_ids = getattr(profile, field_name, None)
        if not isinstance(current_ids, list):
            continue

        updated_ids = [
            resource_id
            for resource_id in current_ids
            if resource_id not in ids_to_remove
        ]
        if updated_ids == current_ids:
            continue

        setattr(profile, field_name, updated_ids)
        profile.updated_at = datetime.now(UTC).isoformat().replace("+00:00", "Z")
        changed_count += 1

    return changed_count


def _invalidate_runtime_caches(
    agent_id: str | None = None,
    owner_user_id: str | None = None,
) -> None:
    """Best-effort invalidation for request-time agent/RAG metadata caches."""
    try:
        from src.middleware.dynamic_config_middleware import DynamicConfigMiddleware

        DynamicConfigMiddleware.clear_cache(agent_id=agent_id, owner_user_id=owner_user_id)
    except Exception:
        pass

    try:
        from src.tools.rag_tool import invalidate_rag_cache

        invalidate_rag_cache(agent_id=agent_id, owner_user_id=owner_user_id)
    except Exception:
        pass


def _new_resource_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4()}"


def _copy_kb_vector_table_best_effort(source_kb_id: str, target_kb_id: str) -> str | None:
    """Copy LanceDB rows for a shared KB when the local vector store is available."""
    try:
        from src.tools.rag_tool import _get_db, _table_name, invalidate_rag_cache

        vector_db = _get_db()
        source_table_name = _table_name(source_kb_id)
        target_table_name = _table_name(target_kb_id)
        if source_table_name not in vector_db.table_names():
            return None

        source_table = vector_db.open_table(source_table_name)
        if hasattr(source_table, "to_arrow"):
            data = source_table.to_arrow()
        elif hasattr(source_table, "to_lance"):
            data = source_table.to_lance().to_table()
        else:
            return "Knowledge base vectors could not be copied by this LanceDB version."

        if target_table_name in vector_db.table_names():
            vector_db.drop_table(target_table_name)
        vector_db.create_table(target_table_name, data=data)
        invalidate_rag_cache()
        return None
    except Exception as exc:
        logger.warning("Failed to copy shared KB vectors %s -> %s: %s", source_kb_id, target_kb_id, exc)
        return "Knowledge base metadata was copied, but vector rows could not be copied."


def _copy_shared_agent_resources(
    db: Session,
    source_profile: AgentProfileTable,
    target_owner_user_id: str,
    include: AgentShareOptions,
    now: str,
) -> tuple[dict[str, list[str]], dict[str, dict[str, str]], list[str]]:
    """Copy selected linked resources and return rewritten id lists."""
    source_ids = {
        "knowledgeBaseIds": list(source_profile.knowledge_base_ids or []),
        "skillIds": list(source_profile.skill_ids or []),
        "mcpIds": list(source_profile.mcp_ids or []),
        "agentIds": list(source_profile.agent_ids or []),
    }
    target_ids = {key: [] for key in source_ids}
    id_map: dict[str, dict[str, str]] = {
        "knowledgeBaseIds": {},
        "skillIds": {},
        "mcpIds": {},
        "agentIds": {},
    }
    warnings: list[str] = []

    if include.knowledgeBases:
        from sqlalchemy import or_

        kbs = db.query(KnowledgeBaseTable).filter(
            KnowledgeBaseTable.id.in_(source_ids["knowledgeBaseIds"]),
            or_(
                KnowledgeBaseTable.owner_user_id == source_profile.owner_user_id,
                KnowledgeBaseTable.owner_user_id.is_(None),
            ),
        ).all()
        by_id = {kb.id: kb for kb in kbs}
        for source_id in source_ids["knowledgeBaseIds"]:
            kb = by_id.get(source_id)
            if not kb:
                warnings.append(f"Knowledge base {source_id} was not found and was skipped.")
                continue
            if kb.owner_user_id is None:
                target_ids["knowledgeBaseIds"].append(kb.id)
                id_map["knowledgeBaseIds"][source_id] = kb.id
                continue

            target_id = _new_resource_id("kb")
            db.add(KnowledgeBaseTable(
                id=target_id,
                owner_user_id=target_owner_user_id,
                name=f"{kb.name} (shared)",
                description=kb.description,
                files=copy.deepcopy(kb.files or []),
                created_at=now,
                updated_at=now,
            ))
            target_ids["knowledgeBaseIds"].append(target_id)
            id_map["knowledgeBaseIds"][source_id] = target_id
            warning = _copy_kb_vector_table_best_effort(kb.id, target_id)
            if warning:
                warnings.append(warning)

    if include.skills:
        skills = db.query(SkillTable).filter(
            SkillTable.id.in_(source_ids["skillIds"]),
            SkillTable.owner_user_id == source_profile.owner_user_id,
        ).all()
        by_id = {skill.id: skill for skill in skills}
        for source_id in source_ids["skillIds"]:
            skill = by_id.get(source_id)
            if not skill:
                warnings.append(f"Skill {source_id} was not found and was skipped.")
                continue
            target_id = _new_resource_id("skill")
            db.add(SkillTable(
                id=target_id,
                owner_user_id=target_owner_user_id,
                name=f"{skill.name} (shared)",
                description=skill.description,
                content=skill.content,
                created_at=now,
                updated_at=now,
            ))
            target_ids["skillIds"].append(target_id)
            id_map["skillIds"][source_id] = target_id

    if include.mcpServers:
        servers = db.query(McpServerTable).filter(
            McpServerTable.id.in_(source_ids["mcpIds"]),
            McpServerTable.owner_user_id == source_profile.owner_user_id,
        ).all()
        by_id = {server.id: server for server in servers}
        for source_id in source_ids["mcpIds"]:
            server = by_id.get(source_id)
            if not server:
                warnings.append(f"MCP server {source_id} was not found and was skipped.")
                continue
            target_id = _new_resource_id("mcp")
            db.add(McpServerTable(
                id=target_id,
                owner_user_id=target_owner_user_id,
                name=f"{server.name} (shared)",
                type="streamable_http",
                url=server.url,
                headers=copy.deepcopy(server.headers or {}),
                created_at=now,
                updated_at=now,
            ))
            target_ids["mcpIds"].append(target_id)
            id_map["mcpIds"][source_id] = target_id

    if include.agents:
        linked_agents = db.query(AgentProfileTable).filter(
            AgentProfileTable.id.in_(source_ids["agentIds"]),
            AgentProfileTable.owner_user_id == source_profile.owner_user_id,
        ).all()
        by_id = {agent.id: agent for agent in linked_agents}
        for source_id in source_ids["agentIds"]:
            agent = by_id.get(source_id)
            if not agent:
                warnings.append(f"Linked agent {source_id} was not found and was skipped.")
                continue
            target_id = _new_resource_id("agent")
            linked_profile = AgentProfileTable(
                id=target_id,
                owner_user_id=target_owner_user_id,
                name=f"{agent.name} (shared)",
                description=agent.description,
                system_prompt=agent.system_prompt,
                model=agent.model,
                enabled_tools=copy.deepcopy(agent.enabled_tools or []),
                knowledge_base_ids=[],
                skill_ids=[],
                mcp_ids=[],
                agent_ids=[],
                wake_words=copy.deepcopy(agent.wake_words or []),
                role_template_id=agent.role_template_id,
                persona_style=agent.persona_style,
                boundary_mode=agent.boundary_mode,
                tts_voice=agent.tts_voice,
                voice_interruption_enabled=agent.voice_interruption_enabled is not False,
                speaker_verification_enabled=False,
                created_at=now,
                updated_at=now,
            )
            db.add(linked_profile)
            _create_agent_profile_version(db, linked_profile, now)
            target_ids["agentIds"].append(target_id)
            id_map["agentIds"][source_id] = target_id

    return target_ids, id_map, warnings
