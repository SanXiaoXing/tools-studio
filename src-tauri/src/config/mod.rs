use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::error::AppError;

/// 应用配置（Architecture.md §5.1）：v1 无设置 UI，直接读 config.json
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    /// Worker API 地址，如 https://your-worker.workers.dev
    pub server: String,
    /// API Key，与 Worker 环境变量 API_KEY 一致
    pub api_key: String,
}

/// 配置文件路径：Windows `%USERPROFILE%\.assets-studio\config.json`，macOS `~/.assets-studio/config.json`
fn config_path() -> Result<PathBuf, AppError> {
    let home = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .ok_or_else(|| AppError::Config("无法定位用户主目录".into()))?;
    Ok(PathBuf::from(home).join(".assets-studio").join("config.json"))
}

/// 读取配置；文件不存在时返回默认值（server/apiKey 为空串，由前端提示填写）
pub fn load() -> Result<Config, AppError> {
    let path = config_path()?;
    let raw = match std::fs::read_to_string(&path) {
        Ok(raw) => raw,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Config::default()),
        Err(e) => return Err(AppError::Io(e.to_string())),
    };
    serde_json::from_str(&raw).map_err(|e| AppError::Config(format!("{path:?}: {e}")))
}

/// 保存 Worker 连接配置（server / apiKey）到 config.json。
/// 基于现有配置合并写入，保留 default_preset / default_output 等字段。
pub fn save(server: &str, api_key: &str) -> Result<(), AppError> {
    let mut cfg = load()?;
    cfg.server = server.trim().to_string();
    cfg.api_key = api_key.trim().to_string();
    let path = config_path()?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| AppError::Io(format!("创建配置目录失败: {e}")))?;
    }
    let json = serde_json::to_string_pretty(&cfg).map_err(|e| AppError::Config(format!("序列化配置失败: {e}")))?;
    std::fs::write(&path, json).map_err(|e| AppError::Io(format!("写入配置失败: {e}")))?;
    Ok(())
}

impl Default for Config {
    fn default() -> Self {
        Self {
            server: String::new(),
            api_key: String::new(),
        }
    }
}
