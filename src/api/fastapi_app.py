# FastAPI server for public Chat LangChain support endpoints
import logging
import os
import re
import string
from typing import Optional

from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from src.api.langsmith_routes import router as langsmith_router

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

DEFAULT_CORS_ORIGINS: list[str] = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3001",
    "https://smith.langchain.com",
    "https://chat.langchain.com",
    "https://support.langchain.com",
    "https://reference.langchain.com",
    "https://chat-lang-chain-v2.vercel.app",
    "https://chat-langchain-alpha.vercel.app",
    "https://public-chat-langchain-test.vercel.app",
    "https://public-chat-langchain-test-b5cwr3ocz-langchain.vercel.app",
]


def _get_cors_origins() -> list[str]:
    """Get CORS allowed origins from defaults plus environment overrides."""
    origins = DEFAULT_CORS_ORIGINS.copy()
    additional = os.getenv("ALLOWED_ORIGINS", "")
    if additional:
        origins.extend([o.strip() for o in additional.split(",") if o.strip()])
    return origins


app = FastAPI(
    title="Chat LangChain API Server",
    description="Public Chat LangChain support endpoints",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_get_cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(langsmith_router)


class TitleGenerationRequest(BaseModel):
    """Request model for title generation."""

    userMessage: str
    assistantResponse: Optional[str] = None
    maxLength: Optional[int] = 60


class TitleGenerationResponse(BaseModel):
    """Response model for title generation."""

    title: str


def truncate_title(message: str, max_length: int = 60) -> str:
    """Generate a deterministic fallback conversation title."""
    title = message.strip()
    title = re.sub(
        r"^(how do i|how to|can you|please|help me with|i need help with)\s+",
        "",
        title,
        flags=re.IGNORECASE,
    )
    title = title.rstrip(string.punctuation)
    if title:
        title = title[0].upper() + title[1:]
    if len(title) > max_length:
        title = title[: max_length - 3] + "..."
    return title


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy", "service": "chat-langchain"}


@app.post("/generate-title", response_model=TitleGenerationResponse)
async def generate_conversation_title(request: TitleGenerationRequest):
    """Generate a simple conversation title for the frontend."""
    return TitleGenerationResponse(
        title=truncate_title(request.userMessage, request.maxLength or 60)
    )



class AgentRAGStatusResponse(BaseModel):
    """RAG knowledge base status for an agent."""

    agent_id: str
    document_count: int


@app.post("/agents/{agent_id}/upload")
async def upload_document(
    agent_id: str,
    file: UploadFile = File(...),
    chunk_size: int = Form(default=1000),
    chunk_overlap: int = Form(default=200),
):
    """Upload a document to the agent's RAG knowledge base.

    Accepts plain text, markdown, and PDF files.
    Splits into chunks, embeds, and stores in LanceDB.
    """
    try:
        from langchain_community.document_loaders import PyPDFLoader
        from langchain_text_splitters import RecursiveCharacterTextSplitter
        import tempfile, pathlib

        content_type = file.content_type or ""
        raw = await file.read()

        if content_type == "application/pdf" or file.filename.lower().endswith(".pdf"):
            # Save to temp file and use PyPDFLoader
            with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
                tmp.write(raw)
                tmp_path = tmp.name
            try:
                loader = PyPDFLoader(tmp_path)
                docs = loader.load()
                full_text = "\n\n".join(d.page_content for d in docs)
            finally:
                pathlib.Path(tmp_path).unlink(missing_ok=True)
        else:
            # Treat as text / markdown
            full_text = raw.decode("utf-8", errors="replace")

        splitter = RecursiveCharacterTextSplitter(
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap,
        )
        chunks = splitter.split_text(full_text)
        if not chunks:
            raise HTTPException(status_code=400, detail="No content extracted from file.")

        from src.tools.rag_tool import ingest_documents
        n = ingest_documents(
            agent_id=agent_id,
            texts=chunks,
            sources=[file.filename or "upload"] * len(chunks),
        )
        return {"agent_id": agent_id, "chunks_ingested": n, "filename": file.filename}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"RAG upload failed for agent {agent_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/agents/{agent_id}/rag-status", response_model=AgentRAGStatusResponse)
async def rag_status(agent_id: str):
    """Return the number of documents in the agent's RAG knowledge base."""
    try:
        from src.tools.rag_tool import _get_db, _table_name
        db = _get_db()
        tname = _table_name(agent_id)
        if tname not in db.table_names():
            return AgentRAGStatusResponse(agent_id=agent_id, document_count=0)
        table = db.open_table(tname)
        return AgentRAGStatusResponse(agent_id=agent_id, document_count=table.count_rows())
    except Exception as e:
        logger.error(f"RAG status failed for agent {agent_id}: {e}")
        return AgentRAGStatusResponse(agent_id=agent_id, document_count=0)


@app.get("/")
async def root():
    """Root endpoint."""
    return {
        "message": "Chat LangChain API Server",
        "version": "1.0.0",
        "endpoints": {
            "health": "/health",
            "generate_title": "/generate-title",
            "langsmith": "/langsmith",
            "agent_upload": "/agents/{agent_id}/upload",
            "agent_rag_status": "/agents/{agent_id}/rag-status",
        },
    }
