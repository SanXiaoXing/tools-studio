/**
 * Card → 详情弹窗 Shared Element Transition。
 *
 * 三条独立飞行层，全部只动 transform / opacity / clip-path（合成器可代劳）：
 * 1. shell 壳：卡片矩形 → 弹窗矩形，非等比矩形变形。壳里没有位图，只有纯色面 + 描边，
 *    所以非等比不会拉伸任何像素；圆角固定 16px（起点与卡片 12px 的差异由卡片自身像素补齐）。
 * 2. view 图片层：窗口（卡片媒体框 → 弹窗内图片框）用 clip-path 裁切，图片在窗口里始终
 *    等比 cover 居中 —— 全程不变形，起点与卡片 cover、终点与弹窗 contain 像素级重合。
 * 3. backdrop 遮罩：独立整层，自己淡入淡出，不再靠 wrap 的 opacity 连带子节点。
 *
 * 不卡不闪的关键：
 * - 栅格化按"终点尺寸"上屏，飞行中只做缩小方向的光栅缩放，避开放大首帧按错尺寸重栅格化；
 * - 交接发生在 t=1：此刻壳 / 图片层与真实弹窗几何完全重合，同帧移除飞行层并显示弹窗，
 *   没有交叉淡入淡出，也就没有半透明重影；
 * - 真实 dialog 全程停在终点布局，只用父级 opacity 隐藏（不做 FLIP，避免整棵子树重栅格化）；
 * - 阴影单独成层、只动 opacity，交接时与弹窗阴影同强度，避免阴影"啪"地出现。
 */

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface SharedEls {
  wrap: HTMLElement;
  /** 独立遮罩层（wrap 内第一个子节点），自行淡入淡出 */
  backdrop: HTMLElement;
  dialog: HTMLElement;
  img: HTMLImageElement;
  imgPanel: HTMLElement;
  infoPanel: HTMLElement;
}

export const EASE_OPEN = "cubic-bezier(0.23, 1, 0.32, 1)";
export const EASE_CLOSE = "cubic-bezier(0.32, 0.72, 0, 1)";
export const OPEN_MS = 300;
export const CLOSE_MS = 260;
/** 交接后信息面板 / 关闭按钮淡入 */
const INFO_MS = 150;
/** 遮罩淡入淡出 */
const BACKDROP_MS = 260;
/** 飞行进度：阴影从此处开始渐显（交接时到满，与真实弹窗阴影对齐） */
const SHADOW_FROM = 0.5;
/** 壳圆角：固定值，与弹窗 rounded-2xl 一致 */
const SHELL_R = 16;
/** 图片窗口起点圆角：与卡片图片 rounded-lg 一致 */
const VIEW_R = 8;

const IDENTITY = "translate(0px, 0px) scale(1, 1)";
const ANIM_CLS = "is-shared-anim";
const SHELL_CLS = "shared-el-shell";
const VIEW_CLS = "shared-el-view";

/** 进行中的飞行（关闭打断时用来读回当前视觉进度） */
let flight: { anims: Animation[]; duration: number } | null = null;
/** 交接后内容淡入动画（forceShow 时取消，避免 fill:both 残留卡住 opacity） */
let contentAnims: Animation[] = [];

export function getRect(el: Element): Rect {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);
const px = (n: number): string => `${n.toFixed(2)}px`;

const lerpRect = (a: Rect, b: Rect, t: number): Rect => ({
  left: lerp(a.left, b.left, t),
  top: lerp(a.top, b.top, t),
  width: lerp(a.width, b.width, t),
  height: lerp(a.height, b.height, t),
});

/** from → to 的等比/非等比位移缩放（transform-origin 必须为 top left） */
export function placeAs(from: Rect, to: Rect): string {
  const sx = to.width / from.width;
  const sy = to.height / from.height;
  return `translate(${px(to.left - from.left)}, ${px(to.top - from.top)}) scale(${sx.toFixed(5)}, ${sy.toFixed(5)})`;
}

/** 图片在面板里的 contain 框（transform: none，尺寸即等比可视框） */
function containBox(panel: Rect, naturalW: number, naturalH: number): Rect {
  if (naturalW <= 0 || naturalH <= 0 || panel.width <= 0 || panel.height <= 0) return panel;
  const scale = Math.min(panel.width / naturalW, panel.height / naturalH);
  const w = naturalW * scale;
  const h = naturalH * scale;
  return {
    left: panel.left + (panel.width - w) / 2,
    top: panel.top + (panel.height - h) / 2,
    width: w,
    height: h,
  };
}

function cardMedia(card: HTMLElement): HTMLElement {
  return (
    card.querySelector<HTMLElement>(".card-media") ??
    card.querySelector<HTMLImageElement>("img")?.parentElement ??
    card
  );
}

