/**
 * Apple 风格 spring（damping ratio + response 参数化，替代固定时长 CSS 过渡）。
 * 可中断：取消旧 spring 后从当前 on-screen 值继续新目标，无跳变。
 * 数值积分用半隐式欧拉，dt 钳制防跳帧发散。
 */
function animateSpring(
  from: number,
  to: number,
  onUpdate: (v: number) => void,
  opts: { damping?: number; response?: number; onComplete?: () => void } = {},
): () => void {
  const damping = opts.damping ?? 1.0; // 1.0 = 临界阻尼，无过冲（UI 默认）
  const response = opts.response ?? 0.3; // 到达目标的大致时间（秒），非固定时长
  const omega = (2 * Math.PI) / response;
  const stiffness = omega * omega;
  const friction = 2 * damping * omega;

  let pos = from;
  let vel = 0;
  let last = performance.now();
  let raf = requestAnimationFrame(tick);

  function tick(now: number): void {
    const dt = Math.min((now - last) / 1000, 1 / 30);
    last = now;
    const acc = -stiffness * (pos - to) - friction * vel;
    vel += acc * dt; // 半隐式欧拉
    pos += vel * dt;
    onUpdate(pos);
    if (Math.abs(pos - to) < 0.001 && Math.abs(vel) < 0.001) {
      onUpdate(to);
      opts.onComplete?.();
      return;
    }
    raf = requestAnimationFrame(tick);
  }

  return () => cancelAnimationFrame(raf);
}

export interface SegOption<T extends string> {
  value: T;
  label: string;
}

export interface SlidingSeg<T extends string> {
  /**
   * 设置当前选中值：同步滑动指示器 + 文字高亮，并触发 onChange（用户点击 / 外部同步共用）。
   * `silent: true` 仅同步指示器与高亮、不触发 onChange（用于恢复默认 / 导入备份等外部同步，
   * 避免 onChange 的副作用（如写模板）覆盖被同步的状态）。
   */
  setValue: (v: T, opts?: { silent?: boolean }) => void;
}

/**
 * 通用分段选择器：滑动指示器（spring 动画）+ 文字高亮，点击即回调 onChange。
 * 主题切换（theme.ts）与「命名方式」等共用本组件，保证滑动动画一致。
 * 首次渲染直接落位不做入场动画；prefers-reduced-motion 时直接切换。
 * size: "md"（默认，主题）| "sm"（紧凑，如命名方式）。
 * autoWidth: 每项按文字长短自适应（滑块宽度/位置随选中项实际尺寸变化），
 *   默认 false —— 等分宽度（旧行为，用于主题 / 命名方式）。
 */
