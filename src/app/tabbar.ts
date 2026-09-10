/** Chrome 式标签条框架（docs/design/sidebar.md 全量对齐）：
 *  - 激活标签为与内容面板同色的「纸面」，指示条用平稳缓动滑动/morph 到激活槽位（无冲顿）；
 *  - 新增标签宽度 0→auto 展开、关闭时宽度收缩后移除（对齐 AnimatePresence 进出场）；
 *  - 标签贴合并排，非激活标签之间以 1px 分隔线划分（对齐 ChromeTab 分隔逻辑）；
 *  - 右键上下文菜单：关闭 / 关闭其他 / 关闭右侧 / 关闭左侧；
 *  - 键盘：方向键仅移动焦点，Enter/Space 激活，Delete/Backspace 关闭；
 *  - 持久化（localStorage "as-tabs"）、每视图一标签单实例。 */
import { icon } from "../lib/icons";
import type { ViewName } from "../lib/types";

export interface TabDef {
  id: ViewName;
  label: string;
  /** 内联 SVG（标签图标） */
  icon: string;
}

interface TabBarApi {
  /** 标签条根元素，由调用方放入内容区顶部 */
  el: HTMLElement;
  /** 打开视图：不存在则追加标签并激活，已存在仅激活（导航 / CTA / 拖拽共用入口） */
  open: (id: ViewName) => void;
  /** 关闭标签页：最后一个标签不可关闭；关闭激活标签时按「先右后左」激活邻居 */
  close: (id: ViewName) => void;
  /** 当前激活视图 */
  activeId: () => ViewName | null;
}

const STORE_KEY = "as-tabs";
const DEFAULT_VIEW: ViewName = "gallery";

/** 指示条补间时长（与进场/收缩动画节奏接近） */
const MOVE_MS = 260;
/** 进场展开 / 出场收缩时长（对齐文档 duration 0.2s ease） */
const GROW_MS = 220;
const EXIT_MS = 200;

interface State {
  open: ViewName[];
  active: ViewName;
}

/** 读取持久化状态；数据缺失 / 损坏时回退为默认（仅打开图库标签） */
function readState(defs: TabDef[]): State {
  const valid = (id: unknown): id is ViewName =>
    typeof id === "string" && defs.some((d) => d.id === id);
  let open: ViewName[] = [DEFAULT_VIEW];
  let active: ViewName = DEFAULT_VIEW;
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { open?: unknown; active?: unknown };
      const ids = Array.isArray(parsed.open) ? parsed.open.filter(valid) : [];
      if (ids.length > 0) {
        open = ids;
        active =
          valid(parsed.active) && open.includes(parsed.active as ViewName)
            ? (parsed.active as ViewName)
            : open[0];
      }
    }
  } catch {
    /* 忽略损坏数据 */
  }
  return { open, active };
}

interface CtxItem {
  label: string;
  icon?: string;
  /** 图标水平翻转（如「关闭左侧」用右箭头镜像） */
  flip?: boolean;
  disabled?: boolean;
  onPick: () => void;
}

