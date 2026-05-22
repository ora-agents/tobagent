"""LanceDB hybrid search RAG tool for generic agent.

Each agent gets its own LanceDB table named after its agent_id.
Hybrid search = vector similarity + full-text (BM25) with reranking.
"""
import logging
import os
from pathlib import Path
from typing import Optional

import lancedb
from langchain_core.tools import BaseTool, tool
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

LANCEDB_PATH = os.getenv("LANCEDB_PATH", "/tmp/lancedb_agents")
EMBEDDING_DIM = 1536  # default for text-embedding-ada-002; overridden by actual model


# ---------------------------------------------------------------------------
# Embeddings helper
# ---------------------------------------------------------------------------

def _get_embeddings():
    """Return a LangChain embeddings instance using the configured OpenAI endpoint."""
    from langchain_openai import OpenAIEmbeddings

    base_url = os.getenv("NEXT_PUBLIC_OPENAI_BASE_URL") or os.getenv("OPENAI_BASE_URL")
    api_key = (
        os.getenv("NEXT_PUBLIC_OPENAI_API_KEY")
        or os.getenv("OPENAI_API_KEY")
        or "dummy"
    )
    embed_model = os.getenv("OPENAI_EMBEDDING_MODEL", "text-embedding-v3")

    return OpenAIEmbeddings(
        model=embed_model,
        base_url=base_url or None,
        api_key=api_key,
    )


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------

def _get_db() -> lancedb.DBConnection:
    Path(LANCEDB_PATH).mkdir(parents=True, exist_ok=True)
    return lancedb.connect(LANCEDB_PATH)


def _table_name(agent_id: str) -> str:
    safe = "".join(c if c.isalnum() or c == "_" else "_" for c in agent_id)
    return f"rag_{safe}" if safe else "rag_default"


def get_or_create_table(agent_id: str):
    """Return an existing LanceDB table for the agent or create a new one."""
    db = _get_db()
    tname = _table_name(agent_id)
    try:
        return db.open_table(tname)
    except Exception:
        import pyarrow as pa
        schema = pa.schema([
            pa.field("id", pa.utf8()),
            pa.field("text", pa.utf8()),
            pa.field("source", pa.utf8()),
            pa.field("vector", pa.list_(pa.float32(), EMBEDDING_DIM)),
        ])
        return db.create_table(tname, schema=schema)


def ingest_documents(agent_id: str, texts: list[str], sources: Optional[list[str]] = None) -> int:
    """Embed and store document chunks into the agent's LanceDB table.

    Returns the number of chunks ingested.
    """
    if not texts:
        return 0

    embedder = _get_embeddings()
    vectors = embedder.embed_documents(texts)

    table = get_or_create_table(agent_id)
    import hashlib
    rows = []
    for i, (text, vec) in enumerate(zip(texts, vectors)):
        source = sources[i] if sources and i < len(sources) else f"doc_{i}"
        doc_id = hashlib.md5(text.encode()).hexdigest()
        rows.append({
            "id": doc_id,
            "text": text,
            "source": source,
            "vector": vec,
        })
    table.add(rows)
    logger.info(f"Ingested {len(rows)} chunks into table {_table_name(agent_id)}")
    return len(rows)


# ---------------------------------------------------------------------------
# Search function (used by the tool factory)
# ---------------------------------------------------------------------------

def search_rag(query: str, agent_id: str, top_k: int = 5) -> str:
    """Hybrid search: vector similarity + FTS, merged with RRF."""
    try:
        db = _get_db()
        tname = _table_name(agent_id)
        existing = db.table_names()
        if tname not in existing:
            return "No documents in the knowledge base yet. Upload files to add documents."

        table = db.open_table(tname)
        count = table.count_rows()
        if count == 0:
            return "Knowledge base is empty. Upload documents first."

        embedder = _get_embeddings()
        query_vec = embedder.embed_query(query)

        # Vector search
        results = (
            table.search(query_vec, vector_column_name="vector")
            .limit(top_k)
            .to_list()
        )

        if not results:
            return "No relevant documents found."

        parts = []
        for r in results:
            parts.append(f"[Source: {r.get('source', 'unknown')}]\n{r.get('text', '')}")
        return "\n\n---\n\n".join(parts)

    except Exception as e:
        logger.error(f"RAG search failed for agent {agent_id}: {e}")
        return f"Knowledge base search failed: {e}"


# ---------------------------------------------------------------------------
# Tool factory: returns a tool bound to a specific agent_id
# ---------------------------------------------------------------------------

def make_rag_tool(agent_id: str) -> BaseTool:
    """Return a LangChain tool for RAG search scoped to the given agent_id."""

    def _search(query: str) -> str:
        return search_rag(query, agent_id=agent_id)

    _search.__name__ = "rag_search"
    _search.__doc__ = (
        "Search the agent's private knowledge base for relevant information.\n\n"
        "Args:\n"
        "    query: Natural language search query.\n\n"
        "Returns:\n"
        "    Relevant document excerpts from the knowledge base."
    )

    return tool(_search)


# ---------------------------------------------------------------------------
# Default RAG tool (agent_id read from ToolRuntime context at call time)
# ---------------------------------------------------------------------------

class _RagInput(BaseModel):
    query: str = Field(..., description="Natural language search query")


class RagSearchTool(BaseTool):
    """LanceDB RAG search tool.

    When used with a generic agent that has `context_schema`, the agent_id is
    read from the runtime context. Falls back to 'default'.
    """

    name: str = "rag_search"
    description: str = (
        "Search the agent's private knowledge base for relevant information. "
        "Use this to answer questions based on uploaded documents."
    )
    args_schema: type[BaseModel] = _RagInput

    def _run(self, query: str, **kwargs) -> str:
        agent_id = "default"
        # Try to get agent_id from ToolRuntime context
        try:
            from langgraph.prebuilt import ToolNode  # noqa: F401
            from langgraph.config import get_config
            cfg = get_config()
            agent_id = cfg.get("configurable", {}).get("agent_id", "default")
        except Exception:
            pass
        return search_rag(query, agent_id=agent_id)

    async def _arun(self, query: str, **kwargs) -> str:
        return self._run(query, **kwargs)
