mod commands;
mod config;
mod error;
mod services;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init());

    // 窗口状态记忆（v2.tauri.app/plugin/window-state）：必须在窗口创建前注册到 Builder，
    // 插件才能在 on_window_ready 中恢复位置/大小/最大化。若注册在 setup 内，主窗口已创建
    // 完毕（window_created 已派发），恢复钩子永远不会触发，只会保存不会恢复。
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_window_state::Builder::default().build());

    builder
        .setup(|app| {
            // 窗口配置 visible=false（恢复尺寸前不闪现默认窗口）。首次启动（无状态文件）时
            // 插件的 restore_state 会负责显示窗口；这里仅兜底：万一恢复失败，窗口不能保持隐藏。
            #[cfg(desktop)]
            {
                let has_state = app
                    .path()
                    .app_config_dir()
                    .is_ok_and(|dir| dir.join(tauri_plugin_window_state::DEFAULT_FILENAME).exists());
                if !has_state {
                    if let Some(win) = app.get_webview_window("main") {
                        win.show()?;
                    }
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
