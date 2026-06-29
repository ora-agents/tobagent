"""Desktop entrypoint for the local TOB Agent API."""

from __future__ import annotations

import argparse
import os
import platform
import sys
from pathlib import Path

APP_NAME = "TOB Agent"


def _default_data_dir() -> Path:
    override = os.getenv("TOB_DESKTOP_DATA_DIR")
    if override:
        return Path(override).expanduser()

    home = Path.home()
    system = platform.system()
    if system == "Windows":
        base = os.getenv("APPDATA")
        return Path(base) / APP_NAME if base else home / "AppData" / "Roaming" / APP_NAME
    if system == "Darwin":
        return home / "Library" / "Application Support" / APP_NAME
    return home / ".local" / "share" / "tob-agent"


def _resource_dir() -> Path:
    override = os.getenv("TOB_DESKTOP_RESOURCE_DIR")
    if override:
        return Path(override).expanduser()

    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent

    return Path(__file__).resolve().parents[1]


def _prepend_origins(existing: str, origins: list[str]) -> str:
    values = [item.strip() for item in existing.split(",") if item.strip()]
    for origin in reversed(origins):
        if origin not in values:
            values.insert(0, origin)
    return ",".join(values)


def configure_desktop_environment(host: str, port: int) -> None:
    """Set desktop-safe defaults before importing the FastAPI app."""
    data_dir = _default_data_dir()
    resource_dir = _resource_dir()
    data_dir.mkdir(parents=True, exist_ok=True)

    logs_dir = data_dir / "logs"
    logs_dir.mkdir(parents=True, exist_ok=True)

    db_path = (data_dir / "chat_langchain.db").resolve()

    os.environ.setdefault("TOB_DESKTOP", "1")
    os.environ.setdefault("DATABASE_URL", f"sqlite:///{db_path.as_posix()}")
    os.environ.setdefault("LANCEDB_PATH", str(data_dir / "lancedb"))
    os.environ.setdefault("VOICE_AUDIO_LOG_DIR", str(logs_dir / "voice_audio"))
    os.environ.setdefault("TOB_AGENT_DEBUG_LOG_FILE", str(logs_dir / "debug.jsonl"))

    assets_dir = resource_dir / "assets"
    if assets_dir.exists():
        os.environ.setdefault("TOB_ASSETS_DIR", str(assets_dir))

    bundled_models_dir = resource_dir / "models"
    models_dir = bundled_models_dir if bundled_models_dir.exists() else data_dir / "models"
    os.environ.setdefault("KWS_MODEL_DIR", str(models_dir / "kws"))

    vad_model = models_dir / "vad" / "ten-vad.onnx"
    os.environ.setdefault("VOICE_TEN_VAD_MODEL_PATH", str(vad_model))
    os.environ.setdefault("VOICE_TEN_VAD_DATA_PATH", str(vad_model))

    origins = [
        "http://tauri.localhost",
        "https://tauri.localhost",
        "tauri://localhost",
        f"http://{host}:{port}",
        f"http://127.0.0.1:{port}",
        f"http://localhost:{port}",
    ]
    os.environ["ALLOWED_ORIGINS"] = _prepend_origins(
        os.getenv("ALLOWED_ORIGINS", ""),
        origins,
    )
    os.environ["CORS_ALLOW_ORIGINS"] = _prepend_origins(
        os.getenv("CORS_ALLOW_ORIGINS", ""),
        origins,
    )


def main() -> None:
    """Run the desktop API server."""
    parser = argparse.ArgumentParser(description="Run the TOB Agent desktop API.")
    parser.add_argument("--host", default=os.getenv("TOB_BACKEND_HOST", "127.0.0.1"))
    parser.add_argument(
        "--port",
        type=int,
        default=int(os.getenv("TOB_BACKEND_PORT", "2025")),
    )
    args = parser.parse_args()

    configure_desktop_environment(args.host, args.port)

    import uvicorn

    uvicorn.run(
        "src.api.fastapi_app:app",
        host=args.host,
        port=args.port,
        log_level=os.getenv("TOB_BACKEND_LOG_LEVEL", "info"),
        access_log=os.getenv("TOB_BACKEND_ACCESS_LOG", "false").lower()
        in {"1", "true", "yes", "on"},
    )


if __name__ == "__main__":
    main()
