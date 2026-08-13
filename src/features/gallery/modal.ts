import type { ImageItem } from "../../lib/types";
import { formatContent, imgSrc } from "../../lib/utils";
import { icon } from "../../lib/icons";
import { getSettings, updateSettings } from "../../lib/settings";

export interface ModalCallbacks {
  onCopy: (it: ImageItem, btn: HTMLButtonElement) => void;
  onConfirmDelete: (it: ImageItem) => void;
}

export interface DetailModal {
  open(it: ImageItem): void;
  close(): void;
}

/** 详情弹窗（DESIGN-SPEC §3.6）：预览 + 信息 + 链接 + 复制/删除（两阶段） */
export function createModal(cb: ModalCallbacks): DetailModal {
  const wrap = document.createElement("div");
  wrap.hidden = true;
  wrap.className =
    "fixed inset-0 z-40 flex items-center justify-center p-6 max-lg:p-3 bg-[rgba(9,12,18,.55)] backdrop-blur-sm";
  wrap.innerHTML = `
  <div class="relative w-full max-w-[920px] max-h-[calc(100dvh-48px)] max-lg:max-h-[calc(100dvh-24px)] flex flex-col bg-surface border border-line rounded-2xl shadow-modal overflow-hidden" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
    <button class="modal-close absolute top-3.5 right-3.5 z-[1] flex items-center justify-center w-[34px] h-[34px] rounded-[10px] border border-line bg-surface text-ink2 hover:bg-surface3 hover:text-ink transition" type="button" title="关闭" aria-label="关闭">${icon.x}</button>
    <div class="grid flex-1 min-h-0 grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] max-lg:grid-cols-1 max-lg:grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
      <div class="bg-surface2 h-[min(560px,60dvh)] min-h-[320px] flex items-center justify-center overflow-hidden max-lg:h-[min(220px,35dvh)] max-lg:min-h-0">
        <img id="modalImg" alt="" class="w-full h-full object-contain">
      </div>
      <div class="flex flex-col gap-4.5 min-h-0 p-6 max-lg:p-4 overflow-y-auto border-l border-line max-lg:border-l-0 max-lg:border-t">
        <h2 id="modalTitle" class="text-[18px] font-bold break-all pr-10"></h2>
        <dl class="grid gap-3.5 m-0 max-lg:grid-cols-2">
          <div class="grid gap-1"><dt class="text-xs text-ink3">格式</dt><dd id="mType" class="m-0 text-[13px] font-medium tnum"></dd></div>
          <div class="grid gap-1"><dt class="text-xs text-ink3">尺寸</dt><dd id="mDims" class="m-0 text-[13px] font-medium tnum"></dd></div>
          <div class="grid gap-1"><dt class="text-xs text-ink3">大小</dt><dd id="mSize" class="m-0 text-[13px] font-medium tnum"></dd></div>
          <div class="grid gap-1"><dt class="text-xs text-ink3">上传时间</dt><dd id="mDate" class="m-0 text-[13px] font-medium tnum"></dd></div>
          <div class="grid gap-1 max-lg:col-span-2"><dt class="text-xs text-ink3">存储路径</dt><dd id="mPath" class="m-0 text-[13px] font-medium font-mono break-all"></dd></div>
        </dl>
        <div class="flex items-center justify-between">
          <span class="text-xs text-ink3">链接格式</span>
          <div class="flex rounded-lg border border-line bg-surface2 p-0.5" role="group" aria-label="链接格式">
            <button type="button" data-format="url" class="seg rounded-md px-3 py-1 text-xs font-medium transition">URL</button>
            <button type="button" data-format="markdown" class="seg rounded-md px-3 py-1 text-xs font-medium transition">Markdown</button>
          </div>
        </div>
        <div>
          <label for="mLink" class="block text-xs text-ink3 mb-1.5">复制内容</label>
          <input id="mLink" readonly spellcheck="false" autocomplete="off" class="w-full px-3 py-2.5 rounded-lg border border-line bg-surface2 text-ink font-mono text-xs outline-none focus:border-accent transition-colors">
        </div>
        <div class="flex gap-2.5 mt-auto pt-1">
          <button id="mCopy" class="flex-1 inline-flex items-center justify-center gap-2 rounded-lg px-4.5 py-2.5 bg-accent-strong text-white text-sm font-semibold hover:bg-accent active:scale-[.985] transition" type="button">${icon.copy}复制链接</button>
          <button id="mDelete" class="flex-1 inline-flex items-center justify-center gap-2 rounded-lg px-4.5 py-2.5 border border-danger text-danger text-sm font-semibold hover:bg-danger-soft active:scale-[.985] transition" type="button">删除图片</button>
        </div>
      </div>
    </div>
  </div>`;
  document.body.appendChild(wrap);

  const $ = <T extends HTMLElement>(sel: string): T => wrap.querySelector(sel) as T;
  const img = $<HTMLImageElement>("#modalImg");
  const title = $<HTMLElement>("#modalTitle");
  const mType = $<HTMLElement>("#mType");
  const mDims = $<HTMLElement>("#mDims");
  const mSize = $<HTMLElement>("#mSize");
  const mDate = $<HTMLElement>("#mDate");
  const mPath = $<HTMLElement>("#mPath");
  const mLink = $<HTMLInputElement>("#mLink");
  const mCopy = $<HTMLButtonElement>("#mCopy");
  const mDelete = $<HTMLButtonElement>("#mDelete");
  const closeBtn = $<HTMLButtonElement>(".modal-close");

  let current: ImageItem | null = null;
  let deleting = false;

  const resetDelete = (): void => {
    deleting = false;
    mDelete.style.background = "";
    mDelete.style.borderColor = "";
    mDelete.style.color = "";
    mDelete.textContent = "删除图片";
  };

  const segBtns = Array.from(wrap.querySelectorAll<HTMLButtonElement>("[data-format]"));
  const applySeg = (f: "url" | "markdown"): void => {
    segBtns.forEach((b) => {
      const active = b.getAttribute("data-format") === f;
      b.classList.toggle("bg-surface", active);
      b.classList.toggle("shadow-sm", active);
      b.classList.toggle("text-ink", active);
      b.classList.toggle("text-ink2", !active);
    });
  };
  segBtns.forEach((b) =>
    b.addEventListener("click", () => {
      const f = b.getAttribute("data-format") as "url" | "markdown";
      updateSettings({ copyFormat: f });
      applySeg(f);
      if (current) mLink.value = formatContent(current);
    }),
  );

  const open = (it: ImageItem): void => {
    current = it;
    resetDelete();
    img.src = imgSrc(it);
    img.alt = it.name;
    title.textContent = it.name;
    mType.textContent = it.type;
    mDims.textContent = it.dims;
    mSize.textContent = it.size;
    mDate.textContent = it.date;
    mPath.textContent = it.path;
    mLink.value = formatContent(it);
    applySeg(getSettings().copyFormat);
    mCopy.style.background = "";
    mCopy.innerHTML = icon.copy + "复制链接";
    wrap.hidden = false;
    document.body.style.overflow = "hidden";
  };

  const close = (): void => {
    wrap.hidden = true;
    document.body.style.overflow = "";
    current = null;
  };

  closeBtn.addEventListener("click", close);
  wrap.addEventListener("click", (e) => {
    if (e.target === wrap) close();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !wrap.hidden) close();
  });

  mCopy.addEventListener("click", () => {
    if (current) cb.onCopy(current, mCopy);
  });

  mDelete.addEventListener("click", () => {
    if (!current) return;
    if (!deleting) {
      deleting = true;
      mDelete.style.background = "var(--color-danger-strong)";
      mDelete.style.borderColor = "var(--color-danger-strong)";
      mDelete.style.color = "#fff";
      mDelete.textContent = "确认删除？";
      return;
    }
    const it = current;
    close();
    cb.onConfirmDelete(it);
  });

  return { open, close };
}
