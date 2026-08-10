import type { Settings } from "./types";

/** 默认设置（DESIGN-SPEC §1 / DESIGN.md §5.3） */
export const SETTINGS_DEFAULTS: Settings = {
  domain: "https://cdn.assets-studio.dev",
  pathTemplate: "blog/{YYYY}/{MM}/{YYYYMMDD}.{ext}",
  renameFind: "",
  renameReplace: "",
  copyFormat: "url",
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

/** 正则重命名（作用于文件名主体，扩展名不变） */
export const applyRename = (base: string): string => {
  if (!settings.renameFind) return base;
  try {
    return base.replace(new RegExp(settings.renameFind, "g"), settings.renameReplace);
  } catch {
    return base;
  }
};

/** 填充路径模板占位符（设置页预览与上传流程共用） */
export const fillTemplate = (template: string, name: string, ext: string, date?: Date): string => {
  const d = date || new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const vars: Record<string, string> = {
    "{YYYY}": String(d.getFullYear()),
    "{MM}": p(d.getMonth() + 1),
    "{DD}": p(d.getDate()),
    "{YYYYMMDD}": `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`,
    "{name}": name,
    "{ext}": ext,
  };
  let out = template || "";
  for (const k of Object.keys(vars)) out = out.split(k).join(vars[k]);
  return out;
};

/** 按上传日期填充路径模板：月份随当前日期自动更新（DESIGN.md §5.2） */
export const buildPath = (name: string, ext: string, date?: Date): string =>
  fillTemplate(settings.pathTemplate, name, ext, date);

/** 拆分文件名主体与扩展名 */
export const splitName = (name: string): { base: string; ext: string } => {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? { base: name.slice(0, dot), ext: name.slice(dot + 1) } : { base: name, ext: "" };
};

export const extToType = (name: string): string => {
  const ext = name.split(".").pop()!.toLowerCase();
  const map: Record<string, string> = {
    png: "PNG", jpg: "JPG", jpeg: "JPG", webp: "WEBP",
    avif: "AVIF", gif: "GIF", svg: "SVG",
  };
  return map[ext] || (ext ? ext.toUpperCase() : "IMAGE");
};
