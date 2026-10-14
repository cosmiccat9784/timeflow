// TimeFlow Tauri 2 backend — spec §23.
// Frontend owns the timetable logic; the backend provides native OS
// integration: file dialogs (V1 import/export), persistent store scope,
// and notifications (V2). No timetable data leaves the device (§24).

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri_plugin_notification::NotificationExt;

#[tauri::command]
fn app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[tauri::command]
fn test_notification(app: tauri::AppHandle) -> Result<(), String> {
    // Settings → notification test button (V2). In-app fallback banner
    // remains the reliable path until per-OS behaviour is verified (§21).
    app.notification()
        .builder()
        .title("TimeFlow")
        .body("Notifications are working on this device.")
        .show()
        .map_err(|e| e.to_string())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![app_version, test_notification])
        .run(tauri::generate_context!())
        .expect("error while running TimeFlow");
}
