use reqwest::Method;

use crate::error::AppError;
use crate::services::http;

/// 删除 R2 中的对象（API.md §5：DELETE /objects/{key}）。
/// 对象不存在时 Worker 返回 404，这里视为"已删除"（幂等删除），不报错。
pub async fn delete_file(
    server: &str,
    api_key: &str,
    key: &str,
) -> Result<(), AppError> {
    let resp = http::request(
        Method::DELETE,
        server,
        api_key,
        &format!("/objects/{key}"),
        "删除",
        None,
    )
    .await;

    match resp {
        Ok(_) => Ok(()),
        // http::request 对非 2xx 统一报错；仅当远程对象不存在（404）时视为删除成功
        Err(AppError::Io(msg)) if msg.contains("HTTP 404") => Ok(()),
        Err(e) => Err(e),
    }
}
