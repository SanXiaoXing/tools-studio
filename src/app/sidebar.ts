import appIcon from "../assets/app-icon.png";
import { icon } from "../lib/icons";
import type { ViewName } from "../lib/types";
import { formatBytes } from "../lib/utils";

/** 导航仅保留视图切换项；上传入口统一为顶部 CTA（upload-cta），避免重复入口 */
const NAV: Array<{ view: ViewName; label: string; icon: string }> = [
  { view: "gallery", label: "浏览图片", icon: icon.image },
  { view: "settings", label: "设置", icon: icon.sliders },
];

const COLLAPSE_KEY = "as-collapsed";

/** 套餐存储额度（真实配额需后端返回，此处为前端默认值） */
const STORAGE_TOTAL = 10 * 1024 * 1024 * 1024; // 10 GB

export interface Sidebar {
  el: HTMLElement;
  navCount: HTMLElement;
  /** 用真实字节数刷新「已用空间」文案与进度条（套餐总额度为 STORAGE_TOTAL） */
  setStorage: (usedBytes: number) => void;
}

/** 侧边栏框架（docs/design/sidebar.md）：品牌头右上角内嵌折叠按钮 + CTA + 导航 + 底部空间用量。
 *  折叠态（68px 图标轨）：仅保留图标，右上角展开按钮不显示；点击顶部 logo 即可展开。 */
export function renderSidebar(onNavigate: (v: ViewName) => void): Sidebar {
  const el = document.createElement("aside");
  el.className =
    "sidebar flex flex-col shrink-0 bg-surface2 border-r border-line overflow-hidden";
  // 折叠宽度过渡由 styles.css 的 .sidebar 非分层规则声明（300ms cubic-bezier）

  let collapsed = false;
  try {
    collapsed = localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    /* 忽略 */
  }
  el.style.width = collapsed ? "68px" : "236px";

  const navHTML = NAV.map(
    (n) => `
    <a class="nav-item flex items-center gap-2.5 px-3 py-2.5 rounded-[10px] text-ink2 font-medium whitespace-nowrap hover:bg-surface3 hover:text-ink transition-colors" data-view="${n.view}" href="#${n.view}">
      ${n.icon}
      <span class="nav-label">${n.label}</span>
      ${n.view === "gallery" ? '<span class="nav-count ml-auto text-xs font-semibold px-2 py-0.5 rounded-full bg-line text-ink2 tnum">0</span>' : ""}
    </a>`,
  ).join("");

  el.innerHTML = `
    <header class="brand-row flex items-center gap-1 h-[52px] px-3.5 border-b border-line shrink-0">
      <a class="brand flex items-center gap-2.5 min-w-0 flex-1 text-ink text-[15px] font-bold whitespace-nowrap" href="#" title="Assets Studio">
        <img class="brand-icon shrink-0" src="${appIcon}" alt="" width="22" height="22"><span class="brand-name truncate tracking-tight">Assets Studio</span>
      </a>
      <button class="collapse-btn flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink2 hover:bg-surface3 hover:text-ink transition-colors" type="button" title="收起侧边栏" aria-label="收起侧边栏">${icon.panel}</button>
    </header>
    <div class="side-body flex min-h-0 flex-1 flex-col gap-3 px-3.5 pt-3.5 pb-3.5 overflow-hidden">
      <button class="upload-cta flex items-center justify-center gap-2 w-full h-[42px] rounded-[10px] bg-accent-strong text-white text-sm font-semibold hover:bg-accent active:scale-[.985] transition whitespace-nowrap" type="button" title="上传图片">
        ${icon.upload}<span class="cta-label">上传图片</span>
      </button>
      <nav class="flex flex-col gap-1">${navHTML}</nav>
      <div class="flex-1"></div>
      <div class="storage px-2">
        <div class="flex justify-between text-xs text-ink3 mb-2 whitespace-nowrap tnum"><span>已用空间</span><span class="storage-text">0 B / 10.0 GB</span></div>
        <div class="h-1 rounded-full bg-line overflow-hidden"><div class="storage-bar h-full rounded-full bg-accent" style="width:0%"></div></div>
      </div>
    </div>`;

  const applyCollapsed = (now: boolean) => {
    el.classList.toggle("sidebar-collapsed", now);
    el.style.width = now ? "68px" : "236px";
    // 折叠后 logo 即展开入口：更新其提示文案
    const brand = el.querySelector<HTMLElement>(".brand");
    if (brand) brand.title = now ? "展开侧边栏" : "Assets Studio";
    el.querySelectorAll<HTMLElement>("[data-view]").forEach((n) => {
      n.style.justifyContent = now ? "center" : "";
      n.style.padding = now ? "10px" : "";
    });
  };
  applyCollapsed(collapsed);

  const toggleCollapsed = (): void => {
    collapsed = !collapsed;
    applyCollapsed(collapsed);
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
    } catch {
      /* 忽略 */
    }
  };

  el.addEventListener("click", (e) => {
    // 折叠态下点击顶部 logo 展开（缩小时右上角无展开按钮，logo 即入口）
    const brand = (e.target as HTMLElement).closest(".brand");
    if (brand) {
      e.preventDefault();
      if (collapsed) toggleCollapsed();
      return;
    }
    const nav = (e.target as HTMLElement).closest("[data-view]");
    if (nav) {
      e.preventDefault();
      onNavigate(nav.getAttribute("data-view") as ViewName);
      return;
    }
    if ((e.target as HTMLElement).closest(".upload-cta")) {
      onNavigate("upload");
      return;
    }
    const cb = (e.target as HTMLElement).closest(".collapse-btn");
    if (cb) {
      toggleCollapsed();
    }
  });

  const navCount = el.querySelector<HTMLElement>(".nav-count")!;
  const storageText = el.querySelector<HTMLElement>(".storage-text")!;
  const storageBar = el.querySelector<HTMLElement>(".storage-bar")!;

  /** 用真实的累计字节数刷新「已用空间」文案与进度条 */
  const setStorage = (usedBytes: number): void => {
    const safe = Number.isFinite(usedBytes) && usedBytes > 0 ? usedBytes : 0;
    const pct = STORAGE_TOTAL > 0 ? Math.min(100, (safe / STORAGE_TOTAL) * 100) : 0;
    storageText.textContent = `${formatBytes(safe)} / ${formatBytes(STORAGE_TOTAL)}`;
    storageBar.style.width = pct + "%";
  };
  setStorage(0); // 初始无图片：已用 0

  return { el, navCount, setStorage };
}
