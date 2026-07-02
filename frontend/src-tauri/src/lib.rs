use serde::Serialize;
use std::{
    collections::HashMap,
    fs,
    io::{self, Write},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
};
use tauri::{Manager, State};

const DEFAULT_ENV: &str = r#"# TOB Agent local backend
TOB_BACKEND_HOST=127.0.0.1
TOB_BACKEND_PORT=2026
TOB_BACKEND_LOG_LEVEL=info
TOB_BACKEND_ACCESS_LOG=false

# Fill these before using model, voice, SMS, or tracing features locally.
# OPENAI_API_KEY=
# LANGSMITH_API_KEY=
# LANGFUSE_PUBLIC_KEY=
# LANGFUSE_SECRET_KEY=
# LANGFUSE_HOST=
"#;

struct BackendProcess(Mutex<Option<Child>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopBackendStatus {
    data_dir: String,
    deploy_dir: String,
    env_path: String,
    download_dir: String,
    package_path: Option<String>,
    binary_path: Option<String>,
    running: bool,
    deployed: bool,
    local_url: String,
}

fn desktop_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|err| format!("Cannot resolve app data directory: {err}"))
}

fn deploy_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(desktop_data_dir(app)?.join("backend"))
}

fn download_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(desktop_data_dir(app)?.join("downloads"))
}

fn env_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(deploy_dir(app)?.join(".env"))
}

fn package_marker_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(download_dir(app)?.join("latest-package.txt"))
}

fn backend_exe_name() -> &'static str {
    if cfg!(windows) {
        "tobagent-backend.exe"
    } else {
        "tobagent-backend"
    }
}

fn local_binary_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    let deployed = deploy_dir(app).ok()?.join("bin").join(backend_exe_name());
    if deployed.exists() {
        return Some(deployed);
    }

    let resource_dir = app.path().resource_dir().ok()?;
    let bundled = resource_dir.join("bin").join(backend_exe_name());
    if bundled.exists() {
        return Some(bundled);
    }
    None
}

fn read_package_marker(app: &tauri::AppHandle) -> Option<PathBuf> {
    let marker = package_marker_path(app).ok()?;
    let value = fs::read_to_string(marker).ok()?;
    let path = PathBuf::from(value.trim());
    path.exists().then_some(path)
}

fn parse_env(content: &str) -> HashMap<String, String> {
    content
        .lines()
        .filter_map(|line| {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') {
                return None;
            }
            let (key, value) = trimmed.split_once('=')?;
            Some((
                key.trim().to_owned(),
                value.trim().trim_matches('"').to_owned(),
            ))
        })
        .collect()
}

fn read_env_map(app: &tauri::AppHandle) -> HashMap<String, String> {
    let content = env_path(app)
        .ok()
        .and_then(|path| fs::read_to_string(path).ok())
        .unwrap_or_else(|| DEFAULT_ENV.to_owned());
    parse_env(&content)
}

fn status_for(app: &tauri::AppHandle, running: bool) -> Result<DesktopBackendStatus, String> {
    let data = desktop_data_dir(app)?;
    let deploy = deploy_dir(app)?;
    let env = env_path(app)?;
    let downloads = download_dir(app)?;
    let env_map = read_env_map(app);
    let host = env_map
        .get("TOB_BACKEND_HOST")
        .cloned()
        .unwrap_or_else(|| "127.0.0.1".to_owned());
    let port = env_map
        .get("TOB_BACKEND_PORT")
        .cloned()
        .unwrap_or_else(|| "2026".to_owned());

    Ok(DesktopBackendStatus {
        data_dir: data.display().to_string(),
        deploy_dir: deploy.display().to_string(),
        env_path: env.display().to_string(),
        download_dir: downloads.display().to_string(),
        package_path: read_package_marker(app).map(|path| path.display().to_string()),
        binary_path: local_binary_path(app).map(|path| path.display().to_string()),
        running,
        deployed: deploy.exists() && env.exists(),
        local_url: format!("http://{host}:{port}"),
    })
}