export function createTabBar(defs: TabDef[], onChange: (id: ViewName) => void): TabBarApi {
  const byId = new Map(defs.map((d) => [d.id, d]));
  const state = readState(defs);
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const persist = (): void => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch {
      /* 忽略 */
    }
  };

  const el = document.createElement("div");
  el.className = "tab-strip relative flex shrink-0 items-end pt-2 bg-surface2 select-none";
  el.innerHTML = `
    <div class="tablist relative flex min-w-0 flex-1 items-end overflow-x-auto overflow-y-hidden px-3" role="tablist" aria-label="打开的视图"></div>
  `;
  const tablist = el.querySelector<HTMLElement>(".tablist")!;
  /** 标签节点持久化：节点不随状态重建，FLIP / 进出场 / 拖拽 / 指示条才能连续动画 */
  const tabNodes = new Map<ViewName, HTMLButtonElement>();

  // ---- 激活指示条：独立持久节点，「纸面」用平稳缓动补间滑到激活槽位。
  //      与 FLIP 同节奏（MOVE_MS），无弹簧起步冲量/过冲，点击切换更平稳 ----
  const indicator = document.createElement("div");
  indicator.className = "tab-active-bg";
  indicator.setAttribute("aria-hidden", "true");
  tablist.appendChild(indicator);
  const ind = { x: 0, w: 0, sx: 0, sw: 0, tx: 0, tw: 0, t0: 0, raf: 0, running: false, ready: false };
  const setIndicatorRect = (x: number, w: number): void => {
    indicator.style.left = `${x}px`;
    indicator.style.width = `${w}px`;
  };
  /** easeInOutCubic：起止平滑、中段略快，整段单调无冲顿 */
  const easeInOutCubic = (t: number): number =>
    t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const tickIndicator = (now: number): void => {
    if (!ind.running) return;
    const t = Math.min(1, (now - ind.t0) / MOVE_MS);
    const e = easeInOutCubic(t);
    ind.x = ind.sx + (ind.tx - ind.sx) * e;
    ind.w = ind.sw + (ind.tw - ind.sw) * e;
    setIndicatorRect(ind.x, ind.w);
    if (t >= 1) {
      ind.running = false;
      ind.raf = 0;
      setIndicatorRect(ind.tx, ind.tw);
    } else {
      ind.raf = requestAnimationFrame(tickIndicator);
    }
  };
  /** 粘合动画：离开时轻微拉伸，到达时平滑吸附 */
  const STICKY_MS = 220;
  let stickyTimer = 0;
  const triggerSticky = (): void => {
    if (reducedMotion) return;
    indicator.style.transformOrigin = "left bottom";
    indicator.style.animation = `tab-sticky-leave ${STICKY_MS}ms cubic-bezier(0.32, 0.72, 0.24, 1)`;
    window.clearTimeout(stickyTimer);
    stickyTimer = window.setTimeout(() => {
      indicator.style.animation = "";
    }, STICKY_MS);
  };
  /** 指示条平缓滑向目标槽位：随时可 retarget（以当前位置续接）；reduced-motion 直接就位 */
  const morphTo = (x: number, w: number): void => {
    if (!ind.ready || reducedMotion) {
      ind.ready = true;
      ind.running = false;
      ind.x = x;
      ind.w = w;
      setIndicatorRect(x, w);
      return;
    }
    ind.sx = ind.x;
    ind.sw = ind.w;
    ind.tx = x;
    ind.tw = w;
    ind.t0 = performance.now();
    if (!ind.running) {
      ind.running = true;
      ind.raf = requestAnimationFrame(tickIndicator);
    }
    // 粘合效果：离开当前槽位时触发轻微拉伸动画
    triggerSticky();
  };

  const TAB_BASE =
    "tab group relative flex h-9 shrink-0 cursor-pointer select-none items-center gap-2 whitespace-nowrap rounded-t-xl px-4 text-[13px] font-medium outline-none min-w-[140px] max-w-[220px] focus-visible:ring-2 focus-visible:ring-accent/70";

  const createTabNode = (id: ViewName): HTMLButtonElement => {
    const def = byId.get(id)!;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.tab = id;
    btn.title = def.label;
    btn.innerHTML = `
      <span class="tab-ic flex-none" aria-hidden="true">${def.icon}</span>
      <span class="min-w-0 flex-1 truncate">${def.label}</span>
      <span class="tab-close ml-0.5 grid h-[18px] w-[18px] flex-none place-items-center rounded-full text-ink3 transition-colors hover:bg-line hover:text-ink" data-close="${id}" aria-label="关闭「${def.label}」标签页" title="关闭标签页">${icon.x}</span>`;
    return btn;
  };

  /** 刷新节点状态（激活类 / aria / tabIndex），className 重建会覆盖拖拽类，需按需补回 */
  const updateNode = (node: HTMLButtonElement, id: ViewName): void => {
    node.className =
      TAB_BASE +
      (id === state.active ? " text-ink" : " text-ink2 hover:text-ink");
    node.setAttribute("aria-selected", String(id === state.active));
    node.tabIndex = id === state.active ? 0 : -1;
  };

  /** 指示条贴到激活标签槽位 */
  const updateIndicator = (): void => {
    const active = tablist.querySelector<HTMLElement>(`[data-tab="${state.active}"]`);
    if (!active) {
      indicator.style.opacity = "0";
      return;
    }
    indicator.style.opacity = "";
    morphTo(active.offsetLeft, active.offsetWidth);
  };

  /** 该标签当前是否持有键盘焦点（roving tabindex） */
  const isTabFocused = (id: ViewName): boolean => {
    const ae = document.activeElement;
    return ae instanceof HTMLElement && ae.dataset.tab === id;
  };

  /** 键盘焦点跟随到激活标签（新增标签 / 关闭持焦标签后调用，保证方向键可继续操作） */
  const focusActiveTab = (): void => {
    tabNodes.get(state.active)?.focus();
  };

  /** 新增标签的进场：宽度 0→实测值 展开 + 淡入（对齐文档 width:0→auto + opacity） */
  const growTab = (node: HTMLButtonElement): void => {
    const width = node.offsetWidth; // 进场前实测完整宽度（含图标与文字）
    if (width <= 0) return;
    node.style.minWidth = "0px";
    node.style.width = "0px";
    node.style.overflow = "hidden";
    node.style.opacity = "0";
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        node.style.transition = `width ${GROW_MS}ms cubic-bezier(0.32, 0.72, 0.24, 1), opacity 160ms ease`;
        node.style.width = `${width}px`;
        node.style.opacity = "1";
        window.setTimeout(() => {
          // 收尾：样式回落到 auto，再校正指示条目标宽度。
          // 注意不能在过渡刚起步时重测：起点处 offsetWidth 仍为 0，
          // 会把弹簧目标错误地定成 0，导致纸面只盖到图标为止。
          if (tabNodes.get(node.dataset.tab as ViewName) === node) {
            node.style.width = "";
            node.style.minWidth = "";
            node.style.overflow = "";
            node.style.opacity = "";
            node.style.transition = "";
            if (node.dataset.tab === state.active) {
              updateIndicator();
              node.scrollIntoView({ block: "nearest", inline: "nearest" });
            }
          }
        }, GROW_MS + 80);
      }),
    );
  };

  /** 出场动画：先收缩到 0 再执行状态变更（对齐 AnimatePresence exit），reduced-motion 直接执行 */
  const shrinkAndRemove = (ids: ViewName[], apply: () => void): void => {
    if (ids.length === 0 || reducedMotion) {
      apply();
      return;
    }
    const nodes = ids
      .map((id) => tabNodes.get(id))
      .filter((n): n is HTMLButtonElement => !!n);
    if (nodes.length === 0) {
      apply();
      return;
    }
    nodes.forEach((n) => {
      n.style.pointerEvents = "none";
      n.style.minWidth = "0px";
      n.style.width = `${n.offsetWidth}px`;
      n.style.overflow = "hidden";
    });
    nodes.forEach((n) => void n.offsetWidth); // 强制 reflow，确保过渡从当前宽开始
    nodes.forEach((n) => {
      n.style.transition = `width ${EXIT_MS}ms cubic-bezier(0.4, 0, 0.2, 1), opacity ${EXIT_MS}ms ease`;
      n.style.width = "0px";
      n.style.opacity = "0";
    });
    window.setTimeout(apply, EXIT_MS + 40);
  };

  /**
   * 按 state 同步标签列表（节点持久化）：
   * 移除已关闭 → 按打开顺序归位/补建 → 刷新状态 → 指示条 → 新增标签进场展开。
   * 关闭由收缩动画（shrinkAndRemove）连续让位，其它情形标签不发生位移。
   */
  const reconcile = (): void => {
    const added: HTMLButtonElement[] = [];
    let removed = false;
    for (const [id, node] of [...tabNodes]) {
      if (!state.open.includes(id)) {
        node.remove();
        tabNodes.delete(id);
        removed = true;
      }
    }
    const frag = document.createDocumentFragment();
    for (const id of state.open) {
      let node = tabNodes.get(id);
      if (!node) {
        node = createTabNode(id);
        tabNodes.set(id, node);
        added.push(node);
      }
      frag.appendChild(node);
    }
    tablist.appendChild(frag);

    state.open.forEach((id) => {
      const node = tabNodes.get(id);
      if (node) updateNode(node, id);
    });

    updateIndicator();
    // 新增标签从宽度 0 展开（首次渲染与持久化恢复时不播放入场）
    if (!firstRender && !reducedMotion) {
      for (const node of added) growTab(node);
    }
    firstRender = false;

    // 仅结构变化（新增/关闭）才把激活标签滚入可视区；
    // 纯点击激活时目标本就在视口内，多余的滚动会造成跳动
    const structural = added.length > 0 || removed;
    if (structural) {
      const active = tablist.querySelector<HTMLElement>(`[data-tab="${state.active}"]`);
      active?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  };
  let firstRender = true;

  // 上次已通知 onChange 的激活视图：随通知动态更新，避免「切回原视图」被误判为无变化
  let announced = state.active;

  /** 状态已变更：持久化 → 重渲染 → 激活视图真正变化时才通知外部切换页面 */
  const commit = (): void => {
    persist();
    reconcile();
    if (state.active !== announced) {
      announced = state.active;
      onChange(state.active);
    }
  };

  /** 激活已打开的视图（内部使用；不新增标签） */
  const activate = (id: ViewName): void => {
    if (id === state.active) return;
    state.active = id;
    commit();
  };

  /** 打开视图：不存在则追加并激活；已存在仅激活 */
  const open = (id: ViewName): void => {
    if (!byId.has(id)) return;
    if (!state.open.includes(id)) {
      state.open.push(id);
      state.active = id;
      commit();
      // 新增标签：键盘焦点跟随到新激活标签（与高亮的激活态一致）
      focusActiveTab();
    } else {
      activate(id);
    }
  };

  /** 关闭标签页：最后一个不可关闭；关闭激活标签时按「先右后左」激活邻居（收缩动画后移除） */
  const close = (id: ViewName): void => {
    const index = state.open.indexOf(id);
    if (index === -1 || state.open.length <= 1) return;
    shrinkAndRemove([id], () => {
      const hadFocus = isTabFocused(id);
      const nextOpen = state.open.filter((x) => x !== id);
      state.open = nextOpen;
      if (state.active === id) {
        state.active = nextOpen[Math.min(index, nextOpen.length - 1)];
      }
      commit();
      // 关闭的正是持焦标签：焦点让给新激活标签
      if (hadFocus) focusActiveTab();
    });
  };

  /** 关闭其他标签页：仅保留目标标签并激活它 */
  const closeOthers = (id: ViewName): void => {
    if (state.open.length <= 1 || !state.open.includes(id)) return;
    const removed = state.open.filter((x) => x !== id);
    shrinkAndRemove(removed, () => {
      const hadFocus = removed.some(isTabFocused);
      state.open = [id];
      state.active = id;
      commit();
      if (hadFocus) focusActiveTab();
    });
  };

  /** 关闭右侧标签页：保留到目标为止；若激活标签被关闭则激活目标 */
  const closeToRight = (id: ViewName): void => {
    const index = state.open.indexOf(id);
    if (index === -1 || index === state.open.length - 1) return;
    const removed = state.open.slice(index + 1);
    shrinkAndRemove(removed, () => {
      const hadFocus = removed.some(isTabFocused);
      state.open = state.open.slice(0, index + 1);
      if (!state.open.includes(state.active)) state.active = id;
      commit();
      if (hadFocus) focusActiveTab();
    });
  };

  /** 关闭左侧标签页：保留目标及右侧；若激活标签被关闭则激活目标 */
  const closeToLeft = (id: ViewName): void => {
    const index = state.open.indexOf(id);
    if (index <= 0) return;
    const removed = state.open.slice(0, index);
    shrinkAndRemove(removed, () => {
      const hadFocus = removed.some(isTabFocused);
      state.open = state.open.slice(index);
      if (!state.open.includes(state.active)) state.active = id;
      commit();
      if (hadFocus) focusActiveTab();
    });
  };

  // ---- 右键上下文菜单（文档 ContextMenu：关闭 / 关闭其他 / 关闭右侧 / 关闭左侧） ----
  const ctxRoot = document.createElement("div");
  ctxRoot.className = "ctx-root";
  ctxRoot.hidden = true;
  document.body.appendChild(ctxRoot);
  let ctxCleanup: (() => void) | null = null;

  const closeCtx = (): void => {
    ctxRoot.hidden = true;
    ctxRoot.innerHTML = "";
    ctxCleanup?.();
    ctxCleanup = null;
  };

  const showCtx = (x: number, y: number, items: CtxItem[]): void => {
    closeCtx();
    for (const item of items) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ctx-item";
      btn.disabled = !!item.disabled;
      if (item.disabled) btn.setAttribute("aria-disabled", "true");
      const iconHtml = item.icon
        ? `<span class="ctx-ic${item.flip ? " flip" : ""}" aria-hidden="true">${item.icon}</span>`
        : "";
      btn.innerHTML = `${iconHtml}<span class="min-w-0 flex-1 truncate">${item.label}</span>`;
      btn.addEventListener("click", () => {
        closeCtx();
        item.onPick();
      });
      ctxRoot.appendChild(btn);
    }
    ctxRoot.hidden = false;
    // 视口内钳制，避免菜单溢出窗口
    const rect = ctxRoot.getBoundingClientRect();
    const left = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8));
    const top = Math.max(8, Math.min(y, window.innerHeight - rect.height - 8));
    ctxRoot.style.left = `${left}px`;
    ctxRoot.style.top = `${top}px`;
    const onPointerDown = (ev: PointerEvent): void => {
      if (!ctxRoot.contains(ev.target as Node)) closeCtx();
    };
    const onKeyDown = (ev: KeyboardEvent): void => {
      if (ev.key === "Escape") closeCtx();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    ctxCleanup = () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  };

  // ---- 事件（容器级委托，节点持久故无需重新绑定） ----
  el.addEventListener("contextmenu", (e) => {
    const tabBtn = (e.target as HTMLElement).closest<HTMLElement>("[data-tab]");
    if (!tabBtn) return;
    e.preventDefault();
    const id = tabBtn.dataset.tab as ViewName;
    const index = state.open.indexOf(id);
    showCtx(e.clientX, e.clientY, [
      { label: "关闭标签页", disabled: state.open.length <= 1, onPick: () => close(id) },
      { label: "关闭其他标签页", disabled: state.open.length <= 1, onPick: () => closeOthers(id) },
      {
        label: "关闭右侧标签页",
        icon: icon.arrow,
        disabled: index === state.open.length - 1,
        onPick: () => closeToRight(id),
      },
      {
        label: "关闭左侧标签页",
        icon: icon.arrow,
        flip: true,
        disabled: index === 0,
        onPick: () => closeToLeft(id),
      },
    ]);
  });

  el.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const chip = target.closest<HTMLElement>("[data-close]");
    if (chip) {
      e.preventDefault();
      e.stopPropagation();
      close(chip.dataset.close as ViewName);
      return;
    }
    const tabBtn = target.closest<HTMLElement>("[data-tab]");
    if (tabBtn) {
      activate(tabBtn.dataset.tab as ViewName);
      tabBtn.focus();
    }
  });

  // 中键点击关闭标签（浏览器习惯）
  el.addEventListener("auxclick", (e) => {
    const ev = e as MouseEvent;
    if (ev.button !== 1) return;
    const tabBtn = (ev.target as HTMLElement).closest<HTMLElement>("[data-tab]");
    if (tabBtn) {
      ev.preventDefault();
      close(tabBtn.dataset.tab as ViewName);
    }
  });

  // 键盘（对齐文档）：方向键/Home/End 仅移动焦点；Enter/Space 激活；Delete/Backspace 关闭
  el.addEventListener("keydown", (e) => {
    if (!(e.target instanceof HTMLElement)) return;
    const tabs = Array.from(tablist.querySelectorAll<HTMLElement>("[data-tab]"));
    const index = tabs.indexOf(e.target);
    if (index === -1) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      activate(tabs[index].dataset.tab as ViewName);
      return;
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      close(tabs[index].dataset.tab as ViewName);
      return;
    }
    let next = -1;
    if (e.key === "ArrowRight") next = Math.min(index + 1, tabs.length - 1);
    else if (e.key === "ArrowLeft") next = Math.max(index - 1, 0);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    else return;
    e.preventDefault();
    tabs[next].focus();
  });

  // 窗口尺寸变化时指示条可能失位，跟随重排
  new ResizeObserver(() => {
    updateIndicator();
  }).observe(el);

  reconcile();
  // 初始状态即激活视图：通知外部完成首次视图切换（打开顺序按持久化恢复）
  onChange(state.active);

  return {
    el,
    open,
    close,
    activeId: () => state.active,
  };
}
