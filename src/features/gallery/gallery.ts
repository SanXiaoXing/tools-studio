import type { ImageItem } from "../../lib/types";
import { esc, imgSrc } from "../../lib/utils";
import { icon } from "../../lib/icons";

export interface GalleryCallbacks {
  onCopy: (it: ImageItem, btn: HTMLButtonElement) => void;
  onDetail: (it: ImageItem) => void;
  onConfirmDelete: (it: ImageItem) => void;
  onEmptyUpload: () => void;
}

const GRID_CLS =
  "grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-5 content-start " +
  "p-5 pl-9 pr-9 pb-12 overflow-y-auto h-full";

export function renderGallery(container: HTMLElement, items: ImageItem[], cb: GalleryCallbacks): void {
  if (items.length === 0) {
    renderEmpty(container, cb);
    return;
  }
  container.innerHTML = `<div class="${GRID_CLS}">${items.map(cardHTML).join("")}</div>`;
  const grid = container.firstElementChild as HTMLElement;
  grid.addEventListener("click", (e) => onClick(e, items, cb));
  grid.addEventListener("mouseleave", (e) => {
    const card = (e.target as HTMLElement).closest(".card") as HTMLElement | null;
    if (card) cancelConfirm(card);
  });
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

function onClick(e: MouseEvent, items: ImageItem[], cb: GalleryCallbacks): void {
  const card = (e.target as HTMLElement).closest(".card") as HTMLElement | null;
  if (!card) return;
  const it = items[Number(card.dataset.i)];
  if (!it) return; /* 骨架屏等未绑定数据的卡片 */
  const btn = (e.target as HTMLElement).closest("button[data-act]") as HTMLButtonElement | null;
  if (btn) {
    const act = btn.getAttribute("data-act");
    const actions = card.querySelector<HTMLElement>(".ov-actions");
    const confirm = card.querySelector<HTMLElement>(".ov-confirm");
    if (act === "copy") cb.onCopy(it, btn);
    if (act === "detail") cb.onDetail(it);
    if (act === "delete" && actions && confirm) {
      actions.hidden = true;
      confirm.hidden = false;
    }
    if (act === "confirm") cb.onConfirmDelete(it);
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
