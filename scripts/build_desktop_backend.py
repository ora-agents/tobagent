"""Build the desktop backend with Nuitka."""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DIST_DIR = ROOT / "desktop" / "dist"
BACKEND_DIST_DIR = DIST_DIR / "backend_entry.dist"
BIN_DIR = DIST_DIR / "bin"
RESOURCE_DIR = DIST_DIR / "resources"
DESKTOP_CONFIG = DIST_DIR / "langgraph.desktop.json"


def _write_desktop_config() -> Path:
    source = ROOT / "langgraph.json"
    if not source.exists():
        raise FileNotFoundError(f"LangGraph config was not found: {source}")

    config = json.loads(source.read_text(encoding="utf-8"))
    config["graphs"] = {
        "generic_agent": "src.agent.generic_agent:generic_agent",
        "agent_builder": "src.agent.agent_builder:agent_builder",
    }
    if isinstance(config.get("auth"), dict):
        config["auth"]["path"] = "src.api.auth:auth"
    if isinstance(config.get("http"), dict):
        config["http"]["app"] = "src.api.server:app"

    DESKTOP_CONFIG.parent.mkdir(parents=True, exist_ok=True)
    DESKTOP_CONFIG.write_text(
        json.dumps(config, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    return DESKTOP_CONFIG


def _include_data_args(config_path: Path) -> list[str]:
    return [f"--include-data-files={config_path}=langgraph.json"]


def _copy_backend_distribution() -> None:
    if BIN_DIR.exists():
        shutil.rmtree(BIN_DIR)
    source_name = "tobagent-backend.exe" if sys.platform == "win32" else "tobagent-backend"
    source = BACKEND_DIST_DIR / source_name
    if not source.exists():
        raise FileNotFoundError(f"Nuitka output binary was not found: {source}")
    shutil.copytree(BACKEND_DIST_DIR, BIN_DIR)


def _copy_optional_resources() -> None:
    if RESOURCE_DIR.exists():
        shutil.rmtree(RESOURCE_DIR)
    RESOURCE_DIR.mkdir(parents=True, exist_ok=True)

    if DESKTOP_CONFIG.exists():
        shutil.copy2(DESKTOP_CONFIG, RESOURCE_DIR / "langgraph.json")

    for name in ("assets", "models"):
        source = ROOT / name
        if source.exists():
            shutil.copytree(source, RESOURCE_DIR / name)


def main() -> None:
    """Run Nuitka and prepare Tauri resource directories."""
    config_path = _write_desktop_config()
    command = [
        sys.executable,
        "-m",
        "nuitka",
        "--standalone",
        "--assume-yes-for-downloads",
        f"--output-dir={DIST_DIR}",
        "--output-filename=tobagent-backend",
        "--include-package=aegra_api",
        "--include-package=langgraph",
        "--include-package=langgraph.checkpoint.sqlite",
        "--include-package=langgraph.store.sqlite",
        "--include-package=src.agent",
        "--include-package=src.api",
        "--include-package=src.config_bundle",
        "--include-package=src.middleware",
        "--include-package=src.prompts",
        "--include-package=src.tools",
        "--include-package=src.utils",
        *_include_data_args(config_path),
        str(ROOT / "desktop" / "backend_entry.py"),
    ]
    subprocess.run(command, cwd=ROOT, check=True)
    _copy_backend_distribution()
    _copy_optional_resources()


if __name__ == "__main__":
    main()
