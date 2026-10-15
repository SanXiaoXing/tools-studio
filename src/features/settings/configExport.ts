import QRCode from "qrcode";
import type { Settings } from "../../lib/types";
import { icon } from "../../lib/icons";
import { EASE_CLOSE, EASE_OPEN, getRect, placeAs } from "../gallery/sharedTransition";

export interface ConnectionConfig {
  server: string;
  apiKey: string;
}

interface ConfigExport {
  appId: "assets-studio";
  formatVersion: 1;
  settings: Settings;
  connection: ConnectionConfig;
}

/** Stable, versioned format shared by desktop file export and the future mobile importer. */
export function serializeConfigExport(settings: Settings, connection: ConnectionConfig, compact = false): string {
  const payload: ConfigExport = {
    appId: "assets-studio",
    formatVersion: 1,
    settings,
    connection,
  };
  return JSON.stringify(payload, null, compact ? undefined : 2);
}

/** Generate the QR locally so credentials are never sent to a remote QR service. */
export function showConfigQrDialog(payload: string, source: HTMLButtonElement): void {
  const dialog = document.createElement("dialog");
  dialog.className = "config-qr-dialog w-[min(92vw,420px)] max-h-[90dvh] overflow-y-auto rounded-2xl border border-line bg-surface p-0 text-ink shadow-modal";
  dialog.setAttribute("aria-labelledby", "configQrTitle");
  dialog.setAttribute("aria-describedby", "configQrDescription");
  dialog.innerHTML = `<div class="config-qr-content">
    <div class="flex items-start justify-between gap-4 px-6 pt-5">
      <div class="min-w-0">
        <h2 id="configQrTitle" class="m-0 text-[18px] leading-snug font-bold tracking-tight">配置二维码</h2>
        <p id="configQrDescription" class="m-0 mt-1 text-[13px] leading-relaxed text-ink2">后续可用移动端扫描导入设置</p>
      </div>
      <button type="button" data-close class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink2 hover:bg-surface3" aria-label="关闭">${icon.x}</button>
    </div>
    <div class="flex flex-col items-center px-6 pb-5 pt-4">
      <div class="config-qr-frame flex h-[360px] w-full items-center justify-center rounded-xl bg-surface2 p-2">
        <canvas hidden class="block h-auto max-w-full" width="344" height="344" role="img" aria-label="包含应用设置和 Worker 连接信息的二维码"></canvas>
        <p data-status role="status" class="text-[13px] text-ink3">正在生成二维码…</p>
      </div>
      <p class="m-0 mt-4 text-center text-xs leading-relaxed text-ink3">二维码包含 Worker 地址和 API Key。仅在自己的设备间扫描，请勿截图分享。</p>
      <div role="alert" data-error hidden class="mt-3 text-center text-sm text-danger"></div>
      <button type="button" data-close class="mt-4 inline-flex min-h-9 items-center justify-center rounded-lg border border-line bg-surface px-5 py-2 text-[13px] font-medium text-ink2 hover:bg-surface3">完成</button>
    </div></div>`;

  const content = dialog.querySelector<HTMLElement>(".config-qr-content")!;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const sourceVisibility = source.style.visibility;
  const sourceRect = getRect(source);
  let dialogRect = sourceRect;
  let panelMotion: Animation | null = null;
  let contentMotion: Animation | null = null;
  let closing = false;

  const close = (): void => {
    if (closing) return;
    closing = true;
    dialog.classList.add("is-closing");
    if (!panelMotion) dialogRect = getRect(dialog);
    const currentTransform = getComputedStyle(dialog).transform;
    const currentOpacity = getComputedStyle(content).opacity;
    panelMotion?.cancel();
    contentMotion?.cancel();

    const target = source.isConnected ? placeAs(dialogRect, getRect(source)) : "none";
    panelMotion = dialog.animate(
      reducedMotion || !source.isConnected
        ? [{ opacity: 1 }, { opacity: 0 }]
        : [{ transform: currentTransform }, { transform: target }],
      { duration: reducedMotion ? 140 : 250, easing: EASE_CLOSE, fill: "forwards" },
    );
    contentMotion = content.animate(
      [{ opacity: currentOpacity }, { opacity: 0 }],
      { duration: reducedMotion ? 100 : 110, easing: "ease-in", fill: "forwards" },
    );
    panelMotion.onfinish = () => dialog.close();
  };

  dialog.querySelectorAll<HTMLButtonElement>("[data-close]").forEach((button) => {
    button.addEventListener("click", close);
  });
  dialog.addEventListener("click", (event) => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right ||
        event.clientY < bounds.top || event.clientY > bounds.bottom) close();
  });
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    close();
  });
  dialog.addEventListener("close", () => {
    panelMotion?.cancel();
    contentMotion?.cancel();
    source.style.visibility = sourceVisibility;
    dialog.remove();
    if (source.isConnected) source.focus({ preventScroll: true });
  });
  document.body.appendChild(dialog);

  const canvas = dialog.querySelector("canvas")!;
  const status = dialog.querySelector<HTMLElement>("[data-status]")!;
  const error = dialog.querySelector<HTMLElement>("[data-error]")!;
  content.style.opacity = "0";
  dialog.showModal();
  dialogRect = getRect(dialog);
  source.style.visibility = "hidden";
  panelMotion = dialog.animate(
    reducedMotion
      ? [{ opacity: 0 }, { opacity: 1 }]
      : [{ transform: placeAs(dialogRect, sourceRect) }, { transform: "none" }],
    { duration: reducedMotion ? 140 : 300, easing: EASE_OPEN, fill: "both" },
  );
  contentMotion = content.animate(
    [{ opacity: 0 }, { opacity: 0, offset: reducedMotion ? 0 : 0.52 }, { opacity: 1 }],
    { duration: reducedMotion ? 140 : 300, easing: "ease-out", fill: "forwards" },
  );
  panelMotion.onfinish = () => {
    panelMotion?.cancel();
    panelMotion = null;
    contentMotion?.cancel();
    contentMotion = null;
    content.style.opacity = "";
  };
  void QRCode.toCanvas(canvas, payload, {
    errorCorrectionLevel: "M",
    margin: 2,
    width: 344,
    color: { dark: "#111827", light: "#ffffff" },
  }).then(() => {
    status.hidden = true;
    canvas.hidden = false;
  }).catch(() => {
    status.hidden = true;
    error.hidden = false;
    error.textContent = "二维码生成失败，请改用 JSON 文件导出。";
  });
}
