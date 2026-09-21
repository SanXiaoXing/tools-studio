import { renderSidebar } from "./app/sidebar";
import { renderGallery } from "./features/gallery/gallery";
import { createModal } from "./features/gallery/modal";
import { renderUploadView, type UploadApi } from "./features/upload/upload";
import { renderSettingsView } from "./features/settings/settingsView";
import { renderDeployView } from "./features/deploy/deployView";
import type { ImageItem, ObjectItem, ObjectList, ViewName } from "./lib/types";
import { basename, errorMessage, formatBytes, formatDateTime, showToast } from "./lib/utils";
import { icon } from "./lib/icons";
import { getSettings } from "./lib/settings";
import { applyTheme } from "./lib/theme";
import {
  copyLink,
  getItems,
  getUsedBytes,
  isCloudSyncNeeded,
  refreshCloudUsage,
  removeItem,
  setItems,
  subscribe,
} from "./lib/store";
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
const BODY_COL = "flex-1 min-h-0 flex flex-col";
const BODY_FILL = "flex-1 min-h-0";

/** 视图壳：页头 + 内容体，四个内置视图共用 */
const createView = (
  title: string,
  sub: string,
  bodyCls: string,
): { root: HTMLElement; body: HTMLElement } => {
  const root = document.createElement("div");
  root.className = VIEW_BASE;
  root.innerHTML = headerHTML(title, sub);
  const body = document.createElement("div");
  body.className = bodyCls;
  root.appendChild(body);
  return { root, body };
};

const gallery = createView(
  "图片库",
  '<span id="gallerySub">共 10 张图片，点击图片查看详情</span>',
  BODY_FILL,
);
const upload = createView(
  "上传图片",
  "拖拽或选择文件；可仅压缩到本地文件夹（图片→WebP，视频→WebM），或压缩后上传",
  BODY_COL,
);
const settings = createView("设置", "链接域名、存储路径与文件名重命名规则", BODY_COL);
const deploy = createView("部署 Worker", "复制源码与配置，部署你自己的 Cloudflare Worker", BODY_COL);

const views: Record<ViewName, HTMLElement> = {
  gallery: gallery.root,
  upload: upload.root,
  settings: settings.root,
  deploy: deploy.root,
};

const { el: sidebarEl, navCount, setStorage } = renderSidebar((v) => showView(v));

/** 展示视图：隐藏非当前视图，同步侧边栏导航激活态 */
function showView(v: ViewName): void {
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

// 应用外壳：侧边栏 + 内容面板（chrome 色底上的 sheet）
const content = document.createElement("main");
content.className = "flex-1 min-w-0 flex flex-col overflow-hidden bg-surface2";
const sheet = document.createElement("section");
sheet.className = "relative flex-1 min-h-0 p-3 overflow-hidden";
content.appendChild(sheet);
const sheetInner = document.createElement("div");
sheetInner.className =
  "relative h-full rounded-xl bg-canvas shadow-card overflow-hidden flex flex-col border border-line";
sheet.appendChild(sheetInner);
app.appendChild(sidebarEl);
app.appendChild(content);
for (const v of Object.keys(views) as ViewName[]) sheetInner.appendChild(views[v]);

const gallerySub = gallery.root.querySelector<HTMLElement>("#gallerySub")!;

/** 图库页头右侧「刷新云端列表」按钮：云端同步仅在启动（缓存过期/为空）触发，
 *  上传/删除之外缺少手动恢复入口（曾导致打包版长期停留在残缺列表），这里补齐。 */
const refreshBtn = document.createElement("button");
refreshBtn.type = "button";
refreshBtn.title = "刷新云端图片列表";
refreshBtn.setAttribute("aria-label", refreshBtn.title);
refreshBtn.className =
  "ml-auto self-center flex items-center justify-center w-8 h-8 rounded-[10px] text-ink2 hover:bg-surface3 hover:text-ink transition shrink-0";
refreshBtn.innerHTML = icon.refresh;
gallery.root.querySelector("header")!.appendChild(refreshBtn);

/** ISO 时间 → "YYYY-MM-DD HH:mm"（本地时区），与上传列表日期格式一致 */
function formatCloudDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : formatDateTime(d);
}

