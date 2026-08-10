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
  renameFind: string;
  renameReplace: string;
  /** 复制链接的格式：纯 URL 或 Markdown 图片语法 */
  copyFormat: "url" | "markdown";
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
}

export type ViewName = "gallery" | "upload" | "settings";
