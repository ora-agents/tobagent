"""Pydantic schemas for the FastAPI API surface."""
# ruff: noqa: D101

from pydantic import BaseModel, Field


class ClientProfileSchema(BaseModel):
    id: str
    label: str | None = None
    avatarColor: str | None = None


class UserRegisterRequest(BaseModel):
    username: str
    password: str
    email: str | None = None


class UserLoginRequest(BaseModel):
    username: str
    password: str


class UserUpdateRequest(BaseModel):
    model_config = {"populate_by_name": True}

    username: str | None = None
    email: str | None = None
    preferences: str | None = None
    safety_enabled: bool | None = Field(default=None, alias="safetyEnabled")


class UserResponse(BaseModel):
    id: str
    username: str
    email: str | None = None
    avatarColor: str | None = None
    preferences: str | None = None
    safetyEnabled: bool = False
    createdAt: str


class UserApiKeySchema(BaseModel):
    id: str
    name: str
    keyPrefix: str
    createdAt: str
    lastUsedAt: str | None = None


class CreateUserApiKeyRequest(BaseModel):
    name: str


class CreateUserApiKeyResponse(UserApiKeySchema):
    apiKey: str


class AgentShareOptions(BaseModel):
    """Optional linked resources to include in an agent share link."""

    knowledgeBases: bool = False
    skills: bool = False
    mcpServers: bool = False
    agents: bool = False


class AgentShareLinkRequest(BaseModel):
    include: AgentShareOptions = Field(default_factory=AgentShareOptions)


class AgentShareLinkSchema(BaseModel):
    token: str
    agentProfileId: str
    include: AgentShareOptions
    createdAt: str
    updatedAt: str


class AgentSharePreview(BaseModel):
    token: str
    agent: "AgentProfileSchema"
    include: AgentShareOptions
    resources: dict[str, int]
    createdAt: str


class AgentShareImportRequest(BaseModel):
    name: str | None = None


class AgentShareImportResponse(BaseModel):
    agent: "AgentProfileSchema"
    resourceIdMap: dict[str, dict[str, str]]
    warnings: list[str] = []



class AgentProfileSchema(BaseModel):
    id: str
    name: str
    description: str | None = None
    systemPrompt: str | None = None
    model: str | None = None
    enabledTools: list[str] = []
    knowledgeBaseIds: list[str] = []
    skillIds: list[str] = []
    mcpIds: list[str] = []
    agentIds: list[str] = []
    wakeWords: list[str] = []
    roleTemplateId: str | None = None
    personaStyle: str | None = None
    boundaryMode: str | None = None
    ttsVoice: str | None = None
    isHidden: bool = False
    voiceInterruptionEnabled: bool = True
    speakerVerificationEnabled: bool = False
    speakerVerificationBound: bool = False
    speakerSampleText: str | None = None
    speakerEnrolledAt: str | None = None
    userVoiceprintId: str | None = None
    createdAt: str
    updatedAt: str


class AgentProfileVersionSchema(BaseModel):
    id: str
    agentProfileId: str
    version: int
    snapshot: AgentProfileSchema
    createdAt: str


class McpServerSchema(BaseModel):
    id: str
    name: str
    type: str  # Always "streamable_http"; kept for API compatibility.
    url: str | None = None
    headers: dict[str, str] = {}
    createdAt: str
    updatedAt: str


class SkillSchema(BaseModel):
    id: str
    name: str
    description: str | None = None
    content: str
    createdAt: str
    updatedAt: str


class KBFileSchema(BaseModel):
    name: str
    size: int
    uploadedAt: str


class KnowledgeBaseSchema(BaseModel):
    id: str
    name: str
    description: str | None = None
    files: list[KBFileSchema] = []
    isSystem: bool = False
    createdAt: str
    updatedAt: str


class AgentRAGStatusResponse(BaseModel):
    """RAG knowledge base status for an agent."""

    agent_id: str
    document_count: int


class RobotPointRequest(BaseModel):
    model_config = {"populate_by_name": True}

    point_name: str = Field(alias="pointName")
    introduction: str
    x: float
    y: float
    z: float
    rotation: float
    position_json: dict = Field(alias="positionJson")
    robot_sn: str | None = Field(default=None, alias="robotSn")


class RobotPointResponse(BaseModel):
    model_config = {"populate_by_name": True}

    id: int
    point_name: str = Field(alias="pointName")
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")


class RobotPointListItem(BaseModel):
    model_config = {"populate_by_name": True}

    id: int
    point_name: str = Field(alias="pointName")
    introduction: str
    x: float
    y: float
    z: float
    rotation: float
    position_json: dict = Field(alias="positionJson")
    robot_sn: str | None = Field(default=None, alias="robotSn")


class RobotCommandResultRequest(BaseModel):
    model_config = {"populate_by_name": True}

    command_id: str = Field(alias="commandId")
    ok: bool
    message: str | None = None
    result: dict | None = None
    error: str | None = None
