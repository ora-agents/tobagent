use serde::Serialize;
use std::{
    collections::HashMap,
    fs,
    io::{self, Read, Write},
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
const MAX_BACKEND_BINARY_BYTES: u64 = 2 * 1024 * 1024 * 1024;

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

fn is_backend_binary_name(name: &str) -> bool {
    name == "tobagent-backend" || name == "tobagent-backend.exe"
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

fn record_package_marker(app: &tauri::AppHandle, package: &Path) -> Result<(), String> {
    let marker = package_marker_path(app)?;
    if let Some(parent) = marker.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("Cannot create download directory: {err}"))?;
    }
    fs::write(marker, package.display().to_string())
        .map_err(|err| format!("Cannot record package: {err}"))
}

fn read_package_marker(app: &tauri::AppHandle) -> Option<PathBuf> {
    let marker = package_marker_path(app).ok()?;
    let value = fs::read_to_string(marker).ok()?;
    let path = PathBuf::from(value.trim());
    path.exists().then_some(path)
}

fn copy_limited<R: Read>(reader: &mut R, output: &mut fs::File) -> Result<u64, String> {
    let mut total = 0_u64;
    let mut buffer = [0_u8; 1024 * 1024];

    loop {
        let read = reader
            .read(&mut buffer)
            .map_err(|err| format!("Cannot read backend binary: {err}"))?;
        if read == 0 {
            break;
        }
        total += read as u64;
        if total > MAX_BACKEND_BINARY_BYTES {
            return Err(format!(
                "Backend binary is larger than {} bytes; refusing to import",
                MAX_BACKEND_BINARY_BYTES
            ));
        }
        output
            .write_all(&buffer[..read])
            .map_err(|err| format!("Cannot write backend binary: {err}"))?;
    }

    output
        .flush()
        .map_err(|err| format!("Cannot flush backend binary: {err}"))?;
    Ok(total)
}

fn install_backend_binary_from_reader<R: Read>(
    reader: &mut R,
    app: &tauri::AppHandle,
    expected_size: Option<u64>,
    unix_mode: Option<u32>,
) -> Result<PathBuf, String> {
    if let Some(size) = expected_size {
        if size > MAX_BACKEND_BINARY_BYTES {
            return Err(format!(
                "Backend binary is larger than {} bytes; refusing to import",
                MAX_BACKEND_BINARY_BYTES
            ));
        }
    }

    let target = deploy_dir(app)?.join("bin").join(backend_exe_name());
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|err| format!("Cannot create bin directory: {err}"))?;
    }

    let temp = target.with_file_name(format!("{}.importing", backend_exe_name()));
    if temp.exists() {
        fs::remove_file(&temp)
            .map_err(|err| format!("Cannot remove previous import temp file: {err}"))?;
    }

    let mut output =
        fs::File::create(&temp).map_err(|err| format!("Cannot create backend binary: {err}"))?;
    let copied = copy_limited(reader, &mut output)?;
    drop(output);
    if copied == 0 {
        let _ = fs::remove_file(&temp);
        return Err("Selected backend binary is empty".to_owned());
    }

    if target.exists() {
        fs::remove_file(&target).map_err(|err| {
            format!("Cannot replace existing backend binary. Stop the local backend first: {err}")
        })?;
    }
    fs::rename(&temp, &target).map_err(|err| format!("Cannot install backend binary: {err}"))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(&target)
            .map_err(|err| format!("Cannot read backend permissions: {err}"))?
            .permissions();
        perms.set_mode(unix_mode.unwrap_or(0o755) | 0o700);
        fs::set_permissions(&target, perms)
            .map_err(|err| format!("Cannot set backend executable bit: {err}"))?;
    }
    Ok(target)
}

fn copy_backend_binary(source: &Path, app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let size = fs::metadata(source)
        .map_err(|err| format!("Cannot inspect backend binary: {err}"))?
        .len();
    let mut file =
        fs::File::open(source).map_err(|err| format!("Cannot open backend binary: {err}"))?;
    install_backend_binary_from_reader(&mut file, app, Some(size), None)
}

fn remove_path_if_exists(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    if path.is_dir() {
        fs::remove_dir_all(path)
    } else {
        fs::remove_file(path)
    }
    .map_err(|err| format!("Cannot remove {}: {err}", path.display()))
}

