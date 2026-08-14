use std::path::PathBuf;
use std::sync::{Arc, RwLock};

use serde::{Deserialize, Serialize};

use crate::error::AppError;

/// 进程级配置缓存（持久作用域）：通过 Tauri State 注入，避免每个命令重复读盘 + 解析。
/// `list_images` 分页拉取时多次调用同一命令会反复 `load()`，缓存后只读内存。
/// ponytail: 用 std::sync::RwLock 而非 tokio——读写临界区仅 clone 几个 String（纳秒级），
/// 不会阻塞 async runtime；升级路径：配置热重载或多写者竞争时换 tokio::RwLock。
pub type ConfigState = Arc<RwLock<Config>>;

/// 启动时加载一次配置到内存缓存；文件不存在 / 解析失败时用默认值（空 server/apiKey）。
pub fn init_state() -> ConfigState {
    Arc::new(RwLock::new(load().unwrap_or_default()))
}

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

/// 将内存中的配置写入磁盘（替代旧 `save`：状态已由 ConfigState 持有，写盘无需再 load 合并）。
pub fn write(cfg: &Config) -> Result<(), AppError> {
    let path = config_path()?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| AppError::Io(format!("创建配置目录失败: {e}")))?;
    }
    let json = serde_json::to_string_pretty(cfg).map_err(|e| AppError::Config(format!("序列化配置失败: {e}")))?;
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
