import type { Settings } from "./types";

/** 默认设置（DESIGN-SPEC §1 / DESIGN.md §5.3） */
export const SETTINGS_DEFAULTS: Settings = {
  domain: "https://cdn.assets-studio.dev",
  pathTemplate: "blog/{YYYY}/{MM}/{YYYYMMDD}-{HHmmss}-{seq}.{ext}",
  renameFind: "",
  renameReplace: "",
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

export const saveSettings = (next: Settings): void => {
  settings = next;
  try {
    localStorage.setItem("as-settings", JSON.stringify(next));
  } catch {
    /* 忽略 */
  }
};
