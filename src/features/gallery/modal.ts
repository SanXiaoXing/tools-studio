import type { ImageItem } from "../../lib/types";
import { Channel, convertFileSrc, invoke } from "@tauri-apps/api/core";
import { formatContent } from "../../lib/utils";
import { icon } from "../../lib/icons";
import { getSettings, updateSettings } from "../../lib/settings";
import { renderSlidingSeg } from "../../lib/seg";
import {
  finishTransitionFx,
  getRect,
  playCloseTransition,
  playOpenTransition,
  readFlightProgress,
  type Rect,
  type SharedEls,
} from "./sharedTransition";

interface ModalCallbacks {
  onCopy: (it: ImageItem, btn: HTMLButtonElement) => void;
  onConfirmDelete: (it: ImageItem) => void;
}

/** get_thumbnails 命令经 Channel 回传的单条结果：path 为本地缩略图路径，空串表示生成失败 */
interface ThumbRes {
  key: string;
  path: string;
}

interface DetailModal {
  /** source：图库卡片，用于 Card → 详情共享元素转场 */
  open(it: ImageItem, source?: HTMLElement | null): void;
  close(): void;
}

/** 详情弹窗（DESIGN-SPEC §3.6）：预览 + 信息 + 链接 + 复制/删除（两阶段）
 *  打开/关闭：有 source 时走 Shared Element Transition（背景淡入 + Card 容器连续缩放）；
 *  reduced-motion 或无 source 时回退到克制的淡入淡出。 */
