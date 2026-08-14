use reqwest::Method;
use std::sync::OnceLock;

use crate::error::AppError;

/// 全局 HTTP 客户端单例（模块作用域持久化）：reqwest::Client 内部维护连接池 /
/// keepalive / DNS 缓存，官方建议复用而非每次请求 `Client::new()`。
/// ponytail: 进程级单例，配置不运行时调整（Agent 字段目前无需自定义）。
static HTTP: OnceLock<reqwest::Client> = OnceLock::new();

fn client() -> &'static reqwest::Client {
    HTTP.get_or_init(reqwest::Client::new)
}

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
    let mut req = client().request(method, &url).header("X-API-Key", api_key);
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
