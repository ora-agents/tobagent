"""Persistent storage helpers for knowledge-base source documents."""

import hashlib
import os
import re
from pathlib import Path

DOCUMENT_ROOT = Path(
    os.getenv("KNOWLEDGE_DOCUMENTS_PATH", "/tmp/tobagent_knowledge_documents")
)


def _safe_component(value: str) -> str:
    safe = re.sub(r"[^A-Za-z0-9_.-]+", "_", value).strip("._")
    if not safe:
        raise ValueError("Invalid document path component")
    return safe


def document_path(kb_id: str, filename: str) -> Path:
    """Return a confined source-document path."""
    kb_dir = DOCUMENT_ROOT / _safe_component(kb_id)
    original_name = Path(filename).name
    suffix = Path(original_name).suffix[:20]
    stored_name = f"{hashlib.sha256(original_name.encode()).hexdigest()}{suffix}"
    path = kb_dir / stored_name
    if DOCUMENT_ROOT.resolve() not in path.resolve().parents:
        raise ValueError("Document path escapes storage root")
    return path


def save_document(kb_id: str, filename: str, raw: bytes) -> Path:
    """Persist source document bytes for later bundle export and reindex."""
    path = document_path(kb_id, filename)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(raw)
    return path


def delete_document(kb_id: str, filename: str) -> None:
    """Delete a persisted source document when present."""
    document_path(kb_id, filename).unlink(missing_ok=True)


def delete_knowledge_base_documents(kb_id: str) -> None:
    """Delete all persisted source documents for a knowledge base."""
    kb_dir = DOCUMENT_ROOT / _safe_component(kb_id)
    if not kb_dir.is_dir():
        return
    for path in kb_dir.iterdir():
        if path.is_file():
            path.unlink(missing_ok=True)
    kb_dir.rmdir()


def read_document(kb_id: str, filename: str) -> bytes | None:
    """Read a persisted source document when present."""
    path = document_path(kb_id, filename)
    return path.read_bytes() if path.is_file() else None
