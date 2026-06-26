import io
import json
import zipfile
from datetime import UTC, datetime

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from src.config_bundle.bundle import (
    build_export_bundle,
    execute_import,
    inspect_bundle,
)
from src.config_bundle.schemas import (
    BundleExportOptions,
    BundleExportRequest,
    BundleImportRequest,
    BundleSelection,
)
from src.config_bundle.storage import save_document
from src.utils.db import (
    AgentProfileTable,
    Base,
    FormRecordTable,
    FormTable,
    KnowledgeBaseTable,
    McpServerTable,
    SkillTable,
)


@pytest.fixture()
def db_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine)()
    try:
        yield session
    finally:
        session.close()


def _seed_resources(db_session):
    now = datetime.now(UTC).isoformat()
    db_session.add(SkillTable(
        id="skill-source",
        owner_user_id="owner",
        name="Research",
        description="Research skill",
        content="# Research\nUse primary sources.",
        created_at=now,
        updated_at=now,
    ))
    db_session.add(McpServerTable(
        id="mcp-source",
        owner_user_id="owner",
        name="Internal MCP",
        type="streamable_http",
        url="https://example.test/mcp",
        headers={
            "Authorization": "Bearer secret",
            "X-Api-Key": "secret",
            "X-Tenant": "safe",
        },
        created_at=now,
        updated_at=now,
    ))
    db_session.add(FormTable(
        id="form-source",
        owner_user_id="owner",
        name="Contacts",
        description="Contact records",
        category="CRM",
        fields=[{"id": "name", "label": "Name", "type": "text", "required": True, "options": []}],
        created_at=now,
        updated_at=now,
    ))
    db_session.add(FormRecordTable(
        id="record-source",
        form_id="form-source",
        owner_user_id="owner",
        data={"name": "Ada"},
        created_at=now,
        updated_at=now,
    ))
    db_session.add(KnowledgeBaseTable(
        id="kb-source",
        owner_user_id="owner",
        name="Manual",
        description="Product manual",
        files=[{"name": "manual.md", "size": 10, "uploadedAt": now}],
        import_status="ready",
        created_at=now,
        updated_at=now,
    ))
    db_session.add(AgentProfileTable(
        id="agent-source",
        owner_user_id="owner",
        name="Support",
        description="Support agent",
        system_prompt="Help users.",
        enabled_tools=["rag_search"],
        knowledge_base_ids=["kb-source"],
        skill_ids=["skill-source"],
        mcp_ids=["mcp-source"],
        form_ids=["form-source"],
        agent_ids=[],
        wake_words=["hello"],
        voice_interruption_enabled=False,
        speaker_verification_enabled=True,
        user_voiceprint_id="voiceprint-secret",
        created_at=now,
        updated_at=now,
    ))
    db_session.commit()


def test_bundle_round_trip_rewrites_ids_and_removes_secrets(db_session):
    _seed_resources(db_session)
    request = BundleExportRequest(
        selection=BundleSelection(agents=["agent-source"]),
        options=BundleExportOptions(
            includeDependencies=True,
            includeKnowledgeDocuments=False,
            includeFormRecords=True,
        ),
    )
    raw, export_warnings = build_export_bundle(db_session, request, "owner")
    assert export_warnings == []

    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        manifest = json.loads(archive.read("manifest.json"))
        assert manifest["resources"]["skills"] == ["skill-source"]
        agent = json.loads(archive.read("agents/agent-source.json"))
        mcp = json.loads(archive.read("mcp-servers/mcp-source.json"))
        form = json.loads(archive.read("forms/form-source.json"))
        assert "userVoiceprintId" not in agent
        assert mcp["headers"] == {"X-Tenant": "safe"}
        assert set(mcp["redactedHeaders"]) == {"Authorization", "X-Api-Key"}
        assert form["category"] == "CRM"

    inspection, entry = inspect_bundle(
        db_session, raw, "receiver", "inspection-test"
    )
    assert inspection.resources == {
        "agents": 1,
        "skills": 1,
        "knowledgeBases": 1,
        "mcpServers": 1,
        "forms": 1,
    }
    assert inspection.voiceprintsRequireRebinding == ["agent-source"]
    assert inspection.redactedMcpFields

    response, jobs = execute_import(
        db_session,
        entry,
        BundleImportRequest(inspectionId="inspection-test"),
        "receiver",
    )
    assert jobs == []
    imported_agent = db_session.get(
        AgentProfileTable, response.resources["agents"][0]
    )
    assert imported_agent.owner_user_id == "receiver"
    assert imported_agent.voice_interruption_enabled is False
    assert imported_agent.speaker_verification_enabled is True
    assert imported_agent.user_voiceprint_id is None
    assert imported_agent.skill_ids == [
        response.resourceIdMap["skillIds"]["skill-source"]
    ]
    assert imported_agent.knowledge_base_ids == [
        response.resourceIdMap["knowledgeBaseIds"]["kb-source"]
    ]
    imported_kb = db_session.get(
        KnowledgeBaseTable, imported_agent.knowledge_base_ids[0]
    )
    assert imported_kb.import_status == "needs_upload"
    assert imported_kb.files[0]["name"] == "manual.md"
    imported_form = db_session.get(
        FormTable, response.resourceIdMap["formIds"]["form-source"]
    )
    assert imported_form.category == "CRM"


