"""PyQt local backend manager."""

from __future__ import annotations

import os
import shutil
import socket
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path

from desktop.local_backend.env_file import read_env, update_env_file

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_ENV = ROOT / ".env"
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 2026


ENV_FIELDS: tuple[tuple[str, str, bool], ...] = (
    ("OPENAI_COMPATIBLE_BASE_URL", "OpenAI-Compatible Base URL", False),
    ("OPENAI_COMPATIBLE_API_KEY", "OpenAI-Compatible API Key", True),
    ("OPENAI_COMPATIBLE_DEFAULT_MODEL", "Default Model", False),
    ("CORS_ALLOW_ORIGINS", "CORS Origins", False),
    ("DASHSCOPE_API_KEY", "DashScope API Key", True),
    ("LANCEDB_PATH", "LanceDB Path", False),
    ("KWS_MODEL_DIR", "KWS Model Directory", False),
)


@dataclass(frozen=True)
class RuntimeStatus:
    """Health and process state for the local backend."""

    running: bool
    healthy: bool
    message: str


def backend_command(host: str, port: int) -> list[str]:
    """Build the local backend command."""
    return [
        sys.executable,
        str(ROOT / "desktop" / "backend_entry.py"),
        "--host",
        host,
        "--port",
        str(port),
    ]


