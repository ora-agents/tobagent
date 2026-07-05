"""Build the desktop backend with Nuitka."""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DIST_DIR = ROOT / "desktop" / "dist"
BACKEND_DIST_DIR = DIST_DIR / "backend_entry.dist"
BIN_DIR = DIST_DIR / "bin"
RESOURCE_DIR = DIST_DIR / "resources"


def _include_data_args() -> list[str]:
    args: list[str] = []
    langgraph_config = ROOT / "langgraph.json"
    if langgraph_config.exists():
        args.append(f"--include-data-files={langgraph_config}=langgraph.json")

    for name in ("src", "assets", "models"):
        source = ROOT / name
        if source.exists():
            args.append(f"--include-data-dir={source}={name}")
    return args


def _copy_backend_binary() -> None:
    BIN_DIR.mkdir(parents=True, exist_ok=True)
    source_name = "tobagent-backend.exe" if sys.platform == "win32" else "tobagent-backend"
    source = BACKEND_DIST_DIR / source_name
    if not source.exists():
        raise FileNotFoundError(f"Nuitka output binary was not found: {source}")
    shutil.copy2(source, BIN_DIR / source_name)


def _copy_optional_resources() -> None:
    if RESOURCE_DIR.exists():
        shutil.rmtree(RESOURCE_DIR)
    RESOURCE_DIR.mkdir(parents=True, exist_ok=True)

    langgraph_config = ROOT / "langgraph.json"
    if langgraph_config.exists():
        shutil.copy2(langgraph_config, RESOURCE_DIR / "langgraph.json")

    for name in ("src", "assets", "models"):
        source = ROOT / name
        if source.exists():
            shutil.copytree(source, RESOURCE_DIR / name)


def main() -> None:
    """Run Nuitka and prepare Tauri resource directories."""
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
        *_include_data_args(),
        str(ROOT / "desktop" / "backend_entry.py"),
    ]
    subprocess.run(command, cwd=ROOT, check=True)
    _copy_backend_binary()
    _copy_optional_resources()


if __name__ == "__main__":
    main()