fn ensure_env_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let deploy = deploy_dir(app)?;
    fs::create_dir_all(&deploy).map_err(|err| format!("Cannot create deploy directory: {err}"))?;
    let env = env_path(app)?;
    if !env.exists() {
        fs::write(&env, DEFAULT_ENV).map_err(|err| format!("Cannot write .env: {err}"))?;
    }
    Ok(env)
}

fn copy_bundled_binary(app: &tauri::AppHandle) -> Result<Option<PathBuf>, String> {
    let resource_dir = match app.path().resource_dir() {
        Ok(path) => path,
        Err(_) => return Ok(None),
    };
    let source = resource_dir.join("bin").join(backend_exe_name());
    if !source.exists() {
        return Ok(None);
    }

    let target = deploy_dir(app)?.join("bin").join(backend_exe_name());
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|err| format!("Cannot create bin directory: {err}"))?;
    }
    fs::copy(&source, &target).map_err(|err| format!("Cannot copy bundled backend: {err}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(&target)
            .map_err(|err| format!("Cannot read backend permissions: {err}"))?
            .permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&target, perms)
            .map_err(|err| format!("Cannot set backend executable bit: {err}"))?;
    }
    Ok(Some(target))
}

fn write_start_scripts(app: &tauri::AppHandle) -> Result<(), String> {
    let deploy = deploy_dir(app)?;
    let unix_script = deploy.join("start-backend.sh");
    let windows_script = deploy.join("start-backend.cmd");
    fs::write(
        &unix_script,
        "#!/usr/bin/env sh\nset -eu\nDIR=$(CDPATH= cd -- \"$(dirname -- \"$0\")\" && pwd)\n\"$DIR/bin/tobagent-backend\" --host \"${TOB_BACKEND_HOST:-127.0.0.1}\" --port \"${TOB_BACKEND_PORT:-2026}\"\n",
    )
    .map_err(|err| format!("Cannot write start script: {err}"))?;
    fs::write(
        windows_script,
        "@echo off\r\nset DIR=%~dp0\r\n\"%DIR%bin\\tobagent-backend.exe\" --host \"%TOB_BACKEND_HOST%\" --port \"%TOB_BACKEND_PORT%\"\r\n",
    )
    .map_err(|err| format!("Cannot write Windows start script: {err}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(&unix_script)
            .map_err(|err| format!("Cannot read script permissions: {err}"))?
            .permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&unix_script, perms)
            .map_err(|err| format!("Cannot set script executable bit: {err}"))?;
    }
    Ok(())
}

fn check_running(state: &State<BackendProcess>) -> Result<bool, String> {
    let mut guard = state
        .0
        .lock()
        .map_err(|_| "Backend process lock is poisoned".to_owned())?;
    if let Some(child) = guard.as_mut() {
        match child.try_wait() {
            Ok(Some(_)) => {
                *guard = None;
                Ok(false)
            }
            Ok(None) => Ok(true),
            Err(err) => Err(format!("Cannot inspect backend process: {err}")),
        }
    } else {
        Ok(false)
    }
}

fn append_log_stdio(log_file: &Path) -> io::Result<(Stdio, Stdio)> {
    let stdout = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_file)?;
    let stderr = stdout.try_clone()?;
    Ok((Stdio::from(stdout), Stdio::from(stderr)))
}

#[tauri::command]
fn desktop_backend_status(
    app: tauri::AppHandle,
    state: State<BackendProcess>,
) -> Result<DesktopBackendStatus, String> {
    let running = check_running(&state)?;
    status_for(&app, running)
}

#[tauri::command]
fn desktop_backend_read_env(app: tauri::AppHandle) -> Result<String, String> {
    let env = ensure_env_file(&app)?;
    fs::read_to_string(env).map_err(|err| format!("Cannot read .env: {err}"))
}

#[tauri::command]
fn desktop_backend_write_env(app: tauri::AppHandle, content: String) -> Result<(), String> {
    let env = ensure_env_file(&app)?;
    fs::write(env, content).map_err(|err| format!("Cannot write .env: {err}"))
}

#[tauri::command]
fn desktop_backend_initialize(
    app: tauri::AppHandle,
    state: State<BackendProcess>,
) -> Result<DesktopBackendStatus, String> {
    ensure_env_file(&app)?;
    write_start_scripts(&app)?;
    let _ = copy_bundled_binary(&app)?;
    let running = check_running(&state)?;
    status_for(&app, running)
}

