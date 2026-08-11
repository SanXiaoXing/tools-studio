use std::path::PathBuf;

use crate::config;
use crate::error::AppError;
use crate::services::compress;

/// 读取应用配置（连接 Worker 所需的 server / apiKey 等），设置页初始化时调用
#[tauri::command]
pub fn get_config() -> Result<config::Config, AppError> {
    config::load()
}

/// 将图片转换为 WebP（减小体积）：输入为本地文件路径，quality 1-100（可选，默认 80）。
/// 输出写入系统临时目录，返回 (输入大小, 输出大小, 输出路径)
#[tauri::command]
pub fn convert_to_webp(input: String, quality: Option<f32>) -> Result<(u64, u64, String), AppError> {
    let (in_size, out_size, out_path) = compress::convert_to_webp(&PathBuf::from(input), quality.unwrap_or(80.0))?;
    Ok((in_size, out_size, out_path.to_string_lossy().into_owned()))
}
