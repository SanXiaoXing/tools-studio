use std::path::PathBuf;

use crate::config;
use crate::error::AppError;
use crate::services::compress;
use crate::services::upload;

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

/// 将本地文件上传到 Worker → R2（API.md：PUT /objects/{key}）。
/// 返回 Worker 给的完整访问 URL；异步执行，不阻塞主线程。
#[tauri::command]
pub async fn upload_image(
    server: String,
    api_key: String,
    key: String,
    content_type: String,
    file_path: String,
) -> Result<upload::UploadedInfo, AppError> {
    upload::upload_file(&server, &api_key, &key, &content_type, &PathBuf::from(file_path)).await
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
