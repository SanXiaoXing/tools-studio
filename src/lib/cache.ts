import type { ImageItem } from "./types";

/**
 * 本地缓存（localStorage 单 key）：图片库列表 + 云端存储用量。
 *
 * 启动时先读缓存立即渲染（秒开、离线可用），后台再与云端同步并覆盖缓存。
 * 只缓存业务数据：objectURL 是会话级 blob 引用（DESIGN-SPEC §8.4），
 * 序列化前必须剥离，加载后预览回退到公开 URL（utils.ts imgSrc）。
 */
const CACHE_KEY = "as-cache";
const CACHE_VERSION = 1;

/** 缓存有效期：超过该时长未更新（无上传/删除/云端同步），启动时重新拉取云端，平衡秒开与数据新鲜度 */
export const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 天

export interface GalleryCache {
  v: number;
  /** 最近一次云端图片列表（最新在前，ImageItem 序列化结果，无 objectURL） */
  items: ImageItem[];
  /** 最近一次云端用量（字节）；从未同步成功时为 null */
  usageSize: number | null;
  /** 写入时间（ISO 8601），排障用 */
  savedAt: string;
}

/** 读取缓存；无缓存 / 版本不符 / 结构非法时返回 null（与 settings.ts 同款容错） */
export function loadGalleryCache(): GalleryCache | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<GalleryCache>;
    if (data.v !== CACHE_VERSION) return null;
    if (!Array.isArray(data.items)) return null;
    return {
      v: CACHE_VERSION,
      // 逐项校验，丢弃损坏项，避免一条脏数据拖垮整个缓存
      items: data.items.filter(
        (it): it is ImageItem =>
          !!it && typeof it.name === "string" && typeof it.path === "string",
      ),
      usageSize: typeof data.usageSize === "number" ? data.usageSize : null,
      savedAt: typeof data.savedAt === "string" ? data.savedAt : "",
    };
  } catch {
    return null;
  }
}

/** 缓存是否过期：无缓存 / savedAt 非法 / 超过有效期均视为需重新同步云端 */
export function isGalleryCacheStale(cache: GalleryCache | null): boolean {
  if (!cache) return true;
  const t = Date.parse(cache.savedAt);
  if (!Number.isFinite(t)) return true;
  return Date.now() - t > CACHE_MAX_AGE_MS;
}

/** 写入缓存：显式白名单序列化（剥离 objectURL 等会话级字段），存储失败静默降级 */
export function saveGalleryCache(items: ImageItem[], usageSize: number | null): void {
  try {
    const cache: GalleryCache = {
      v: CACHE_VERSION,
      items: items.map((it) => ({
        name: it.name,
        type: it.type,
        size: it.size,
        dims: it.dims,
        date: it.date,
        path: it.path,
        url: it.url,
      })),
      usageSize,
      savedAt: new Date().toISOString(),
    };
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* 存储满 / 被禁用等：静默降级为不缓存，不影响运行 */
  }
}
