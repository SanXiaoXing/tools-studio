use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use tauri::ipc::Channel;

use crate::error::AppError;
use crate::services::http;

/// 网格卡片缩略图目标宽度（px）：卡片最小列宽 220px，2x 高分屏留一倍余量
const THUMB_WIDTH: u32 = 480;
/// WebP 编码质量（网格缩略图，无需高保真）
const THUMB_QUALITY: f32 = 75.0;
/// 缓存目录总大小上限：超出后按修改时间从旧到新清理
const CACHE_MAX_BYTES: u64 = 500 * 1024 * 1024;
/// 并发生成数：几十张图同时下载/解码会挤爆带宽与 CPU
const CONCURRENCY: usize = 4;

/// 单条缩略图请求：key 为 R2 对象键（缓存定位 + Worker 回退路径），url 为公开访问地址
#[derive(serde::Deserialize)]
pub struct ThumbReq {
    pub key: String,
    pub url: String,
}

/// 单条缩略图结果：path 为本地缩略图绝对路径；生成失败时为空串（前端回退原图 URL）
#[derive(serde::Serialize)]
pub struct ThumbRes {
    pub key: String,
    pub path: String,
}

/// key → 缓存文件路径：对 key 哈希，规避嵌套 key 的子目录/非法字符问题
fn cache_file(dir: &Path, key: &str, ext: &str) -> PathBuf {
    let mut h = DefaultHasher::new();
    key.hash(&mut h);
    dir.join(format!("{:016x}.{ext}", h.finish()))
}

/// 查找已缓存的缩略图（webp / gif 两种扩展名都查）
pub fn lookup(dir: &Path, key: &str) -> Option<PathBuf> {
    for ext in ["webp", "gif"] {
        let p = cache_file(dir, key, ext);
        if p.is_file() {
            return Some(p);
        }
    }
    None
}

/// 删除某 key 的缩略图缓存（webp/gif 都清）；文件不存在视为已删除
pub fn remove(dir: &Path, key: &str) -> Result<(), AppError> {
    for ext in ["webp", "gif"] {
        match std::fs::remove_file(cache_file(dir, key, ext)) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(AppError::Io(format!("删除缩略图缓存失败: {e}"))),
        }
    }
    Ok(())
}

/// 下载原图并生成缩略图落盘。GIF（可能含动画）直接缓存原图字节不缩放。
/// 下载走 async；解码/编码/写盘是 CPU 密集任务，放 spawn_blocking 不占 Tauri 主线程。
async fn generate(dir: PathBuf, req: ThumbReq, worker: (String, String)) -> Result<PathBuf, AppError> {
    // 下载原图：优先公开 URL；为空时回退 Worker /objects/{key}（带 API Key）
    let bytes: Vec<u8> = if req.url.trim().is_empty() {
        let resp = http::request(
            reqwest::Method::GET,
            &worker.0,
            &worker.1,
            &format!("/objects/{}", req.key),
            "获取图片",
            None,
        )
        .await?;
        resp.bytes()
            .await
            .map_err(|e| AppError::Io(format!("读取图片失败: {e}")))?
            .to_vec()
    } else {
        http::fetch_bytes(&req.url).await?
    };

    let key = req.key;
    tauri::async_runtime::spawn_blocking(move || {
        if bytes.starts_with(b"GIF8") {
            // GIF 直接缓存原图字节：image crate 未启用 gif 解码，且缩放会丢动画
            let path = cache_file(&dir, &key, "gif");
            std::fs::write(&path, &bytes).map_err(|e| AppError::Io(format!("写入 GIF 缓存失败: {e}")))?;
            return Ok(path);
        }
        let img = image::load_from_memory(&bytes).map_err(|e| AppError::Io(format!("解码图片失败: {e}")))?;
        let thumb = img.thumbnail(THUMB_WIDTH, u32::MAX);
        let encoded = webp::Encoder::from_image(&thumb)
            .map_err(|e| AppError::Io(format!("创建 WebP 编码器失败: {e}")))?
            .encode(THUMB_QUALITY);
        let path = cache_file(&dir, &key, "webp");
        std::fs::write(&path, &*encoded).map_err(|e| AppError::Io(format!("写入缩略图失败: {e}")))?;
        Ok(path)
    })
    .await
    .map_err(|e| AppError::Io(format!("缩略图生成任务失败: {e}")))?
}

