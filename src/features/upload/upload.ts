import type { ImageItem, QueueItem } from "../../lib/types";
import { basename, errorMessage, esc, formatBytes, nowDate, readDims, showToast } from "../../lib/utils";
import { icon } from "../../lib/icons";
import { getSettings } from "../../lib/settings";
import { buildPath, splitName } from "../../lib/naming";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import ConfirmUpload from "./ConfirmUpload";

export interface UploadCallbacks {
  /** 单张转换完成，交由主流程入列浏览视图 */
  onUploaded: (it: ImageItem) => void;
  onQueueCopy: (q: QueueItem, btn: HTMLButtonElement) => void;
}

/** renderUploadView 返回值：供外部（全局拖拽）发起带二次确认的上传 */
export interface UploadApi {
  requestUpload: (paths: string[]) => void;
}

/** 读取转换后图片尺寸（promise 封装） */
const readDimsAsync = (url: string): Promise<string> =>
  new Promise((resolve) => {
    readDims(url, (w, h) => resolve(w && h ? `${w} × ${h}` : "未知"));
  });

export function renderUploadView(container: HTMLElement, cb: UploadCallbacks): UploadApi {
  const queue: QueueItem[] = [];
  let total = 0;
  let done = 0;
  let seq = 0; // 队列内自增序号，同秒完成的多张图也能区分

  container.innerHTML = `
  <div class="upload-body flex-1 min-h-0 overflow-y-auto p-5 pl-9 pr-9 pb-12 flex flex-col gap-5">
    <div class="dropzone flex-1 min-h-[260px] flex flex-col items-center justify-center gap-2 p-12 border-2 border-dashed border-line rounded-2xl bg-surface cursor-pointer text-center transition-colors hover:border-accent hover:bg-accent-soft">
      <div class="flex items-center justify-center w-14 h-14 rounded-[14px] bg-accent-soft text-accent mb-1.5">${icon.upload}</div>
      <h2 class="text-[17px] font-semibold">拖拽图片到此处</h2>
      <p class="text-[13px] text-ink3">或点击选择文件，支持 PNG、JPG、WebP 格式，单张不超过 20 MB，可一次选择多张</p>
      <button class="mt-4 inline-flex items-center gap-2 rounded-lg px-4.5 py-2.5 bg-accent-strong text-white text-sm font-semibold hover:bg-accent active:scale-[.985] transition" type="button">选择图片文件</button>
    </div>
    <div class="queue flex flex-col max-h-[55dvh] bg-surface border border-line rounded-xl shadow-card overflow-hidden" hidden>
      <div class="flex items-center justify-between px-4.5 py-3.5 text-[13px] font-semibold border-b border-line shrink-0">
        <span>上传队列</span><span class="q-count text-xs font-medium text-ink3 tnum"></span>
      </div>
      <div class="q-list overflow-y-auto min-h-0"></div>
    </div>
  </div>`;

  const drop = container.querySelector<HTMLElement>(".dropzone")!;
  const queueEl = container.querySelector<HTMLElement>(".queue")!;
  const queueList = container.querySelector<HTMLElement>(".q-list")!;
  const countEl = container.querySelector<HTMLElement>(".q-count")!;

  const renderQueue = (): void => {
    queueList.innerHTML = queue.map(queueRowHTML).join("");
    countEl.textContent = `${done} / ${total} 已完成`;
    queueEl.hidden = queue.length === 0;
  };

  const updateRow = (q: QueueItem): void => {
    const row = queueList.querySelector<HTMLElement>(`[data-i="${queue.indexOf(q)}"]`);
    if (!row || q.done) return;
    row.querySelector<HTMLElement>(".q-bar")!.style.width = q.pct + "%";
    row.querySelector<HTMLElement>(".q-status")!.textContent = q.status;
    row.querySelector<HTMLElement>(".q-pct")!.textContent = `${Math.round(q.pct)}%`;
  };

  const finish = (q: QueueItem, inSize: number, outSize: number, outPath: string, url: string): void => {
    q.pct = 100;
    q.done = true;
    done += 1;
    q.bytes = outSize;
    q.sizeBefore = formatBytes(inSize);
    q.sizeAfter = formatBytes(outSize);
    q.dims = "读取中…";
    q.outputPath = outPath;
    // 路径已在 processNext 中按模板生成（默认含 {YYYYMMDD}-{HHmmss}-{seq}）
    const { base } = splitName(q.name);
    const newName = base + ".webp";
    const outUrl = convertFileSrc(outPath);
    readDimsAsync(outUrl).then((dims) => {
      q.dims = dims;
      cb.onUploaded({
        name: newName,
        type: "WEBP",
        size: q.sizeAfter,
        dims,
        date: nowDate(),
        objectURL: outUrl,
        url,
        path: q.path ?? "",
      });
    });
    renderQueue();
  };

  // 并发转换窗口：同时最多 MAX_CONCURRENT 张，兼顾速度与 CPU 占用
  const MAX_CONCURRENT = 3;
  let running = 0;

  const processNext = (): void => {
    while (running < MAX_CONCURRENT) {
      // 只取尚未启动的（status 仍为"等待转换"）；已启动的由 status 标记，避免并发窗口重复选中同一张
      const q = queue.find((x) => x.status === "等待转换");
      if (!q) return;
      running += 1;
      q.status = "正在转换为 WebP";
      q.pct = 45;
      updateRow(q);
      let stage: "convert" | "upload" = "convert";
      invoke<[number, number, string]>("convert_to_webp", {
        input: q.inputPath,
        quality: getSettings().quality,
      })
        .then(([inSize, outSize, outPath]) => {
          stage = "upload";
          q.status = "正在上传";
          q.pct = 80;
          updateRow(q);
          // 生成 R2 key（模板）并上传到 Worker → R2；server/apiKey 由 Rust 从 config.json 读取（WORKER-V2.md §7）
          const { base } = splitName(q.name);
          const path = buildPath(base, "webp", undefined, ++seq);
          q.path = path;
          // Tauri v2 命令参数：JS 端用驼峰命名（自动转 Rust 蛇形参数），
          // 必须用 contentType / filePath，不能写 content_type / file_path，否则报 invalid args。
          return invoke<{ key: string; url: string }>("upload_image", {
            key: path,
            contentType: "image/webp",
            filePath: outPath,
          }).then((res) => {
            running -= 1;
            finish(q, inSize, outSize, outPath, res.url);
            processNext();
          });
        })
        .catch((e) => {
          running -= 1;
          q.failed = true;
          q.failStage = stage;
          q.status = "处理失败";
          q.pct = 100;
          showToast(`${stage === "upload" ? "上传失败" : "转换失败"}：${errorMessage(e)}`);
          renderQueue();
          processNext();
        });
    }
  };

  const addPaths = (paths: string[]): void => {
    seq = 0; // 每批次重置序号：同一批内累加，新批次从 1 重新开始
    const files = paths.filter((p) => /\.(png|jpe?g|webp)$/i.test(p));
    if (files.length === 0) {
      showToast("未检测到支持的图片文件");
      return;
    }
    for (const p of files) {
      const q: QueueItem = {
        name: basename(p),
        url: convertFileSrc(p),
        bytes: 0,
        sizeBefore: "",
        sizeAfter: "",
        dims: "未知",
        status: "等待转换",
        pct: 0,
        done: false,
        inputPath: p,
        outputPath: "",
      };
      queue.push(q);
      total += 1;
    }
    renderQueue();
    processNext();
  };

  // ---- 二次确认弹窗（React 组件挂载，拖拽与手动选择共用）----
  const confirmRoot = createRoot(document.body.appendChild(document.createElement("div")));

  const requestUpload = (paths: string[]): void => {
    const files = paths.filter((p) => /\.(png|jpe?g|webp)$/i.test(p));
    if (files.length === 0) {
      showToast("未检测到支持的图片文件");
      return;
    }
    document.body.style.overflow = "hidden";
    confirmRoot.render(
      createElement(ConfirmUpload, {
        paths: files,
        onConfirm: (remaining) => {
          document.body.style.overflow = "";
          confirmRoot.render(null);
          addPaths(remaining);
        },
        onCancel: () => {
          document.body.style.overflow = "";
          confirmRoot.render(null);
        },
      }),
    );
  };

  // 点击选择文件 → Tauri 对话框（返回真实路径）→ 二次确认
  drop.addEventListener("click", () => {
    void open({
      multiple: true,
      filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "webp"] }],
    }).then((picked) => {
      if (!picked) return;
      requestUpload(Array.isArray(picked) ? picked : [picked]);
    });
  });

  queueList.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-act]");
    if (!btn) return;
    const row = btn.closest<HTMLElement>("[data-i]");
    const q = queue[Number(row?.getAttribute("data-i"))];
    if (q && q.done) cb.onQueueCopy(q, btn);
  });

  return { requestUpload };
}

