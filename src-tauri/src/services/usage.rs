use serde::{Deserialize, Serialize};

use crate::error::AppError;

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

/// 拉取 R2 存储统计。rescan=true 调 POST /usage/rescan（全量校准），
/// false 调 GET /usage（读维护计数）。均携带 X-API-Key，契约见 docs/API.md。
pub async fn fetch_usage(server: &str, api_key: &str, rescan: bool) -> Result<UsageInfo, AppError> {
    if server.trim().is_empty() || api_key.trim().is_empty() {
        return Err(AppError::Config("未配置 Worker 地址或 API Key，请在设置页填写".into()));
    }
    let path = if rescan { "/usage/rescan" } else { "/usage" };
    let url = format!("{}{}", server.trim_end_matches('/'), path);
    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .header("X-API-Key", api_key)
        .send()
        .await
        .map_err(|e| AppError::Io(format!("请求 Worker 失败: {e}")))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(AppError::Io(format!("获取存储统计失败 HTTP {status}: {text}")));
    }
    resp.json::<UsageInfo>()
        .await
        .map_err(|e| AppError::Io(format!("解析 Worker 响应失败: {e}")))
}
