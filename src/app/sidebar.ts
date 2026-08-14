import appIcon from "../assets/app-icon.png";
import { icon } from "../lib/icons";
import type { ViewName } from "../lib/types";
import { formatBytes } from "../lib/utils";

/** 导航仅保留视图切换项；上传入口统一为顶部 CTA（upload-cta），避免重复入口 */
const NAV: Array<{ view: ViewName; label: string; icon: string }> = [
  { view: "gallery", label: "浏览图片", icon: icon.image },
  { view: "settings", label: "设置", icon: icon.sliders },
  { view: "deploy", label: "部署 Worker", icon: icon.code },
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

export function renderSidebar(onNavigate: (v: ViewName) => void): Sidebar {
  const el = document.createElement("aside");
  el.className =
    "flex flex-col gap-5 shrink-0 bg-surface2 border-r border-line px-3.5 pt-4 pb-3.5 overflow-hidden " +
    "transition-[width] duration-300 ease-[cubic-bezier(.32,.72,.24,1)]";

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
    <a class="brand flex items-center gap-2.5 px-1.5 text-ink text-[15px] font-bold whitespace-nowrap" href="#">
      <img class="brand-icon shrink-0" src="${appIcon}" alt="" width="22" height="22"><span class="brand-name tracking-tight">Assets Studio</span>
    </a>
    <button class="upload-cta flex items-center justify-center gap-2 w-full h-[42px] rounded-[10px] bg-accent-strong text-white text-sm font-semibold hover:bg-accent active:scale-[.985] transition whitespace-nowrap" type="button">
      ${icon.upload}<span class="cta-label">上传图片</span>
    </button>
    <nav class="flex flex-col gap-1">${navHTML}</nav>
    <div class="flex-1"></div>
    <div class="storage px-2">
      <div class="flex justify-between text-xs text-ink3 mb-2 whitespace-nowrap tnum"><span>已用空间</span><span class="storage-text">0 B / 10.0 GB</span></div>
      <div class="h-1 rounded-full bg-line overflow-hidden"><div class="storage-bar h-full rounded-full bg-accent" style="width:0%"></div></div>
    </div>
    <button class="collapse-btn flex items-center gap-2.5 w-full px-3 py-2 rounded-[10px] text-ink2 text-[13px] hover:bg-surface3 hover:text-ink transition whitespace-nowrap" type="button" title="收起侧边栏">
      ${icon.panel}<span class="collapse-label">收起侧边栏</span>
    </button>`;

  const applyCollapsed = (now: boolean) => {
    el.classList.toggle("sidebar-collapsed", now);
    el.style.width = now ? "68px" : "236px";
    const cb = el.querySelector<HTMLButtonElement>(".collapse-btn");
    if (cb) {
      cb.title = now ? "展开侧边栏" : "收起侧边栏";
      cb.setAttribute("aria-label", cb.title);
    }
    el.querySelectorAll<HTMLElement>("[data-view]").forEach((n) => {
      n.style.justifyContent = now ? "center" : "";
      n.style.padding = now ? "10px" : "";
    });
  };
  applyCollapsed(collapsed);

  el.addEventListener("click", (e) => {
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
      collapsed = !collapsed;
      applyCollapsed(collapsed);
      try {
        localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
      } catch {
        /* 忽略 */
      }
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