function queueRowHTML(q: QueueItem, i: number): string {
  const progress = q.done
    ? ""
    : q.failed
      ? `<div class="flex justify-between mt-1.5 text-xs"><span class="text-danger font-semibold">${q.failStage === "upload" ? "上传失败" : "转换失败"}</span></div>`
      : `<div class="h-[5px] rounded-full bg-line overflow-hidden"><div class="q-bar h-full rounded-full bg-accent transition-[width] duration-150" style="width:${q.pct}%"></div></div>
         <div class="flex justify-between mt-1.5 text-xs text-ink3"><span class="q-status">${q.status}</span><span class="q-pct font-semibold text-ink2 tnum">${Math.round(q.pct)}%</span></div>`;
  const doneHtml = q.done
    ? `<div class="flex justify-between mt-1.5 text-xs"><span class="text-ok font-semibold">已完成，链接已生成</span><span class="text-ink3 tnum">${q.sizeBefore} → ${q.sizeAfter}</span></div>`
    : "";
  return `
  <div class="q-item flex items-center gap-3.5 px-4.5 py-3 border-t border-line first:border-t-0" data-i="${i}">
    <img class="w-[52px] h-[52px] rounded-[10px] object-cover bg-surface2 shrink-0" src="${q.url}" alt="${esc(q.name)}">
    <div class="flex-1 min-w-0">
      <div class="q-name text-[13px] font-semibold truncate" title="${esc(q.name)}">${esc(q.name)}</div>
      ${progress}${doneHtml}
    </div>
    <div class="shrink-0">
      <button class="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold bg-accent-strong text-white hover:bg-accent transition whitespace-nowrap disabled:opacity-45 disabled:pointer-events-none" data-act="copy" type="button" ${q.done ? "" : "disabled"}>${icon.copy}复制链接</button>
    </div>
  </div>`;
}
