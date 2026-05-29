"""Document loading helpers shared by API uploads and startup imports."""

from __future__ import annotations

import pathlib
import tempfile


def load_document_bytes(filename: str, content_type: str, raw: bytes) -> str:
    """Parse document bytes with LangChain loaders and return extracted text."""
    fname_lower = filename.lower()

    if content_type == "application/pdf" or fname_lower.endswith(".pdf"):
        suffix = ".pdf"
        from langchain_community.document_loaders import PyPDFLoader

        loader_cls = PyPDFLoader
        loader_kwargs = {}
    elif (
        content_type in (
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "application/msword",
        )
        or fname_lower.endswith(".docx")
        or fname_lower.endswith(".doc")
    ):
        suffix = ".docx"
        from langchain_community.document_loaders import Docx2txtLoader

        loader_cls = Docx2txtLoader
        loader_kwargs = {}
    elif fname_lower.endswith(".csv"):
        suffix = ".csv"
        from langchain_community.document_loaders import CSVLoader

        loader_cls = CSVLoader
        loader_kwargs = {}
    else:
        suffix = pathlib.Path(filename or "file.txt").suffix or ".txt"
        from langchain_community.document_loaders import TextLoader

        loader_cls = TextLoader
        loader_kwargs = {"encoding": "utf-8"}

    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(raw)
        tmp_path = tmp.name

    try:
        loader = loader_cls(tmp_path, **loader_kwargs)
        docs = loader.load()
        return "\n\n".join(d.page_content for d in docs)
    finally:
        pathlib.Path(tmp_path).unlink(missing_ok=True)
