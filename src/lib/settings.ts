import type { Settings } from "./types";

/** 命名方式默认预设模板：切换 mode 时若该 mode 尚无自定义记录则使用这些 */
export const NAME_MODE_DEFAULT_TEMPLATES: Settings["nameModeTemplates"] = {
  auto: "blog/{YYYY}/{MM}/{YYYYMMDD}-{HHmmss}-{seq}.{ext}",
  original: "blog/{YYYY}/{MM}/{name}.{ext}",
};

/** 默认设置（DESIGN-SPEC §1 / DESIGN.md §5.3）；连接信息（server/apiKey）在 Rust config.json */
export const SETTINGS_DEFAULTS: Settings = {
  domain: "https://cdn.assets-studio.dev",
  pathTemplate: NAME_MODE_DEFAULT_TEMPLATES.auto,
  copyFormat: "url",
  quality: 80,
  theme: "system",
  nameMode: "auto",
  nameModeTemplates: { ...NAME_MODE_DEFAULT_TEMPLATES },
};

/** 旧版备份/本地存储缺 nameModeTemplates 时：当前 mode 用现行 pathTemplate，另一 mode 用预设 */
function withNameModeTemplates(merged: Settings, rawTemplates?: Settings["nameModeTemplates"]): Settings {
  if (rawTemplates && typeof rawTemplates.auto === "string" && typeof rawTemplates.original === "string") {
    return { ...merged, nameModeTemplates: rawTemplates };
  }
  return {
    ...merged,
    nameModeTemplates: {
      ...NAME_MODE_DEFAULT_TEMPLATES,
      [merged.nameMode]: merged.pathTemplate || NAME_MODE_DEFAULT_TEMPLATES[merged.nameMode],
    },
  };
}

let settings: Settings = load();

function load(): Settings {
  try {
    const raw = localStorage.getItem("as-settings");
    if (!raw) return { ...SETTINGS_DEFAULTS };
    const data = JSON.parse(raw) as Partial<Settings>;
    const merged: Settings = { ...SETTINGS_DEFAULTS, ...data };
    return withNameModeTemplates(merged, data.nameModeTemplates);
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
    if (merged.nameMode !== "auto" && merged.nameMode !== "original") return null;
    return withNameModeTemplates(merged, data.nameModeTemplates);
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
