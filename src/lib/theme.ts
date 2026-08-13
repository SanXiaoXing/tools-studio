import type { Settings } from "./types";
import { getSettings, updateSettings } from "./settings";

/** 系统深色偏好监听（theme="system" 时跟随实时变化） */
const themeMedia = window.matchMedia("(prefers-color-scheme: dark)");

/** 应用主题：把 data-theme 写到 <html>，CSS 变量据此切换（styles.css） */
export const applyTheme = (theme: Settings["theme"]): void => {
  const root = document.documentElement;
  root.dataset.theme = theme === "system" ? (themeMedia.matches ? "dark" : "light") : theme;
};

// 跟随系统模式：系统偏好变化时实时切换
themeMedia.addEventListener("change", () => {
  if (getSettings().theme === "system") applyTheme("system");
});

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

export interface ThemeSeg {
  /** 设置主题：保存到 settings + 应用到 <html> + 同步滑动指示器（按钮点击与外部同步共用） */
  setTheme: (t: Settings["theme"]) => void;
}

/** 主题三选 segment：滑动指示器（spring 动画）+ 文字高亮，点击即保存并应用。
 *  渲染到传入容器；返回 setTheme 供外部同步（恢复默认 / 导入备份）。 */
export function renderThemeSeg(container: HTMLElement): ThemeSeg {
  container.innerHTML = `
    <div class="theme-seg relative flex rounded-lg border border-line bg-surface2 p-0.5" role="group" aria-label="主题模式">
      <div class="theme-seg-thumb absolute top-0.5 bottom-0.5 left-0.5 w-[calc((100%-4px)/3)] rounded-md bg-surface shadow-sm will-change-transform"></div>
      <button type="button" data-theme="system" class="relative z-10 flex-1 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors">跟随系统</button>
      <button type="button" data-theme="dark" class="relative z-10 flex-1 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors">深色</button>
      <button type="button" data-theme="light" class="relative z-10 flex-1 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors">浅色</button>
    </div>`;

  const btns = Array.from(container.querySelectorAll<HTMLButtonElement>("[data-theme]"));
  const thumb = container.querySelector<HTMLElement>(".theme-seg-thumb")!;
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  let inited = false; // 首次渲染直接落位，不做入场动画
  let thumbPos = 0; // 指示器当前位置（0/1/2），动画中也实时更新，供中断续接
  let cancelSpring: (() => void) | null = null;

  const setTheme = (t: Settings["theme"]): void => {
    updateSettings({ theme: t });
    applyTheme(t);
    const i = Math.max(0, btns.findIndex((b) => b.dataset.theme === t));
    // 文字高亮立即切换（响应优先，不等动画）
    btns.forEach((b) => {
      const active = b.dataset.theme === t;
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
    cancelSpring = animateSpring(thumbPos, i, (v) => {
      thumbPos = v;
      thumb.style.transform = `translateX(${v * 100}%)`;
    }, { onComplete: () => { cancelSpring = null; } });
  };

  btns.forEach((b) =>
    b.addEventListener("click", () => setTheme(b.dataset.theme as Settings["theme"])),
  );

  setTheme(getSettings().theme);

  return { setTheme };
}
