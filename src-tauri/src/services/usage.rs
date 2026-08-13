use reqwest::Method;
use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::services::http;

/// 存储统计响应（WORKER-V2.md §7.4：GET /usage 与 POST /usage/rescan）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageInfo {
    pub objects: u64,
    pub size: u64,
    /// Worker 返回的人类可读大小（如 "1.71 GB"），直接透传展示
    pub size_formatted: String,
    pub updated_at: String,
}

/// 拉取 R2 存储统计。rescan=true 调 POST /usage/rescan（全量校准，注意必须 POST），
/// false 调 GET /usage（读维护计数）。均携带 X-API-Key，契约见 docs/API.md。
pub async fn fetch_usage(server: &str, api_key: &str, rescan: bool) -> Result<UsageInfo, AppError> {
    let (method, path) = if rescan {
        (Method::POST, "/usage/rescan")
    } else {
        (Method::GET, "/usage")
    };
    let resp = http::request(method, server, api_key, path, "获取存储统计", None).await?;
    resp.json::<UsageInfo>()
        .await
        .map_err(|e| AppError::Io(format!("解析 Worker 响应失败: {e}")))
}
