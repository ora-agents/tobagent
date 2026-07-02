"""Pydantic schemas for the FastAPI API surface."""
# ruff: noqa: D101,D102,D103

import re
from typing import Literal

from pydantic import BaseModel, Field, field_validator

PHONE_PATTERN = r"^\+?\d{6,20}$"
SMS_CODE_PATTERN = r"^\d{4,8}$"


def _normalize_phone(value: str) -> str:
    return value.strip().replace(" ", "").replace("-", "")


class ClientProfileSchema(BaseModel):
    id: str
    label: str | None = None
    avatarColor: str | None = None


class UserRegisterRequest(BaseModel):
    username: str
    phone: str
    code: str
    password: str

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, value: str) -> str:
        phone = _normalize_phone(value)
        if not re.fullmatch(PHONE_PATTERN, phone):
            raise ValueError("Invalid phone number")
        return phone

    @field_validator("code")
    @classmethod
    def validate_code(cls, value: str | None) -> str | None:
        code = value.strip()
        if not re.fullmatch(SMS_CODE_PATTERN, code):
            raise ValueError("Invalid verification code")
        return code

    @field_validator("password")
    @classmethod
    def validate_password(cls, value: str) -> str:
        password = value.strip()
        if len(password) < 6:
            raise ValueError("Password must be at least 6 characters")
        return password


class UserLoginRequest(BaseModel):
    phone: str | None = None
    account: str | None = None
    password: str | None = None

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, value: str | None) -> str | None:
        if value is None:
            return value
        phone = _normalize_phone(value)
        if not re.fullmatch(PHONE_PATTERN, phone):
            raise ValueError("Invalid phone number")
        return phone

    @field_validator("account")
    @classmethod
    def validate_account(cls, value: str | None) -> str | None:
        if value is None:
            return value
        account = value.strip()
        if not account:
            raise ValueError("Invalid account")
        return account

    @field_validator("password")
    @classmethod
    def validate_password(cls, value: str | None) -> str | None:
        if value is None:
            return value
        password = value.strip()
        if not password:
            raise ValueError("Invalid password")
        return password


class SmsCodeRequest(BaseModel):
    phone: str
    purpose: Literal["register", "sensitive", "bind_phone", "reset_password"] = "register"

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, value: str) -> str:
        phone = _normalize_phone(value)
        if not re.fullmatch(PHONE_PATTERN, phone):
            raise ValueError("Invalid phone number")
        return phone


class SmsCodeResponse(BaseModel):
    ok: bool = True


class SmsCodeVerifyRequest(BaseModel):
    phone: str
    purpose: Literal["sensitive", "reset_password"] = "sensitive"
    code: str

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, value: str) -> str:
        phone = _normalize_phone(value)
        if not re.fullmatch(PHONE_PATTERN, phone):
            raise ValueError("Invalid phone number")
        return phone

    @field_validator("code")
    @classmethod
    def validate_code(cls, value: str) -> str:
        code = value.strip()
        if not re.fullmatch(SMS_CODE_PATTERN, code):
            raise ValueError("Invalid verification code")
        return code


class UserUpdateRequest(BaseModel):
    model_config = {"populate_by_name": True}

    username: str | None = None
    email: str | None = None
    preferences: str | None = None
    safety_enabled: bool | None = Field(default=None, alias="safetyEnabled")


class UserResponse(BaseModel):
    id: str
    username: str
    phone: str | None = None
    email: str | None = None
    avatarColor: str | None = None
    preferences: str | None = None
    safetyEnabled: bool = False
    createdAt: str


class AuthSessionResponse(UserResponse):
    sessionToken: str | None = None


class UserBindPhoneRequest(BaseModel):
    phone: str
    code: str

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, value: str) -> str:
        phone = _normalize_phone(value)
        if not re.fullmatch(PHONE_PATTERN, phone):
            raise ValueError("Invalid phone number")
        return phone

    @field_validator("code")
    @classmethod
    def validate_code(cls, value: str) -> str:
        code = value.strip()
        if not re.fullmatch(SMS_CODE_PATTERN, code):
            raise ValueError("Invalid verification code")
        return code


class UserPasswordUpdateRequest(BaseModel):
    phone: str
    code: str
    password: str

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, value: str) -> str:
        phone = _normalize_phone(value)
        if not re.fullmatch(PHONE_PATTERN, phone):
            raise ValueError("Invalid phone number")
        return phone

    @field_validator("code")
    @classmethod
    def validate_code(cls, value: str) -> str:
        code = value.strip()
        if not re.fullmatch(SMS_CODE_PATTERN, code):
            raise ValueError("Invalid verification code")
        return code

    @field_validator("password")
    @classmethod
    def validate_password(cls, value: str) -> str:
        password = value.strip()
        if len(password) < 6:
            raise ValueError("Password must be at least 6 characters")
        return password


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


WorkspaceRole = Literal["owner", "admin", "member"]
WorkspaceChangeStatus = Literal["pending", "approved", "rejected", "applied"]
WorkspaceChangeAction = Literal["create", "update", "delete"]
WorkspaceTargetType = Literal[
    "workspace",
    "agent_profile",
    "skill",
    "knowledge_base",
    "mcp_server",
    "form",
    "form_record",
    "workspace_member",
]


