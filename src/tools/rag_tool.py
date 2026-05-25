"""LanceDB hybrid search RAG tool for generic agent.

Each agent gets its own LanceDB table named after its agent_id.
Hybrid search = vector similarity + full-text (BM25) with reranking.
"""
import logging
import os
from pathlib import Path

import lancedb
from langchain_core.tools import BaseTool, tool
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

LANCEDB_PATH = os.getenv("LANCEDB_PATH", "/tmp/lancedb_agents")

# 向量维度：text-embedding-v4 默认 1024，v3 为 2048，v2/ada-002 为 1536
# 可通过环境变量 EMBEDDING_DIM 覆盖
_embed_model = os.getenv("OPENAI_EMBEDDING_MODEL", "text-embedding-v4")
if "v4" in _embed_model:
    _default_dim = 1024
elif "v3" in _embed_model:
    _default_dim = 2048
else:
    _default_dim = 1536
EMBEDDING_DIM = int(os.getenv("EMBEDDING_DIM", str(_default_dim)))


# ---------------------------------------------------------------------------
# Embeddings helper
# ---------------------------------------------------------------------------

def _get_embeddings():
    """Return a LangChain embeddings instance using the configured OpenAI endpoint.

    Notes for DashScope (Alibaba Cloud) compatible mode:
    - ``check_embedding_ctx_length=False``: tiktoken 无法识别非 OpenAI 模型名（如
      text-embedding-v4），会抛异常或错误截断文本，故禁用。
    - ``tiktoken_enabled=False``: 同上，进一步确保不调用 tiktoken。
    - 不传 ``encoding_format``（即不设置 base64）：DashScope compatible API 不支持
      base64 encoding_format，否则 input.contents 会被错误解析，触发 400 错误。
    - ``chunk_size=128``: 限制单次批量大小，降低超长请求概率。
    """
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
        # 禁用 tiktoken 检查：DashScope 模型名不在 tiktoken 预置列表
        check_embedding_ctx_length=False,
        # 不使用 base64 编码传输：DashScope compatible mode 不支持
        # （langchain-openai>=0.3 默认开启 base64，会导致 contents 格式错误）
        tiktoken_enabled=False,
        # 限制每批次文本数量，避免超大请求
        chunk_size=128,
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


def _clean_text(t: object) -> str | None:
    """Clean a text chunk for embedding.

    Returns None if the chunk should be discarded (empty, non-string, etc.).
    """
    if not isinstance(t, str):
        return None
    # 移除 null bytes 及其他非法控制字符，避免 embedding API 报 400
    import re
    cleaned = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", t)
    return cleaned if cleaned.strip() else None


def ingest_documents(agent_id: str, texts: list[str], sources: list[str] | None = None) -> int:
    """Embed and store document chunks into the agent's LanceDB table.

    Returns the number of chunks ingested.
    """
    if not texts:
        return 0

    # 过滤掉 None / 空白字符串 / 含非法字符的 chunk，避免 embedding API 报 400
    # （contents is neither str nor list of str）
    cleaned_texts: list[str] = []
    cleaned_sources: list[str] = []
    src_list = sources if sources else [None] * len(texts)  # type: ignore[list-item]
    for raw_t, raw_s in zip(texts, src_list):
        c = _clean_text(raw_t)
        if c is not None:
            cleaned_texts.append(c)
            cleaned_sources.append(str(raw_s) if raw_s is not None else "unknown")

    if not cleaned_texts:
        logger.warning("ingest_documents: all chunks were empty after filtering, nothing to ingest")
        return 0

    texts = cleaned_texts
    sources = cleaned_sources

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

def delete_documents(agent_id: str, source: str):
    """Delete document chunks from the agent's LanceDB table by source (filename)."""
    try:
        db = _get_db()
        tname = _table_name(agent_id)
        if tname in db.table_names():
            table = db.open_table(tname)
            # Escape single quotes in source to prevent SQL injection issues in LanceDB delete
            safe_source = source.replace("'", "''")
            table.delete(f"source = '{safe_source}'")
            logger.info(f"Deleted chunks for source '{source}' from LanceDB table '{tname}'")
    except Exception as e:
        logger.error(f"Failed to delete chunks for source '{source}' in table '{_table_name(agent_id)}': {e}")


