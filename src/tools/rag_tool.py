"""LanceDB RAG tool for generic agent.

Each agent gets its own LanceDB table named after its agent_id.
Search = vector similarity with async-native LanceDB API (v0.14+).

设计原则
--------
- 所有 LanceDB / embedding 操作均使用 **async 原生 API**，不再需要
  ``asyncio.to_thread`` 包裹，彻底消除 ASGI 事件循环阻塞警告。
- 同步版本（``ingest_documents`` / ``search_rag``）保留为对
  ``asyncio.run_coroutine_threadsafe`` 的薄封装，供历史调用点使用。
- LangChain ``OpenAIEmbeddings`` 的 ``aembed_documents`` / ``aembed_query``
  同样是原生 async，无需额外包裹。
"""
import hashlib
import logging
import os
import re
from pathlib import Path

import lancedb
from langchain_core.tools import BaseTool, tool
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

LANCEDB_PATH = os.getenv("LANCEDB_PATH", "/tmp/lancedb_agents")

# 向量维度：text-embedding-v4 默认 1024，v3 为 2048，v2/ada-002 为 1536
# 可通过环境变量 EMBEDDING_DIM 覆盖
_embed_model_env = os.getenv("OPENAI_EMBEDDING_MODEL", "text-embedding-v4")
if "v4" in _embed_model_env:
    _default_dim = 1024
elif "v3" in _embed_model_env:
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
    - ``chunk_size=10``: DashScope text-embedding-v4 每次请求最多接受 10 条文本，超过会报
      "batch size is invalid, it should not be larger than 10"，故限制为 10。
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
        # DashScope text-embedding-v4 每批最多 10 条，超过会报 400 InvalidParameter
        chunk_size=10,
    )


# ---------------------------------------------------------------------------
# Async DB helpers
# ---------------------------------------------------------------------------

def _table_name(agent_id: str) -> str:
    safe = re.sub(r"[^A-Za-z0-9_.-]+", "_", agent_id).strip("_")
    if not safe:
        safe = hashlib.sha1(agent_id.encode("utf-8")).hexdigest()[:12]
    return f"rag_{safe}"


def _get_db():
    """Return a sync LanceDB connection for legacy call sites."""
    Path(LANCEDB_PATH).mkdir(parents=True, exist_ok=True)
    return lancedb.connect(LANCEDB_PATH)


async def _get_async_db() -> lancedb.AsyncConnection:
    """Return an async LanceDB connection.

    ``Path.mkdir`` is a synchronous ``os.mkdir`` call. Even inside an
    ``async def``, it still blocks the event loop, so we run it in a
    thread via ``asyncio.to_thread``.
    """
    import asyncio
    await asyncio.to_thread(Path(LANCEDB_PATH).mkdir, parents=True, exist_ok=True)
    return await lancedb.connect_async(LANCEDB_PATH)


async def get_or_create_table_async(agent_id: str) -> lancedb.AsyncTable:
    """Return an existing AsyncTable for the agent, or create a new one."""
    import pyarrow as pa

    db = await _get_async_db()
    tname = _table_name(agent_id)
    table_names = await db.table_names()
    if tname in table_names:
        return await db.open_table(tname)

    schema = pa.schema([
        pa.field("id", pa.utf8()),
        pa.field("text", pa.utf8()),
        pa.field("source", pa.utf8()),
        pa.field("vector", pa.list_(pa.float32(), EMBEDDING_DIM)),
    ])
    return await db.create_table(tname, schema=schema)


# ---------------------------------------------------------------------------
# Text cleaning
# ---------------------------------------------------------------------------

def _clean_text(t: object) -> str | None:
    """Sanitise a text chunk before embedding.

    Returns None when the chunk should be discarded (non-string, blank, or
    contains only control characters that would cause the embedding API to
    return HTTP 400).
    """
    if not isinstance(t, str):
        return None
    # 移除 null bytes 及其他非法控制字符，避免 embedding API 报 400
    cleaned = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", t)
    return cleaned if cleaned.strip() else None


# ---------------------------------------------------------------------------
# Async ingest
# ---------------------------------------------------------------------------

