use std::path::PathBuf;

use tauri::Manager;

use crate::config::{self, ConfigState};
use crate::error::AppError;
use crate::services::compress;
use crate::services::delete;
use crate::services::list;
use crate::services::thumbnail;
use crate::services::upload;
use crate::services::usage;

/// 读取应用配置（连接 Worker 所需的 server / apiKey 等），设置页初始化时调用。
/// 走 ConfigState 内存缓存，不再每次读盘解析。
#[tauri::command]
pub fn get_config(state: tauri::State<'_, ConfigState>) -> Result<config::Config, AppError> {
    Ok(state.read().unwrap().clone())
}

/// 将图片转换为 WebP（减小体积）：输入为本地文件路径，quality 1-100（可选，默认 80）。
/// output_dir 为空时写入系统临时目录；否则直接写到该目录（仅压缩模式）。
/// 返回 (输入大小, 输出大小, 输出路径)。
/// async + spawn_blocking：图片解码/编码是 CPU 密集任务，不能占 Tauri 主线程，否则拖拽/点击会卡顿。
#[tauri::command]
pub async fn convert_to_webp(
    input: String,
    quality: Option<f32>,
    output_dir: Option<String>,
) -> Result<(u64, u64, String), AppError> {
    let quality = quality.unwrap_or(80.0);
    tauri::async_runtime::spawn_blocking(move || {
        let out_dir = output_dir.map(PathBuf::from);
        let (in_size, out_size, out_path) = compress::convert_to_webp(
            &PathBuf::from(input),
            quality,
            out_dir.as_deref(),
        )?;
        Ok((in_size, out_size, out_path.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|e| AppError::Io(format!("转换任务失败: {e}")))?
}

/// 将视频压缩为 WebM（系统 ffmpeg）：输出写入用户选择的 output_dir。
/// 返回 (输入大小, 输出大小, 输出路径)。
#[tauri::command]
pub async fn compress_video_to_webm(
    input: String,
    quality: Option<f32>,
    output_dir: String,
) -> Result<(u64, u64, String), AppError> {
    let quality = quality.unwrap_or(80.0);
    tauri::async_runtime::spawn_blocking(move || {
        let (in_size, out_size, out_path) = compress::compress_video_to_webm(
            &PathBuf::from(input),
            quality,
            &PathBuf::from(output_dir),
        )?;
        Ok((in_size, out_size, out_path.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|e| AppError::Io(format!("视频压缩任务失败: {e}")))?
}

/// 保存 Worker 连接配置（server / apiKey）到 config.json；设置页保存时调用。
/// 密钥只存在 Rust 侧配置文件（WORKER-V2.md §7），前端不接触。
/// 同步更新 ConfigState 内存缓存，并落盘持久化。
#[tauri::command]
pub fn set_config(
    server: String,
    api_key: String,
    state: tauri::State<'_, ConfigState>,
) -> Result<(), AppError> {
    let cfg = {
        let mut c = state.write().unwrap();
        c.server = server.trim().to_string();
        c.api_key = api_key.trim().to_string();
        c.clone()
    };
    config::write(&cfg)
}

/// 将本地文件上传到 Worker → R2（API.md：PUT /objects/{key}）。
/// server / apiKey 从 ConfigState 内存读取，前端不再传参（WORKER-V2.md §7）。
/// 返回 Worker 给的完整访问 URL；异步执行，不阻塞主线程。
#[tauri::command]
pub async fn upload_image(
    key: String,
    content_type: String,
    file_path: String,
    state: tauri::State<'_, ConfigState>,
) -> Result<upload::UploadedInfo, AppError> {
    let cfg = state.read().unwrap().clone();
    upload::upload_file(&cfg.server, &cfg.api_key, &key, &content_type, &PathBuf::from(file_path)).await
}

/// 拉取 R2 存储统计（WORKER-V2.md §7.4）。
/// rescan=true 调 POST /usage/rescan（全量校准），false 调 GET /usage（读维护计数）。
/// 由用户在设置页手动触发，不做启动自动拉取。server / apiKey 从 ConfigState 内存读取。
#[tauri::command]
pub async fn sync_usage(
    rescan: bool,
    state: tauri::State<'_, ConfigState>,
) -> Result<usage::UsageInfo, AppError> {
    let cfg = state.read().unwrap().clone();
    usage::fetch_usage(&cfg.server, &cfg.api_key, rescan).await
}

/// 删除 R2 中的图片（API.md §5：DELETE /objects/{key}）。
/// server / apiKey 从 ConfigState 内存读取；对象不存在（404）视为已删除，不报错。
#[tauri::command]
pub async fn delete_image(
    key: String,
    state: tauri::State<'_, ConfigState>,
) -> Result<(), AppError> {
    let cfg = state.read().unwrap().clone();
    delete::delete_file(&cfg.server, &cfg.api_key, &key).await
}

/// 拉取云端图片列表（API.md §4：GET /objects），用于启动时恢复图片库。
/// limit 每页数量（默认 100，最大 1000）；cursor 为上次返回的分页游标。
/// 分页合并时多次调用同一命令，ConfigState 缓存避免重复读盘解析。
#[tauri::command]
pub async fn list_images(
    limit: Option<u32>,
    cursor: Option<String>,
    state: tauri::State<'_, ConfigState>,
) -> Result<list::ObjectList, AppError> {
    let cfg = state.read().unwrap().clone();
    list::list_objects(&cfg.server, &cfg.api_key, limit, cursor).await
}

/// 批量获取图片缩略图：本地磁盘缓存（缓存目录/thumbs），命中直接返回本地路径，
/// 未命中下载原图生成 480px WebP 落盘。网格卡片用缩略图渲染，避免加载原图。
/// 结果经 Channel 逐条回传（on_message 接收）；path 为空串表示该条生成失败，
/// 前端回退公开 URL。
#[tauri::command]
pub async fn get_thumbnails(
    app: tauri::AppHandle,
    items: Vec<thumbnail::ThumbReq>,
    on_message: tauri::ipc::Channel<thumbnail::ThumbRes>,
    state: tauri::State<'_, ConfigState>,
) -> Result<(), AppError> {
    let cfg = state.read().unwrap().clone();
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| AppError::Io(format!("解析缓存目录失败: {e}")))?
        .join("thumbs");
    thumbnail::get_batch(dir, items, (cfg.server, cfg.api_key), on_message).await
}

/// 删除某图片的缩略图缓存（图片被删除时调用），防止缓存残留死文件
#[tauri::command]
pub fn delete_thumbnail(app: tauri::AppHandle, key: String) -> Result<(), AppError> {
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| AppError::Io(format!("解析缓存目录失败: {e}")))?
        .join("thumbs");
    thumbnail::remove(&dir, &key)
}

/// 在系统文件管理器中打开并定位到该文件（「打开位置」）。
#[tauri::command]
pub fn open_folder(path: String) -> Result<(), AppError> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Err(AppError::Io(format!("路径不存在: {path}")));
    }

    // spawn 即返回；explorer 即使成功也可能以非 0 退出，不要用 wait()/output() 判失败
    #[cfg(target_os = "windows")]
    {
        // /select, 打开资源管理器并选中该文件
        std::process::Command::new("explorer")
            .arg(format!("/select,{}", p.to_string_lossy()))
            .spawn()
            .map_err(|e| AppError::Io(format!("打开文件夹失败: {e}")))?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", &p.to_string_lossy()])
            .spawn()
            .map_err(|e| AppError::Io(format!("打开文件夹失败: {e}")))?;
    }
    #[cfg(target_os = "linux")]
    {
        let dir = if p.is_dir() {
            p.clone()
        } else {
            p.parent().map(|d| d.to_path_buf()).unwrap_or_else(|| p.clone())
        };
        std::process::Command::new("xdg-open")
            .arg(dir)
            .spawn()
            .map_err(|e| AppError::Io(format!("打开文件夹失败: {e}")))?;
    }
    Ok(())
}

/// 用系统默认浏览器打开 http(s) 链接（侧边栏 GitHub 等）。
#[tauri::command]
pub fn open_url(url: String) -> Result<(), AppError> {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err(AppError::Io("仅支持 http/https 链接".into()));
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &url])
            .spawn()
            .map_err(|e| AppError::Io(format!("打开链接失败: {e}")))?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(|e| AppError::Io(format!("打开链接失败: {e}")))?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .map_err(|e| AppError::Io(format!("打开链接失败: {e}")))?;
    }
    Ok(())
}

/// 导出设置备份：将设置 JSON 写入用户选择的文件（设置页「导出备份」）
#[tauri::command]
pub fn export_settings(path: String, content: String) -> Result<(), AppError> {
    std::fs::write(&path, content).map_err(|e| AppError::Io(format!("写入备份文件失败: {e}")))
}

/// 导入设置备份：读取备份文件内容返回给前端解析（设置页「导入备份」）
#[tauri::command]
pub fn import_settings(path: String) -> Result<String, AppError> {
    std::fs::read_to_string(&path).map_err(|e| AppError::Io(format!("读取备份文件失败: {e}")))
}
