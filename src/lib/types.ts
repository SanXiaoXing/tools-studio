/** 领域类型（对应 docs/design/DESIGN-SPEC.md） */

/** 图片项：上传流程生成，path 为对象存储归档路径 */
export interface ImageItem {
  name: string;
  type: string;
  size: string;
  dims: string;
  date: string;
  path: string;
  /** 完整访问 URL（Worker 上传后返回，优先于 domain+path 拼接） */
  url?: string;
  objectURL?: string;
}

/** 设置（DESIGN.md §5.3）：非连接类配置持久化于 localStorage("as-settings")。
 *  Worker 连接信息（server / apiKey）存 Rust 侧 config.json（WORKER-V2.md §7），不落前端。 */
export interface Settings {
  domain: string;
  pathTemplate: string;
  /** 复制链接的格式：纯 URL 或 Markdown 图片语法 */
  copyFormat: "url" | "markdown";
  /** WebP 压缩率 1-100，越低体积越小 */
  quality: number;
  /** 主题模式：跟随系统 / 深色 / 浅色 */
  theme: "system" | "dark" | "light";
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
  /** 失败发生的阶段：转换（WebP）或上传（Worker），用于区分失败标签 */
  failStage?: "convert" | "upload";
}

export type ViewName = "gallery" | "upload" | "settings";

/** 存储统计响应（WORKER-V2.md §7.4：sync_usage 命令透传 Worker /usage） */
export interface UsageInfo {
  objects: number;
  size: number;
  /** 人类可读大小（如 "1.71 GB"），Worker 返回，直接展示 */
  sizeFormatted: string;
  updatedAt: string;
}