async def ingest_documents_async(
    agent_id: str,
    texts: list[str],
    sources: list[str] | None = None,
) -> int:
    """Async: embed and store document chunks into the agent's LanceDB table.

    Returns the number of chunks ingested.
    """
    if not texts:
        return 0

    # 过滤掉 None / 空白 / 含非法字符的 chunk
    cleaned_texts: list[str] = []
    cleaned_sources: list[str] = []
    src_list: list = sources if sources else [None] * len(texts)
    for raw_t, raw_s in zip(texts, src_list):
        c = _clean_text(raw_t)
        if c is not None:
            cleaned_texts.append(c)
            cleaned_sources.append(str(raw_s) if raw_s is not None else "unknown")

    if not cleaned_texts:
        logger.warning("ingest_documents_async: all chunks were empty after filtering, nothing to ingest")
        return 0

    embedder = _get_embeddings()
    # 使用原生 async embedding，不阻塞事件循环
    vectors = await embedder.aembed_documents(cleaned_texts)

    table = await get_or_create_table_async(agent_id)
    rows = []
    for i, (text, vec) in enumerate(zip(cleaned_texts, vectors)):
        source = cleaned_sources[i] if i < len(cleaned_sources) else f"doc_{i}"
        doc_id = hashlib.md5(text.encode()).hexdigest()
        rows.append({"id": doc_id, "text": text, "source": source, "vector": vec})

    await table.add(rows)
    logger.info(f"Ingested {len(rows)} chunks into table {_table_name(agent_id)}")
    return len(rows)


# Sync shim: kept for backward compatibility with older call sites
def ingest_documents(
    agent_id: str,
    texts: list[str],
    sources: list[str] | None = None,
) -> int:
    """Wrap ``ingest_documents_async`` for synchronous callers.

    Prefer calling ``ingest_documents_async`` directly from async code.
    This shim exists for backward compatibility only.
    """
    import asyncio
    return asyncio.run(ingest_documents_async(agent_id, texts, sources))


# ---------------------------------------------------------------------------
# Async delete
# ---------------------------------------------------------------------------

async def delete_documents_async(agent_id: str, source: str) -> None:
    """Async: delete document chunks from the agent's LanceDB table by source."""
    try:
        db = await _get_async_db()
        tname = _table_name(agent_id)
        table_names = await db.table_names()
        if tname not in table_names:
            return
        table = await db.open_table(tname)
        safe_source = source.replace("'", "''")
        await table.delete(f"source = '{safe_source}'")
        logger.info(f"Deleted chunks for source '{source}' from LanceDB table '{tname}'")
    except Exception as e:
        logger.error(f"Failed to delete chunks for source '{source}' in table '{_table_name(agent_id)}': {e}")


# Sync shim
def delete_documents(agent_id: str, source: str) -> None:
    """Wrap ``delete_documents_async`` for synchronous callers."""
    import asyncio
    asyncio.run(delete_documents_async(agent_id, source))


# ---------------------------------------------------------------------------
# Async search
# ---------------------------------------------------------------------------

