import type { Settings } from "./types";

/** 默认设置（DESIGN-SPEC §1 / DESIGN.md §5.3） */
export const SETTINGS_DEFAULTS: Settings = {
  server: "",
  apiKey: "",
  domain: "https://cdn.assets-studio.dev",
  pathTemplate: "blog/{YYYY}/{MM}/{YYYYMMDD}-{HHmmss}-{seq}.{ext}",
  copyFormat: "url",
  quality: 80,
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
    if (typeof merged.server !== "string") return null;
    if (typeof merged.apiKey !== "string") return null;
    if (typeof merged.domain !== "string") return null;
    if (typeof merged.pathTemplate !== "string") return null;
    if (merged.copyFormat !== "url" && merged.copyFormat !== "markdown") return null;
    if (typeof merged.quality !== "number" || merged.quality < 1 || merged.quality > 100) return null;
    return merged;
  } catch {
    return null;
  }
};