def test_import_rewrites_form_reference_bindings_and_record_values(db_session):
    now = datetime.now(UTC).isoformat()
    db_session.add_all([
        FormTable(
            id="customers",
            owner_user_id="owner",
            name="Customers",
            description="",
            category="",
            fields=[{"id": "name", "label": "Name", "type": "text", "required": False, "options": []}],
            hooks=[],
            created_at=now,
            updated_at=now,
        ),
        FormTable(
            id="orders",
            owner_user_id="owner",
            name="Orders",
            description="",
            category="",
            fields=[{
                "id": "customer",
                "label": "Customer",
                "type": "reference",
                "required": False,
                "options": [],
                "binding": {
                    "targetFormId": "customers",
                    "targetDisplayFieldId": "name",
                    "relation": "many_to_one",
                    "onTargetDelete": "restrict",
                },
            }],
            hooks=[],
            created_at=now,
            updated_at=now,
        ),
        FormRecordTable(
            id="customer-record",
            form_id="customers",
            owner_user_id="owner",
            data={"name": "Ada"},
            created_at=now,
            updated_at=now,
        ),
        FormRecordTable(
            id="order-record",
            form_id="orders",
            owner_user_id="owner",
            data={"customer": "customer-record"},
            created_at=now,
            updated_at=now,
        ),
    ])
    db_session.commit()

    raw, warnings = build_export_bundle(
        db_session,
        BundleExportRequest(
            selection=BundleSelection(forms=["customers", "orders"]),
            options=BundleExportOptions(includeDependencies=False, includeFormRecords=True),
        ),
        "owner",
    )
    assert warnings == []

    inspection, entry = inspect_bundle(db_session, raw, "receiver", "inspection-reference")
    response, _ = execute_import(
        db_session,
        entry,
        BundleImportRequest(inspectionId="inspection-reference"),
        "receiver",
    )

    imported_order_form = db_session.get(FormTable, response.resourceIdMap["formIds"]["orders"])
    imported_customer_form_id = response.resourceIdMap["formIds"]["customers"]
    assert imported_order_form.fields[0]["binding"]["targetFormId"] == imported_customer_form_id

    imported_order_record = db_session.query(FormRecordTable).filter(
        FormRecordTable.form_id == imported_order_form.id,
        FormRecordTable.owner_user_id == "receiver",
    ).one()
    imported_customer_record = db_session.query(FormRecordTable).filter(
        FormRecordTable.form_id == imported_customer_form_id,
        FormRecordTable.owner_user_id == "receiver",
    ).one()
    assert imported_order_record.data["customer"] == imported_customer_record.id


