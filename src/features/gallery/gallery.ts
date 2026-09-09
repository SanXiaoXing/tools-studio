import type { ImageItem } from "../../lib/types";
import { esc, imgSrc } from "../../lib/utils";
import { icon } from "../../lib/icons";
import { copyLink, removeItem } from "../../lib/store";
import { groupByPeriod, type PeriodGroup } from "./periods";

export interface GalleryCallbacks {
  onDetail: (it: ImageItem) => void;
  onEmptyUpload: () => void;
}

/**
 * 图库渲染：时间轴 + 节点展开加载。
 *
 * 规模优化（图片总量持续增长时 DOM/内存不随总量线性膨胀）：
 * 1. 按月份分桶（periods.ts）排成时间轴，月份节点默认折叠 —— 折叠节点只有一行标题，零卡片渲染；
 * 2. 点击节点标题展开后才加载该月图片（首次展开渲染 CHUNK 张，滚动到底由哨兵分批追加）；
 * 3. 最新月份默认自动展开（用户手动折叠后不打扰），旧月份无人为操作时保持折叠；
 * 4. store 变更（上传/删除/同步）触发整体重绘时，保留各节点展开状态、已展开批次数与滚动位置。
 */

/** 每个展开节点的首批 / 每批追加渲染卡片数 */
const CHUNK = 60;

const TL_CLS = "gallery-tl h-full overflow-y-auto p-5 pl-9 pr-9 pb-12";
const GRID_CLS = "grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-5 content-start pt-3";

// ---- 模块级视图状态：store 变更触发整体重绘时需要保留 ----
/** 用户手动展开的节点 */
const manualExpanded = new Set<string>();
/** 用户手动折叠的节点（覆盖最新月份的自动展开） */
const manualCollapsed = new Set<string>();
/** 各节点已渲染的卡片数（哨兵分批追加进度） */
const visibleMap = new Map<string, number>();
let observer: IntersectionObserver | null = null;
// 最近一次渲染的上下文，节点展开/折叠、哨兵追加时复用，无需经 store 重绘
let ctx: { container: HTMLElement; items: ImageItem[]; cb: GalleryCallbacks } | null = null;
// 当前渲染的分组（点击卡片时按节点 key 查找所属数组）
let currentGroupsByKey = new Map<string, ImageItem[]>();
let latestKey = "";

/** 节点是否展开：手动展开优先；最新月份默认展开（除非被手动折叠） */
const isExpanded = (key: string): boolean =>
  manualExpanded.has(key) || (key === latestKey && !manualCollapsed.has(key));

export function renderGallery(container: HTMLElement, items: ImageItem[], cb: GalleryCallbacks): void {
  ctx = { container, items, cb };
  if (items.length === 0) {
    manualExpanded.clear();
    manualCollapsed.clear();
    visibleMap.clear();
    observer?.disconnect();
    renderEmpty(container, cb);
    return;
  }

  const groups = groupByPeriod(items);
  latestKey = groups[0]?.key ?? "";
  currentGroupsByKey = new Map(groups.map((g) => [g.key, g.items]));

  // 重绘前记录滚动位置（展开/折叠、哨兵追加、store 变更共用同一渲染入口）
  const prevScroll = container.querySelector<HTMLElement>(".gallery-tl")?.scrollTop ?? 0;

  container.innerHTML = `
  <div class="${TL_CLS}">
    ${groups.map((g, gi) => sectionHTML(g, gi === groups.length - 1)).join("")}
  </div>`;

  const tl = container.querySelector<HTMLElement>(".gallery-tl")!;
  tl.scrollTop = prevScroll;

  // 事件只在新建的时间轴根元素上绑定一次（renderGallery 每次整体替换，无监听器叠加）
  tl.addEventListener("click", (e) => onTimelineClick(e, cb));
  tl.addEventListener("mouseleave", (e) => {
    const card = (e.target as HTMLElement).closest(".card") as HTMLElement | null;
    if (card) cancelConfirm(card);
  });

  // 哨兵：所有展开节点共用一个 observer，滚动接近底部时给对应节点追加下一批
  observer?.disconnect();
  const sentinels = tl.querySelectorAll<HTMLElement>(".gallery-sentinel");
  if (sentinels.length > 0) {
    observer = new IntersectionObserver(
      (entries) => {
        const hit = entries.find((en) => en.isIntersecting);
        if (!hit) return;
        const key = (hit.target as HTMLElement).dataset.key ?? "";
        visibleMap.set(key, (visibleMap.get(key) ?? CHUNK) + CHUNK);
        if (ctx) renderGallery(ctx.container, ctx.items, ctx.cb);
      },
      { root: tl, rootMargin: "600px" },
    );
    sentinels.forEach((s) => observer!.observe(s));
  }
}

