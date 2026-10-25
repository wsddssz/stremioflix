use serde::Deserialize;
use tauri::generate_context;

#[derive(Deserialize)]
struct PlayRequest {
    url: String,
    title: Option<String>,
    subs: Option<String>,
}

#[tauri::command]
fn native_play(req: PlayRequest) -> Result<bool, String> {
    let _ = req;
    Ok(true)
}

#[tauri::command]
fn native_stop() -> Result<(), String> {
    Ok(())
}

#[tauri::command]
fn native_pause() -> Result<(), String> {
    Ok(())
}

#[tauri::command]
fn native_seek(seconds: f64) -> Result<(), String> {
    let _ = seconds;
    Ok(())
}

#[tauri::command]
fn native_volume(percent: f64) -> Result<(), String> {
    let _ = percent;
    Ok(())
}

/// Entry point shared by desktop (`main.rs`) and Android (`mobile_entry_point`).
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run_app() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            native_play,
            native_stop,
            native_pause,
            native_seek,
            native_volume,
        ])
        .run(generate_context!())
        .expect("error while running tauri application");
}
