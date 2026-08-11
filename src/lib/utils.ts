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
  return (b / (1024 * 1024)).toFixed(1) + " MB";
};

export const nowDate = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

/** 读取图片真实尺寸（上传预览用） */
export const readDims = (url: string, cb: (w: number | null, h: number | null) => void): void => {
  const img = new Image();
  img.onload = () => cb(img.naturalWidth, img.naturalHeight);
  img.onerror = () => cb(null, null);
  img.src = url;
};

/** mock 缩略图（原型演示用；真实上传图走 objectURL） */
const thumb = (seed: string, w = 640, h = 480): string =>
  `https://picsum.photos/seed/${seed}/${w}/${h}`;

export const imgSrc = (it: ImageItem, w = 640, h = 480): string =>
  it.objectURL || thumb(it.seed || it.name, w, h);

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

/** 复制按钮成功反馈：变绿「已复制」（DESIGN-SPEC §6） */
export const feedbackCopied = (btn: HTMLButtonElement, delay = 1600): void => {
  const old = btn.innerHTML;
  btn.style.background = "var(--color-ok)";
  btn.innerHTML = icon.check + "已复制";
  window.setTimeout(() => {
    btn.style.background = "";
    btn.innerHTML = old;
  }, delay);
};