function cardMediaBox(card: HTMLElement): Rect {
  return getRect(cardMedia(card));
}

function srcOf(img: HTMLImageElement | null): string {
  return img?.currentSrc || img?.src || "";
}

/**
 * 图片层几何：窗口矩形 + 布局矩形（= 终点 contain 框，宽高比与自然尺寸一致）
 * → 等比放大到刚好 cover 窗口、居中，再在图片本地坐标里把窗口外的部分 clip 掉。
 *
 * 因为窗口起止两端（卡片媒体框 / 弹窗图片框）与布局框的宽高比只在终点相同，
 * cover 比例在整段飞行里正好是线性的，所以 transform / clipPath 都能两帧插值，
 * 不需要额外采样关键帧。
 */
function viewGeometry(win: Rect, box: Rect, radius: number): { transform: string; clipPath: string } {
  const k = Math.max(win.width / box.width, win.height / box.height);
  const w = box.width * k;
  const h = box.height * k;
  const left = win.left + (win.width - w) / 2;
  const top = win.top + (win.height - h) / 2;
  // 窗口在图片本地坐标（左上角为原点、未缩放）里的位置
  const cl = Math.max(0, (win.left - left) / k);
  const ct = Math.max(0, (win.top - top) / k);
  const cw = win.width / k;
  const ch = win.height / k;
  const cr = Math.max(0, box.width - cl - cw);
  const cb = Math.max(0, box.height - ct - ch);
  return {
    transform: `translate(${px(left - box.left)}, ${px(top - box.top)}) scale(${k.toFixed(5)})`,
    clipPath: `inset(${px(ct)} ${px(cr)} ${px(cb)} ${px(cl)} round ${radius}px)`,
  };
}

function removeFxNodes(): void {
  document.body.querySelectorAll(`.${SHELL_CLS}, .${VIEW_CLS}`).forEach((n) => n.remove());
}

/** 壳：布局盒固定为弹窗矩形，起点用 transform 摆到卡片矩形 */
function mountShell(dialogRect: Rect, at: Rect): HTMLElement {
  const el = document.createElement("div");
  el.className = SHELL_CLS;
  el.setAttribute("aria-hidden", "true");
  el.style.left = px(dialogRect.left);
  el.style.top = px(dialogRect.top);
  el.style.width = px(dialogRect.width);
  el.style.height = px(dialogRect.height);
  el.style.transform = placeAs(dialogRect, at);
  el.style.borderRadius = `${SHELL_R}px`;
  el.innerHTML = `<i class="shared-el-shadow" style="border-radius:${SHELL_R}px"></i>`;
  document.body.appendChild(el);
  return el;
}

/** 图片层：布局盒 = 终点 contain 框，起点用 transform + clipPath 摆到窗口 */
function mountView(box: Rect, win: Rect, src: string, radius: number): HTMLImageElement {
  const img = document.createElement("img");
  img.className = VIEW_CLS;
  img.alt = "";
  img.draggable = false;
  img.setAttribute("aria-hidden", "true");
  const g = viewGeometry(win, box, radius);
  img.style.left = px(box.left);
  img.style.top = px(box.top);
  img.style.width = px(box.width);
  img.style.height = px(box.height);
  img.style.transform = g.transform;
  img.style.clipPath = g.clipPath;
  // 图片本体必须已解码（同一 URL 已在卡片上屏，走内存位图缓存），否则整段转场放弃
  img.src = src;
  document.body.appendChild(img);
  return img;
}

function shadowOf(shell: HTMLElement): HTMLElement | null {
  return shell.querySelector<HTMLElement>(".shared-el-shadow");
}

/** 清掉隐藏态，让 CSS 默认可见性生效（cancel 之后必须调用） */
function forceShow(els: SharedEls): void {
  cancelAnims(contentAnims);
  contentAnims = [];
  els.dialog.style.opacity = "";
  els.dialog.style.visibility = "";
  els.dialog.style.transform = "";
  els.dialog.style.willChange = "";
  els.infoPanel.style.opacity = "";
  els.img.style.opacity = "";
  els.imgPanel.style.opacity = "";
  const closeBtn = els.dialog.querySelector<HTMLElement>(".modal-close");
  if (closeBtn) closeBtn.style.opacity = "";
  els.backdrop.style.opacity = "";
  els.wrap.style.opacity = "";
  els.wrap.classList.remove(ANIM_CLS);
}

export function cancelAnims(anims: Animation[]): void {
  for (const a of anims) {
    a.onfinish = null;
    a.oncancel = null;
    try {
      a.cancel();
    } catch {
      /* already idle */
    }
  }
}

