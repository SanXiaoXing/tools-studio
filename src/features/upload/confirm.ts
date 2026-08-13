import { basename, esc } from "../../lib/utils";
import { icon } from "../../lib/icons";

/** 上传二次确认弹窗（vanilla 版）：列出待上传文件（可逐个移除），确认后才真正入队。
 *  显隐与回调由调用方（upload.ts）控制；移除状态由内部维护。 */
export function showConfirmUpload(
  paths: string[],
  onConfirm: (paths: string[]) => void,
  onCancel: () => void,
): void {
  let pending = [...paths];
  const MAX_SHOW = 100;

  const wrap = document.createElement("div");
  wrap.className = "fixed inset-0 z-40 flex items-center justify-center p-6 bg-[rgba(9,12,18,.55)] backdrop-blur-sm";
  document.body.appendChild(wrap);

  const close = (): void => {
    document.removeEventListener("keydown", onKey);
    wrap.remove();
  };

  const render = (): void => {
    const shown = pending.slice(0, MAX_SHOW);
    const extra = pending.length - shown.length;
    wrap.innerHTML = `
    <div class="w-full max-w-[420px] max-h-[80dvh] flex flex-col bg-surface border border-line rounded-2xl shadow-modal overflow-hidden" role="dialog" aria-modal="true" aria-labelledby="confirmTitle">
      <div class="flex items-center justify-between px-5 py-4 border-b border-line">
        <h2 id="confirmTitle" class="text-[15px] font-bold">确认上传</h2>
        <button type="button" data-act="cancel" class="flex items-center justify-center w-[30px] h-[30px] rounded-lg border border-line bg-surface text-ink2 hover:bg-surface3 hover:text-ink transition" title="取消" aria-label="取消">${icon.x}</button>
      </div>
      <p class="px-5 pt-3.5 text-[13px] text-ink3 leading-relaxed">
        将转换为 WebP 后上传，共 <span class="text-ink font-semibold tnum">${pending.length}</span> 张图片，请确认：
      </p>
      <ul class="confirm-list flex-1 min-h-0 mx-5 mt-3 mb-4 overflow-y-auto flex flex-col gap-1">
        ${shown
          .map(
            (p, i) => `
        <li class="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-surface2 text-[13px]">
          <span class="text-ink3 shrink-0">${icon.image}</span>
          <span class="flex-1 min-w-0 truncate" title="${esc(basename(p))}">${esc(basename(p))}</span>
          <button type="button" data-remove="${i}" class="shrink-0 flex items-center justify-center w-6 h-6 rounded-md text-ink3 hover:text-danger hover:bg-danger-soft transition" title="移除" aria-label="移除">${icon.x}</button>
        </li>`,
          )
          .join("")}
        ${extra > 0 ? `<li class="px-2.5 py-1.5 text-xs text-ink3">… 还有 ${extra} 张未显示</li>` : ""}
      </ul>
      <div class="flex gap-2.5 px-5 py-4 border-t border-line">
        <button type="button" data-act="cancel" class="flex-1 rounded-lg px-4.5 py-2.5 border border-line bg-surface text-ink2 text-sm font-medium hover:bg-surface3 hover:text-ink transition">取消</button>
        <button type="button" data-act="confirm" class="flex-1 inline-flex items-center justify-center gap-2 rounded-lg px-4.5 py-2.5 bg-accent-strong text-white text-sm font-semibold hover:bg-accent active:scale-[.985] transition">${icon.upload}确认上传</button>
      </div>
    </div>`;
  };

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") {
      close();
      onCancel();
    }
  };

  // 事件委托：内部按钮（移除/确认/取消）与遮罩点击关闭
  wrap.addEventListener("click", (e) => {
    if (e.target === wrap) {
      close();
      onCancel();
      return;
    }
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-act],button[data-remove]");
    if (!btn) return;
    if (btn.dataset.remove !== undefined) {
      pending = pending.filter((_, idx) => idx !== Number(btn.dataset.remove));
      if (pending.length === 0) {
        close();
        onCancel();
      } else {
        render();
      }
      return;
    }
    if (btn.dataset.act === "confirm") {
      const remaining = pending;
      close();
      onConfirm(remaining);
      return;
    }
    if (btn.dataset.act === "cancel") {
      close();
      onCancel();
    }
  });

  document.addEventListener("keydown", onKey);
  render();
}