def search_rag(query: str, agent_id: str, top_k: int = 5) -> str:
    """Hybrid search: vector similarity over multiple LanceDB tables.

    This is a **synchronous** function — always call it inside
    ``asyncio.to_thread(search_rag, ...)`` from async contexts to avoid
    blocking the event loop (LanceDB uses ``os.mkdir`` / file I/O internally).

    Searches both the agent's exclusive table (rag_{agent_id}) and any linked
    knowledge bases (rag_{kb_id}) configured in the PostgreSQL agent profile.
    """
    try:
        db = _get_db()
        embedder = _get_embeddings()
        query_vec = embedder.embed_query(query)

        # Determine all target tables to search
        tables_to_search = []

        # 1. Exclusive agent RAG table
        agent_table_name = _table_name(agent_id)
        if agent_table_name in db.table_names():
            tables_to_search.append((agent_table_name, "Exclusive RAG"))

        # 2. Linked knowledge bases from PostgreSQL
        try:
            from src.utils.db import AgentProfileTable, SessionLocal
            session = SessionLocal()
            agent_profile = session.query(AgentProfileTable).filter(AgentProfileTable.id == agent_id).first()
            if agent_profile and agent_profile.knowledge_base_ids:
                kb_ids = agent_profile.knowledge_base_ids or []
                for kb_id in kb_ids:
                    kb_table_name = _table_name(kb_id)
                    if kb_table_name in db.table_names():
                        tables_to_search.append((kb_table_name, f"KB: {kb_id}"))
            session.close()
        except Exception as db_err:
            logger.error(f"Failed to fetch linked KBs from PostgreSQL for {agent_id}: {db_err}")

        if not tables_to_search:
            return "No documents in the knowledge base yet. Upload files to add documents."

        # Perform query on all identified tables and aggregate
        all_results = []
        for tname, source_desc in tables_to_search:
            try:
                table = db.open_table(tname)
                if table.count_rows() == 0:
                    continue

                results = (
                    table.search(query_vec, vector_column_name="vector")
                    .limit(top_k)
                    .to_list()
                )
                for r in results:
                    dist = r.get("_distance", 1.0)
                    all_results.append({
                        "source": r.get("source", "unknown"),
                        "text": r.get("text", ""),
                        "distance": dist,
                        "origin": source_desc
                    })
            except Exception as table_err:
                logger.error(f"Search failed for table {tname}: {table_err}")

        if not all_results:
            return "No relevant documents found."

        # Sort by distance ascending (nearest vectors first)
        all_results.sort(key=lambda x: x["distance"])

        # Take the top_k
        top_results = all_results[:top_k]

        parts = []
        for r in top_results:
            parts.append(f"[Source: {r['source']} ({r['origin']})]\n{r['text']}")
        return "\n\n---\n\n".join(parts)

    except Exception as e:
        logger.error(f"RAG search failed for agent {agent_id}: {e}")
        return f"Knowledge base search failed: {e}"


async def async_search_rag(query: str, agent_id: str, top_k: int = 5) -> str:
    """Async wrapper around search_rag — safe to await directly in async handlers.

    Runs the blocking LanceDB + embedding calls inside a thread pool so the
    ASGI event loop is never blocked.
    """
    import asyncio
    return await asyncio.to_thread(search_rag, query, agent_id, top_k)



# ---------------------------------------------------------------------------
# Tool factory: returns a tool bound to a specific agent_id
# ---------------------------------------------------------------------------

def make_rag_tool(agent_id: str) -> BaseTool:
    """Return a LangChain tool for RAG search scoped to the given agent_id."""

    def _search(query: str) -> str:
        return search_rag(query, agent_id=agent_id)

    async def _asearch(query: str) -> str:
        return await async_search_rag(query, agent_id=agent_id)

    _search.__name__ = "rag_search"
    _search.__doc__ = (
        "Search the agent's private knowledge base for relevant information.\n\n"
        "Args:\n"
        "    query: Natural language search query.\n\n"
        "Returns:\n"
        "    Relevant document excerpts from the knowledge base."
    )
    _asearch.__name__ = "rag_search"
    _asearch.__doc__ = _search.__doc__

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

    Both ``_run`` and ``_arun`` are safe to call from async contexts:
    - ``_run``  → used when LangGraph calls the tool synchronously (rare)
    - ``_arun`` → wraps blocking I/O in ``asyncio.to_thread`` so the
                  ASGI event loop is never blocked
    """

    name: str = "rag_search"
    description: str = (
        "Search the agent's private knowledge base for relevant information. "
        "Use this to answer questions based on uploaded documents."
    )
    args_schema: type[BaseModel] = _RagInput

    def _get_agent_id(self, **kwargs) -> str:
        agent_id = "default"
        try:
            from langgraph.config import get_config
            cfg = get_config()
            agent_id = cfg.get("configurable", {}).get("agent_id", "default")
        except Exception:
            pass
        return agent_id

    def _run(self, query: str, **kwargs) -> str:
        return search_rag(query, agent_id=self._get_agent_id(**kwargs))

    async def _arun(self, query: str, **kwargs) -> str:
        """Non-blocking async entry point — delegates to thread pool."""
        import asyncio
        agent_id = self._get_agent_id(**kwargs)
        return await asyncio.to_thread(search_rag, query, agent_id)

