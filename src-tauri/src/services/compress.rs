use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::error::AppError;

/// 将图片转换为 WebP 以减小体积（有损编码，quality 1-100，越低体积越小）。
/// 解码用纯 Rust image crate，编码用 webp crate（libwebp 有损）。
/// 输出写入系统临时目录（不污染用户目录），返回 (输入大小, 输出大小, 输出路径)。
pub fn convert_to_webp(input: &Path, quality: f32) -> Result<(u64, u64, PathBuf), AppError> {
    let input_size = std::fs::metadata(input)
        .map_err(|e| AppError::Io(format!("读取元数据 {input:?} 失败: {e}")))?
        .len();
    let img = image::open(input).map_err(|e| AppError::Io(format!("读取图片 {input:?} 失败: {e}")))?;
    let encoder = webp::Encoder::from_image(&img)
        .map_err(|e| AppError::Io(format!("创建 WebP 编码器失败: {e}")))?;
    let webp = encoder.encode(quality.clamp(1.0, 100.0));

    // 临时目录 + 时间戳命名，避免同名冲突；系统临时目录由 OS 定期清理
    let dir = std::env::temp_dir().join("assets-studio");
    std::fs::create_dir_all(&dir).map_err(|e| AppError::Io(e.to_string()))?;
    let stem = input.file_stem().and_then(|s| s.to_str()).unwrap_or("image");
    let millis = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    let output = dir.join(format!("{stem}_{millis}.webp"));

    std::fs::write(&output, &*webp).map_err(|e| AppError::Io(e.to_string()))?;
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

        let (in_size, out_size, webp) = convert_to_webp(&png, 80.0).expect("转换失败");
        assert!(webp.exists(), "输出 WebP 应存在");
        assert!(in_size > 0 && out_size > 0, "输入输出大小应大于 0");
        assert!(out_size < in_size, "有损 WebP 应小于原图: {in_size} -> {out_size}");
        assert_ne!(webp, png, "输出不应覆盖输入文件");
        let out = image::open(&webp).expect("读取输出 WebP");
        assert_eq!((out.width(), out.height()), (256, 256), "尺寸应保持一致");

        let _ = std::fs::remove_file(png);
        let _ = std::fs::remove_file(webp);
    }
}