def test_export_agent_dependencies_preserve_system_knowledge_base_reference(db_session):
    _seed_resources(db_session)
    now = datetime.now(UTC).isoformat()
    db_session.add(KnowledgeBaseTable(
        id="kb-system",
        owner_user_id=None,
        name="System manual",
        description="Shared manual",
        files=[],
        import_status="ready",
        created_at=now,
        updated_at=now,
    ))
    agent = db_session.get(AgentProfileTable, "agent-source")
    agent.knowledge_base_ids = ["kb-source", "kb-system"]
    db_session.commit()

    raw, warnings = build_export_bundle(
        db_session,
        BundleExportRequest(
            selection=BundleSelection(agents=["agent-source"]),
            options=BundleExportOptions(includeDependencies=True),
        ),
        "owner",
    )

    assert warnings == []
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        manifest = json.loads(archive.read("manifest.json"))
        assert manifest["resources"]["knowledgeBases"] == ["kb-source"]
        assert "knowledge-bases/kb-system.json" not in archive.namelist()
        exported_agent = json.loads(archive.read("agents/agent-source.json"))
        assert exported_agent["knowledgeBaseIds"] == ["kb-source", "kb-system"]

    inspection, entry = inspect_bundle(db_session, raw, "receiver", "inspection-system-kb")
    assert inspection.missingDependencies == []

    response, _ = execute_import(
        db_session,
        entry,
        BundleImportRequest(inspectionId="inspection-system-kb"),
        "receiver",
    )
    imported_agent = db_session.get(AgentProfileTable, response.resources["agents"][0])
    assert imported_agent.knowledge_base_ids == [
        response.resourceIdMap["knowledgeBaseIds"]["kb-source"],
        "kb-system",
    ]


def test_inspection_reports_missing_dependencies_and_conflicts(db_session):
    _seed_resources(db_session)
    raw, _ = build_export_bundle(
        db_session,
        BundleExportRequest(
            selection=BundleSelection(agents=["agent-source"]),
            options=BundleExportOptions(includeDependencies=False),
        ),
        "owner",
    )
    inspection, _ = inspect_bundle(db_session, raw, "owner", "inspection-test")

    assert inspection.conflicts[0].sourceId == "agent-source"
    missing_types = {item.resourceType for item in inspection.missingDependencies}
    assert missing_types == {"skills", "knowledgeBases", "mcpServers", "forms"}


def test_skip_conflict_reuses_existing_dependency(db_session):
    _seed_resources(db_session)
    raw, _ = build_export_bundle(
        db_session,
        BundleExportRequest(
            selection=BundleSelection(
                agents=["agent-source"],
                skills=["skill-source"],
            ),
            options=BundleExportOptions(includeDependencies=False),
        ),
        "owner",
    )
    inspection, entry = inspect_bundle(db_session, raw, "owner", "inspection-test")
    assert len(inspection.conflicts) == 2
    response, _ = execute_import(
        db_session,
        entry,
        BundleImportRequest(
            inspectionId="inspection-test",
            conflictPolicy="skip",
        ),
        "owner",
    )
    assert response.resources["agents"] == []
    assert response.resourceIdMap["skillIds"]["skill-source"] == "skill-source"


def test_rejects_zip_path_traversal(db_session):
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        archive.writestr("../manifest.json", "{}")

    with pytest.raises(HTTPException, match="Unsafe path"):
        inspect_bundle(db_session, output.getvalue(), "owner", "inspection-test")


def test_full_knowledge_export_creates_reindex_job(db_session, tmp_path, monkeypatch):
    _seed_resources(db_session)
    monkeypatch.setattr("src.config_bundle.storage.DOCUMENT_ROOT", tmp_path)
    save_document("kb-source", "manual.md", b"# Manual\nOriginal content.")
    raw, warnings = build_export_bundle(
        db_session,
        BundleExportRequest(
            selection=BundleSelection(knowledgeBases=["kb-source"]),
            options=BundleExportOptions(includeKnowledgeDocuments=True),
        ),
        "owner",
    )
    assert warnings == []

    inspection, entry = inspect_bundle(
        db_session, raw, "receiver", "inspection-docs"
    )
    assert inspection.knowledgeDocuments == 1
    assert inspection.knowledgeDocumentBytes == 26

    response, jobs = execute_import(
        db_session,
        entry,
        BundleImportRequest(inspectionId="inspection-docs"),
        "receiver",
    )
    assert len(response.jobs) == 1
    assert len(jobs) == 1
    imported_kb = db_session.get(
        KnowledgeBaseTable, response.resources["knowledgeBases"][0]
    )
    assert imported_kb.import_status == "importing"
    assert imported_kb.files[0]["name"] == "manual.md"
