import { icon } from "../lib/icons";
import type { ViewName } from "../lib/types";

const NAV: Array<{ view: ViewName; label: string; icon: string }> = [
  { view: "gallery", label: "浏览图片", icon: icon.image },
  { view: "upload", label: "上传图片", icon: icon.upload },
  { view: "settings", label: "设置", icon: icon.sliders },
];

const COLLAPSE_KEY = "as-collapsed";

export interface Sidebar {
  el: HTMLElement;
  navCount: HTMLElement;
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
      ${icon.brand}<span class="brand-name tracking-tight">Assets Studio</span>
    </a>
    <button class="upload-cta flex items-center justify-center gap-2 w-full h-[42px] rounded-[10px] bg-accent-strong text-white text-sm font-semibold hover:bg-accent active:scale-[.985] transition whitespace-nowrap" type="button">
      ${icon.upload}<span class="cta-label">上传图片</span>
    </button>
    <nav class="flex flex-col gap-1">${navHTML}</nav>
    <div class="flex-1"></div>
    <div class="storage px-2">
      <div class="flex justify-between text-xs text-ink3 mb-2 whitespace-nowrap tnum"><span>已用空间</span><span>2.4 / 10 GB</span></div>
      <div class="h-1 rounded-full bg-line overflow-hidden"><div class="h-full rounded-full bg-accent" style="width:24%"></div></div>
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
  return { el, navCount };
}
