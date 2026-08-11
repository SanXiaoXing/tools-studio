use serde::Serialize;

/// 统一错误类型（Architecture.md §5 / DECISIONS.md D-002），Tauri Command 直接透传给前端
#[derive(Debug, thiserror::Error, Serialize)]
pub enum AppError {
    #[error("配置错误: {0}")]
    Config(String),
    #[error("文件读取失败: {0}")]
    Io(String),
}
