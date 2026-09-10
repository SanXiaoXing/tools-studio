import { getSettings } from "./settings";
import { pad2 } from "./utils";

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

/**
 * 生成不会覆盖已有对象的 R2 key。
 * - 模板含 {seq}：从 seedSeq 起递增，直到路径未被占用（跨批次也能按当天已有数量续号）。
 * - 模板不含 {seq}：若整路径冲突，在扩展名前追加 -1、2…。
 * isTaken 应返回「图库已有路径」或「本批次已分配路径」。
 */
export const resolveUniquePath = (
  name: string,
  ext: string,
  date: Date | undefined,
  seedSeq: number,
  isTaken: (path: string) => boolean,
): string => {
  const template = getSettings().pathTemplate;
  const d = date || new Date();
  const fill = (seq: number): string => fillTemplate(template, name, ext, d, seq);

  if (template.includes("{seq}")) {
    for (let s = seedSeq; s < seedSeq + 9999; s++) {
      const p = fill(s);
      if (!isTaken(p)) return p;
    }
    return fill(seedSeq);
  }

  const base = fill(seedSeq);
  if (!isTaken(base)) return base;
  const stem = base.toLowerCase().endsWith(`.${ext.toLowerCase()}`)
    ? base.slice(0, -(ext.length + 1))
    : base;
  for (let n = 1; n < 9999; n++) {
    const p = `${stem}-${n}.${ext}`;
    if (!isTaken(p)) return p;
  }
  return base;
};

/** 拆分文件名主体与扩展名 */
export const splitName = (name: string): { base: string; ext: string } => {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? { base: name.slice(0, dot), ext: name.slice(dot + 1) } : { base: name, ext: "" };
};

/**
 * 清洗文件名使其可用于 R2 key：
 * - 保留中文等 Unicode 字符（Worker 已支持）
 * - 非法字符（空格、引号、尖括号等）替换为 `-`
 * - 折叠连续 `-`、去掉首尾 `-` / `.`
 * 空结果回退 "image"（防止 key 为空导致上传失败）。
 */
export const sanitizeName = (name: string): string => {
  const cleaned = name
    .replace(/[^\p{L}\p{N}._-]/gu, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "");
  return cleaned || "image";
};
