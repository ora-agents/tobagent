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
    let builder = tauri::Builder::default().plugin(tauri_plugin_store::Builder::new().build());

    #[cfg(target_os = "linux")]
    let builder = builder.plugin(linux_microphone_permission_plugin());

    #[cfg(target_os = "windows")]
    let builder = builder.plugin(windows_microphone_permission_plugin());

    builder
        .build(tauri::generate_context!())
        .expect("failed to build TOB Agent desktop app")
        .run(|_, _| {});
}
