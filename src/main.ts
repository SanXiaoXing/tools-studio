import { renderSidebar } from "./views/sidebar";
import { renderGallery, renderSkeleton } from "./views/gallery";
import { renderUploadView } from "./views/upload";
import { renderSettingsView } from "./views/settingsView";
import { createModal } from "./views/modal";
import type { ImageItem, ViewName } from "./lib/types";
import { copyText, feedbackCopied, formatContent, showToast } from "./lib/utils";

/** mock 数据（原型演示用，非真实上传数据；真实数据来自上传流程的 objectURL） */
const DATA: ImageItem[] = [
  { name: "banner-1920x640.png", type: "PNG", size: "1.8 MB", dims: "1920 × 640", date: "2026-08-08 14:32", seed: "banner", path: "blog/2026/08/banner-1920x640.png" },
  { name: "avatar-round.png", type: "PNG", size: "348 KB", dims: "512 × 512", date: "2026-08-08 11:05", seed: "avatar", path: "blog/2026/08/avatar-round.png" },
  { name: "cover-article.webp", type: "WEBP", size: "624 KB", dims: "1600 × 900", date: "2026-08-07 19:47", seed: "cover", path: "blog/2026/08/cover-article.webp" },
  { name: "screenshot-dashboard.jpg", type: "JPG", size: "2.4 MB", dims: "2560 × 1440", date: "2026-08-07 16:20", seed: "screenshot", path: "blog/2026/08/screenshot-dashboard.jpg" },
  { name: "logo-dark.svg", type: "SVG", size: "24 KB", dims: "512 × 512", date: "2026-08-06 09:12", seed: "logo", path: "blog/2026/08/logo-dark.svg" },
  { name: "hero-og-image.png", type: "PNG", size: "1.1 MB", dims: "1200 × 630", date: "2026-08-05 21:33", seed: "hero", path: "blog/2026/08/hero-og-image.png" },
  { name: "icon-512.png", type: "PNG", size: "86 KB", dims: "512 × 512", date: "2026-08-05 10:08", seed: "icon", path: "blog/2026/08/icon-512.png" },
  { name: "thumbnail-note.webp", type: "WEBP", size: "156 KB", dims: "800 × 450", date: "2026-08-04 15:41", seed: "thumbnail", path: "blog/2026/08/thumbnail-note.webp" },
  { name: "poster-release.png", type: "PNG", size: "3.2 MB", dims: "2480 × 3508", date: "2026-08-03 18:26", seed: "poster", path: "blog/2026/08/poster-release.png" },
  { name: "gif-demo.gif", type: "GIF", size: "5.6 MB", dims: "960 × 540", date: "2026-08-02 13:15", seed: "gif", path: "blog/2026/08/gif-demo.gif" },
];

const app = document.querySelector<HTMLElement>("#app")!;
app.className = "flex h-full";

/** 视图页头（DESIGN-SPEC §2） */
const headerHTML = (title: string, sub: string): string => `
  <header class="flex items-baseline gap-3 px-9 pt-6.5 pb-1 shrink-0">
    <h1 class="m-0 text-[22px] font-bold tracking-tight">${title}</h1>
    <p class="m-0 text-[13px] text-ink3">${sub}</p>
  </header>`;

const VIEW_BASE = "flex-1 min-h-0 flex flex-col overflow-hidden";

const galleryView = document.createElement("div");
galleryView.className = VIEW_BASE;
galleryView.innerHTML = headerHTML("图片库", '<span id="gallerySub">共 10 张图片，点击图片查看详情</span>');
const galleryBody = document.createElement("div");
galleryBody.className = "flex-1 min-h-0";
galleryView.appendChild(galleryBody);

const uploadView = document.createElement("div");
uploadView.className = VIEW_BASE;
uploadView.innerHTML = headerHTML("上传图片", "拖拽或选择图片，自动压缩并上传，完成后一键复制链接");
const uploadBody = document.createElement("div");
uploadBody.className = "flex-1 min-h-0 flex flex-col";
uploadView.appendChild(uploadBody);

const settingsView = document.createElement("div");
settingsView.className = VIEW_BASE;
settingsView.innerHTML = headerHTML("设置", "链接域名、存储路径与文件名重命名规则");
const settingsBody = document.createElement("div");
settingsBody.className = "flex-1 min-h-0 flex flex-col";
settingsView.appendChild(settingsBody);

const views: Record<ViewName, HTMLElement> = {
  gallery: galleryView,
  upload: uploadView,
  settings: settingsView,
};

/** 视图切换：隐藏非当前视图，同步导航激活态 */
function switchView(v: ViewName): void {
  for (const name of Object.keys(views) as ViewName[]) views[name].hidden = name !== v;
  sidebarEl.querySelectorAll<HTMLElement>("[data-view]").forEach((n) => {
    const active = n.getAttribute("data-view") === v;
    n.classList.toggle("bg-accent-soft", active);
    n.classList.toggle("text-accent", active);
    n.classList.toggle("font-semibold", active);
    n.classList.toggle("text-ink2", !active);
    n.classList.toggle("font-medium", !active);
    if (active) n.setAttribute("aria-current", "page");
    else n.removeAttribute("aria-current");
  });
}

const { el: sidebarEl, navCount } = renderSidebar(switchView);

const content = document.createElement("main");
content.className = "flex-1 min-w-0 flex flex-col overflow-hidden";
app.appendChild(sidebarEl);
app.appendChild(content);
for (const v of Object.keys(views) as ViewName[]) content.appendChild(views[v]);
switchView("gallery"); // 初始视图：隐藏其余视图并高亮导航

let items: ImageItem[] = DATA.map((d) => ({ ...d }));
const gallerySub = document.querySelector<HTMLElement>("#gallerySub")!;

async function copyLink(it: ImageItem, btn?: HTMLButtonElement): Promise<void> {
  const ok = await copyText(formatContent(it));
  if (ok) {
    if (btn) feedbackCopied(btn);
    showToast("链接已复制到剪贴板");
  } else {
    showToast("复制失败，请手动复制链接");
  }
}

function removeItem(it: ImageItem): void {
  items = items.filter((x) => x !== it);
  render();
  showToast(`已删除 ${it.name}`);
}

const modal = createModal({
  onCopy: (it, btn) => {
    void copyLink(it, btn);
  },
  onConfirmDelete: removeItem,
});

function render(): void {
  renderGallery(galleryBody, items, {
    onCopy: (it, btn) => {
      void copyLink(it, btn);
    },
    onDetail: (it) => modal.open(it),
    onConfirmDelete: removeItem,
    onEmptyUpload: () => switchView("upload"),
  });
  navCount.textContent = String(items.length);
  gallerySub.textContent = `共 ${items.length} 张图片，点击图片查看详情`;
}

renderUploadView(uploadBody, {
  onUploaded: (it) => {
    items = [it].concat(items);
    render();
    showToast(`上传完成：${it.name}`);
  },
  onQueueCopy: (q, btn) => {
    void copyLink({ name: q.name, path: q.path ?? "" } as ImageItem, btn);
  },
});
renderSettingsView(settingsBody);

// 首屏骨架屏（模拟加载状态，DESIGN-SPEC §3.8）
renderSkeleton(galleryBody);
window.setTimeout(render, 750);