fn copy_dir_contents(source: &Path, target: &Path) -> Result<(), String> {
    fs::create_dir_all(target)
        .map_err(|err| format!("Cannot create directory {}: {err}", target.display()))?;
    for entry in
        fs::read_dir(source).map_err(|err| format!("Cannot read {}: {err}", source.display()))?
    {
        let entry = entry.map_err(|err| format!("Cannot read directory entry: {err}"))?;
        let source_path = entry.path();
        let target_path = target.join(entry.file_name());
        if source_path.is_dir() {
            copy_dir_contents(&source_path, &target_path)?;
        } else if source_path.is_file() {
            if let Some(parent) = target_path.parent() {
                fs::create_dir_all(parent).map_err(|err| {
                    format!("Cannot create directory {}: {err}", parent.display())
                })?;
            }
            fs::copy(&source_path, &target_path).map_err(|err| {
                format!(
                    "Cannot copy {} to {}: {err}",
                    source_path.display(),
                    target_path.display()
                )
            })?;
        }
    }
    Ok(())
}

fn find_backend_binary(root: &Path) -> Result<Option<PathBuf>, String> {
    if !root.exists() {
        return Ok(None);
    }
    for entry in
        fs::read_dir(root).map_err(|err| format!("Cannot read {}: {err}", root.display()))?
    {
        let entry = entry.map_err(|err| format!("Cannot read directory entry: {err}"))?;
        let path = entry.path();
        if path.is_dir() {
            if let Some(found) = find_backend_binary(&path)? {
                return Ok(Some(found));
            }
        } else if path
            .file_name()
            .and_then(|value| value.to_str())
            .is_some_and(is_backend_binary_name)
        {
            return Ok(Some(path));
        }
    }
    Ok(None)
}

#[cfg(unix)]
fn make_backend_executable(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    let mut perms = fs::metadata(path)
        .map_err(|err| format!("Cannot read backend permissions: {err}"))?
        .permissions();
    perms.set_mode(0o755);
    fs::set_permissions(path, perms)
        .map_err(|err| format!("Cannot set backend executable bit: {err}"))
}

#[cfg(not(unix))]
fn make_backend_executable(_path: &Path) -> Result<(), String> {
    Ok(())
}

fn install_backend_layout_from_dir(root: &Path, app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let binary = find_backend_binary(root)?
        .ok_or_else(|| format!("Package does not contain {}", backend_exe_name()))?;
    let deploy = deploy_dir(app)?;
    let target_bin = deploy.join("bin");
    remove_path_if_exists(&target_bin)?;

    let binary_parent = binary.parent().ok_or_else(|| {
        format!(
            "Cannot resolve backend binary directory: {}",
            binary.display()
        )
    })?;
    if binary_parent.file_name().and_then(|value| value.to_str()) == Some("bin") {
        let package_root = binary_parent.parent().ok_or_else(|| {
            format!(
                "Cannot resolve backend package root from {}",
                binary_parent.display()
            )
        })?;
        copy_dir_contents(binary_parent, &target_bin)?;

        let package_resources = package_root.join("resources");
        let target_resources = deploy.join("resources");
        remove_path_if_exists(&target_resources)?;
        if package_resources.exists() {
            copy_dir_contents(&package_resources, &target_resources)?;
        }

        let version = package_root.join("VERSION");
        if version.exists() {
            fs::copy(&version, deploy.join("VERSION"))
                .map_err(|err| format!("Cannot copy backend package version: {err}"))?;
        }
    } else {
        copy_dir_contents(binary_parent, &target_bin)?;
    }

    let target = target_bin.join(backend_exe_name());
    if !target.exists() {
        return Err(format!(
            "Imported backend binary was not found: {}",
            target.display()
        ));
    }
    make_backend_executable(&target)?;
    Ok(target)
}

fn extract_zip_package(package: &Path, target: &Path) -> Result<(), String> {
    let file = fs::File::open(package).map_err(|err| format!("Cannot open zip package: {err}"))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|err| format!("Cannot read zip package: {err}"))?;

    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|err| format!("Cannot read zip entry: {err}"))?;
        let Some(path) = entry.enclosed_name() else {
            continue;
        };
        let output_path = target.join(path);
        if entry.is_dir() {
            fs::create_dir_all(&output_path)
                .map_err(|err| format!("Cannot create zip directory: {err}"))?;
        } else if entry.is_file() {
            if let Some(parent) = output_path.parent() {
                fs::create_dir_all(parent)
                    .map_err(|err| format!("Cannot create zip directory: {err}"))?;
            }
            let mut output = fs::File::create(&output_path)
                .map_err(|err| format!("Cannot extract zip entry: {err}"))?;
            copy_limited(&mut entry, &mut output)?;
        }
    }

    Ok(())
}

fn extract_tar_package<R: Read>(reader: R, target: &Path) -> Result<(), String> {
    let mut archive = tar::Archive::new(reader);
    for entry in archive
        .entries()
        .map_err(|err| format!("Cannot read tar package: {err}"))?
    {
        let mut entry = entry.map_err(|err| format!("Cannot read tar entry: {err}"))?;
        let path = entry
            .path()
            .map_err(|err| format!("Cannot read tar entry path: {err}"))?
            .into_owned();
        if path.components().any(|component| {
            matches!(
                component,
                std::path::Component::ParentDir | std::path::Component::Prefix(_)
            )
        }) {
            continue;
        }
        entry
            .unpack_in(target)
            .map_err(|err| format!("Cannot extract tar entry: {err}"))?;
    }
    Ok(())
}

