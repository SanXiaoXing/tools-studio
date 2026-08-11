use serde::{Deserialize, Serialize};

/// 图片处理策略（Architecture.md §3.2 / DECISIONS.md D-006）
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Preset {
    pub compression: Compression,
    pub conversion: Conversion,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Compression {
    pub enabled: bool,
    /// 1-100，仅对有损压缩（JPEG/WebP）生效，PNG 走 Oxipng 无损
    pub quality: u8,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Conversion {
    Keep,
    WebP,
}

impl Default for Preset {
    fn default() -> Self {
        Self {
            compression: Compression { enabled: true, quality: 85 },
            conversion: Conversion::WebP,
        }
    }
}