#[tauri::command]
async fn desktop_backend_download_package(
    app: tauri::AppHandle,
    url: String,
) -> Result<String, String> {
    let url = url.trim().to_owned();
    if url.is_empty() {
        return Err("Download URL is required".to_owned());
    }
    let downloads = download_dir(&app)?;
    fs::create_dir_all(&downloads)
        .map_err(|err| format!("Cannot create download directory: {err}"))?;
    let filename = url
        .rsplit('/')
        .next()
        .and_then(|name| name.split('?').next())
        .filter(|name| !name.trim().is_empty())
        .unwrap_or("tobagent-backend-package");
    let target = downloads.join(filename);
    let marker = package_marker_path(&app)?;

    let target_for_task = target.clone();
    let url_for_task = url.clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let mut response = reqwest::blocking::get(&url_for_task)
            .map_err(|err| format!("Download failed: {err}"))?;
        if !response.status().is_success() {
            return Err(format!("Download failed with HTTP {}", response.status()));
        }
        let mut file = fs::File::create(&target_for_task)
            .map_err(|err| format!("Cannot create package: {err}"))?;
        io::copy(&mut response, &mut file).map_err(|err| format!("Cannot save package: {err}"))?;
        file.flush()
            .map_err(|err| format!("Cannot flush package: {err}"))?;
        Ok(())
    })
    .await
    .map_err(|err| format!("Download task failed: {err}"))??;

    fs::write(marker, target.display().to_string())
        .map_err(|err| format!("Cannot record downloaded package: {err}"))?;
    Ok(target.display().to_string())
}

#[tauri::command]
fn desktop_backend_run_installer(
    app: tauri::AppHandle,
    package_path: Option<String>,
) -> Result<(), String> {
    let package = package_path
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
        .or_else(|| read_package_marker(&app))
        .ok_or_else(|| "No downloaded package found".to_owned())?;
    if !package.exists() {
        return Err(format!("Package does not exist: {}", package.display()));
    }

    #[cfg(target_os = "windows")]
    let mut command = {
        let mut cmd = Command::new("cmd");
        cmd.args(["/C", "start", "", &package.display().to_string()]);
        cmd
    };

    #[cfg(target_os = "macos")]
    let mut command = {
        let mut cmd = Command::new("open");
        cmd.arg(&package);
        cmd
    };

    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let mut cmd = Command::new("xdg-open");
        cmd.arg(&package);
        cmd
    };

    command
        .spawn()
        .map_err(|err| format!("Cannot start installer: {err}"))?;
    Ok(())
}

#[tauri::command]
fn desktop_backend_start(
    app: tauri::AppHandle,
    state: State<BackendProcess>,
) -> Result<DesktopBackendStatus, String> {
    ensure_env_file(&app)?;
    let mut guard = state
        .0
        .lock()
        .map_err(|_| "Backend process lock is poisoned".to_owned())?;
    if let Some(child) = guard.as_mut() {
        if child
            .try_wait()
            .map_err(|err| format!("Cannot inspect backend process: {err}"))?
            .is_none()
        {
            drop(guard);
            return status_for(&app, true);
        }
    }
    *guard = None;

    let binary = local_binary_path(&app).ok_or_else(|| {
        "No local backend binary found. Initialize deployment with a bundled backend, or install/copy to backend/bin first.".to_owned()
    })?;
    let deploy = deploy_dir(&app)?;
    let env_map = read_env_map(&app);
    let host = env_map
        .get("TOB_BACKEND_HOST")
        .cloned()
        .unwrap_or_else(|| "127.0.0.1".to_owned());
    let port = env_map
        .get("TOB_BACKEND_PORT")
        .cloned()
        .unwrap_or_else(|| "2026".to_owned());
    let logs = deploy.join("logs");
    fs::create_dir_all(&logs).map_err(|err| format!("Cannot create log directory: {err}"))?;
    let (stdout, stderr) = append_log_stdio(&logs.join("backend.log"))
        .map_err(|err| format!("Cannot open backend log: {err}"))?;

    let mut command = Command::new(binary);
    command
        .current_dir(&deploy)
        .args(["--host", &host, "--port", &port])
        .envs(env_map)
        .stdout(stdout)
        .stderr(stderr);

    let child = command
        .spawn()
        .map_err(|err| format!("Cannot start local backend: {err}"))?;
    *guard = Some(child);
    drop(guard);
    status_for(&app, true)
}

