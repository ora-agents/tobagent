"""Runtime feature capability flags exposed to web clients."""

from fastapi import APIRouter
from pydantic import BaseModel

from src.api.sms_verification import aliyun_sms_is_configured
from src.utils.langfuse_tracing import langfuse_is_configured

router = APIRouter(prefix="/api/capabilities", tags=["system"])


class RuntimeCapabilities(BaseModel):
    """Feature flags derived from backend environment configuration."""

    smsAuth: bool
    langfuseTracing: bool


@router.get("", response_model=RuntimeCapabilities)
async def get_runtime_capabilities() -> RuntimeCapabilities:
    """Return modules that are enabled for the current backend env."""
    return RuntimeCapabilities(
        smsAuth=aliyun_sms_is_configured(),
        langfuseTracing=langfuse_is_configured(),
    )
