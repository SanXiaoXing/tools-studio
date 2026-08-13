/** 刻度滑块（vanilla，对齐 docs/design/slider.md 的 shadcn Slider + ticks demo）：
 *  8px 轨道 + 主色填充 + 圆形 thumb + 数值气泡 + 刻度（每 5 细线 / 每 10 数字标签）。
 *  键盘（←/→/Home/End）支持。onChange 拖动中触发，onCommit 松手/键盘提交触发。 */

export interface ElasticSliderOptions {
  value: number;
  min?: number;
  max?: number;
  /** 拖动中实时回调（四舍五入后的整数） */
  onChange?: (value: number) => void;
  /** 松手/键盘提交回调（自动保存用） */
  onCommit?: (value: number) => void;
}

export interface ElasticSlider {
  /** 外部同步值（恢复默认 / 导入备份后调用），不触发回调 */
  setValue: (v: number) => void;
}

const TICK_EVERY = 5; // 细刻度线间隔
const LABEL_EVERY = 10; // 数字标签间隔
const STEP = 5; // 拖动/键盘步进（与细刻度对齐）

export function renderElasticSlider(container: HTMLElement, opts: ElasticSliderOptions): ElasticSlider {
  const min = opts.min ?? 0;
  const max = opts.max ?? 100;
  let value = Math.min(Math.max(opts.value, min), max);

  // 刻度：0..max 每 TICK_EVERY 一根线，与 demo 一致（两端含边界值）
  const ticks: number[] = [];
  for (let t = 0; t <= max; t += TICK_EVERY) ticks.push(t);

  container.innerHTML = `
    <div class="es-root w-full touch-none select-none">
      <div class="es-body relative">
        <div class="es-bubble" role="status">${Math.round(value)}%</div>
        <div class="es-track relative cursor-grab" role="slider" tabindex="0"
             aria-valuemin="${min}" aria-valuemax="${max}" aria-valuenow="${Math.round(value)}"
             aria-label="压缩质量">
          <div class="es-fill absolute inset-y-0 left-0 rounded-full bg-accent"></div>
        </div>
        <div class="es-ticks flex items-start justify-between gap-1 px-2.5" aria-hidden="true">
          ${ticks
            .map((t) => {
              const major = t % LABEL_EVERY === 0;
              return `
            <span class="flex w-0 flex-col items-center justify-center gap-1.5">
              <span class="es-tick ${major ? "es-tick-major" : "es-tick-minor"}"></span>
              <span class="text-[10px] font-medium text-ink3 ${major ? "" : "opacity-0"}">${t}</span>
            </span>`;
            })
            .join("")}
        </div>
      </div>
    </div>`;

  const root = container.querySelector<HTMLElement>(".es-root")!;
  const body = root.querySelector<HTMLElement>(".es-body")!;
  const track = root.querySelector<HTMLElement>(".es-track")!;
  const fill = root.querySelector<HTMLElement>(".es-fill")!;
  const bubble = body.querySelector<HTMLElement>(".es-bubble")!;

  let dragging = false;

  const pct = (): number => ((value - min) / (max - min)) * 100;

  const sync = (notify: "change" | "none"): void => {
    const p = pct();
    fill.style.width = p + "%";
    // 气泡跟随滑块位置，两端留 4% 余量防止溢出轨道
    bubble.textContent = Math.round(value) + "%";
    bubble.style.left = `${Math.min(Math.max(p, 4), 96)}%`;
    track.setAttribute("aria-valuenow", String(Math.round(value)));
    if (notify === "change") opts.onChange?.(Math.round(value));
  };

  const moveTo = (clientX: number): void => {
    const rect = track.getBoundingClientRect();
    const raw = min + ((clientX - rect.left) / rect.width) * (max - min);
    value = Math.min(Math.max(Math.round(raw / STEP) * STEP, min), max);
    sync("change");
  };

  const endDrag = (): void => {
    if (!dragging) return;
    dragging = false;
    bubble.classList.remove("hot");
    opts.onCommit?.(Math.round(value));
  };

  track.addEventListener("pointerdown", (e) => {
    dragging = true;
    bubble.classList.add("hot"); // 气泡放大反馈
    track.setPointerCapture(e.pointerId);
    moveTo(e.clientX);
  });
  track.addEventListener("pointermove", (e) => {
    if (dragging) moveTo(e.clientX);
  });
  track.addEventListener("pointerup", endDrag);
  track.addEventListener("pointercancel", endDrag);

  track.addEventListener("keydown", (e) => {
    let next: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") next = Math.min(max, value + STEP);
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = Math.max(min, value - STEP);
    else if (e.key === "Home") next = min;
    else if (e.key === "End") next = max;
    if (next !== null) {
      e.preventDefault();
      value = next;
      sync("change");
    }
  });
  track.addEventListener("keyup", () => {
    if (!dragging) opts.onCommit?.(Math.round(value));
  });

  sync("none"); // 初始渲染不触发回调

  return {
    setValue: (v: number): void => {
      value = Math.min(Math.max(v, min), max);
      sync("none");
    },
  };
}