export function renderSlidingSeg<T extends string>(
  container: HTMLElement,
  opts: {
    options: SegOption<T>[];
    value: T;
    onChange: (v: T) => void;
    size?: "sm" | "md";
    autoWidth?: boolean;
  },
): SlidingSeg<T> {
  const n = opts.options.length;
  const small = opts.size === "sm";
  const autoWidth = opts.autoWidth ?? false;
  // autoWidth：宽度/位置由 JS 按实测尺寸写入（内联 left:0 覆盖 left-0.5，与 offsetLeft 同基准）
  // 非 autoWidth：宽度等分，不能用 Tailwind 任意值 class（动态 ${n} 不会被扫描生成），用内联 style
  const thumbStyle = autoWidth ? "left:0" : `width: calc((100% - 4px)/${n})`;
  const btnCls = small
    ? "relative z-10 rounded-md px-2.5 py-1 text-xs font-medium transition-colors"
    : "relative z-10 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors";
  // autoWidth：按钮按内容宽度排布（不 flex-1 均分），文字不换行
  const itemCls = autoWidth ? `${btnCls} flex-none whitespace-nowrap` : `${btnCls} flex-1`;
  // w-fit：宽度贴合内容（autoWidth 必选；sm 亦如此），不占满整行
  const wrapCls = autoWidth || small
    ? "relative flex w-fit rounded-lg border border-line bg-surface2 p-0.5"
    : "relative flex rounded-lg border border-line bg-surface2 p-0.5";
  container.innerHTML = `
    <div class="${wrapCls}" role="group" aria-label="分段选择">
      <div class="seg-thumb absolute top-0.5 bottom-0.5 left-0.5 rounded-md bg-surface shadow-sm will-change-transform" style="${thumbStyle}"></div>
      ${opts.options
        .map(
          (o) => `
      <button type="button" data-seg="${o.value}" class="${itemCls}">${o.label}</button>`,
        )
        .join("")}
    </div>`;

  const wrapEl = container.firstElementChild as HTMLElement;
  const btns = Array.from(container.querySelectorAll<HTMLButtonElement>("[data-seg]"));
  const thumb = container.querySelector<HTMLElement>(".seg-thumb")!;
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  let inited = false; // 首次渲染直接落位，不做入场动画
  let thumbPos = 0; // 指示器当前位置（0..n-1），动画中也实时更新，供中断续接
  let cancelSpring: (() => void) | null = null;

  // ---- autoWidth：实测每项几何，滑块按进度在相邻项之间插值（位置 + 宽度）----
  let metrics: { x: number; w: number }[] = [];
  let metricsValid = false;
  let pendingIndex = -1; // 容器不可见（尺寸为 0）时暂存目标项
  let progress = 0; // 当前插值进度（0..n-1）

  const measure = (): boolean => {
    const m = btns.map((b) => ({ x: b.offsetLeft, w: b.offsetWidth }));
    if (m.some((g) => g.w <= 0)) return false; // 仍不可见，等 ResizeObserver
    metrics = m;
    metricsValid = true;
    return true;
  };

  const applyProgress = (t: number): void => {
    const a = Math.max(0, Math.min(Math.floor(t), n - 1));
    const b = Math.min(a + 1, n - 1);
    const k = Math.max(0, Math.min(t - a, 1));
    const x = metrics[a].x + (metrics[b].x - metrics[a].x) * k;
    const w = metrics[a].w + (metrics[b].w - metrics[a].w) * k;
    thumb.style.transform = `translateX(${x}px)`;
    thumb.style.width = `${w}px`;
  };

  const placeAuto = (i: number, animate: boolean): void => {
    cancelSpring?.();
    if (!animate) {
      progress = i;
      applyProgress(i);
      return;
    }
    cancelSpring = animateSpring(
      progress,
      i,
      (v) => {
        progress = v;
        applyProgress(v);
      },
      { onComplete: () => { cancelSpring = null; } },
    );
  };

  const setValue = (v: T, extra?: { silent?: boolean }): void => {
    if (!extra?.silent) opts.onChange(v);
    const i = Math.max(0, btns.findIndex((b) => b.dataset.seg === v));
    // 文字高亮立即切换（响应优先，不等动画）
    btns.forEach((b) => {
      const active = b.dataset.seg === v;
      b.classList.toggle("text-ink", active);
      b.classList.toggle("text-ink2", !active);
    });

    // autoWidth：先确保测到真实尺寸（弹窗首次渲染时容器可能是 hidden）
    if (autoWidth) {
      if (!metricsValid && !measure()) {
        pendingIndex = i;
        return;
      }
      placeAuto(i, inited && !prefersReducedMotion.matches);
      inited = true;
      return;
    }

    // 初始化 / reduced-motion：直接落位
    if (!inited || prefersReducedMotion.matches) {
      inited = true;
      thumbPos = i;
      thumb.style.transform = `translateX(${i * 100}%)`;
      return;
    }

    // spring：从当前 on-screen 值续接，可被下一次点击中断重定向
    cancelSpring?.();
    cancelSpring = animateSpring(
      thumbPos,
      i,
      (v2) => {
        thumbPos = v2;
        thumb.style.transform = `translateX(${v2 * 100}%)`;
      },
      { onComplete: () => { cancelSpring = null; } },
    );
  };

  btns.forEach((b) =>
    b.addEventListener("click", () => setValue(b.dataset.seg as T)),
  );

  // autoWidth：容器/按钮尺寸变化（弹窗由 hidden 变可见、字体加载等）后重新测量并落位
  if (autoWidth && typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(() => {
      if (!measure()) return;
      if (pendingIndex >= 0) {
        const i = pendingIndex;
        pendingIndex = -1;
        placeAuto(i, false); // 首次可见直接落位，不做入场动画
        inited = true;
        return;
      }
      placeAuto(progress, false); // 尺寸变化后按当前进度重排，不做动画
    });
    ro.observe(wrapEl);
    btns.forEach((b) => ro.observe(b));
  }

  // 初始渲染：直接落位且不触发 onChange（避免初始化副作用，如弹 toast）
  setValue(opts.value, { silent: true });

  return { setValue };
}