fn import_archive_package(package: &Path, app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let staging = deploy_dir(app)?.join("import-staging");
    cleanup_import_staging(app)?;
    fs::create_dir_all(&staging)
        .map_err(|err| format!("Cannot create import staging directory: {err}"))?;
    let name = package
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();

    if name.ends_with(".zip") {
        extract_zip_package(package, &staging)?;
    } else {
        let file =
            fs::File::open(package).map_err(|err| format!("Cannot open tar package: {err}"))?;
        if name.ends_with(".tar.gz") || name.ends_with(".tgz") {
            let decoder = flate2::read::GzDecoder::new(file);
            extract_tar_package(decoder, &staging)?;
        } else {
            extract_tar_package(file, &staging)?;
        }
    }

    install_backend_layout_from_dir(&staging, app)
}

fn import_backend_package(app: &tauri::AppHandle, package: &Path) -> Result<PathBuf, String> {
    if !package.exists() {
        return Err(format!("Package does not exist: {}", package.display()));
    }
    ensure_env_file(app)?;
    write_start_scripts(app)?;
    cleanup_import_staging(app)?;

    let name = package
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();

    if name.ends_with(".zip")
        || name.ends_with(".tar")
        || name.ends_with(".tar.gz")
        || name.ends_with(".tgz")
    {
        import_archive_package(package, app)
    } else {
        copy_backend_binary(package, app)
    }
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
    let source_bin = resource_dir.join("bin");
    let source = source_bin.join(backend_exe_name());
    if !source.exists() {
        return Ok(None);
    }

    let target = deploy_dir(app)?.join("bin").join(backend_exe_name());
    let target_bin = target
        .parent()
        .ok_or_else(|| format!("Cannot resolve backend bin directory: {}", target.display()))?;
    remove_path_if_exists(target_bin)?;
    copy_dir_contents(&source_bin, target_bin)?;
    make_backend_executable(&target)?;
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

fn cleanup_import_staging(app: &tauri::AppHandle) -> Result<(), String> {
    let staging = deploy_dir(app)?.join("import-staging");
    if staging.exists() {
        fs::remove_dir_all(&staging)
            .map_err(|err| format!("Cannot clear import staging directory: {err}"))?;
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
    cleanup_import_staging(&app)?;
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

    record_package_marker(&app, &target)?;
    Ok(target.display().to_string())
}

#[tauri::command]
fn desktop_backend_select_package(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let selected = rfd::FileDialog::new()
        .set_title("Select TOB Agent backend package")
        .add_filter(
            "Backend package",
            &[
                "zip", "tar", "gz", "tgz", "exe", "bin", "msi", "dmg", "deb", "rpm",
            ],
        )
        .pick_file();

    let Some(package) = selected else {
        return Ok(None);
    };
    record_package_marker(&app, &package)?;
    Ok(Some(package.display().to_string()))
}

#[tauri::command]
async fn desktop_backend_import_package(
    app: tauri::AppHandle,
    package_path: Option<String>,
    state: State<'_, BackendProcess>,
) -> Result<DesktopBackendStatus, String> {
    if check_running(&state)? {
        return Err("Stop the local backend before importing a backend package.".to_owned());
    }
    let package = package_path
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
        .or_else(|| read_package_marker(&app))
        .ok_or_else(|| "No package selected".to_owned())?;

    let app_for_task = app.clone();
    let package_for_task = package.clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let _ = import_backend_package(&app_for_task, &package_for_task)?;
        record_package_marker(&app_for_task, &package_for_task)
    })
    .await
    .map_err(|err| format!("Import task failed: {err}"))??;

    status_for(&app, false)
}

#[tauri::command]
fn desktop_backend_open_deploy_dir(app: tauri::AppHandle) -> Result<(), String> {
    ensure_env_file(&app)?;
    write_start_scripts(&app)?;
    let deploy = deploy_dir(&app)?;
    fs::create_dir_all(&deploy).map_err(|err| format!("Cannot create deploy directory: {err}"))?;
    open::that_detached(&deploy)
        .map_err(|err| format!("Cannot open deploy directory {}: {err}", deploy.display()))
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
            desktop_backend_select_package,
            desktop_backend_import_package,
            desktop_backend_open_deploy_dir,
            desktop_backend_run_installer,
            desktop_backend_start,
            desktop_backend_stop,
        ])
        .build(tauri::generate_context!())
        .expect("failed to build TOB Agent desktop app")
        .run(|_, _| {});
}