#[tauri::command]
fn desktop_backend_stop(
    app: tauri::AppHandle,
    state: State<BackendProcess>,
) -> Result<DesktopBackendStatus, String> {
    let mut guard = state
        .0
        .lock()
        .map_err(|_| "Backend process lock is poisoned".to_owned())?;
    if let Some(mut child) = guard.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    drop(guard);
    status_for(&app, false)
}

#[cfg(target_os = "linux")]
fn linux_microphone_permission_plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("desktop-microphone-permission")
        .on_webview_ready(|webview| {
            let label = webview.label().to_owned();
            if let Err(err) = webview.with_webview(move |platform_webview| {
                use webkit2gtk::{glib::object::ObjectExt, PermissionRequestExt, WebViewExt};

                platform_webview
                    .inner()
                    .connect_permission_request(|_, request| {
                        if request.is::<webkit2gtk::UserMediaPermissionRequest>() {
                            request.allow();
                            true
                        } else {
                            false
                        }
                    });
            }) {
                eprintln!("failed to install microphone permission handler for {label}: {err}");
            }
        })
        .build()
}

#[cfg(target_os = "windows")]
fn windows_microphone_permission_plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("desktop-microphone-permission")
        .on_webview_ready(|webview| {
            let label = webview.label().to_owned();
            let webview_label = label.clone();
            if let Err(err) = webview.with_webview(move |platform_webview| unsafe {
                use webview2_com::{
                    Microsoft::Web::WebView2::Win32::{
                        COREWEBVIEW2_PERMISSION_KIND, COREWEBVIEW2_PERMISSION_KIND_MICROPHONE,
                        COREWEBVIEW2_PERMISSION_STATE_ALLOW,
                    },
                    PermissionRequestedEventHandler,
                };

                let core_webview = match platform_webview.controller().CoreWebView2() {
                    Ok(webview) => webview,
                    Err(err) => {
                        eprintln!("failed to access WebView2 for {webview_label}: {err}");
                        return;
                    }
                };

                let mut token = 0;
                if let Err(err) = core_webview.add_PermissionRequested(
                    &PermissionRequestedEventHandler::create(Box::new(|_, args| {
                        let Some(args) = args else {
                            return Ok(());
                        };

                        let mut kind = COREWEBVIEW2_PERMISSION_KIND::default();
                        args.PermissionKind(&mut kind)?;
                        if kind == COREWEBVIEW2_PERMISSION_KIND_MICROPHONE {
                            args.SetState(COREWEBVIEW2_PERMISSION_STATE_ALLOW)?;
                        }

                        Ok(())
                    })),
                    &mut token,
                ) {
                    eprintln!("failed to install WebView2 microphone permission handler: {err}");
                }
            }) {
                eprintln!("failed to install microphone permission handler for {label}: {err}");
            }
        })
        .build()
}

pub fn run() {
    let builder = tauri::Builder::default()
        .manage(BackendProcess(Mutex::new(None)))
        .plugin(tauri_plugin_store::Builder::new().build());

    #[cfg(target_os = "linux")]
    let builder = builder.plugin(linux_microphone_permission_plugin());

    #[cfg(target_os = "windows")]
    let builder = builder.plugin(windows_microphone_permission_plugin());

    builder
        .invoke_handler(tauri::generate_handler![
            desktop_backend_status,
            desktop_backend_read_env,
            desktop_backend_write_env,
            desktop_backend_initialize,
            desktop_backend_download_package,
            desktop_backend_run_installer,
            desktop_backend_start,
            desktop_backend_stop,
        ])
        .build(tauri::generate_context!())
        .expect("failed to build TOB Agent desktop app")
        .run(|_, _| {});
}
