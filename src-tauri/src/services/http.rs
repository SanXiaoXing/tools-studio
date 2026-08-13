use reqwest::Method;

use crate::error::AppError;

/// 发送带 X-API-Key 的 Worker 请求并校验状态码。
/// `path` 为 URL 路径（如 `/objects/{key}`、`/usage`）；`body` 为 (字节, Content-Type)，仅上传类请求传入。
/// 统一配置校验与错误文案，避免各服务重复实现（upload.rs / usage.rs 共用）。
pub async fn request(
    method: Method,
    server: &str,
    api_key: &str,
    path: &str,
    action: &str,
    body: Option<(Vec<u8>, String)>,
) -> Result<reqwest::Response, AppError> {
    if server.trim().is_empty() || api_key.trim().is_empty() {
        return Err(AppError::Config("未配置 Worker 地址或 API Key，请在设置页填写".into()));
    }
    let url = format!("{}{}", server.trim_end_matches('/'), path);
    let client = reqwest::Client::new();
    let mut req = client.request(method, &url).header("X-API-Key", api_key);
    if let Some((bytes, content_type)) = body {
        req = req.header("Content-Type", content_type).body(bytes);
    }
    let resp = req.send().await.map_err(|e| AppError::Io(format!("请求 Worker 失败: {e}")))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(AppError::Io(format!("{action}失败 HTTP {status}: {text}")));
    }
    Ok(resp)
}
