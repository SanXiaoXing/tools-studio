import { renderSidebar } from "./app/sidebar";
import { renderGallery, renderSkeleton } from "./features/gallery/gallery";
import { createModal } from "./features/gallery/modal";
import { renderUploadView, type UploadApi } from "./features/upload/upload";
import { renderSettingsView } from "./features/settings/settingsView";
import type { ImageItem, ViewName } from "./lib/types";
import { copyText, feedbackCopied, formatContent, parseSizeToBytes, showToast } from "./lib/utils";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import DragMask from "./app/DragMask";

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

const { el: sidebarEl, navCount, setStorage } = renderSidebar(switchView);

const content = document.createElement("main");
content.className = "flex-1 min-w-0 flex flex-col overflow-hidden";
app.appendChild(sidebarEl);
app.appendChild(content);
for (const v of Object.keys(views) as ViewName[]) content.appendChild(views[v]);
switchView("gallery"); // 初始视图：隐藏其余视图并高亮导航

/** 初始为空：首屏不预置任何图片，展示空状态，真实数据来自上传流程 */
let items: ImageItem[] = [];
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
  gallerySub.textContent =
    items.length === 0 ? "还没有图片，去上传页添加吧" : `共 ${items.length} 张图片，点击图片查看详情`;
  // 已用空间 = 图片库所有图片真实体积之和（每张 size 来自上传压缩后的体积）
  const usedBytes = items.reduce((sum, it) => sum + parseSizeToBytes(it.size), 0);
  setStorage(usedBytes);
}

const uploadApi: UploadApi = renderUploadView(uploadBody, {
  onUploaded: (it) => {
    items = [it].concat(items);
    render();
    showToast(`上传完成：${it.name}`);
  },
  onQueueCopy: (q, btn) => {
    void copyLink({ name: q.name, path: q.path ?? "" } as ImageItem, btn);
  },
});
// 存储用量：用户手动触发（设置页「存储用量」区块，WORKER-V2.md §8）。
// 拉取成功后覆盖侧边栏「已用空间」为 R2 真实统计，不做启动自动拉取。
renderSettingsView(settingsBody, {
  onUsageResolved: (usedBytes) => {
    setStorage(usedBytes);
  },
});

// ---- 全局拖拽遮罩（React 组件挂载）：拖入窗口时全屏提示，drop 后跳转上传页并触发二次确认 ----
const dragRoot = createRoot(document.body.appendChild(document.createElement("div")));
let dragVisible = false;
const setDragVisible = (v: boolean): void => {
  if (dragVisible === v) return;
  dragVisible = v;
  dragRoot.render(createElement(DragMask, { isVisible: v }));
};

void getCurrentWebview().onDragDropEvent((event) => {
  const t = event.payload.type;
  if (t === "enter" || t === "over") setDragVisible(true);
  if (t === "leave") setDragVisible(false);
  if (t === "drop") {
    setDragVisible(false);
    switchView("upload");
    uploadApi.requestUpload(event.payload.paths);
  }
});

// 首屏骨架屏（模拟加载状态，DESIGN-SPEC §3.8）
renderSkeleton(galleryBody);
window.setTimeout(render, 750);
