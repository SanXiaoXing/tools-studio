import type { ImageItem } from "./types";
import { getSettings } from "./settings";
import { icon } from "./icons";

/** HTML 转义（所有插入 innerHTML 的文本必须经过） */
export const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

/** 补零到两位（日期/时间字段共用） */
export const pad2 = (n: number): string => String(n).padStart(2, "0");

/** 取路径最后一段文件名 */
export const basename = (p: string): string => p.split(/[\\/]/).pop() || p;

export const formatBytes = (b: number): string => {
  if (b < 1024) return b + " B";
  if (b < 1024 * 1024) return (b / 1024).toFixed(0) + " KB";
  if (b < 1024 * 1024 * 1024) return (b / (1024 * 1024)).toFixed(1) + " MB";
  return (b / (1024 * 1024 * 1024)).toFixed(1) + " GB";
};

/** 反向解析大小字符串（如 "1.8 MB"、"348 KB"、"24 KB"、"5.6 MB"）为字节数；解析失败返回 0 */
const SIZE_UNIT: Record<string, number> = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 };
export const parseSizeToBytes = (s: string): number => {
  const m = s.trim().match(/^([\d.]+)\s*(B|KB|MB|GB|TB)$/i);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  return Number.isFinite(n) ? n * (SIZE_UNIT[m[2].toUpperCase()] ?? 1) : 0;
};

/** 把 Tauri 返回的错误对象/字符串统一转成可读文本。
 * Rust 的 AppError enum 默认序列化成 {"Config":"..."} / {"Io":"..."}，
 * 直接用 String(e) 会得到 [object Object]，需要提取或 JSON 化。 */
export const errorMessage = (e: unknown): string => {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  if (e && typeof e === "object") {
    const obj = e as Record<string, unknown>;
    if (typeof obj.message === "string") return obj.message;
    try {
      return JSON.stringify(e);
    } catch {
      return "未知错误";
    }
  }
  return String(e);
};

export const nowDate = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

/** API Key 固定前缀：`as` = 产品标识（Assets Studio），`live` = 环境。
 * 体现产品身份而非个人身份（WORKER-V2.md §2 决策 7），未来可扩展 as_test_ / as_dev_。
 */
const API_KEY_PREFIX = "as_live_";

/** 随机段字符集：Crockford Base32（去掉 I/L/O/U 易混淆字符），每字符 5 位熵；256 % 32 == 0，无取模偏差 */
const KEY_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * 生成规则化的 API Key：`as_live_` 前缀 + 4 段 × 4 字符随机（Crockford Base32），
 * 形如 `as_live_K7FM-92QX-W8PT-4N6C`（16 字符 ≈ 80 位熵，短小易读且足够安全）。
 */
export const generateApiKey = (): string => {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const chars = Array.from(bytes, (b) => KEY_ALPHABET[b % KEY_ALPHABET.length]);
  const segments: string[] = [];
  for (let i = 0; i < chars.length; i += 4) {
    segments.push(chars.slice(i, i + 4).join(""));
  }
  return API_KEY_PREFIX + segments.join("-");
};

/** 读取图片真实尺寸（上传预览用） */
export const readDims = (url: string, cb: (w: number | null, h: number | null) => void): void => {
  const img = new Image();
  img.onload = () => cb(img.naturalWidth, img.naturalHeight);
  img.onerror = () => cb(null, null);
  img.src = url;
};

/** 图片地址：优先本地 objectURL（上传转换产物），云端恢复的图片（无 objectURL）回退到公开 URL */
export const imgSrc = (it: ImageItem): string => it.objectURL || it.url || "";

/** 底部轻提示（单例；浅色深底 / 深色浅底由 CSS 变量自动反转） */
let toastEl: HTMLElement | null = null;
let toastTimer: number | undefined;

export const showToast = (msg: string): void => {
  if (!toastEl) {
    toastEl = document.createElement("div");
    toastEl.className =
      "fixed left-1/2 bottom-7 z-[60] -translate-x-1/2 translate-y-2 rounded-full px-4 py-2 text-[13px] font-medium shadow-modal opacity-0 transition-all duration-200 pointer-events-none";
    toastEl.style.background = "var(--color-ink)";
    toastEl.style.color = "var(--color-canvas)";
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = msg;
  window.clearTimeout(toastTimer);
  requestAnimationFrame(() => toastEl!.classList.add("opacity-100", "translate-y-0"));
  toastTimer = window.setTimeout(() => {
    toastEl!.classList.remove("opacity-100", "translate-y-0");
  }, 2000);
};

/** 复制文本，clipboard API 失败时降级 execCommand（file:// 等环境） */
export const copyText = async (t: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(t);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = t;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
};

/** 按设置的链接格式生成复制内容：纯 URL 或 Markdown 图片语法。
 * 优先用上传返回的完整 URL，未上传（mock）时回退 domain+path 拼接 */
export const formatContent = (it: { path: string; name: string; url?: string }): string => {
  const url = it.url || `${getSettings().domain}/${it.path}`;
  return getSettings().copyFormat === "markdown" ? `![${it.name}](${url})` : url;
};

/** 复制成功反馈：按钮变绿显示 ✓（可附文字标签，如「已复制」），delay 后恢复（DESIGN-SPEC §6） */
export const feedbackCheck = (btn: HTMLButtonElement, label = "", delay = 1600): void => {
  const old = btn.innerHTML;
  btn.style.background = "var(--color-ok)";
  btn.innerHTML = icon.check + label;
  window.setTimeout(() => {
    btn.style.background = "";
    btn.innerHTML = old;
  }, delay);
};
