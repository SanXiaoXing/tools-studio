import { invoke } from "@tauri-apps/api/core";
import type { ImageItem, UsageInfo } from "./types";
import { copyText, errorMessage, feedbackCheck, formatContent, parseSizeToBytes, showToast } from "./utils";

/**
 * 应用级状态单例（模块作用域持久化）。
 *
 * 把原先散落在 main.ts 顶层的 items / cloudUsage 与跨视图副作用
 * （copyLink / removeItem / refreshCloudUsage）收敛到此处，feature 模块
 * 直接 import 读写，无需经 main.ts 回调链（onUploaded / onUsageResolved / onCopy）。
 * render 由订阅者注册，状态变更自动触发重绘。
 */

let items: ImageItem[] = [];
let cloudUsage: number | null = null;
const listeners = new Set<() => void>();

const emit = (): void => {
  for (const fn of listeners) fn();
};

export const getItems = (): ImageItem[] => items;
export const getCloudUsage = (): number | null => cloudUsage;

/** 估算已用字节：优先云端真实统计，否则本地累加（历史图片无字节信息时兜底） */
export const getUsedBytes = (): number =>
  cloudUsage ?? items.reduce((sum, it) => sum + parseSizeToBytes(it.size), 0);

export const setItems = (next: ImageItem[]): void => {
  items = next;
  emit();
};
export const addItem = (it: ImageItem): void => {
  items = [it, ...items];
  emit();
};
export const removeLocalItem = (it: ImageItem): void => {
  items = items.filter((x) => x !== it);
  emit();
};
export const setCloudUsage = (n: number | null): void => {
  cloudUsage = n;
  emit();
};

export const subscribe = (fn: () => void): (() => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

/** 从云端拉取 R2 真实统计并写入 cloudUsage；失败时静默保留当前显示（本地估算兜底） */
export async function refreshCloudUsage(): Promise<void> {
  try {
    const u = await invoke<UsageInfo>("sync_usage", { rescan: false });
    cloudUsage = u.size;
    emit();
  } catch {
    /* 云端不可用时保持现有显示，不打扰用户 */
  }
}

/** 复制图片链接（按设置格式：纯 URL 或 Markdown），成功后按钮变绿 + 轻提示 */
export async function copyLink(
  it: { path: string; name: string; url?: string },
  btn?: HTMLButtonElement,
): Promise<void> {
  const ok = await copyText(formatContent(it));
  if (ok) {
    if (btn) feedbackCheck(btn, "已复制");
    showToast("链接已复制到剪贴板");
  } else {
    showToast("复制失败，请手动复制链接");
  }
}

/** 删除图片：先删远程 R2 对象，成功后才从本地列表移除（避免本地已删、远程残留） */
export async function removeItem(it: ImageItem): Promise<void> {
  if (it.path) {
    try {
      await invoke("delete_image", { key: it.path });
    } catch (e) {
      showToast(`远程删除失败：${errorMessage(e)}`);
      return;
    }
  }
  items = items.filter((x) => x !== it);
  emit();
  void refreshCloudUsage(); // 删除后同步云端统计（Worker 已 -1）
  showToast(`已删除 ${it.name}`);
}
