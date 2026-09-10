import type { Settings } from "./types";
import { getSettings, updateSettings } from "./settings";
import { renderSlidingSeg } from "./seg";

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

/** 主题三选 segment：滑动指示器（spring 动画）+ 文字高亮，点击即保存并应用。
 *  返回 renderSlidingSeg 的 setValue，供外部同步（恢复默认 / 导入备份）。
 *  滑动动画与设置页「命名方式」共用 renderSlidingSeg（seg.ts），交互一致。 */
export function renderThemeSeg(container: HTMLElement) {
  return renderSlidingSeg<Settings["theme"]>(container, {
    options: [
      { value: "system", label: "跟随系统" },
      { value: "dark", label: "深色" },
      { value: "light", label: "浅色" },
    ],
    value: getSettings().theme,
    onChange: (t) => {
      updateSettings({ theme: t });
      applyTheme(t);
    },
  });
}
