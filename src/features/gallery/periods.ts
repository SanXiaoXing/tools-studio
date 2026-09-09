import type { ImageItem } from "../../lib/types";

/**
 * 图片按时间段（月）分桶。
 *
 * 图库规模增长后不再一次性渲染全部卡片，而是按月份分组，
 * 由 gallery.ts 的下拉框选择某个时间段渲染；分桶逻辑独立在此，便于复用与测试。
 * date 统一为 "YYYY-MM-DD HH:mm"（上传走 nowDate，云端走 formatCloudDate），
 * 无法解析的归入 "unknown"（沉底展示，不丢弃数据）。
 */

export interface PeriodGroup {
  /** "YYYY-MM"，无法解析日期时为 "unknown" */
  key: string;
  /** 展示文案，如 "2026年9月" / "未知时间" */
  label: string;
  /** 组内图片，保持传入顺序（调用方保证最新在前） */
  items: ImageItem[];
}

const MONTH_RE = /^\d{4}-\d{2}/;

/** 从格式化日期中提取月份桶 key；非法日期归入 "unknown" */
export const periodKeyOf = (date: string): string => (MONTH_RE.test(date) ? date.slice(0, 7) : "unknown");

/** 月份桶 key → 中文展示文案 */
export const periodLabel = (key: string): string => {
  if (key === "unknown") return "未知时间";
  const [y, m] = key.split("-");
  return `${y}年${Number(m)}月`;
};

/** 按月份分组：月份按时间倒序（新 → 旧），"unknown" 沉底；组内保持传入顺序 */
export function groupByPeriod(items: ImageItem[]): PeriodGroup[] {
  const map = new Map<string, ImageItem[]>();
  for (const it of items) {
    const key = periodKeyOf(it.date);
    const arr = map.get(key);
    if (arr) arr.push(it);
    else map.set(key, [it]);
  }
  const keys = [...map.keys()].filter((k) => k !== "unknown").sort().reverse();
  if (map.has("unknown")) keys.push("unknown");
  return keys.map((key) => ({ key, label: periodLabel(key), items: map.get(key)! }));
}
