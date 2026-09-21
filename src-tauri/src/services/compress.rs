use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::error::AppError;

/// 目标目录内生成不覆盖已有文件的路径：stem.ext → stem-1.ext → …
fn unique_output(dir: &Path, stem: &str, ext: &str) -> PathBuf {
    let mut p = dir.join(format!("{stem}.{ext}"));
    let mut n = 1u32;
    while p.exists() {
        p = dir.join(format!("{stem}-{n}.{ext}"));
        n += 1;
    }
    p
}

/// 将图片转换为 WebP 以减小体积（有损编码，quality 1-100，越低体积越小）。
/// 解码用纯 Rust image crate，编码用 webp crate（libwebp 有损）。
/// output_dir 为 None 时写入系统临时目录；为 Some 时直接写到用户目录并自动去重命名。
/// 返回 (输入大小, 输出大小, 输出路径)。
pub fn convert_to_webp(
    input: &Path,
    quality: f32,
    output_dir: Option<&Path>,
) -> Result<(u64, u64, PathBuf), AppError> {
    let input_size = std::fs::metadata(input)
        .map_err(|e| AppError::Io(format!("读取元数据 {input:?} 失败: {e}")))?
        .len();
    let img = image::open(input).map_err(|e| AppError::Io(format!("读取图片 {input:?} 失败: {e}")))?;
    let encoder = webp::Encoder::from_image(&img)
        .map_err(|e| AppError::Io(format!("创建 WebP 编码器失败: {e}")))?;
    let webp = encoder.encode(quality.clamp(1.0, 100.0));

    let stem = input.file_stem().and_then(|s| s.to_str()).unwrap_or("image");
    let output = match output_dir {
        Some(dir) => {
            std::fs::create_dir_all(dir).map_err(|e| AppError::Io(e.to_string()))?;
            unique_output(dir, stem, "webp")
        }
        None => {
            let dir = std::env::temp_dir().join("assets-studio");
            std::fs::create_dir_all(&dir).map_err(|e| AppError::Io(e.to_string()))?;
            let millis = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_millis())
                .unwrap_or(0);
            dir.join(format!("{stem}_{millis}.webp"))
        }
    };

    std::fs::write(&output, &*webp).map_err(|e| AppError::Io(e.to_string()))?;
    let output_size = std::fs::metadata(&output)
        .map_err(|e| AppError::Io(format!("读取输出大小 {output:?} 失败: {e}")))?
        .len();
    Ok((input_size, output_size, output))
}

/// quality 1-100 → VP9 CRF（越低画质越好）。q=80 ≈ 21，q=50 ≈ 31，q=20 ≈ 41
fn quality_to_crf(quality: f32) -> String {
    let crf = ((100.0 - quality.clamp(1.0, 100.0)) * 0.32 + 15.0).clamp(15.0, 50.0);
    format!("{crf:.0}")
}

/// 将视频压缩为 WebM（VP9 + Opus），依赖系统 PATH 中的 ffmpeg（D-001 纯 Rust 约束只覆盖图片）。
/// 输出写入 output_dir，重名自动 -1 去重。返回 (输入大小, 输出大小, 输出路径)。
pub fn compress_video_to_webm(
    input: &Path,
    quality: f32,
    output_dir: &Path,
) -> Result<(u64, u64, PathBuf), AppError> {
    let input_size = std::fs::metadata(input)
        .map_err(|e| AppError::Io(format!("读取元数据 {input:?} 失败: {e}")))?
        .len();
    std::fs::create_dir_all(output_dir).map_err(|e| AppError::Io(e.to_string()))?;

    let stem = input.file_stem().and_then(|s| s.to_str()).unwrap_or("video");
    let output = unique_output(output_dir, stem, "webm");
    let crf = quality_to_crf(quality);

    let input_s = input.to_string_lossy().into_owned();
    let output_s = output.to_string_lossy().into_owned();

    let result = Command::new("ffmpeg")
        .args(["-y", "-hide_banner", "-loglevel", "error", "-i", &input_s])
        .args(["-c:v", "libvpx-vp9", "-crf", &crf, "-b:v", "0"])
        .args(["-deadline", "good", "-cpu-used", "4"])
        .args(["-c:a", "libopus", "-b:a", "96k"])
        .arg(&output_s)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output();

    let out = match result {
        Ok(o) => o,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Err(AppError::Io(
                "未找到 ffmpeg，请先安装并加入系统 PATH 后重试".into(),
            ))
        }
        Err(e) => return Err(AppError::Io(format!("启动 ffmpeg 失败: {e}"))),
    };

    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        let msg = stderr.lines().rev().take(3).collect::<Vec<_>>().join(" ");
        return Err(AppError::Io(format!(
            "ffmpeg 转码失败: {}",
            if msg.is_empty() { out.status.to_string() } else { msg }
        )));
    }

    let output_size = std::fs::metadata(&output)
        .map_err(|e| AppError::Io(format!("读取输出大小 {output:?} 失败: {e}")))?
        .len();
    Ok((input_size, output_size, output))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_png_to_webp_smaller() {
        let dir = std::env::temp_dir();
        let png = dir.join("as-test-in.png");

        // 生成有细节的图片，保证有损压缩明显缩小体积
        let mut img = image::RgbaImage::new(256, 256);
        for (x, y, px) in img.enumerate_pixels_mut() {
            *px = image::Rgba([(x * 7) as u8, (y * 11) as u8, ((x + y) * 3) as u8, 255]);
        }
        img.save(&png).expect("写入测试 PNG");

        let (in_size, out_size, webp) = convert_to_webp(&png, 80.0, None).expect("转换失败");
        assert!(webp.exists(), "输出 WebP 应存在");
        assert!(in_size > 0 && out_size > 0, "输入输出大小应大于 0");
        assert!(out_size < in_size, "有损 WebP 应小于原图: {in_size} -> {out_size}");
        assert_ne!(webp, png, "输出不应覆盖输入文件");
        let out = image::open(&webp).expect("读取输出 WebP");
        assert_eq!((out.width(), out.height()), (256, 256), "尺寸应保持一致");

        let _ = std::fs::remove_file(png);
        let _ = std::fs::remove_file(webp);
    }

    #[test]
    fn writes_to_custom_dir_and_avoids_overwrite() {
        let dir = std::env::temp_dir().join("as-test-outdir");
        std::fs::create_dir_all(&dir).ok();
        let png = dir.join("as-test-custom.png");
        let mut img = image::RgbaImage::new(64, 64);
        for (x, y, px) in img.enumerate_pixels_mut() {
            *px = image::Rgba([x as u8 * 2, y as u8 * 2, 128, 255]);
        }
        img.save(&png).expect("写入测试 PNG");

        let (_, _, a) = convert_to_webp(&png, 80.0, Some(&dir)).expect("第一次");
        let (_, _, b) = convert_to_webp(&png, 80.0, Some(&dir)).expect("第二次");
        assert!(a.exists() && b.exists());
        assert_ne!(a, b, "重复文件名应去重");
        assert!(a.starts_with(&dir) && b.starts_with(&dir));

        let _ = std::fs::remove_file(png);
        let _ = std::fs::remove_file(a);
        let _ = std::fs::remove_file(b);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn quality_to_crf_maps_reasonably() {
        assert_eq!(quality_to_crf(80.0), "21");
        assert_eq!(quality_to_crf(50.0), "31");
        assert_eq!(quality_to_crf(1.0), "47");
        assert_eq!(quality_to_crf(100.0), "15");
    }
}
