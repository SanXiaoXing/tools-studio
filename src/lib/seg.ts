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
 */
export function renderSlidingSeg<T extends string>(
  container: HTMLElement,
  opts: { options: SegOption<T>[]; value: T; onChange: (v: T) => void; size?: "sm" | "md" },
): SlidingSeg<T> {
  const n = opts.options.length;
  const small = opts.size === "sm";
  // 滑块宽度不能用 Tailwind 任意值 class（动态 ${n} 拼接不会被扫描生成），改用内联 style
  const thumbStyle = `width: calc((100% - 4px)/${n})`;
  const btnCls = small
    ? "relative z-10 flex-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors"
    : "relative z-10 flex-1 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors";
  // sm：宽度贴合内容（w-fit），不占满整行
  const wrapCls = small
    ? "relative flex w-fit rounded-lg border border-line bg-surface2 p-0.5"
    : "relative flex rounded-lg border border-line bg-surface2 p-0.5";
  container.innerHTML = `
    <div class="${wrapCls}" role="group" aria-label="分段选择">
      <div class="seg-thumb absolute top-0.5 bottom-0.5 left-0.5 rounded-md bg-surface shadow-sm will-change-transform" style="${thumbStyle}"></div>
      ${opts.options
        .map(
          (o) => `
      <button type="button" data-seg="${o.value}" class="${btnCls}">${o.label}</button>`,
        )
        .join("")}
    </div>`;

  const btns = Array.from(container.querySelectorAll<HTMLButtonElement>("[data-seg]"));
  const thumb = container.querySelector<HTMLElement>(".seg-thumb")!;
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  let inited = false; // 首次渲染直接落位，不做入场动画
  let thumbPos = 0; // 指示器当前位置（0..n-1），动画中也实时更新，供中断续接
  let cancelSpring: (() => void) | null = null;

  const setValue = (v: T, extra?: { silent?: boolean }): void => {
    if (!extra?.silent) opts.onChange(v);
    const i = Math.max(0, btns.findIndex((b) => b.dataset.seg === v));
    // 文字高亮立即切换（响应优先，不等动画）
    btns.forEach((b) => {
      const active = b.dataset.seg === v;
      b.classList.toggle("text-ink", active);
      b.classList.toggle("text-ink2", !active);
    });

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

  // 初始渲染：直接落位且不触发 onChange（避免初始化副作用，如弹 toast）
  setValue(opts.value, { silent: true });

  return { setValue };
}
