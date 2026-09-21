import type { QueueItem } from "../../lib/types";
import { basename, errorMessage, esc, formatBytes, nowDate, readDims, showToast } from "../../lib/utils";

import { icon } from "../../lib/icons";
import { getSettings } from "../../lib/settings";
import { resolveUniquePath, sanitizeName, splitName } from "../../lib/naming";
import { addItem, copyLink, getItems, refreshCloudUsage } from "../../lib/store";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { renderSlidingSeg } from "../../lib/seg";
import { showConfirmUpload, type ProcessMode } from "./confirm";

/** renderUploadView 返回值：供外部（全局拖拽）发起带二次确认的处理 */
export interface UploadApi {
  requestUpload: (paths: string[]) => void;
}

const IMAGE_RE = /\.(png|jpe?g|webp)$/i;
const VIDEO_RE = /\.(mp4)$/i;

/** 读取转换后图片尺寸文案 */
const dimsText = async (url: string): Promise<string> => {
  const { w, h } = await readDims(url);
  return w && h ? `${w} × ${h}` : "未知";
};

export function renderUploadView(container: HTMLElement): UploadApi {
  const queue: QueueItem[] = [];
  let total = 0;
  let done = 0;
  let mode: ProcessMode = "upload";
  let outputDir = "";

  container.innerHTML = `
  <div class="upload-body flex-1 min-h-0 overflow-y-auto p-5 pl-9 pr-9 pb-12 flex flex-col gap-4">
    <div id="modeMount"></div>
    <div class="dropzone flex-1 min-h-[260px] flex flex-col items-center justify-center gap-2 p-12 border-2 border-dashed border-line rounded-2xl bg-surface cursor-pointer text-center transition-colors hover:border-accent hover:bg-accent-soft">
      <div class="flex items-center justify-center w-14 h-14 rounded-[14px] bg-accent-soft text-accent mb-1.5">${icon.upload}</div>
      <h2 class="drop-title text-[17px] font-semibold">拖拽图片到此处</h2>
      <p class="drop-desc text-[13px] text-ink3">或点击选择文件，支持 PNG、JPG、WebP 格式，单张不超过 20 MB，可一次选择多张</p>
      <button class="drop-btn mt-4 inline-flex items-center gap-2 rounded-lg px-4.5 py-2.5 bg-accent-strong text-white text-sm font-semibold hover:bg-accent active:scale-[.985] transition" type="button">选择图片文件</button>
    </div>
    <div class="queue flex flex-col max-h-[55dvh] bg-surface border border-line rounded-xl shadow-card overflow-hidden" hidden>
      <div class="flex items-center justify-between px-4.5 py-3.5 text-[13px] font-semibold border-b border-line shrink-0">
        <span class="q-title">上传队列</span><span class="q-count text-xs font-medium text-ink3 tnum"></span>
      </div>
      <div class="q-list overflow-y-auto min-h-0"></div>
    </div>
  </div>`;

  const drop = container.querySelector<HTMLElement>(".dropzone")!;
  const queueEl = container.querySelector<HTMLElement>(".queue")!;
  const queueList = container.querySelector<HTMLElement>(".q-list")!;
  const countEl = container.querySelector<HTMLElement>(".q-count")!;
  const dropTitle = container.querySelector<HTMLElement>(".drop-title")!;
  const dropDesc = container.querySelector<HTMLElement>(".drop-desc")!;
  const dropBtn = container.querySelector<HTMLElement>(".drop-btn")!;
  const qTitle = container.querySelector<HTMLElement>(".q-title")!;

  const applyModeUI = (): void => {
    const local = mode === "compress-only";
    dropTitle.textContent = local ? "拖拽文件到此处（仅压缩）" : "拖拽图片到此处";
    dropDesc.textContent = local
      ? "支持 PNG、JPG、WebP、MP4；图片转 WebP，视频转 WebM，可选择输出文件夹，不上传"
      : "或点击选择文件，支持 PNG、JPG、WebP 格式，单张不超过 20 MB，可一次选择多张";
    dropBtn.textContent = local ? "选择文件并压缩" : "选择图片文件";
    qTitle.textContent = local ? "压缩队列" : "上传队列";
  };

  // 与设置页主题/命名方式、详情弹窗链接格式完全共用 renderSlidingSeg 的默认样式：
  // 蓝色指示器（.seg-thumb-blue）+ 阻尼 spring 滑动，四处配色与手感一致，不再单独传参。
  const modeSeg = renderSlidingSeg<ProcessMode>(container.querySelector<HTMLElement>("#modeMount")!, {
    options: [
      { value: "upload", label: "压缩并上传" },
      { value: "compress-only", label: "仅压缩" },
    ],
    value: mode,
    size: "sm",
    autoWidth: true,
    onChange: (v) => {
      mode = v;
      applyModeUI();
    },
  });
  applyModeUI();

  const renderQueue = (): void => {
    queueList.innerHTML = queue.map((q, i) => queueRowHTML(q, i, mode)).join("");
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

  /** 仅压缩完成：不上传、不进图库 */
  const finishLocal = (q: QueueItem, inSize: number, outSize: number, outPath: string): void => {
    q.pct = 100;
    q.done = true;
    done += 1;
    q.bytes = outSize;
    q.sizeBefore = formatBytes(inSize);
    q.sizeAfter = formatBytes(outSize);
    q.outputPath = outPath;
    q.dims = q.isVideo ? "视频" : basename(outPath);
    showToast(`压缩完成：${basename(outPath)}`);
    renderQueue();
  };

  const finishUpload = (q: QueueItem, inSize: number, outSize: number, outPath: string, url: string): void => {
    q.pct = 100;
    q.done = true;
    done += 1;
    q.bytes = outSize;
    q.sizeBefore = formatBytes(inSize);
    q.sizeAfter = formatBytes(outSize);
    q.dims = "读取中…";
    q.outputPath = outPath;
    // 路径已在 processNext 中按模板生成并去重（见 resolveUniquePath）
    const { base } = splitName(q.name);
    const newName = base + ".webp";
    const outUrl = convertFileSrc(outPath);
    dimsText(outUrl).then((dims) => {
      q.dims = dims;
      addItem({
        name: newName,
        type: "WEBP",
        size: q.sizeAfter,
        dims,
        date: nowDate(),
        objectURL: outUrl,
        url,
        path: q.path ?? "",
      });
      void refreshCloudUsage(); // 上传后同步云端统计（Worker 已 +1，含全部历史图片）
      showToast(`上传完成：${newName}`);
    });
    renderQueue();
  };

  // 并发窗口：上传 3 张；仅压缩含 ffmpeg 视频，压到 2 以控 CPU
  let running = 0;

  const processNext = (): void => {
    const maxConcurrent = mode === "compress-only" ? 2 : 3;
    while (running < maxConcurrent) {
      // 只取尚未启动的（status 仍为"等待压缩/转换"）；已启动的由 status 标记，避免并发窗口重复选中同一张
      const q = queue.find((x) => x.status === "等待转换" || x.status === "等待压缩");
      if (!q) return;
      running += 1;
      const local = q.localOnly === true;
      const quality = getSettings().quality;

      if (local) {
        q.status = q.isVideo ? "正在压缩为 WebM" : "正在转换为 WebP";
        q.pct = q.isVideo ? 25 : 45;
        updateRow(q);
        const cmd = q.isVideo ? "compress_video_to_webm" : "convert_to_webp";
        invoke<[number, number, string]>(cmd, {
          input: q.inputPath,
          quality,
          outputDir: outputDir,
        })
          .then(([inSize, outSize, outPath]) => {
            running -= 1;
            finishLocal(q, inSize, outSize, outPath);
            processNext();
          })
          .catch((e) => {
            running -= 1;
            q.failed = true;
            q.failStage = "convert";
            q.status = "处理失败";
            q.pct = 100;
            showToast(`压缩失败：${errorMessage(e)}`);
            renderQueue();
            processNext();
          });
        continue;
      }

      q.status = "正在转换为 WebP";
      q.pct = 45;
      updateRow(q);
      let stage: "convert" | "upload" = "convert";
      invoke<[number, number, string]>("convert_to_webp", {
        input: q.inputPath,
        quality,
      })
        .then(([inSize, outSize, outPath]) => {
          stage = "upload";
          q.status = "正在上传";
          q.pct = 80;
          updateRow(q);
          // 生成 R2 key（模板 + 去重）并上传到 Worker → R2；server/apiKey 由 Rust 从 config.json 读取（WORKER-V2.md §7）
          // 文件名先清洗：保留原文件名（nameMode=original 时模板 {name} 生效），非法字符替换为 -（naming.ts sanitizeName）
          // 路径冲突：模板有 {seq} 则按当天已有数量续号，否则追加 -1/-2，避免同 key 覆盖
          const { base } = splitName(q.name);
          const safeBase = sanitizeName(base);
          const path = resolveUniquePath(safeBase, "webp", undefined, 1, (p) =>
            queue.some((x) => x.path === p) || getItems().some((it) => it.path === p),
          );
          q.path = path;
          // Tauri v2 命令参数：JS 端用驼峰命名（自动转 Rust 蛇形参数），
          // 必须用 contentType / filePath / outputDir，不能写蛇形，否则报 invalid args。
          return invoke<{ key: string; url: string }>("upload_image", {
            key: path,
            contentType: "image/webp",
            filePath: outPath,
          }).then((res) => {
            running -= 1;
            finishUpload(q, inSize, outSize, outPath, res.url);
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
    const files = paths.filter((p) => (mode === "compress-only" ? IMAGE_RE.test(p) || VIDEO_RE.test(p) : IMAGE_RE.test(p)));
    if (files.length === 0) {
      showToast(mode === "compress-only" ? "未检测到支持的文件" : "未检测到支持的图片文件");
      return;
    }
    for (const p of files) {
      const isVideo = VIDEO_RE.test(p);
      const q: QueueItem = {
        name: basename(p),
        url: convertFileSrc(p),
        bytes: 0,
        sizeBefore: "",
        sizeAfter: "",
        dims: "未知",
        status: mode === "compress-only" ? "等待压缩" : "等待转换",
        pct: 0,
        done: false,
        inputPath: p,
        outputPath: "",
        localOnly: mode === "compress-only",
        isVideo,
      };
      queue.push(q);
      total += 1;
    }
    renderQueue();
    processNext();
  };

  /** 仅压缩：先选输出文件夹，再入队 */
  const startCompressOnly = async (files: string[]): Promise<void> => {
    const picked = await open({
      directory: true,
      multiple: false,
      title: "选择压缩输出文件夹",
    });
    if (typeof picked !== "string" || !picked) return;
    outputDir = picked;
    addPaths(files);
  };

  // ---- 二次确认弹窗（vanilla，拖拽与手动选择共用）----
  const requestUpload = (paths: string[]): void => {
    const images = paths.filter((p) => IMAGE_RE.test(p));
    const videos = paths.filter((p) => VIDEO_RE.test(p));

    // 拖入视频时自动切到仅压缩（图床 Worker 只收图片）
    if (mode === "upload" && videos.length > 0) {
      if (images.length === 0) {
        modeSeg.setValue("compress-only");
      } else {
        showToast("视频请切换到「仅压缩」模式");
      }
    }

    const accept = (p: string): boolean => (mode === "compress-only" ? IMAGE_RE.test(p) || VIDEO_RE.test(p) : IMAGE_RE.test(p));
    const files = paths.filter(accept);
    if (files.length === 0) {
      showToast(mode === "compress-only" ? "未检测到支持的文件" : "未检测到支持的图片文件");
      return;
    }
    document.body.style.overflow = "hidden";
    showConfirmUpload(
      files,
      (remaining) => {
        document.body.style.overflow = "";
        if (mode === "compress-only") {
          void startCompressOnly(remaining);
          return;
        }
        addPaths(remaining);
      },
      () => {
        document.body.style.overflow = "";
      },
      mode,
    );
  };

  const pickFiles = (): void => {
    void open({
      multiple: true,
      filters:
        mode === "compress-only"
          ? [{ name: "媒体文件", extensions: ["png", "jpg", "jpeg", "webp", "mp4"] }]
          : [{ name: "图片", extensions: ["png", "jpg", "jpeg", "webp"] }],
    }).then((picked) => {
      if (!picked) return;
      requestUpload(Array.isArray(picked) ? picked : [picked]);
    });
  };

  drop.addEventListener("click", pickFiles);
  dropBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    pickFiles();
  });

  queueList.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-act]");
    if (!btn) return;
    const row = btn.closest<HTMLElement>("[data-i]");
    const q = queue[Number(row?.getAttribute("data-i"))];
    if (!q || !q.done) return;
    if (q.localOnly) {
      // 本地路径走 Rust open_folder（explorer /select）
      void invoke("open_folder", { path: q.outputPath }).catch((err) =>
        showToast(`打开位置失败：${errorMessage(err)}`),
      );
      return;
    }
    void copyLink({ name: q.name, path: q.path ?? "" }, btn);
  });

  return { requestUpload };
}

function queueRowHTML(q: QueueItem, i: number, mode: ProcessMode): string {
  const local = q.localOnly === true || mode === "compress-only";
  const failLabel = q.failStage === "upload" ? "上传失败" : "压缩失败";
  const progress = q.done
    ? ""
    : q.failed
      ? `<div class="flex justify-between mt-1.5 text-xs"><span class="text-danger font-semibold">${failLabel}</span></div>`
      : `<div class="h-[5px] rounded-full bg-line overflow-hidden"><div class="q-bar h-full rounded-full bg-accent transition-[width] duration-150" style="width:${q.pct}%"></div></div>
         <div class="flex justify-between mt-1.5 text-xs text-ink3"><span class="q-status">${esc(q.status)}</span><span class="q-pct font-semibold text-ink2 tnum">${Math.round(q.pct)}%</span></div>`;
  const doneHtml = q.done
    ? `<div class="flex justify-between mt-1.5 text-xs">
         <span class="text-ok font-semibold">${local ? "已完成，已保存到本地" : "已完成，链接已生成"}</span>
         <span class="text-ink3 tnum">${q.sizeBefore} → ${q.sizeAfter}</span>
       </div>
       ${local && q.outputPath ? `<div class="mt-1 text-[11px] text-ink3 truncate" title="${esc(q.outputPath)}">${esc(q.outputPath)}</div>` : ""}`
    : "";
  const media = q.isVideo
    ? `<video class="w-[52px] h-[52px] rounded-[10px] object-cover bg-surface2 shrink-0" src="${q.url}" muted playsinline></video>`
    : `<img class="w-[52px] h-[52px] rounded-[10px] object-cover bg-surface2 shrink-0" src="${q.url}" alt="${esc(q.name)}">`;
  const action = local
    ? `<button class="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold bg-accent-strong text-white hover:bg-accent transition whitespace-nowrap disabled:opacity-45 disabled:pointer-events-none" data-act="open" type="button" ${q.done ? "" : "disabled"}>${icon.folder}打开位置</button>`
    : `<button class="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold bg-accent-strong text-white hover:bg-accent transition whitespace-nowrap disabled:opacity-45 disabled:pointer-events-none" data-act="copy" type="button" ${q.done ? "" : "disabled"}>${icon.copy}复制链接</button>`;
  return `
  <div class="q-item flex items-center gap-3.5 px-4.5 py-3 border-t border-line first:border-t-0" data-i="${i}">
    ${media}
    <div class="flex-1 min-w-0">
      <div class="q-name text-[13px] font-semibold truncate" title="${esc(q.name)}">${esc(q.name)}</div>
      ${progress}${doneHtml}
    </div>
    <div class="shrink-0">${action}</div>
  </div>`;
}
