import { UploadIcon } from "../lib/icons";

/**
 * 全局拖拽遮罩：拖入窗口时全屏提示"释放以上传"。
 * 显隐由外部（main.ts）通过 isVisible 控制；drop 后由 main.ts 跳转上传页并触发二次确认。
 * 样式见 styles.css 的 .drag-overlay / .drag-overlay-icon（毛玻璃 + 品牌光晕 + 呼吸动画）。
 */
export function DragMask({ isVisible }: { isVisible: boolean }) {
  if (!isVisible) return null;

  return (
    <div className="drag-overlay fixed inset-0 z-50 pointer-events-none" role="status" aria-live="polite">
      <div className="absolute inset-4 rounded-xl border-2 border-dashed border-accent/60">
        <div className="flex h-full flex-col items-center justify-center gap-4">
          <div className="drag-overlay-icon flex items-center justify-center text-accent">
            <UploadIcon />
          </div>
          <div className="text-center">
            <p className="text-lg font-bold text-white">释放文件以上传图片</p>
            <p className="mt-1 text-sm text-white/70">自动转换为 WebP 并压缩</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default DragMask;
