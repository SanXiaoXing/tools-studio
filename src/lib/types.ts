/** 领域类型（对应 docs/design/DESIGN-SPEC.md） */

/** 图片项：mock 或上传流程生成，path 为对象存储归档路径 */
export interface ImageItem {
  name: string;
  type: string;
  size: string;
  dims: string;
  date: string;
  seed?: string;
  path: string;
  objectURL?: string;
}

/** 设置（DESIGN.md §5.3），持久化于 localStorage("as-settings") */
export interface Settings {
  domain: string;
  pathTemplate: string;
  /** 复制链接的格式：纯 URL 或 Markdown 图片语法 */
  copyFormat: "url" | "markdown";
  /** WebP 压缩率 1-100，越低体积越小 */
  quality: number;
}

/** 上传队列项 */
export interface QueueItem {
  name: string;
  url: string;
  bytes: number;
  sizeBefore: string;
  sizeAfter: string;
  dims: string;
  status: string;
  pct: number;
  done: boolean;
  path?: string;
  /** 真实磁盘路径（Tauri 拖拽/对话框获取），用于 invoke 转换 */
  inputPath: string;
  /** 转换输出路径（与 inputPath 同目录 .webp） */
  outputPath: string;
  failed?: boolean;
}

export type ViewName = "gallery" | "upload" | "settings";