async def search_rag_async(query: str, agent_id: str, top_k: int = 5) -> str:
    """Async: vector similarity search over all tables linked to agent_id.

    Searches both the agent's exclusive table (rag_{agent_id}) and any linked
    knowledge bases (rag_{kb_id}) configured in the PostgreSQL agent profile.
    """
    try:
        db = await _get_async_db()
        embedder = _get_embeddings()
        # 使用原生 async embedding
        query_vec = await embedder.aembed_query(query)

        table_names = await db.table_names()

        # Determine all target tables to search
        tables_to_search: list[tuple[str, str]] = []

        # 1. Exclusive agent RAG table
        agent_table_name = _table_name(agent_id)
        if agent_table_name in table_names:
            tables_to_search.append((agent_table_name, "Exclusive RAG"))

        # 2. Linked knowledge bases from PostgreSQL
        # SQLAlchemy 同步查询会阻塞事件循环，用 asyncio.to_thread 封装
        def _get_kb_ids() -> list[str]:
            try:
                from src.utils.db import AgentProfileTable, SessionLocal

                owner_user_id = ""
                try:
                    from langgraph.config import get_config

                    cfg = get_config()
                    owner_user_id = cfg.get("configurable", {}).get("user_id") or ""
                except Exception:
                    pass

                if not owner_user_id:
                    return []

                session = SessionLocal()
                agent_profile = session.query(AgentProfileTable).filter(
                    AgentProfileTable.id == agent_id,
                    AgentProfileTable.owner_user_id == owner_user_id,
                ).first()
                kb_ids = list(agent_profile.knowledge_base_ids or []) if agent_profile else []
                session.close()
                return kb_ids
            except Exception as _err:
                logger.error(f"Failed to fetch linked KBs from PostgreSQL for {agent_id}: {_err}")
                return []

        import asyncio as _asyncio
        kb_ids = await _asyncio.to_thread(_get_kb_ids)
        for kb_id in kb_ids:
            kb_tname = _table_name(kb_id)
            if kb_tname in table_names:
                tables_to_search.append((kb_tname, f"KB: {kb_id}"))


        if not tables_to_search:
            return "No documents in the knowledge base yet. Upload files to add documents."

        # Query all tables concurrently
        import asyncio

        async def _query_table(tname: str, source_desc: str) -> list[dict]:
            try:
                table = await db.open_table(tname)
                count = await table.count_rows()
                if count == 0:
                    return []
                results = await (
                    table.vector_search(query_vec)
                    .column("vector")
                    .limit(top_k)
                    .to_list()
                )
                return [
                    {
                        "source": r.get("source", "unknown"),
                        "text": r.get("text", ""),
                        "distance": r.get("_distance", 1.0),
                        "origin": source_desc,
                    }
                    for r in results
                ]
            except Exception as table_err:
                logger.error(f"Search failed for table {tname}: {table_err}")
                return []

        nested = await asyncio.gather(*[_query_table(t, d) for t, d in tables_to_search])
        all_results = [item for sub in nested for item in sub]

        if not all_results:
            return "No relevant documents found."

        all_results.sort(key=lambda x: x["distance"])
        top_results = all_results[:top_k]

        parts = [f"[Source: {r['source']} ({r['origin']})]\\n{r['text']}" for r in top_results]
        return "\\n\\n---\\n\\n".join(parts)

    except Exception as e:
        logger.error(f"RAG search failed for agent {agent_id}: {e}")
        return f"Knowledge base search failed: {e}"


# Sync shim: kept for backward compatibility
def search_rag(query: str, agent_id: str, top_k: int = 5) -> str:
    """Wrap ``search_rag_async`` for synchronous callers.

    Prefer ``search_rag_async`` from async code.
    """
    import asyncio
    return asyncio.run(search_rag_async(query, agent_id, top_k))


# ---------------------------------------------------------------------------
# Tool factory: returns a tool bound to a specific agent_id
# ---------------------------------------------------------------------------

def make_rag_tool(agent_id: str) -> BaseTool:
    """Return a LangChain tool for RAG search scoped to the given agent_id."""
    _doc = (
        "Search the agent's private knowledge base for relevant information.\n\n"
        "Args:\n"
        "    query: Natural language search query.\n\n"
        "Returns:\n"
        "    Relevant document excerpts from the knowledge base."
    )

    async def _asearch(query: str) -> str:
        return await search_rag_async(query, agent_id=agent_id)

    _asearch.__name__ = "rag_search"
    _asearch.__doc__ = _doc

    return tool(_asearch)


# ---------------------------------------------------------------------------
# Default RAG tool (agent_id read from ToolRuntime context at call time)
# ---------------------------------------------------------------------------

class _RagInput(BaseModel):
    query: str = Field(..., description="Natural language search query")


class RagSearchTool(BaseTool):
    """LanceDB RAG search tool — fully async native.

    When used with a generic agent that has ``context_schema``, the agent_id
    is read from the LangGraph runtime context. Falls back to ``'default'``.

    ``_arun`` uses the native async LanceDB + embedding API directly,
    so no ``asyncio.to_thread`` wrapping is needed.
    ``_run`` is kept only as a fallback for synchronous call sites.
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
        """Sync fallback — runs the async implementation in a new event loop."""
        import asyncio
        return asyncio.run(search_rag_async(query, agent_id=self._get_agent_id(**kwargs)))

    async def _arun(self, query: str, **kwargs) -> str:
        """Preferred entry point: fully async, no blocking calls."""
        return await search_rag_async(query, agent_id=self._get_agent_id(**kwargs))
