import { renderSidebar } from "./app/sidebar";
import { renderGallery } from "./features/gallery/gallery";
import { createModal } from "./features/gallery/modal";
import { renderUploadView, type UploadApi } from "./features/upload/upload";
import { renderSettingsView } from "./features/settings/settingsView";
import { renderDeployView } from "./features/deploy/deployView";
import type { ImageItem, UsageInfo, ViewName } from "./lib/types";
import { copyText, errorMessage, feedbackCheck, formatContent, parseSizeToBytes, showToast } from "./lib/utils";
import { icon } from "./lib/icons";
import { getSettings } from "./lib/settings";
import { applyTheme } from "./lib/theme";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { invoke } from "@tauri-apps/api/core";

// 启动即应用主题（data-theme 驱动 CSS 变量；system 模式由 settings.ts 监听实时跟随）
applyTheme(getSettings().theme);

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

const deployView = document.createElement("div");
deployView.className = VIEW_BASE;
deployView.innerHTML = headerHTML("部署 Worker", "复制源码与配置，部署你自己的 Cloudflare Worker");
const deployBody = document.createElement("div");
deployBody.className = "flex-1 min-h-0 flex flex-col";
deployView.appendChild(deployBody);

const views: Record<ViewName, HTMLElement> = {
  gallery: galleryView,
  upload: uploadView,
  settings: settingsView,
  deploy: deployView,
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

/** 云端真实存储用量（GET /usage，WORKER-V2.md §7.4）：优先显示，本地估算仅作兜底 */
let cloudUsage: number | null = null;

/** 从云端拉取 R2 真实统计并刷新侧边栏「已用空间」；失败时静默保留当前显示（本地估算兜底） */
async function refreshCloudUsage(): Promise<void> {
  try {
    const u = await invoke<UsageInfo>("sync_usage", { rescan: false });
    cloudUsage = u.size;
    setStorage(u.size);
  } catch {
    /* 云端不可用时保持现有显示，不打扰用户 */
  }
}

async function copyLink(it: ImageItem, btn?: HTMLButtonElement): Promise<void> {
  const ok = await copyText(formatContent(it));
  if (ok) {
    if (btn) feedbackCheck(btn, "已复制");
    showToast("链接已复制到剪贴板");
  } else {
    showToast("复制失败，请手动复制链接");
  }
}

/** 删除图片：先删除远程 R2 对象（DELETE /objects/{key}），成功后才从本地列表移除。
 *  远程删除失败时保留本地项并提示，避免「本地已删、远程残留」的脏数据（API.md §5）。 */
async function removeItem(it: ImageItem): Promise<void> {
  if (it.path) {
    try {
      await invoke("delete_image", { key: it.path });
    } catch (e) {
      showToast(`远程删除失败：${errorMessage(e)}`);
      return;
    }
  }
  items = items.filter((x) => x !== it);
  render();
  void refreshCloudUsage(); // 删除后同步云端统计（Worker 已 -1）
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
  // 已用空间：优先显示云端 R2 真实统计（含历史图片）；未拉取到云端时用本地图片累加兜底
  const usedBytes = cloudUsage ?? items.reduce((sum, it) => sum + parseSizeToBytes(it.size), 0);
  setStorage(usedBytes);
}

const uploadApi: UploadApi = renderUploadView(uploadBody, {
  onUploaded: (it) => {
    items = [it].concat(items);
    render();
    void refreshCloudUsage(); // 上传后同步云端统计（Worker 已 +1，含全部历史图片）
    showToast(`上传完成：${it.name}`);
  },
  onQueueCopy: (q, btn) => {
    void copyLink({ name: q.name, path: q.path ?? "" } as ImageItem, btn);
  },
});
// 存储用量：设置页手动刷新（WORKER-V2.md §8）时同步侧边栏为云端真实统计
renderSettingsView(settingsBody, {
  onUsageResolved: (usedBytes) => {
    cloudUsage = usedBytes;
    setStorage(usedBytes);
  },
});

// 部署 Worker 视图：展示源码/配置 + 复制按钮，用户自行部署（不替用户创建远端资源）
renderDeployView(deployBody);

// ---- 全局拖拽遮罩（vanilla 内联）：拖入窗口时全屏提示，drop 后跳转上传页并触发二次确认 ----
const dragMask = document.createElement("div");
dragMask.className = "drag-overlay fixed inset-0 z-50 pointer-events-none";
dragMask.setAttribute("role", "status");
dragMask.setAttribute("aria-live", "polite");
dragMask.hidden = true;
dragMask.innerHTML = `
  <div class="absolute inset-4 rounded-xl border-2 border-dashed border-accent/60">
    <div class="flex h-full flex-col items-center justify-center gap-4">
      <div class="drag-overlay-icon flex items-center justify-center text-accent">${icon.upload}</div>
      <div class="text-center">
        <p class="text-lg font-bold text-white">释放文件以上传图片</p>
        <p class="mt-1 text-sm text-white/70">自动转换为 WebP 并压缩</p>
      </div>
    </div>
  </div>`;
document.body.appendChild(dragMask);
const setDragVisible = (v: boolean): void => {
  dragMask.hidden = !v;
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

// 数据同步就绪即渲染（无骨架屏表演）；启动即拉取云端真实用量（本地 items 为空，云端可能已有历史图片）
render();
void refreshCloudUsage();
