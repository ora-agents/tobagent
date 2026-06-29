use std::{
    env,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread,
    time::Duration,
};

use tauri::{Manager, RunEvent};

const BACKEND_PORT: u16 = 2025;

struct BackendState {
    child: Mutex<Option<Child>>,
}

fn backend_executable_name() -> &'static str {
    if cfg!(windows) {
        "tobagent-backend.exe"
    } else {
        "tobagent-backend"
    }
}

fn candidate_backend_paths(resource_dir: Option<&Path>) -> Vec<PathBuf> {
    let mut paths = Vec::new();

    if let Ok(path) = env::var("TOB_DESKTOP_BACKEND_BIN") {
        if !path.trim().is_empty() {
            paths.push(PathBuf::from(path));
        }
    }

    if let Some(resource_dir) = resource_dir {
        paths.push(resource_dir.join("bin").join(backend_executable_name()));
        paths.push(resource_dir.join("desktop").join("dist").join("backend_entry.dist").join(backend_executable_name()));
        paths.push(resource_dir.join(backend_executable_name()));
    }

    paths
}

fn find_backend(resource_dir: Option<&Path>) -> Option<PathBuf> {
    candidate_backend_paths(resource_dir)
        .into_iter()
        .find(|path| path.is_file())
}

fn start_backend(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    if env::var("TOB_DESKTOP_BACKEND_EXTERNAL").is_ok() {
        return Ok(());
    }

    let resource_dir = app.path().resource_dir().ok();
    let Some(backend) = find_backend(resource_dir.as_deref()) else {
        eprintln!(
            "TOB Agent desktop backend was not found. Set TOB_DESKTOP_BACKEND_BIN for dev, or run `make desktop-backend` before packaging."
        );
        return Ok(());
    };

    let app_data_dir = app.path().app_data_dir()?;
    std::fs::create_dir_all(&app_data_dir)?;

    let mut command = Command::new(&backend);
    command
        .arg("--host")
        .arg("127.0.0.1")
        .arg("--port")
        .arg(BACKEND_PORT.to_string())
        .env("TOB_DESKTOP", "1")
        .env("TOB_DESKTOP_DATA_DIR", &app_data_dir)
        .env("TOB_BACKEND_HOST", "127.0.0.1")
        .env("TOB_BACKEND_PORT", BACKEND_PORT.to_string())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    if let Some(resource_dir) = resource_dir {
        command.env("TOB_DESKTOP_RESOURCE_DIR", resource_dir);
    }

    let child = command.spawn()?;
    let state = app.state::<BackendState>();
    *state.child.lock().expect("backend process mutex poisoned") = Some(child);

    thread::sleep(Duration::from_millis(900));
    Ok(())
}

fn stop_backend(app_handle: &tauri::AppHandle) {
    let Some(state) = app_handle.try_state::<BackendState>() else {
        return;
    };

    let mut guard = state.child.lock().expect("backend process mutex poisoned");
    let Some(mut child) = guard.take() else {
        return;
    };

    if let Err(error) = child.kill() {
        eprintln!("Failed to stop TOB Agent backend: {error}");
    }
    let _ = child.wait();
}

pub fn run() {
    tauri::Builder::default()
        .manage(BackendState {
            child: Mutex::new(None),
        })
        .setup(|app| {
            start_backend(app)?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build TOB Agent desktop app")
        .run(|app_handle, event| {
            if matches!(event, RunEvent::ExitRequested { .. }) {
                stop_backend(app_handle);
            }
        });
}
