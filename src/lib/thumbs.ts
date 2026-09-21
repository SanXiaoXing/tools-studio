import { Channel, convertFileSrc, invoke } from "@tauri-apps/api/core";

/** get_thumbnails 命令经 Channel 逐条回传的结果：path 为空串表示生成失败 */
export interface ThumbRes {
  key: string;
  path: string;
}

export interface ThumbReq {
  key: string;
  url: string;
}

/**
 * 批量/单条获取缩略图：本地缓存命中直接返回路径，失败回退 fallback URL。
 * 结果经 Channel 流式回传；单条失败 path 为空。
 */
export function fetchThumbnails(
  items: ThumbReq[],
  onItem: (res: ThumbRes) => void,
  onError?: (e: unknown) => void,
): void {
  invoke("get_thumbnails", {
    items,
    onMessage: new Channel<ThumbRes>(onItem),
  }).catch((e) => {
    onError?.(e);
  });
}

/** 缩略图本地路径 → 可显示 URL；失败时返回空串由调用方回退 */
export const thumbSrc = (path: string): string => (path ? convertFileSrc(path) : "");