class WorkspaceMemberSchema(BaseModel):
    userId: str
    username: str | None = None
    role: WorkspaceRole
    status: str = "active"
    createdAt: str
    updatedAt: str


class WorkspaceSchema(BaseModel):
    id: str
    name: str
    ownerUserId: str
    currentUserRole: WorkspaceRole
    createdAt: str
    updatedAt: str


class WorkspaceCreateRequest(BaseModel):
    name: str


class WorkspaceUpdateRequest(BaseModel):
    name: str


class WorkspaceMemberUpsertRequest(BaseModel):
    userId: str | None = None
    username: str | None = None
    role: Literal["admin", "member"] = "member"


class WorkspaceMemberRoleUpdateRequest(BaseModel):
    role: Literal["admin", "member"]


class WorkspaceChangeRequestCreate(BaseModel):
    targetType: WorkspaceTargetType
    targetId: str | None = None
    action: WorkspaceChangeAction
    payload: dict = Field(default_factory=dict)


class WorkspaceChangeRequestReview(BaseModel):
    note: str | None = None


class WorkspaceChangeRequestSchema(BaseModel):
    id: str
    workspaceId: str
    requesterUserId: str
    requesterUsername: str | None = None
    targetType: WorkspaceTargetType
    targetId: str | None = None
    action: WorkspaceChangeAction
    payload: dict = Field(default_factory=dict)
    status: WorkspaceChangeStatus
    reviewerUserId: str | None = None
    reviewNote: str | None = None
    createdAt: str
    reviewedAt: str | None = None


class AgentShareOptions(BaseModel):
    """Optional linked resources to include in an agent share link."""

    knowledgeBases: bool = False
    skills: bool = False
    mcpServers: bool = False
    agents: bool = False
    forms: bool = False


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
    ownerUserId: str
    include: AgentShareOptions
    resources: dict[str, int]
    createdAt: str


class AgentShareImportRequest(BaseModel):
    name: str | None = None


class AgentShareImportResponse(BaseModel):
    agent: "AgentProfileSchema"
    resourceIdMap: dict[str, dict[str, str]]
    warnings: list[str] = []


class AgentConfigTomlImportRequest(BaseModel):
    toml: str


class AgentConfigTomlImportResponse(BaseModel):
    agents: list["AgentProfileSchema"]
    resourceIdMap: dict[str, dict[str, str]]
    warnings: list[str] = []


class AgentProfileSchema(BaseModel):
    id: str
    ownerUserId: str | None = None
    name: str
    description: str | None = None
    systemPrompt: str | None = None
    model: str | None = None
    modelTemperature: float | None = Field(default=None, ge=0, le=2)
    graphId: str | None = None
    enabledTools: list[str] = []
    knowledgeBaseIds: list[str] = []
    skillIds: list[str] = []
    skillCategoryIds: list[str] = []
    mcpIds: list[str] = []
    agentIds: list[str] = []
    formIds: list[str] = []
    formCategoryIds: list[str] = []
    formPermissions: dict[
        str,
        list[Literal["create", "read", "update", "delete"]],
    ] = {}
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
    headers: dict[str, str] = Field(default_factory=dict)
    tools: list[dict] = Field(default_factory=list)
    resources: list[dict] = Field(default_factory=list)
    prompts: list[dict] = Field(default_factory=list)
    createdAt: str
    updatedAt: str


class FormFieldSchema(BaseModel):
    id: str
    label: str
    type: str = "text"
    required: bool = False
    options: list[str] = Field(default_factory=list)


class FormHookConditionSchema(BaseModel):
    fieldId: str
    matchType: Literal["regex", "value", "empty", "not_empty"] = "regex"
    pattern: str = ""
    value: str = ""


class FormHookSchema(BaseModel):
    id: str
    name: str = ""
    enabled: bool = True
    conditions: list[FormHookConditionSchema] = Field(default_factory=list)
    conditionLogic: Literal["all", "any"] = "all"
    fieldId: str | None = None
    matchType: Literal["regex", "value"] = "regex"
    pattern: str = ""
    value: str = ""
    url: str
    method: Literal["POST", "PUT", "PATCH"] = "POST"
    headers: dict[str, str] = Field(default_factory=dict)
    payloadFieldIds: list[str] = Field(default_factory=list)


class FormSchema(BaseModel):
    id: str
    name: str
    description: str | None = None
    category: str = ""
    fields: list[FormFieldSchema] = Field(default_factory=list)
    hooks: list[FormHookSchema] = Field(default_factory=list)
    recordCount: int = 0
    createdAt: str
    updatedAt: str


class FormRecordSchema(BaseModel):
    id: str
    formId: str
    data: dict = Field(default_factory=dict)
    createdAt: str
    updatedAt: str


class FormRecordWriteSchema(BaseModel):
    id: str | None = None
    data: dict = Field(default_factory=dict)
    createdAt: str | None = None
    updatedAt: str | None = None


class FormRecordListResponse(BaseModel):
    records: list[FormRecordSchema]
    total: int
    page: int
    pageSize: int


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
    importStatus: str = "ready"
    importError: str | None = None
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
