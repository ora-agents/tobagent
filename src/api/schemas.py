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


class PasswordResetRequest(UserPasswordUpdateRequest):
    pass


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


class SiteTestimonialSchema(BaseModel):
    id: str
    authorName: str
    role: str | None = None
    company: str | None = None
    rating: int
    quote: str
    createdAt: str
    updatedAt: str
    isOwn: bool = False


class SiteTestimonialRequest(BaseModel):
    role: str | None = None
    company: str | None = None
    rating: int = Field(default=5, ge=1, le=5)
    quote: str = Field(min_length=10, max_length=800)

    @field_validator("role", "company")
    @classmethod
    def validate_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return value
        text = value.strip()
        if not text:
            return None
        if len(text) > 80:
            raise ValueError("Value must be at most 80 characters")
        return text

    @field_validator("quote")
    @classmethod
    def validate_quote(cls, value: str) -> str:
        text = value.strip()
        if len(text) < 10:
            raise ValueError("Quote must be at least 10 characters")
        return text


class AgentShareFaqItem(BaseModel):
    question: str = Field(min_length=1, max_length=160)
    answer: str = Field(min_length=1, max_length=800)

    @field_validator("question", "answer")
    @classmethod
    def validate_text(cls, value: str) -> str:
        text = value.strip()
        if not text:
            raise ValueError("FAQ text cannot be empty")
        return text


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
    customSlug: str | None = None
    priceCents: int = Field(default=0, ge=0)
    currency: Literal["CNY"] = "CNY"
    trialDurationMinutes: int = Field(default=0, ge=0, le=43200)
    introductionText: str | None = Field(default=None, max_length=1600)
    faqItems: list[AgentShareFaqItem] = Field(default_factory=list, max_length=12)

    @field_validator("customSlug")
    @classmethod
    def validate_custom_slug(cls, value: str | None) -> str | None:
        if value is None:
            return value
        slug = value.strip().lower()
        if not slug:
            return None
        if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{2,127}", slug):
            raise ValueError("customSlug must be 3-128 chars using lowercase letters, numbers, hyphen, or underscore")
        return slug

    @field_validator("introductionText")
    @classmethod
    def validate_introduction_text(cls, value: str | None) -> str | None:
        if value is None:
            return value
        text = value.strip()
        return text or None


class AgentShareLinkSchema(BaseModel):
    token: str
    agentProfileId: str
    include: AgentShareOptions
    customSlug: str | None = None
    priceCents: int = 0
    currency: str = "CNY"
    trialDurationMinutes: int = 0
    introductionText: str | None = None
    faqItems: list[AgentShareFaqItem] = Field(default_factory=list)
    createdAt: str
    updatedAt: str


class AgentSharePreview(BaseModel):
    token: str
    agent: "AgentProfileSchema"
    ownerUserId: str
    include: AgentShareOptions
    resources: dict[str, int]
    customSlug: str | None = None
    priceCents: int = 0
    currency: str = "CNY"
    isPaid: bool = False
    trialDurationMinutes: int = 0
    introductionText: str | None = None
    faqItems: list[AgentShareFaqItem] = Field(default_factory=list)
    createdAt: str


class AgentShareImportRequest(BaseModel):
    name: str | None = None


class AgentShareImportResponse(BaseModel):
    agent: "AgentProfileSchema"
    resourceIdMap: dict[str, dict[str, str]]
    warnings: list[str] = []


class AgentShareAccessResponse(BaseModel):
    token: str
    agentProfileId: str
    purchased: bool
    requiresPurchase: bool
    priceCents: int = 0
    currency: str = "CNY"
    trialDurationMinutes: int = 0
    trialActive: bool = False
    trialExpiresAt: str | None = None


class AgentSharePurchaseRequest(BaseModel):
    pass


class AgentSharePurchaseResponse(BaseModel):
    orderId: str
    outTradeNo: str
    status: str
    amountCents: int
    currency: str = "CNY"
    codeUrl: str | None = None
    paymentProvider: str = "wechat_native"
    paymentConfigured: bool = False


class PaymentOrderResponse(BaseModel):
    orderId: str
    outTradeNo: str
    status: str
    amountCents: int
    currency: str = "CNY"
    codeUrl: str | None = None
    paidAt: str | None = None


class WalletSummaryResponse(BaseModel):
    userId: str
    balanceCents: int
    currency: str = "CNY"
    entries: list[dict] = []


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
