mod commands;
mod config;
mod error;
mod services;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // 窗口状态记忆：保存/恢复位置与大小（桌面端，v2.tauri.app/plugin/window-state）
            #[cfg(desktop)]
            {
                app.handle()
                    .plugin(tauri_plugin_window_state::Builder::default().build())?;
                // 兜底显示：插件仅在存在已保存状态时才显示 visible=false 的窗口，
                // 首次启动（无状态文件）时窗口会保持隐藏，这里确保主窗口始终可见。
                if let Some(win) = app.get_webview_window("main") {
                    win.show()?;
                }
            }
            Ok(())
        })
        .manage(config::init_state())
        .invoke_handler(tauri::generate_handler![
            commands::get_config,
            commands::set_config,
            commands::convert_to_webp,
            commands::upload_image,
            commands::sync_usage,
            commands::delete_image,
            commands::list_images,
            commands::export_settings,
            commands::import_settings
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