/** 单个时间节点：折叠时只有标题行；展开时渲染卡片网格 + 加载哨兵 */
function sectionHTML(g: PeriodGroup, isLast: boolean): string {
  const expanded = isExpanded(g.key);
  const vis = Math.min(visibleMap.get(g.key) ?? CHUNK, g.items.length);
  return `
  <section class="tl-sec relative pl-7 pb-2" data-key="${g.key}">
    ${isLast ? "" : '<span class="absolute left-[5px] top-6 bottom-0 w-px bg-line" aria-hidden="true"></span>'}
    <span class="absolute left-0 top-[15px] w-[11px] h-[11px] rounded-full border-2 border-canvas ${expanded ? "bg-accent" : "bg-ink3/40"}" aria-hidden="true"></span>
    <button type="button" data-toggle="${g.key}" aria-expanded="${expanded}"
      class="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 -ml-2 text-left hover:bg-surface3 transition-colors">
      <span class="text-ink3 transition-transform duration-200 ${expanded ? "" : "-rotate-90"}">${icon.chevron}</span>
      <span class="text-[15px] font-semibold">${g.label}</span>
      <span class="text-xs text-ink3 tnum">${g.items.length} 张</span>
      ${expanded ? "" : '<span class="ml-auto text-xs text-ink3">展开加载</span>'}
    </button>
    ${
      expanded
        ? `<div class="${GRID_CLS}">
            ${g.items
              .slice(0, vis)
              .map((it, i) => cardHTML(it, i))
              .join("")}
            ${g.items.length > vis ? `<div class="gallery-sentinel col-span-full flex items-center justify-center py-2 text-xs text-ink3" data-key="${g.key}">加载更多…</div>` : ""}
          </div>`
        : ""
    }
  </section>`;
}

/** 时间轴点击分发：节点标题 → 展开/折叠；卡片 → 复制/详情/删除 */
function onTimelineClick(e: MouseEvent, cb: GalleryCallbacks): void {
  const toggle = (e.target as HTMLElement).closest("[data-toggle]") as HTMLElement | null;
  if (toggle) {
    const key = toggle.dataset.toggle ?? "";
    if (isExpanded(key)) {
      manualExpanded.delete(key);
      manualCollapsed.add(key);
    } else {
      manualExpanded.add(key);
      manualCollapsed.delete(key);
    }
    if (ctx) renderGallery(ctx.container, ctx.items, ctx.cb);
    return;
  }
  onCardClick(e, cb);
}

