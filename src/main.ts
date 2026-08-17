import { renderSidebar } from "./app/sidebar";
import { renderGallery } from "./features/gallery/gallery";
import { createModal } from "./features/gallery/modal";
import { renderUploadView, type UploadApi } from "./features/upload/upload";
import { renderSettingsView } from "./features/settings/settingsView";
import { renderDeployView } from "./features/deploy/deployView";
import type { ImageItem, ObjectItem, ObjectList, ViewName } from "./lib/types";
import { basename, formatBytes, pad2 } from "./lib/utils";
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

const gallerySub = document.querySelector<HTMLElement>("#gallerySub")!;

/** ISO 时间 → "YYYY-MM-DD HH:mm"（本地时区），与上传列表日期格式一致 */
function formatCloudDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
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

/** 图片扩展名白名单（与 Worker 的 ALLOWED_TYPES 一致），用于过滤云端列表 */
const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "webp", "gif", "avif"]);

/** 仅图片对象：key 以图片扩展名结尾，排除目录占位（/ 结尾）等非图片对象 */
function isImageObject(o: ObjectItem): boolean {
  if (o.key.endsWith("/")) return false;
  const ext = o.key.slice(o.key.lastIndexOf(".") + 1).toLowerCase();
  return IMAGE_EXTS.has(ext);
}

/** 启动时从云端拉取图片列表（API.md §4：GET /objects，分页合并），重启后仍能看到历史图片。
 *  失败（如未配置 Worker）时保留本地缓存（store 已从缓存恢复），不打扰用户。 */
async function loadCloudGallery(): Promise<void> {
  try {
    const all: ObjectItem[] = [];
    let cursor: string | null = null;
    do {
      // 显式标注类型：do-while 中 cursor/page 相互引用会触发 TS7022 循环推断
      const page: ObjectList = await invoke<ObjectList>("list_images", {
        limit: 1000,
        cursor: cursor ?? null,
      });
      // 过滤非图片对象（目录占位 / 非图片扩展名），兼容旧版未过滤的 Worker
      all.push(...page.items.filter(isImageObject));
      cursor = page.has_more ? page.cursor : null;
    } while (cursor);
    // R2 列表按 key 升序（即时间正序）；倒序让最新图片排最前，与上传流程一致
    setItems(all.reverse().map(cloudItemToImageItem));
  } catch {
    /* 未配置 Worker 或拉取失败：保持空状态，不打扰 */
  }
}

const modal = createModal({
  onCopy: (it, btn) => {
    void copyLink(it, btn);
  },
  onConfirmDelete: removeItem,
});

/** 重绘：状态来自 store（订阅触发），侧边栏已用空间用云端真实统计或本地累加兜底 */
function render(): void {
  const items = getItems();
  renderGallery(galleryBody, items, {
    onDetail: (it) => modal.open(it),
    onEmptyUpload: () => switchView("upload"),
  });
  navCount.textContent = String(items.length);
  gallerySub.textContent =
    items.length === 0 ? "还没有图片，去上传页添加吧" : `共 ${items.length} 张图片，点击图片查看详情`;
  setStorage(getUsedBytes());
}

const uploadApi: UploadApi = renderUploadView(uploadBody);
// 存储用量：设置页手动刷新（WORKER-V2.md §8）时直接写入 store，订阅触发侧边栏同步；
// 「部署 Worker」入口：跳转到部署页面（侧边栏已移除该导航）
renderSettingsView(settingsBody, {
  onOpenDeploy: () => switchView("deploy"),
});

// 部署 Worker 视图：展示源码/配置 + 复制按钮，用户自行部署（不替用户创建远端资源）；
// 「返回设置」按钮回到设置页（从设置页入口进入，侧边栏无独立导航）
renderDeployView(deployBody, {
  onBack: () => switchView("settings"),
});

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

// 数据同步就绪即渲染；缓存命中且未过期时直接使用本地数据（秒开、少读），
// 仅当缓存缺失或超过有效期才拉取云端真实用量与图片列表（上传/删除会写回并续期缓存）
subscribe(render);
render();
if (isCloudSyncNeeded()) {
  void refreshCloudUsage();
  void loadCloudGallery();
}
