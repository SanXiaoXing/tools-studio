use std::path::PathBuf;

use crate::config;
use crate::error::AppError;
use crate::services::compress;
use crate::services::delete;
use crate::services::upload;
use crate::services::usage;

/// 读取应用配置（连接 Worker 所需的 server / apiKey 等），设置页初始化时调用
#[tauri::command]
pub fn get_config() -> Result<config::Config, AppError> {
    config::load()
}

/// 将图片转换为 WebP（减小体积）：输入为本地文件路径，quality 1-100（可选，默认 80）。
/// 输出写入系统临时目录，返回 (输入大小, 输出大小, 输出路径)。
/// async + spawn_blocking：图片解码/编码是 CPU 密集任务，不能占 Tauri 主线程，否则拖拽/点击会卡顿。
#[tauri::command]
pub async fn convert_to_webp(input: String, quality: Option<f32>) -> Result<(u64, u64, String), AppError> {
    let quality = quality.unwrap_or(80.0);
    tauri::async_runtime::spawn_blocking(move || {
        let (in_size, out_size, out_path) = compress::convert_to_webp(&PathBuf::from(input), quality)?;
        Ok((in_size, out_size, out_path.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|e| AppError::Io(format!("转换任务失败: {e}")))?
}

/// 保存 Worker 连接配置（server / apiKey）到 config.json；设置页保存时调用。
/// 密钥只存在 Rust 侧配置文件（WORKER-V2.md §7），前端不接触。
#[tauri::command]
pub fn set_config(server: String, api_key: String) -> Result<(), AppError> {
    config::save(&server, &api_key)
}

/// 将本地文件上传到 Worker → R2（API.md：PUT /objects/{key}）。
/// server / apiKey 从 config.json 内部读取，前端不再传参（WORKER-V2.md §7）。
/// 返回 Worker 给的完整访问 URL；异步执行，不阻塞主线程。
#[tauri::command]
pub async fn upload_image(
    key: String,
    content_type: String,
    file_path: String,
) -> Result<upload::UploadedInfo, AppError> {
    let cfg = config::load()?;
    upload::upload_file(&cfg.server, &cfg.api_key, &key, &content_type, &PathBuf::from(file_path)).await
}

/// 拉取 R2 存储统计（WORKER-V2.md §7.4）。
/// rescan=true 调 POST /usage/rescan（全量校准），false 调 GET /usage（读维护计数）。
/// 由用户在设置页手动触发，不做启动自动拉取。server / apiKey 从 config.json 内部读取。
#[tauri::command]
pub async fn sync_usage(rescan: bool) -> Result<usage::UsageInfo, AppError> {
    let cfg = config::load()?;
    usage::fetch_usage(&cfg.server, &cfg.api_key, rescan).await
}

/// 删除 R2 中的图片（API.md §5：DELETE /objects/{key}）。
/// server / apiKey 从 config.json 内部读取；对象不存在（404）视为已删除，不报错。
#[tauri::command]
pub async fn delete_image(key: String) -> Result<(), AppError> {
    let cfg = config::load()?;
    delete::delete_file(&cfg.server, &cfg.api_key, &key).await
}

/// 导出设置备份：将设置 JSON 写入用户选择的文件（设置页「导出备份」）
#[tauri::command]
pub fn export_settings(path: String, content: String) -> Result<(), AppError> {
    std::fs::write(&path, content).map_err(|e| AppError::Io(format!("写入备份文件失败: {e}")))
}

/// 导入设置备份：读取备份文件内容返回给前端解析（设置页「导入备份」）
#[tauri::command]
pub fn import_settings(path: String) -> Result<String, AppError> {
    std::fs::read_to_string(&path).map_err(|e| AppError::Io(format!("读取备份文件失败: {e}")))
}
