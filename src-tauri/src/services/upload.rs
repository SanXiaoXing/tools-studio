use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::error::AppError;

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
    if server.trim().is_empty() || api_key.trim().is_empty() {
        return Err(AppError::Config("未配置 Worker 地址或 API Key，请在设置页填写".into()));
    }
    let body = std::fs::read(file_path).map_err(|e| AppError::Io(format!("读取文件失败: {e}")))?;
    let url = format!("{}/objects/{}", server.trim_end_matches('/'), key);
    let client = reqwest::Client::new();
    let resp = client
        .put(&url)
        .header("X-API-Key", api_key)
        .header("Content-Type", content_type)
        .body(body)
        .send()
        .await
        .map_err(|e| AppError::Io(format!("请求 Worker 失败: {e}")))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(AppError::Io(format!("上传失败 HTTP {status}: {text}")));
    }
    resp.json::<UploadedInfo>()
        .await
        .map_err(|e| AppError::Io(format!("解析 Worker 响应失败: {e}")))
}
