import { renderSidebar } from "./app/sidebar";
import { createTabBar, type TabDef } from "./app/tabbar";
import { renderGallery } from "./features/gallery/gallery";
import { createModal } from "./features/gallery/modal";
import { renderUploadView, type UploadApi } from "./features/upload/upload";
import { renderSettingsView } from "./features/settings/settingsView";
import { renderDeployView } from "./features/deploy/deployView";
import type { ImageItem, ObjectItem, ObjectList, ViewName } from "./lib/types";
import { basename, errorMessage, formatBytes, pad2, showToast } from "./lib/utils";
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

/** 标签页定义（docs/design/sidebar.md 框架）：四个内置视图各对应一个可开关的标签页 */
const TAB_DEFS: TabDef[] = [
  { id: "gallery", label: "浏览图片", icon: icon.image },
  { id: "upload", label: "上传图片", icon: icon.upload },
  { id: "settings", label: "设置", icon: icon.sliders },
  { id: "deploy", label: "部署 Worker", icon: icon.code },
];

const { el: sidebarEl, navCount, setStorage } = renderSidebar((v) => tabbar.open(v));

/** 展示视图：隐藏非当前视图，同步导航激活态（激活态由标签条驱动） */
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

// 标签条：状态持久化恢复（打开顺序 + 激活视图），首帧 onChange 完成初始视图切换
const tabbar = createTabBar(TAB_DEFS, showView);

// 应用外壳（sidebar.md 框架）：侧边栏 + 内容列（chrome 色底）＝ 标签条 + 内容面板。
// tab-strip 与 sheet 直接拼接，指示条向下延伸覆盖 sheet 左上圆角，形成统一容器轮廓。
const content = document.createElement("main");
content.className = "flex-1 min-w-0 flex flex-col overflow-hidden bg-surface2";
content.appendChild(tabbar.el);
const sheet = document.createElement("section");
sheet.className = "relative flex-1 min-h-0 px-3 pb-3 pt-0 overflow-hidden";
content.appendChild(sheet);
const sheetInner = document.createElement("div");
sheetInner.className = "relative h-full rounded-b-xl bg-canvas shadow-card overflow-hidden flex flex-col border border-line border-t-0";
sheet.appendChild(sheetInner);
app.appendChild(sidebarEl);
app.appendChild(content);
for (const v of Object.keys(views) as ViewName[]) sheetInner.appendChild(views[v]);

const gallerySub = document.querySelector<HTMLElement>("#gallerySub")!;

/** 图库页头右侧「刷新云端列表」按钮：云端同步仅在启动（缓存过期/为空）触发，
 *  上传/删除之外缺少手动恢复入口（曾导致打包版长期停留在残缺列表），这里补齐。 */
const refreshBtn = document.createElement("button");
refreshBtn.type = "button";
refreshBtn.title = "刷新云端图片列表";
refreshBtn.setAttribute("aria-label", refreshBtn.title);
refreshBtn.className =
  "ml-auto self-center flex items-center justify-center w-8 h-8 rounded-[10px] text-ink2 hover:bg-surface3 hover:text-ink transition shrink-0";
refreshBtn.innerHTML = icon.refresh;
galleryView.querySelector("header")!.appendChild(refreshBtn);

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

/** 从云端拉取完整图片列表并写入 store（API.md §4：GET /objects 分页合并）。
 *  启动同步与页头手动刷新共用；失败时保留本地现有数据（store 已从缓存恢复），
 *  通过 toast 提示并恢复原列表，便于用户重试。 */
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
      // 过滤非图片对象（目录占位 / 非图片扩展名），兼容旧版未过滤的 Worker
      all.push(...page.items.filter(isImageObject));
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
  renderGallery(galleryBody, items, {
    onDetail: (it) => modal.open(it),
    onEmptyUpload: () => tabbar.open("upload"),
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
  onOpenDeploy: () => tabbar.open("deploy"),
});

// 部署 Worker 视图：展示源码/配置 + 复制按钮，用户自行部署（不替用户创建远端资源）；
// 「返回设置」按钮回到设置页（从设置页入口进入，侧边栏无独立导航）
renderDeployView(deployBody, {
  onBack: () => tabbar.open("settings"),
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
    tabbar.open("upload");
    uploadApi.requestUpload(event.payload.paths);
  }
});

// 数据同步就绪即渲染；缓存命中且未过期时直接使用本地数据（秒开、少读）。
// 缓存缺失 / 超过有效期 / 本地没有任何图片时启动同步：最后一条保证首次同步
// 失败的应用（如打包版在配置 Worker 前启动过）重启后能自动恢复云端列表，
// 而不是停留在空列表直到 7 天缓存过期（上传/删除会写回并续期缓存）。
subscribe(render);
render();
if (isCloudSyncNeeded() || getItems().length === 0) {
  void refreshCloudUsage();
  void syncCloudGallery();
}