/** 云端对象 → 图片库项：名称取 key 末段，尺寸/时间来自 Worker 返回（无本地文件元数据） */
function cloudItemToImageItem(o: ObjectItem): ImageItem {
  const ext = (o.key.split(".").pop() ?? "").toUpperCase();
  return {
    name: basename(o.key) || o.key,
    type: ext || "FILE",
    size: formatBytes(o.size),
    dims: "未知",
    date: formatCloudDate(o.uploaded),
    path: o.key,
    url: o.url,
  };
}

/** 从云端拉取完整图片列表并写入 store（API.md §4：GET /objects 分页合并）。
 *  启动同步与页头手动刷新共用；失败时保留本地现有数据（store 已从缓存恢复），
 *  通过 toast 提示并恢复原列表，便于用户重试。图片过滤由 Worker 负责。 */
let syncing = false;
async function syncCloudGallery(): Promise<void> {
  if (syncing) return;
  syncing = true;
  refreshBtn.disabled = true;
  refreshBtn.classList.add("opacity-60", "pointer-events-none");
  refreshBtn.title = "同步中…";
  gallerySub.textContent = "正在同步云端…";
  try {
    const all: ObjectItem[] = [];
    let cursor: string | null = null;
    do {
      // 显式标注类型：do-while 中 cursor/page 相互引用会触发 TS7022 循环推断
      const page: ObjectList = await invoke<ObjectList>("list_images", {
        limit: 1000,
        cursor: cursor ?? null,
      });
      all.push(...page.items);
      cursor = page.has_more ? page.cursor : null;
    } while (cursor);
    // R2 列表按 key 升序（即时间正序）；倒序让最新图片排最前，与上传流程一致
    setItems(all.reverse().map(cloudItemToImageItem));
    showToast(`已同步 ${all.length} 张图片`);
  } catch (e) {
    render(); // 恢复列表区域文案（同步失败不产生状态变更，这里不触发订阅）
    showToast(`云端同步失败：${errorMessage(e)}`);
  } finally {
    syncing = false;
    refreshBtn.disabled = false;
    refreshBtn.classList.remove("opacity-60", "pointer-events-none");
    refreshBtn.title = "刷新云端图片列表";
  }
}
refreshBtn.addEventListener("click", () => void syncCloudGallery());

const modal = createModal({
  onCopy: (it, btn) => {
    void copyLink(it, btn);
  },
  onConfirmDelete: removeItem,
});

/** 重绘：状态来自 store（订阅触发），侧边栏已用空间用云端真实统计或本地累加兜底 */
function render(): void {
  const items = getItems();
  renderGallery(gallery.body, items, {
    onDetail: (it, card) => modal.open(it, card),
    onEmptyUpload: () => showView("upload"),
  });
  navCount.textContent = String(items.length);
  gallerySub.textContent =
    items.length === 0 ? "还没有图片，去上传页添加吧" : `共 ${items.length} 张图片，点击图片查看详情`;
  setStorage(getUsedBytes());
}

const uploadApi: UploadApi = renderUploadView(upload.body);
// 存储用量：设置页手动刷新（WORKER-V2.md §8）时直接写入 store，订阅触发侧边栏同步；
// 「部署 Worker」入口：跳转到部署页面（侧边栏已移除该导航）
renderSettingsView(settings.body, {
  onOpenDeploy: () => showView("deploy"),
});

// 部署 Worker 视图：展示源码/配置 + 复制按钮，用户自行部署（不替用户创建远端资源）；
// 「返回设置」按钮回到设置页（从设置页入口进入，侧边栏无独立导航）
renderDeployView(deploy.body, {
  onBack: () => showView("settings"),
});

// ---- 全局拖拽遮罩：拖入窗口时全屏提示，drop 后跳转上传页并触发二次确认 ----
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
        <p class="mt-1 text-sm text-white/70">图片→WebP，视频→WebM；可仅压缩或压缩后上传</p>
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
    showView("upload");
    uploadApi.requestUpload(event.payload.paths);
  }
});

// 数据同步就绪即渲染；缓存命中且未过期时直接使用本地数据（秒开、少读）。
// 缓存缺失 / 超过有效期 / 本地没有任何图片时启动同步：最后一条保证首次同步
// 失败的应用（如打包版在配置 Worker 前启动过）重启后能自动恢复云端列表，
// 而不是停留在空列表直到 7 天缓存过期（上传/删除会写回并续期缓存）。
subscribe(render);
render();
showView("gallery");
if (isCloudSyncNeeded() || getItems().length === 0) {
  void refreshCloudUsage();
  void syncCloudGallery();
}
