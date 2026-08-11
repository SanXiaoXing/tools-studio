import { getSettings } from "./settings";
import { pad2 } from "./utils";

/** 正则重命名（作用于文件名主体，扩展名不变），按设置中的查找/替换规则 */
export const applyRename = (base: string): string => {
  const { renameFind, renameReplace } = getSettings();
  if (!renameFind) return base;
  try {
    return base.replace(new RegExp(renameFind, "g"), renameReplace);
  } catch {
    return base;
  }
};

/** 填充路径模板占位符（设置页预览与上传流程共用）。
 * 支持：{YYYY} 年、{MM} 月、{DD} 日、{YYYYMMDD} 年月日、{HHmmss} 时分秒、
 * {seq} 批次内序号（同秒多图区分）、{name} 重命名后文件名、{ext} 扩展名 */
export const fillTemplate = (template: string, name: string, ext: string, date?: Date, seq = 1): string => {
  const d = date || new Date();
  const vars: Record<string, string> = {
    "{YYYY}": String(d.getFullYear()),
    "{MM}": pad2(d.getMonth() + 1),
    "{DD}": pad2(d.getDate()),
    "{YYYYMMDD}": `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`,
    "{HHmmss}": `${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`,
    "{seq}": String(seq),
    "{name}": name,
    "{ext}": ext,
  };
  let out = template || "";
  for (const k of Object.keys(vars)) out = out.split(k).join(vars[k]);
  return out;
};

/** 按设置中的路径模板生成归档路径（月份随当前日期自动更新，DESIGN.md §5.2） */
export const buildPath = (name: string, ext: string, date?: Date, seq = 1): string =>
  fillTemplate(getSettings().pathTemplate, name, ext, date, seq);

/** 拆分文件名主体与扩展名 */
export const splitName = (name: string): { base: string; ext: string } => {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? { base: name.slice(0, dot), ext: name.slice(dot + 1) } : { base: name, ext: "" };
};