/** 结束 / 打断统一收尾：先 cancel（去掉 fill:both 的计算值），再 forceShow，最后移除飞行层 */
export function finishTransitionFx(els: SharedEls, anims: Animation[] = []): void {
  cancelAnims(anims);
  flight = null;
  forceShow(els);
  removeFxNodes();
}

/** 交接后把弹窗内容（信息面板 / 关闭按钮）淡进来，避免"啪"地整块出现 */
function revealContent(els: SharedEls): Animation[] {
  const opts: KeyframeAnimationOptions = { duration: INFO_MS, easing: "ease-out", fill: "both" };
  const anims: Animation[] = [els.infoPanel.animate([{ opacity: 0 }, { opacity: 1 }], opts)];
  const closeBtn = els.dialog.querySelector<HTMLElement>(".modal-close");
  if (closeBtn) anims.push(closeBtn.animate([{ opacity: 0 }, { opacity: 1 }], opts));
  return anims;
}

/**
 * 进场：壳从卡片矩形撑到弹窗矩形；图片层从卡片媒体框（cover 裁切）过渡到弹窗图片框
 * （contain 完整）；遮罩独立淡入。t=1 时飞行层与真实弹窗几何完全重合，同帧换真身。
 */
export function playOpenTransition(
  els: SharedEls,
  sourceCard: HTMLElement,
  onSettle?: () => void,
): Animation[] {
  finishTransitionFx(els);

  // 先摆成"不可见但可量"：真身 opacity 0、遮罩 opacity 0，量到的就是终点布局
  els.dialog.style.transform = "";
  els.dialog.style.opacity = "0";
  els.backdrop.style.opacity = "0";
  els.wrap.classList.add(ANIM_CLS);
  void els.dialog.offsetWidth;

  const cardRect = getRect(sourceCard);
  const mediaRect = cardMediaBox(sourceCard);
  const dialogRect = getRect(els.dialog);
  const panelRect = getRect(els.imgPanel);
  const cardImg = sourceCard.querySelector<HTMLImageElement>("img");
  const src = srcOf(els.img) || srcOf(cardImg);
  // 尺寸以弹窗 img 为准（握手时两者 URL 相同），拿不到再退到卡片图；再拿不到就放弃转场
  const nw = els.img.naturalWidth || cardImg?.naturalWidth || 0;
  const nh = els.img.naturalHeight || cardImg?.naturalHeight || 0;
  const box = containBox(panelRect, nw, nh);

  if (
    !src ||
    nw <= 0 ||
    nh <= 0 ||
    dialogRect.width < 2 ||
    dialogRect.height < 2 ||
    cardRect.width < 2 ||
    cardRect.height < 2 ||
    mediaRect.width < 2 ||
    mediaRect.height < 2 ||
    box.width < 2 ||
    box.height < 2
  ) {
    forceShow(els); // 调用方回退到淡入淡出
    return [];
  }

  const shell = mountShell(dialogRect, cardRect);
  const view = mountView(box, mediaRect, src, VIEW_R);
  const shadow = shadowOf(shell);
  const from = viewGeometry(mediaRect, box, VIEW_R);
  const to = viewGeometry(box, box, 0);
  void shell.offsetWidth;

  const anims: Animation[] = [];

  anims.push(
    els.backdrop.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: BACKDROP_MS,
      easing: "ease-out",
      fill: "both",
    }),
  );

  anims.push(
    shell.animate([{ transform: placeAs(dialogRect, cardRect) }, { transform: IDENTITY }], {
      duration: OPEN_MS,
      easing: EASE_OPEN,
      fill: "both",
    }),
  );

  if (shadow) {
    anims.push(
      shadow.animate(
        [
          { opacity: 0, offset: 0 },
          { opacity: 0, offset: SHADOW_FROM },
          { opacity: 1, offset: 1 },
        ],
        { duration: OPEN_MS, easing: "linear", fill: "both" },
      ),
    );
  }

  anims.push(
    view.animate([{ transform: from.transform, clipPath: from.clipPath }, { transform: to.transform, clipPath: to.clipPath }], {
      duration: OPEN_MS,
      easing: EASE_OPEN,
      fill: "both",
    }),
  );

  flight = { anims, duration: OPEN_MS };

  let settled = false;
  const settle = (): void => {
    if (settled) return;
    settled = true;
    cancelAnims(anims);
    flight = null;
    removeFxNodes();
    // 一次性把飞行期写下的隐藏态全部交回 CSS 默认（dialog / backdrop 的 inline opacity）
    // 并摘掉 is-shared-anim —— 那个类带着 .modal-dialog{pointer-events:none}，
    // 漏摘就会让弹窗全程点不动（复制 / 删除 / 链接格式分段控件全部失效）。
    // 隐藏态一律走 forceShow 单一出口，避免以后再漏。
    forceShow(els);
    contentAnims = revealContent(els);
    onSettle?.();
  };
  anims[anims.length - 1].onfinish = settle;
  window.setTimeout(settle, OPEN_MS + 80);

  return anims;
}

