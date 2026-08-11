import { useEffect, useState } from "react";
import { basename } from "../../lib/utils";
import { ImageIcon, UploadIcon, XIcon } from "../../lib/icons";

/**
 * 上传二次确认弹窗：列出待上传文件（可逐个移除），确认后才真正入队。
 * 显隐与回调由外部（upload.ts）通过 props 控制；移除状态由组件内部管理。
 */
export interface ConfirmUploadProps {
  paths: string[];
  onConfirm: (paths: string[]) => void;
  onCancel: () => void;
}

export function ConfirmUpload({ paths, onConfirm, onCancel }: ConfirmUploadProps) {
  const [pending, setPending] = useState<string[]>(paths);
  const MAX_SHOW = 100;
  const shown = pending.slice(0, MAX_SHOW);
  const extra = pending.length - shown.length;

  // Escape 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const removeAt = (i: number): void => {
    const next = pending.filter((_, idx) => idx !== i);
    setPending(next);
    if (next.length === 0) onCancel(); // 全部移除后自动关闭
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center p-6 bg-[rgba(9,12,18,.55)] backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        className="w-full max-w-[420px] max-h-[80dvh] flex flex-col bg-surface border border-line rounded-2xl shadow-modal overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirmTitle"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-line">
          <h2 id="confirmTitle" className="text-[15px] font-bold">确认上传</h2>
          <button
            type="button"
            onClick={onCancel}
            className="flex items-center justify-center w-[30px] h-[30px] rounded-lg border border-line bg-surface text-ink2 hover:bg-surface3 hover:text-ink transition"
            title="取消"
            aria-label="取消"
          >
            <XIcon />
          </button>
        </div>
        <p className="px-5 pt-3.5 text-[13px] text-ink3 leading-relaxed">
          将转换为 WebP 后上传，共 <span className="text-ink font-semibold tnum">{pending.length}</span> 张图片，请确认：
        </p>
        <ul className="confirm-list flex-1 min-h-0 mx-5 mt-3 mb-4 overflow-y-auto flex flex-col gap-1">
          {shown.map((p, i) => (
            <li key={p} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-surface2 text-[13px]">
              <span className="text-ink3 shrink-0">
                <ImageIcon />
              </span>
              <span className="flex-1 min-w-0 truncate" title={basename(p)}>
                {basename(p)}
              </span>
              <button
                type="button"
                onClick={() => removeAt(i)}
                className="shrink-0 flex items-center justify-center w-6 h-6 rounded-md text-ink3 hover:text-danger hover:bg-danger-soft transition"
                title="移除"
                aria-label="移除"
              >
                <XIcon />
              </button>
            </li>
          ))}
          {extra > 0 && <li className="px-2.5 py-1.5 text-xs text-ink3">… 还有 {extra} 张未显示</li>}
        </ul>
        <div className="flex gap-2.5 px-5 py-4 border-t border-line">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-lg px-4.5 py-2.5 border border-line bg-surface text-ink2 text-sm font-medium hover:bg-surface3 hover:text-ink transition"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => onConfirm(pending)}
            className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg px-4.5 py-2.5 bg-accent-strong text-white text-sm font-semibold hover:bg-accent active:scale-[.985] transition"
          >
            <UploadIcon />
            确认上传
          </button>
        </div>
      </div>
    </div>
  );
}

export default ConfirmUpload;
