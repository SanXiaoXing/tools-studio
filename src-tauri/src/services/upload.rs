use std::path::Path;

use reqwest::Method;
use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::services::http;

/// 上传成功响应（API.md：PUT /objects/{key}）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UploadedInfo {
    pub key: String,
    pub url: String,
}

/// 将本地文件通过 Worker（Storage Gateway）上传到 R2。
/// 请求契约见 docs/API.md：PUT /objects/{key}，携带 X-API-Key 与 Content-Type。
pub async fn upload_file(
    server: &str,
    api_key: &str,
    key: &str,
    content_type: &str,
    file_path: &Path,
) -> Result<UploadedInfo, AppError> {
    let body = std::fs::read(file_path).map_err(|e| AppError::Io(format!("读取文件失败: {e}")))?;
    let resp = http::request(
        Method::PUT,
        server,
        api_key,
        &format!("/objects/{key}"),
        "上传",
        Some((body, content_type.to_string())),
    )
    .await?;
    resp.json::<UploadedInfo>()
        .await
        .map_err(|e| AppError::Io(format!("解析 Worker 响应失败: {e}")))
}
