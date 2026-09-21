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

/**
 * 分段指示器统一的 spring 参数，四处分段控件（主题 / 命名方式 / 链接格式 / 压缩模式）共用，
 * 保证滑动手感完全一致：
 * - damping 0.75（略欠阻尼）：滑到位后带回弹落位，比临界阻尼"重"，即所说的阻尼感；
 * - response 0.36s：比默认 0.3s 慢一档，短距离位移也看得清过程，不会一闪而过。
 * 默认值 1.0 / 0.3 是临界阻尼，本身无过冲，短距滑动基本看不出动画，故此处统一放宽。
 * 实测（60Hz 半隐式欧拉）：约 0.12s 走完 85%，末端过冲 0.5%~0.6%（≈0.5px），0.55s 静止。
 * 过冲量刻意压得很小：指示器只有轨道内边距（SEG_PAD）可容身，过冲再大就会冲出轨道边框。
 */
const SEG_SPRING = { damping: 0.75, response: 0.36 };

/** 弹簧过冲时允许越界的项数上限。仅作保护，实际过冲不到 1% 项，远小于此值 */
const SEG_OVERRUN = 0.08;

/** 轨道内边距（px）。下面三处必须与它同步，否则指示器会跟按钮错位：
 *  ① 轨道 wrapper 的 p-1 ② 指示器的 top/bottom/left-1 ③ 等分宽度 calc((100% - 2*SEG_PAD)/n)。
 *  指示器内圆角也由它决定（轨道外圆角 - SEG_PAD），见 wrapCls 处的同心圆角注释。
 *  取值比原来的 2px 大，让轨道留出呼吸感、指示器与文字之间不再贴死。 */
const SEG_PAD = 4;

/** 分段控件统一的蓝色指示器与选中文字色（styles.css 的 .seg-thumb-blue / --color-seg-thumb）。
 *  主题切换、命名方式、链接格式、压缩模式四处共用同一套默认样式，
 *  颜色与滑动动画都不在调用处单独覆盖，避免又出现"一处蓝一处白"。 */
const SEG_THUMB_CLASS = "seg-thumb-blue";
const SEG_ACTIVE_CLASS = "text-accent font-semibold";

interface SegOption<T extends string> {
  value: T;
  label: string;
}

interface SlidingSeg<T extends string> {
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
 *   默认 false —— 等分宽度（用于主题 / 命名方式）。
 * 指示器与选中文字外观统一用 SEG_THUMB_CLASS / SEG_ACTIVE_CLASS，调用处不传参。
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
  const thumbCls = SEG_THUMB_CLASS;
  const activeCls = SEG_ACTIVE_CLASS;
  // autoWidth：宽度/位置由 JS 按实测尺寸写入（内联 left:0 覆盖 left-1，与 offsetLeft 同基准）
  // 非 autoWidth：宽度等分，不能用 Tailwind 任意值 class（动态 ${n} 不会被扫描生成），用内联 style
  const thumbStyle = autoWidth ? "left:0" : `width: calc((100% - ${SEG_PAD * 2}px)/${n})`;
  // 按钮内边距随轨道一起放大（原 sm 10/4px、md 12/6px 偏挤），保持字号与圆角不变
  const btnCls = small
    ? "relative z-10 rounded-md px-3 py-1.5 text-xs font-medium transition-colors"
    : "relative z-10 rounded-md px-3.5 py-2 text-[13px] font-medium transition-colors";
  // autoWidth：按钮按内容宽度排布（不 flex-1 均分），文字不换行
  const itemCls = autoWidth ? `${btnCls} flex-none whitespace-nowrap` : `${btnCls} flex-1`;
  // 圆角必须同心：指示器内圆角 = 轨道外圆角 - SEG_PAD。轨道取 10px（与侧边栏导航项、
  // 上传主按钮、弹窗关闭按钮同一档，app 的"选中态 chip"圆角），10 - 4 = 6px 即 rounded-md，
  // 于是指示器与轨道的角平行、四周留白均匀；轨道若回到 8px，指示器就得降到 4px 才不顶角。
  // 两点都写死成静态 class：动态拼 rounded-[${...}px] 同样扫不到，样式不会生成。
  // w-fit：宽度贴合内容（autoWidth 必选；sm 亦如此），不占满整行
  const wrapCls = autoWidth || small
    ? "relative flex w-fit rounded-[10px] border border-line bg-surface2 p-1"
    : "relative flex rounded-[10px] border border-line bg-surface2 p-1";
  container.innerHTML = `
    <div class="${wrapCls}" role="group" aria-label="分段选择">
      <div class="seg-thumb absolute top-1 bottom-1 left-1 rounded-md will-change-transform ${thumbCls}" style="${thumbStyle}"></div>
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

  /** 位置 / 宽度插值。k 不夹到 [0,1]：弹簧过冲时线性外推，指示器越过目标再回弹落位
   *  （等分模式下 translateX 天然过冲，这里补齐，两种模式手感才一致）。
   *  t 的越界量由 SEG_OVERRUN 兜底，避免极端参数下指示器冲出容器。 */
  const applyProgress = (t: number): void => {
    const tc = Math.max(Math.min(t, n - 1 + SEG_OVERRUN), -SEG_OVERRUN);
    const a = Math.max(0, Math.min(Math.floor(tc), n - 2));
    const b = Math.min(a + 1, n - 1);
    const k = tc - a;
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
      { ...SEG_SPRING, onComplete: () => { cancelSpring = null; } },
    );
  };

  const setValue = (v: T, extra?: { silent?: boolean }): void => {
    if (!extra?.silent) opts.onChange(v);
    const i = Math.max(0, btns.findIndex((b) => b.dataset.seg === v));
    // 文字高亮立即切换（响应优先，不等动画）；activeCls 可含多个 class
    const activeTokens = activeCls.split(/\s+/).filter(Boolean);
    btns.forEach((b) => {
      const active = b.dataset.seg === v;
      activeTokens.forEach((c) => b.classList.toggle(c, active));
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
      { ...SEG_SPRING, onComplete: () => { cancelSpring = null; } },
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
