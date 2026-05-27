# LangSmith API proxy routes for FastAPI app
import asyncio
import logging
import os
from fastapi import APIRouter, HTTPException
from langsmith import Client as LangSmithClient
from typing import Optional

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/langsmith", tags=["langsmith"])

# Use custom env var name to avoid conflicts with LangGraph Cloud reserved names
# In LangGraph Cloud: set CHAT_LANGCHAIN_LANGSMITH_API_KEY instead of LANGSMITH_API_KEY
LANGSMITH_API_KEY = os.getenv("CHAT_LANGCHAIN_LANGSMITH_API_KEY") or os.getenv(
    "LANGSMITH_API_KEY"
)
LANGSMITH_BASE_URL = os.getenv("LANGSMITH_BASE_URL", "https://api.smith.langchain.com")

# Primary client (singleton)
_langsmith_client: Optional[LangSmithClient] = None


def get_langsmith_client() -> LangSmithClient:
    """Get or create primary LangSmith client instance (singleton)."""
    global _langsmith_client

    if _langsmith_client is None:
        try:
            if LANGSMITH_API_KEY:
                _langsmith_client = LangSmithClient(
                    api_key=LANGSMITH_API_KEY, api_url=LANGSMITH_BASE_URL
                )
            else:
                _langsmith_client = LangSmithClient(api_url=LANGSMITH_BASE_URL)
        except Exception as e:
            raise HTTPException(
                status_code=500, detail=f"Failed to initialize LangSmith client: {e}"
            )

    return _langsmith_client


@router.get("/runs/{runId}")
async def read_run(runId: str):
    """Read run details from LangSmith."""
    try:
        client = get_langsmith_client()
        run = await asyncio.to_thread(client.read_run, runId)
        return run
    except Exception as e:
        # Return 404 for not found, let CORS middleware handle headers
        if "not found" in str(e).lower() or "404" in str(e):
            raise HTTPException(
                status_code=404, detail="Run not found yet - may still be processing"
            )
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/runs/{runId}/share")
async def share_run(runId: str):
    """Create a public share URL for a LangSmith run."""
    try:
        client = get_langsmith_client()
        share_url = await asyncio.to_thread(client.share_run, runId)
        return {"shareUrl": share_url}
    except Exception as e:
        if "not found" in str(e).lower() or "404" in str(e):
            raise HTTPException(
                status_code=404,
                detail="Run not found yet - may still be processing",
            )
        raise HTTPException(status_code=500, detail=str(e))