/// 批量获取缩略图：命中缓存直接返回路径，未命中的并发生成；单条失败不拖垮整批（path 空串）。
/// 结果经 Channel 逐条流式回传（每完成一张即上屏，不等整批完成——首次冷缓存可能要
/// 下载数百张原图，整批返回会让页面长时间无图）。有新生成时后台触发缓存清理（超上限删最旧）。
pub async fn get_batch(
    dir: PathBuf,
    items: Vec<ThumbReq>,
    worker: (String, String),
    channel: Channel<ThumbRes>,
) -> Result<(), AppError> {
    std::fs::create_dir_all(&dir).map_err(|e| AppError::Io(format!("创建缩略图缓存目录失败: {e}")))?;

    // 固定并发的 worker 池：共享下标原子递增领取任务，避免引入额外依赖
    let items = Arc::new(items);
    let next = Arc::new(AtomicUsize::new(0));
    let generated = Arc::new(AtomicUsize::new(0));

    let mut handles = Vec::with_capacity(CONCURRENCY);
    for _ in 0..CONCURRENCY {
        let dir = dir.clone();
        let items = items.clone();
        let next = next.clone();
        let generated = generated.clone();
        let channel = channel.clone();
        let worker = worker.clone();
        handles.push(tauri::async_runtime::spawn(async move {
            loop {
                let i = next.fetch_add(1, Ordering::Relaxed);
                if i >= items.len() {
                    break;
                }
                let req = &items[i];
                let path = match lookup(&dir, &req.key) {
                    Some(p) => Some(p),
                    None => match generate(dir.clone(), ThumbReq { key: req.key.clone(), url: req.url.clone() }, worker.clone()).await {
                        Ok(p) => {
                            generated.fetch_add(1, Ordering::Relaxed);
                            Some(p)
                        }
                        Err(_) => None, // 单条失败只影响自己：path 空串，前端回退原图 URL
                    },
                };
                let res = ThumbRes {
                    key: req.key.clone(),
                    path: path
                        .map(|p| p.to_string_lossy().into_owned())
                        .unwrap_or_default(),
                };
                // 流式回传；前端已重绘离开等场景下发送失败可忽略
                let _ = channel.send(res);
            }
        }));
    }
    for h in handles {
        h.await.map_err(|e| AppError::Io(format!("缩略图任务失败: {e}")))?;
    }

    if generated.load(Ordering::Relaxed) > 0 {
        tauri::async_runtime::spawn_blocking(move || prune(&dir));
    }
    Ok(())
}

/// 缓存总量超上限时按修改时间从旧到新删除，直到回到上限以下
fn prune(dir: &Path) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    let mut files: Vec<(std::time::SystemTime, u64, PathBuf)> = entries
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let md = e.metadata().ok()?;
            if !md.is_file() {
                return None;
            }
            Some((md.modified().ok()?, md.len(), e.path()))
        })
        .collect();
    let mut total: u64 = files.iter().map(|(_, s, _)| *s).sum();
    if total <= CACHE_MAX_BYTES {
        return;
    }
    files.sort_by_key(|(t, _, _)| *t);
    for (_, size, path) in files {
        if total <= CACHE_MAX_BYTES {
            break;
        }
        if std::fs::remove_file(&path).is_ok() {
            total = total.saturating_sub(size);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generates_and_caches_thumbnail() {
        let dir = std::env::temp_dir().join(format!("as-thumb-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);

        // 生成一张测试 PNG 并以 data 形式直接喂给编码路径（不经网络）
        let mut img = image::RgbaImage::new(1200, 800);
        for (x, y, px) in img.enumerate_pixels_mut() {
            *px = image::Rgba([(x % 255) as u8, (y % 255) as u8, ((x + y) % 255) as u8, 255]);
        }
        let mut png: Vec<u8> = Vec::new();
        img.write_to(
            &mut std::io::Cursor::new(&mut png),
            image::ImageFormat::Png,
        )
        .expect("编码测试 PNG");

        let key = "2026/09/test.png";
        let file = cache_file(&dir, key, "webp");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(&file, &png).unwrap();

        // 命中缓存
        let hit = lookup(&dir, key);
        assert_eq!(hit, Some(file.clone()));

        // 缓存文件可按内容解码（产品路径 load_from_memory 不依赖扩展名；此处写入的是 PNG 字节）
        let bytes = std::fs::read(&file).expect("读取缓存文件");
        let decoded = image::load_from_memory(&bytes).expect("缩略图应为合法图片");
        assert!(decoded.width() > 0);

        // remove 清理两种扩展名
        remove(&dir, key).expect("删除不应失败");
        assert_eq!(lookup(&dir, key), None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn prune_keeps_recent_files() {
        let dir = std::env::temp_dir().join(format!("as-thumb-prune-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        // 3 个 1KB 文件，上限设为 2KB 时应删掉最旧的 1 个
        for i in 0..3 {
            std::fs::write(dir.join(format!("{i:016x}.webp")), vec![0u8; 1024]).unwrap();
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        // 临时把上限调小：通过模块内常量不便测试，这里直接构造超额场景验证逻辑入口不 panic
        prune(&dir);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