export function createModal(cb: ModalCallbacks): DetailModal {
  const wrap = document.createElement("div");
  wrap.hidden = true;
  wrap.className = "modal-root fixed inset-0 z-40 flex items-center justify-center p-6 max-lg:p-3";
  wrap.innerHTML = `
  <div class="modal-backdrop fixed inset-0 bg-[rgba(9,12,18,.55)] backdrop-blur-sm" aria-hidden="true"></div>
  <div class="modal-dialog relative w-full max-w-[920px] max-h-[calc(100dvh-48px)] max-lg:max-h-[calc(100dvh-24px)] flex flex-col bg-surface border border-line rounded-2xl shadow-modal overflow-hidden" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
    <button class="modal-close absolute top-3.5 right-3.5 z-[1] flex items-center justify-center w-[34px] h-[34px] rounded-[10px] border border-line bg-surface text-ink2 hover:bg-surface3 hover:text-ink transition" type="button" title="关闭" aria-label="关闭">${icon.x}</button>
    <div class="modal-body grid flex-1 min-h-0 grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] max-lg:grid-cols-1 max-lg:grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
      <div class="modal-img-panel bg-surface2 h-[min(560px,60dvh)] min-h-[320px] flex items-center justify-center overflow-hidden max-lg:h-[min(220px,35dvh)] max-lg:min-h-0">
        <img id="modalImg" alt="" class="w-full h-full object-contain">
      </div>
      <div class="modal-info flex flex-col gap-4.5 min-h-0 p-6 max-lg:p-4 overflow-y-auto border-l border-line max-lg:border-l-0 max-lg:border-t">
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
          <div id="formatSegMount"></div>
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
  const dialog = $<HTMLElement>(".modal-dialog");
  const backdrop = $<HTMLElement>(".modal-backdrop");
  const imgPanel = $<HTMLElement>(".modal-img-panel");
  const infoPanel = $<HTMLElement>(".modal-info");

  const sharedEls: SharedEls = { wrap, backdrop, dialog, img, imgPanel, infoPanel };

  let current: ImageItem | null = null;
  let deleting = false;
  /** 触发本次打开的图库卡片，关闭时作为共享元素回收目标 */
  let sourceCard: HTMLElement | null = null;
  /** 预览异步加载序号：连续打开不同图片时，旧请求的迟到回传不覆盖新预览 */
  let previewSeq = 0;
  /** 出场动画定时器：连续开关时取消上一次，避免过早 hidden 或残留类名 */
  let closeTimer = 0;
  /** 当前进行中的 FLIP 动画（打断时 cancel） */
  let activeAnims: Animation[] = [];
  let usingShared = false;
  /** 转场飞行中：图片层已上屏，此时换预览 src 会导致交接瞬间图片跳一下，故推迟 */
  let flightActive = false;
  /** 飞行期间被推迟的预览 URL，交接后写入 */
  let pendingSrc = "";
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  /**
   * 预览加载：本地 objectURL（刚上传，磁盘产物）直接使用；
   * 云端恢复的图片走 get_thumbnails 本地缩略图缓存（命中磁盘秒开，未命中下载生成），
   * 避免详情弹窗从网络加载原图；生成失败（path 空 / 整批出错）回退公开 URL。
   *
   * 两个防闪细节：
   * 1. URL 与当前 src 相同则跳过 —— 重新赋值会让 <img> 重解码，闪一下空白；
   * 2. 转场飞行期间不换 src —— 换了会与飞行层图片不一致，交接时图片"跳"一下，
   *    推迟到交接（onSettle）之后再写。
   */
  const applyPreview = (url: string): void => {
    if (!url || img.src === url) return;
    if (flightActive) {
      pendingSrc = url;
      return;
    }
    img.src = url;
  };

  const loadPreview = (it: ImageItem): void => {
    if (it.objectURL) {
      applyPreview(it.objectURL);
      return;
    }
    const seq = ++previewSeq;
    const key = it.path;
    const fallback = it.url ?? "";
    invoke("get_thumbnails", {
      items: [{ key, url: fallback }],
      onMessage: new Channel<ThumbRes>((res) => {
        if (seq !== previewSeq || res.key !== key) return;
        applyPreview(res.path ? convertFileSrc(res.path) : fallback);
      }),
    }).catch(() => {
      if (seq === previewSeq) applyPreview(fallback);
    });
  };

  const resetDelete = (): void => {
    deleting = false;
    mDelete.style.background = "";
    mDelete.style.borderColor = "";
    mDelete.style.color = "";
    mDelete.textContent = "删除图片";
  };

  const formatSeg = renderSlidingSeg<"url" | "markdown">($<HTMLElement>("#formatSegMount"), {
    options: [
      { value: "url", label: "URL" },
      { value: "markdown", label: "Markdown" },
    ],
    value: getSettings().copyFormat,
    size: "sm",
    // 两项文字长度不同（URL / Markdown），滑块按文字实际宽度自适应，不做等分
    autoWidth: true,
    onChange: (f) => {
      updateSettings({ copyFormat: f });
      if (current) mLink.value = formatContent(current);
    },
  });

  /** 取消进行中动画并强制恢复可显示（cancel 先于清 inline，避免 fill:both 卡在 opacity:0） */
  const stopActiveAnims = (): void => {
    flightActive = false;
    finishTransitionFx(sharedEls, activeAnims);
    activeAnims = [];
  };

  /** 交接完成（飞行层已与真身重合、飞行层已移除）：补上飞行期间被推迟的预览 URL */
  const settlePreview = (): void => {
    flightActive = false;
    const url = pendingSrc;
    pendingSrc = "";
    if (url && img.src !== url) img.src = url;
  };

  const finishClose = (): void => {
    stopActiveAnims();
    pendingSrc = "";
    wrap.classList.remove("modal-anim-in", "modal-anim-out");
    wrap.hidden = true;
    wrap.style.opacity = "";
    document.body.style.overflow = "";
    current = null;
    sourceCard = null;
    usingShared = false;
  };

  const open = (it: ImageItem, source?: HTMLElement | null): void => {
    window.clearTimeout(closeTimer);
    stopActiveAnims();
    wrap.classList.remove("modal-anim-in", "modal-anim-out");

    current = it;
    sourceCard = source ?? null;
    resetDelete();
    // 先用卡片已上屏的位图垫底：飞行层与真身用同一张图，交接时不会换成空白；
    // 同 src 不重复赋值，避免 <img> 重解码闪一下
    const seedImg = source?.querySelector<HTMLImageElement>("img");
    const seed = seedImg?.currentSrc || seedImg?.src || "";
    if (seed && img.src !== seed) img.src = seed;
    loadPreview(it);
    img.alt = it.name;
    title.textContent = it.name;
    mType.textContent = it.type;
    mDims.textContent = it.dims;
    mSize.textContent = it.size;
    mDate.textContent = it.date;
    mPath.textContent = it.path;
    mLink.value = formatContent(it);
    formatSeg.setValue(getSettings().copyFormat, { silent: true });
    mCopy.style.background = "";
    mCopy.innerHTML = icon.copy + "复制链接";

    const canShare = !reducedMotion.matches && !!sourceCard && sourceCard.isConnected;
    // 走共享元素时先把真身 / 遮罩摆成隐藏态，再解除 hidden —— 否则会闪一帧满血弹窗
    if (canShare) {
      dialog.style.transform = "";
      dialog.style.opacity = "0";
      backdrop.style.opacity = "0";
    }

    wrap.hidden = false;
    document.body.style.overflow = "hidden";

    if (canShare && sourceCard) {
      usingShared = true;
      activeAnims = playOpenTransition(sharedEls, sourceCard, settlePreview);
      if (activeAnims.length === 0) {
        usingShared = false;
        stopActiveAnims();
        void wrap.offsetWidth;
        wrap.classList.add("modal-anim-in");
      } else {
        flightActive = true;
      }
      return;
    }

    usingShared = false;
    sourceCard = null;
    if (!reducedMotion.matches) {
      void wrap.offsetWidth;
      wrap.classList.add("modal-anim-in");
    }
  };

  const close = (): void => {
    window.clearTimeout(closeTimer);

    if (reducedMotion.matches || !usingShared || !sourceCard) {
      stopActiveAnims();
      if (reducedMotion.matches) {
        finishClose();
        return;
      }
      wrap.classList.remove("modal-anim-in");
      wrap.classList.add("modal-anim-out");
      closeTimer = window.setTimeout(finishClose, 170);
      return;
    }

    const target = sourceCard;
    // 打断进场时先读回飞行进度：必须赶在 cancel 之前 —— cancel 后壳会回落到起始 transform，
    // 再量就只能读到"还在卡片上"。没在飞行（已落位）时按 1 处理。
    const cardBox: Rect = getRect(target);
    const dlgBox: Rect = getRect(dialog);
    const progress = readFlightProgress(cardBox, dlgBox) ?? 1;

    const prev = activeAnims;
    activeAnims = [];
    for (const a of prev) {
      a.onfinish = null;
      try {
        a.cancel();
      } catch {
        /* idle */
      }
    }

    activeAnims = playCloseTransition(sharedEls, target, progress);
    if (activeAnims.length === 0) {
      stopActiveAnims();
      wrap.classList.remove("modal-anim-in");
      wrap.classList.add("modal-anim-out");
      closeTimer = window.setTimeout(finishClose, 170);
      return;
    }
    const last = activeAnims[activeAnims.length - 1];
    last.onfinish = () => finishClose();
    closeTimer = window.setTimeout(finishClose, 300);
  };

  closeBtn.addEventListener("click", close);
  wrap.addEventListener("click", (e) => {
    // 遮罩已独立成层：点它也算点空白处关闭
    if (e.target === wrap || e.target === backdrop) close();
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
