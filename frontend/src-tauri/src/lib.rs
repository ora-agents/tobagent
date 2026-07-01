pub fn run() {
    tauri::Builder::default()
        .build(tauri::generate_context!())
        .expect("failed to build TOB Agent desktop app")
        .run(|_, _| {});
}