/**
 * 关闭打断进场时读回当前视觉进度：壳宽在"卡片矩形 → 弹窗矩形"之间的插值比例。
 * 0 = 还在卡片上，1 = 已落在弹窗。没有飞行层或未等比时返回 null（按已落位处理）。
 */
export function readFlightProgress(cardRect: Rect, dialogRect: Rect): number | null {
  if (!flight) return null;
  const shell = document.body.querySelector<HTMLElement>(`.${SHELL_CLS}`);
  if (!shell) return null;
  const span = dialogRect.width - cardRect.width;
  if (Math.abs(span) < 2) return null;
  return clamp01((getRect(shell).width - cardRect.width) / span);
}

/**
 * 出场：从当前视觉状态（打断时为飞行中途）收回卡片；壳先盖住真身再同帧隐掉它，
 * 所以不会出现"空壳没图"的一段；结尾飞行层精确落回卡片位置，移除即无缝。
 */
export function playCloseTransition(
  els: SharedEls,
  sourceCard: HTMLElement | null,
  progress = 1,
): Animation[] {
  removeFxNodes();
  // 内容淡入可能还在跑（fill:both 优先级高于 inline）：不撤掉的话，
  // 下面给面板写的 inline opacity:0 会被动画盖住，打断关闭时会看到面板没被壳盖住的残影
  cancelAnims(contentAnims);
  contentAnims = [];
  els.wrap.classList.add(ANIM_CLS);

  const dialogRect = getRect(els.dialog);
  const panelRect = getRect(els.imgPanel);
  const card: HTMLElement | null = sourceCard && sourceCard.isConnected ? sourceCard : null;
  const cardRect = card ? getRect(card) : null;
  const mediaRect = card ? cardMediaBox(card) : null;
  const src = srcOf(els.img);
  const nw = els.img.naturalWidth;
  const nh = els.img.naturalHeight;
  const box = containBox(panelRect, nw, nh);

  if (
    !card ||
    !cardRect ||
    !mediaRect ||
    !src ||
    nw <= 0 ||
    nh <= 0 ||
    dialogRect.width < 2 ||
    cardRect.width < 2 ||
    cardRect.height < 2 ||
    mediaRect.width < 2 ||
    box.width < 2 ||
    box.height < 2
  ) {
    forceShow(els);
    return [];
  }

  const p = clamp01(progress);
  const fromShell = lerpRect(cardRect, dialogRect, p);
  const fromWindow = lerpRect(mediaRect, box, p);
  const fromRadius = lerp(VIEW_R, 0, p);
  const from = viewGeometry(fromWindow, box, fromRadius);
  const to = viewGeometry(mediaRect, box, VIEW_R);
  const shadowFrom = clamp01((p - SHADOW_FROM) / (1 - SHADOW_FROM));

  const shell = mountShell(dialogRect, fromShell);
  const view = mountView(box, fromWindow, src, fromRadius);
  const shadow = shadowOf(shell);
  void shell.offsetWidth;

  // 壳已（或即将完全）盖住真身：同帧隐掉弹窗与内容，不再有"先空壳后淡入"的空白段
  els.dialog.style.opacity = "0";
  els.infoPanel.style.opacity = "0";
  const closeBtn = els.dialog.querySelector<HTMLElement>(".modal-close");
  if (closeBtn) closeBtn.style.opacity = "0";

  const anims: Animation[] = [];

  anims.push(
    els.backdrop.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: CLOSE_MS,
      easing: "ease-out",
      fill: "both",
    }),
  );

  anims.push(
    shell.animate([{ transform: placeAs(dialogRect, fromShell) }, { transform: placeAs(dialogRect, cardRect) }], {
      duration: CLOSE_MS,
      easing: EASE_CLOSE,
      fill: "both",
    }),
  );

  if (shadow) {
    anims.push(
      shadow.animate(
        [
          { opacity: shadowFrom, offset: 0 },
          { opacity: shadowFrom, offset: 0.35 },
          { opacity: 0, offset: 1 },
        ],
        { duration: CLOSE_MS, easing: "linear", fill: "both" },
      ),
    );
  }

  anims.push(
    view.animate([{ transform: from.transform, clipPath: from.clipPath }, { transform: to.transform, clipPath: to.clipPath }], {
      duration: CLOSE_MS,
      easing: EASE_CLOSE,
      fill: "both",
    }),
  );

  flight = { anims, duration: CLOSE_MS };
  return anims;
}