function cardHTML(it: ImageItem, i: number): string {
  return `
  <article class="card group bg-surface border border-line rounded-xl p-2.5 shadow-card hover:shadow-card-hover hover:-translate-y-0.5 transition-all duration-200" data-i="${i}">
    <div class="relative aspect-[4/3] rounded-lg overflow-hidden bg-surface2 cursor-zoom-in">
      <img src="${imgSrc(it)}" alt="${esc(it.name)}" loading="lazy" class="w-full h-full object-cover">
      <div class="overlay absolute inset-0 flex items-end p-2.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-200 bg-[linear-gradient(to_top,var(--color-overlay),transparent_35%)]">
        <div class="ov-actions flex items-center gap-1.5 w-full">
          <button class="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold bg-accent-strong text-white hover:bg-accent transition whitespace-nowrap" data-act="copy" type="button">${icon.copy}复制链接</button>
          <button class="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-white/30 bg-white/15 text-white hover:bg-white/30 active:scale-95 transition" data-act="detail" type="button" title="查看详情" aria-label="查看详情">${icon.eye}</button>
          <button class="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-white/30 bg-white/15 text-white hover:bg-danger-strong hover:border-danger-strong active:scale-95 transition" data-act="delete" type="button" title="删除图片" aria-label="删除图片">${icon.trash}</button>
        </div>
        <div class="ov-confirm items-center gap-2 w-full text-white text-[13px] font-semibold" hidden>
          <span class="mr-auto whitespace-nowrap">确认删除？</span>
          <button class="rounded-lg px-2.5 py-1.5 text-xs font-semibold bg-danger-strong text-white hover:bg-danger transition" data-act="confirm" type="button">删除</button>
          <button class="rounded-lg px-2.5 py-1.5 text-xs font-semibold bg-white/15 border border-white/25 text-white hover:bg-white/25 transition" data-act="cancel" type="button">取消</button>
        </div>
      </div>
    </div>
    <div class="px-1 pt-2.5">
      <div class="text-[13px] font-semibold truncate" title="${esc(it.name)}">${esc(it.name)}</div>
      <div class="text-xs text-ink3 tnum mt-0.5">${esc(it.size)} ${esc(it.date.slice(5))}</div>
    </div>
  </article>`;
}

function cancelConfirm(card: HTMLElement): void {
  const actions = card.querySelector<HTMLElement>(".ov-actions");
  const confirm = card.querySelector<HTMLElement>(".ov-confirm");
  if (actions && confirm) {
    actions.hidden = false;
    confirm.hidden = true;
  }
}

function onCardClick(e: MouseEvent, cb: GalleryCallbacks): void {
  const card = (e.target as HTMLElement).closest(".card") as HTMLElement | null;
  if (!card) return;
  // 卡片 data-i 是其所属时间节点数组的下标，按所在 section 的 key 取出对应数组
  const key = (card.closest("[data-key]") as HTMLElement | null)?.dataset.key ?? "";
  const it = currentGroupsByKey.get(key)?.[Number(card.dataset.i)];
  if (!it) return; /* 骨架屏等未绑定数据的卡片 */
  const btn = (e.target as HTMLElement).closest("button[data-act]") as HTMLButtonElement | null;
  if (btn) {
    const act = btn.getAttribute("data-act");
    const actions = card.querySelector<HTMLElement>(".ov-actions");
    const confirm = card.querySelector<HTMLElement>(".ov-confirm");
    if (act === "copy") void copyLink(it, btn);
    if (act === "detail") cb.onDetail(it);
    if (act === "delete" && actions && confirm) {
      actions.hidden = true;
      confirm.hidden = false;
    }
    if (act === "confirm") void removeItem(it);
    if (act === "cancel") cancelConfirm(card);
    return;
  }
  // 点击图片区域（图片本体或悬停遮罩的非按钮部分）直接打开详情
  const t = e.target as HTMLElement;
  if (t.closest(".overlay") || t.closest("img")) {
    cancelConfirm(card); // 若正处于删除确认态，先复位再打开详情
    cb.onDetail(it);
  }
}

function renderEmpty(container: HTMLElement, cb: GalleryCallbacks): void {
  container.innerHTML = `
  <div class="h-full overflow-y-auto p-5 pl-9 pr-9 pb-12 flex">
    <div class="dropzone flex-1 min-h-[340px] flex flex-col items-center justify-center gap-2 p-12 border-2 border-dashed border-line rounded-2xl bg-surface cursor-pointer text-center transition-colors hover:border-accent hover:bg-accent-soft">
      <div class="flex items-center justify-center w-14 h-14 rounded-[14px] bg-accent-soft text-accent mb-1.5">${icon.upload}</div>
      <h2 class="text-[17px] font-semibold">还没有图片</h2>
      <p class="text-[13px] text-ink3">去上传页拖拽图片，压缩后自动上传并生成链接</p>
      <button class="mt-4 inline-flex items-center gap-2 rounded-lg px-4.5 py-2.5 bg-accent-strong text-white text-sm font-semibold hover:bg-accent active:scale-[.985] transition" type="button">去上传图片</button>
    </div>
  </div>`;
  container.querySelector(".dropzone")!.addEventListener("click", () => cb.onEmptyUpload());
}