def port_is_available(host: str, port: int) -> bool:
    """Return whether a TCP port can be bound."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.5)
        return sock.connect_ex((host, port)) != 0


def check_health(host: str, port: int, timeout: float = 2.0) -> RuntimeStatus:
    """Check the backend health endpoint."""
    url = f"http://{host}:{port}/health"
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            if 200 <= response.status < 300:
                return RuntimeStatus(True, True, f"Healthy: {url}")
            return RuntimeStatus(True, False, f"HTTP {response.status}: {url}")
    except urllib.error.URLError as exc:
        return RuntimeStatus(False, False, f"Not reachable: {exc.reason}")
    except TimeoutError:
        return RuntimeStatus(False, False, "Health check timed out")


def run_app() -> int:
    """Run the PyQt manager application."""
    try:
        from PyQt6.QtCore import QProcess, Qt, QTimer
        from PyQt6.QtWidgets import (
            QApplication,
            QCheckBox,
            QFileDialog,
            QFormLayout,
            QGroupBox,
            QHBoxLayout,
            QLabel,
            QLineEdit,
            QMainWindow,
            QMessageBox,
            QPlainTextEdit,
            QPushButton,
            QSpinBox,
            QTabWidget,
            QVBoxLayout,
            QWidget,
        )
    except ImportError as exc:
        raise SystemExit(
            "PyQt6 is required. Install it with: uv sync --group local-backend"
        ) from exc

    class LocalBackendWindow(QMainWindow):
        """Main window for editing env values and supervising the backend."""

        def __init__(self) -> None:
            super().__init__()
            self.setWindowTitle("TOB Agent Local Backend")
            self.resize(980, 720)
            self.process: QProcess | None = None

            self.env_path = QLineEdit(str(DEFAULT_ENV))
            self.env_path.setMinimumWidth(520)
            self.host_input = QLineEdit(os.getenv("TOB_BACKEND_HOST", DEFAULT_HOST))
            self.port_input = QSpinBox()
            self.port_input.setRange(1024, 65535)
            self.port_input.setValue(int(os.getenv("TOB_BACKEND_PORT", str(DEFAULT_PORT))))

            self.field_inputs: dict[str, QLineEdit] = {}
            for key, _label, secret in ENV_FIELDS:
                line_edit = QLineEdit()
                if secret:
                    line_edit.setEchoMode(QLineEdit.EchoMode.Password)
                self.field_inputs[key] = line_edit

            self.show_secrets = QCheckBox("Show secrets")
            self.show_secrets.stateChanged.connect(self._toggle_secret_visibility)

            self.raw_env = QPlainTextEdit()
            self.raw_env.setPlaceholderText("Raw .env content")
            self.log_output = QPlainTextEdit()
            self.log_output.setReadOnly(True)
            self.log_output.setMaximumBlockCount(4000)
            self.status_label = QLabel("Stopped")
            self.status_label.setTextInteractionFlags(Qt.TextInteractionFlag.TextSelectableByMouse)

            self.start_button = QPushButton("Start Backend")
            self.stop_button = QPushButton("Stop")
            self.health_button = QPushButton("Check Health")
            self.save_button = QPushButton("Save .env")
            self.reload_button = QPushButton("Reload .env")

            self.start_button.clicked.connect(self._start_backend)
            self.stop_button.clicked.connect(self._stop_backend)
            self.health_button.clicked.connect(self._check_health)
            self.save_button.clicked.connect(self._save_env)
            self.reload_button.clicked.connect(self._load_env)

            self._build_layout()
            self._load_env()

            self.health_timer = QTimer(self)
            self.health_timer.setInterval(5000)
            self.health_timer.timeout.connect(self._check_health_quietly)
            self.health_timer.start()
            self._update_buttons()

        def _build_layout(self) -> None:
            central = QWidget()
            layout = QVBoxLayout(central)

            path_row = QHBoxLayout()
            path_row.addWidget(QLabel(".env file"))
            path_row.addWidget(self.env_path, 1)
            browse = QPushButton("Browse")
            browse.clicked.connect(self._browse_env)
            path_row.addWidget(browse)
            layout.addLayout(path_row)

            runtime_group = QGroupBox("Runtime")
            runtime_form = QFormLayout(runtime_group)
            runtime_form.addRow("Host", self.host_input)
            runtime_form.addRow("Port", self.port_input)
            runtime_form.addRow("Status", self.status_label)
            layout.addWidget(runtime_group)

            tabs = QTabWidget()
            env_tab = QWidget()
            env_form = QFormLayout(env_tab)
            for key, label, _secret in ENV_FIELDS:
                env_form.addRow(label, self.field_inputs[key])
            env_form.addRow("", self.show_secrets)
            tabs.addTab(env_tab, "Common Env")
            tabs.addTab(self.raw_env, "Raw .env")
            layout.addWidget(tabs, 1)

            button_row = QHBoxLayout()
            button_row.addWidget(self.reload_button)
            button_row.addWidget(self.save_button)
            button_row.addStretch(1)
            button_row.addWidget(self.health_button)
            button_row.addWidget(self.stop_button)
            button_row.addWidget(self.start_button)
            layout.addLayout(button_row)

            layout.addWidget(QLabel("Backend Logs"))
            layout.addWidget(self.log_output, 1)
            self.setCentralWidget(central)

        def _browse_env(self) -> None:
            selected, _ = QFileDialog.getOpenFileName(
                self,
                "Select .env file",
                str(Path(self.env_path.text()).parent),
                "Environment Files (.env*);;All Files (*)",
            )
            if selected:
                self.env_path.setText(selected)
                self._load_env()

        def _load_env(self) -> None:
            path = Path(self.env_path.text()).expanduser()
            if not path.exists():
                example = ROOT / ".env.example"
                self.raw_env.setPlainText(example.read_text(encoding="utf-8") if example.exists() else "")
            else:
                self.raw_env.setPlainText(path.read_text(encoding="utf-8"))

            values = read_env(path)
            for key, input_widget in self.field_inputs.items():
                input_widget.setText(values.get(key, ""))

        def _save_env(self) -> None:
            path = Path(self.env_path.text()).expanduser()
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(self.raw_env.toPlainText().rstrip() + "\n", encoding="utf-8")

            values = {
                key: input_widget.text().strip()
                for key, input_widget in self.field_inputs.items()
                if input_widget.text().strip()
            }
            update_env_file(path, values)
            self.raw_env.setPlainText(path.read_text(encoding="utf-8"))
            self._append_log(f"Saved environment: {path}")

        def _toggle_secret_visibility(self) -> None:
            mode = (
                QLineEdit.EchoMode.Normal
                if self.show_secrets.isChecked()
                else QLineEdit.EchoMode.Password
            )
            for key, _label, secret in ENV_FIELDS:
                if secret:
                    self.field_inputs[key].setEchoMode(mode)

        def _start_backend(self) -> None:
            if self.process and self.process.state() != QProcess.ProcessState.NotRunning:
                return

            self._save_env()
            host = self.host_input.text().strip() or DEFAULT_HOST
            port = int(self.port_input.value())
            if not port_is_available(host, port):
                QMessageBox.warning(
                    self,
                    "Port in use",
                    f"{host}:{port} is already in use. Stop the existing process or choose another port.",
                )
                return

            env = os.environ.copy()
            env["TOB_BACKEND_HOST"] = host
            env["TOB_BACKEND_PORT"] = str(port)
            env["TOB_DESKTOP_DATA_DIR"] = str(Path.home() / ".local" / "share" / "tob-agent")
            env["PYTHONUNBUFFERED"] = "1"

            process = QProcess(self)
            process.setWorkingDirectory(str(ROOT))
            process.setProcessEnvironment(_process_environment(env))
            process.readyReadStandardOutput.connect(self._read_stdout)
            process.readyReadStandardError.connect(self._read_stderr)
            process.finished.connect(self._process_finished)
            self.process = process

            command = backend_command(host, port)
            self._append_log("$ " + " ".join(command))
            process.start(command[0], command[1:])
            self.status_label.setText(f"Starting on http://{host}:{port}")
            self._update_buttons()

        def _stop_backend(self) -> None:
            if not self.process:
                return
            if self.process.state() != QProcess.ProcessState.NotRunning:
                self.process.terminate()
                if not self.process.waitForFinished(3000):
                    self.process.kill()
            self._update_buttons()

        def _check_health(self) -> None:
            status = check_health(self.host_input.text().strip() or DEFAULT_HOST, int(self.port_input.value()))
            self.status_label.setText(status.message)
            self._append_log(status.message)

        def _check_health_quietly(self) -> None:
            if not self.process or self.process.state() == QProcess.ProcessState.NotRunning:
                return
            status = check_health(self.host_input.text().strip() or DEFAULT_HOST, int(self.port_input.value()), 0.8)
            self.status_label.setText(status.message)

        def _read_stdout(self) -> None:
            if self.process:
                self._append_log(bytes(self.process.readAllStandardOutput()).decode(errors="replace").rstrip())

        def _read_stderr(self) -> None:
            if self.process:
                self._append_log(bytes(self.process.readAllStandardError()).decode(errors="replace").rstrip())

        def _process_finished(self, exit_code: int, _status: QProcess.ExitStatus) -> None:
            self._append_log(f"Backend stopped with exit code {exit_code}")
            self.status_label.setText("Stopped")
            self._update_buttons()

        def _append_log(self, text: str) -> None:
            if text:
                self.log_output.appendPlainText(text)

        def _update_buttons(self) -> None:
            running = bool(self.process and self.process.state() != QProcess.ProcessState.NotRunning)
            self.start_button.setEnabled(not running)
            self.stop_button.setEnabled(running)

        def closeEvent(self, event) -> None:  # noqa: ANN001, N802
            self._stop_backend()
            event.accept()

    def _process_environment(values: dict[str, str]):
        from PyQt6.QtCore import QProcessEnvironment

        environment = QProcessEnvironment()
        for key, value in values.items():
            environment.insert(key, value)
        return environment

    if not shutil.which(sys.executable):
        raise SystemExit(f"Python executable was not found: {sys.executable}")

    app = QApplication(sys.argv)
    window = LocalBackendWindow()
    window.show()
    return app.exec()


if __name__ == "__main__":
    raise SystemExit(run_app())
