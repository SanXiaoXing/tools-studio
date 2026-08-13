import type { Settings } from "./types";

/** 默认设置（DESIGN-SPEC §1 / DESIGN.md §5.3）；连接信息（server/apiKey）在 Rust config.json */
export const SETTINGS_DEFAULTS: Settings = {
  domain: "https://cdn.assets-studio.dev",
  pathTemplate: "blog/{YYYY}/{MM}/{YYYYMMDD}-{HHmmss}-{seq}.{ext}",
  copyFormat: "url",
  quality: 80,
  theme: "system",
};

let settings: Settings = load();

function load(): Settings {
  try {
    const raw = localStorage.getItem("as-settings");
    return raw ? { ...SETTINGS_DEFAULTS, ...JSON.parse(raw) } : { ...SETTINGS_DEFAULTS };
  } catch {
    return { ...SETTINGS_DEFAULTS };
  }
}

export const getSettings = (): Settings => settings;

/** 统一保存入口：合并补丁字段后持久化，所有设置写入必须走这里（DESIGN-SPEC §3.4） */
export const updateSettings = (patch: Partial<Settings>): void => {
  settings = { ...settings, ...patch };
  try {
    localStorage.setItem("as-settings", JSON.stringify(settings));
  } catch {
    /* 忽略 */
  }
};

/** 解析备份 JSON 为完整设置；结构非法时返回 null（备份导入用，未知字段丢弃） */
export const parseSettingsBackup = (raw: string): Settings | null => {
  try {
    const data = JSON.parse(raw) as Partial<Settings>;
    if (!data || typeof data !== "object") return null;
    const merged: Settings = { ...SETTINGS_DEFAULTS, ...data };
    if (typeof merged.domain !== "string") return null;
    if (typeof merged.pathTemplate !== "string") return null;
    if (merged.copyFormat !== "url" && merged.copyFormat !== "markdown") return null;
    if (typeof merged.quality !== "number" || merged.quality < 1 || merged.quality > 100) return null;
    if (merged.theme !== "system" && merged.theme !== "dark" && merged.theme !== "light") return null;
    return merged;
  } catch {
    return null;
  }
};

/** 从备份 JSON 中提取 Worker 连接信息（server / apiKey）。
 *  连接信息存 Rust config.json（WORKER-V2.md §7），导入时需单独写回；
 *  旧版备份未含这些字段时返回 null。 */
export const parseConnectionBackup = (raw: string): { server: string; apiKey: string } | null => {
  try {
    const data = JSON.parse(raw) as Record<string, unknown>;
    if (typeof data.server !== "string" || typeof data.apiKey !== "string") return null;
    return { server: data.server, apiKey: data.apiKey };
  } catch {
    return null;
  }
};
