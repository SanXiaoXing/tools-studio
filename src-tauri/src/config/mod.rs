use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::models::Preset;

/// 应用配置（Architecture.md §5.1）：v1 无设置 UI，直接读 config.json
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    /// Worker API 地址，如 https://your-worker.workers.dev
    pub server: String,
    /// API Key，与 Worker 环境变量 API_KEY 一致
    pub api_key: String,
    #[serde(default = "default_preset")]
    pub default_preset: Preset,
    #[serde(default = "default_output")]
    pub default_output: String,
}

fn default_preset() -> Preset {
    Preset::default()
}

fn default_output() -> String {
    "markdown".into()
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

impl Default for Config {
    fn default() -> Self {
        Self {
            server: String::new(),
            api_key: String::new(),
            default_preset: default_preset(),
            default_output: default_output(),
        }
    }
}
