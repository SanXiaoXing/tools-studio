use reqwest::Method;
use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::services::http;

/// 云端对象列表项（API.md §4：GET /objects 响应中的 items）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ObjectItem {
    pub key: String,
    pub url: String,
    pub size: u64,
    /// ISO 8601 上传时间（如 "2026-08-14T08:00:00Z"）
    pub uploaded: String,
}

/// GET /objects 响应（API.md §4）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ObjectList {
    pub items: Vec<ObjectItem>,
    /// 分页游标；has_more=false 时为 null
    pub cursor: Option<String>,
    pub has_more: bool,
}

/// 拉取 R2 中的对象列表（API.md §4：GET /objects）。
/// 分页参数：limit 每页数量（1-1000，默认 100），cursor 上次返回的游标。
/// 启动时用于恢复图片库（重启后仍能看到历史图片）。
pub async fn list_objects(
    server: &str,
    api_key: &str,
    limit: Option<u32>,
    cursor: Option<String>,
) -> Result<ObjectList, AppError> {
    let mut path = String::from("/objects");
    let mut params: Vec<String> = Vec::new();
    if let Some(limit) = limit {
        params.push(format!("limit={limit}"));
    }
    if let Some(cursor) = cursor {
        if !cursor.is_empty() {
            params.push(format!("cursor={cursor}"));
        }
    }
    if !params.is_empty() {
        path.push('?');
        path.push_str(&params.join("&"));
    }
    let resp = http::request(Method::GET, server, api_key, &path, "获取图片列表", None).await?;
    resp.json::<ObjectList>()
        .await
        .map_err(|e| AppError::Io(format!("解析 Worker 响应失败: {e}")))
}
