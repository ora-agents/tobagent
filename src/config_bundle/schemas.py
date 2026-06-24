"""Schemas for configuration bundle APIs."""
# ruff: noqa: D101

from typing import Literal

from pydantic import BaseModel, Field

RESOURCE_KEYS = (
    "agents",
    "skills",
    "knowledgeBases",
    "mcpServers",
    "forms",
)


class BundleSelection(BaseModel):
    agents: list[str] = Field(default_factory=list)
    skills: list[str] = Field(default_factory=list)
    knowledgeBases: list[str] = Field(default_factory=list)
    mcpServers: list[str] = Field(default_factory=list)
    forms: list[str] = Field(default_factory=list)


class BundleExportOptions(BaseModel):
    includeDependencies: bool = True
    includeKnowledgeDocuments: bool = False
    includeFormRecords: bool = True


class BundleExportRequest(BaseModel):
    selection: BundleSelection = Field(default_factory=BundleSelection)
    options: BundleExportOptions = Field(default_factory=BundleExportOptions)


class BundleConflict(BaseModel):
    resourceType: str
    sourceId: str
    sourceName: str
    existingId: str
    reason: Literal["id", "name"]


class BundleMissingDependency(BaseModel):
    agentId: str
    resourceType: str
    resourceId: str


class BundleInspectionResponse(BaseModel):
    inspectionId: str
    formatVersion: int
    exportedAt: str
    resources: dict[str, int]
    availableResources: dict[str, list[str]]
    conflicts: list[BundleConflict]
    missingDependencies: list[BundleMissingDependency]
    warnings: list[str]
    redactedMcpFields: list[str]
    voiceprintsRequireRebinding: list[str]
    knowledgeDocuments: int = 0
    knowledgeDocumentBytes: int = 0


class BundleImportRequest(BaseModel):
    inspectionId: str
    selection: BundleSelection | None = None
    conflictPolicy: Literal["copy", "overwrite", "skip"] = "copy"


class BundleImportResponse(BaseModel):
    resources: dict[str, list[str]]
    resourceIdMap: dict[str, dict[str, str]]
    warnings: list[str]
    jobs: list[str]


class BundleJobResponse(BaseModel):
    id: str
    status: Literal["pending", "running", "ready", "failed"]
    resourceType: str
    resourceId: str
    processedDocuments: int = 0
    totalDocuments: int = 0
    error: str | None = None
