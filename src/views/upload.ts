import type { ImageItem, QueueItem } from "../lib/types";
import { esc, formatBytes, nowDate, readDims, showToast } from "../lib/utils";
import { icon } from "../lib/icons";
import { applyRename, buildPath, extToType, splitName } from "../lib/settings";

export interface UploadCallbacks {
  /** 单张上传完成，交由主流程入列浏览视图 */
  onUploaded: (it: ImageItem) => void;
  onQueueCopy: (q: QueueItem, btn: HTMLButtonElement) => void;
}

const COMPRESS_PHASE = 45; // 压缩阶段占比，之后进入上传阶段（DESIGN.md §4）

export function renderUploadView(container: HTMLElement, cb: UploadCallbacks): void {
  const queue: QueueItem[] = [];
  let total = 0;
  let done = 0;

  container.innerHTML = `
  <div class="upload-body flex-1 min-h-0 overflow-y-auto p-5 pl-9 pr-9 pb-12 flex flex-col gap-5">
    <div class="dropzone flex-1 min-h-[260px] flex flex-col items-center justify-center gap-2 p-12 border-2 border-dashed border-line rounded-2xl bg-surface cursor-pointer text-center transition-colors hover:border-accent hover:bg-accent-soft">
      <div class="flex items-center justify-center w-14 h-14 rounded-[14px] bg-accent-soft text-accent mb-1.5">${icon.upload}</div>
      <h2 class="text-[17px] font-semibold">拖拽图片到此处</h2>
      <p class="text-[13px] text-ink3">或点击选择文件，支持 PNG、JPG、WebP、AVIF、GIF 格式，单张不超过 20 MB，可一次选择多张</p>
      <button class="mt-4 inline-flex items-center gap-2 rounded-lg px-4.5 py-2.5 bg-accent-strong text-white text-sm font-semibold hover:bg-accent active:scale-[.985] transition" type="button">选择图片文件</button>
      <input type="file" accept="image/*" multiple hidden>
    </div>
    <div class="queue bg-surface border border-line rounded-xl shadow-card overflow-hidden" hidden>
      <div class="flex items-center justify-between px-4.5 py-3.5 text-[13px] font-semibold border-b border-line">
        <span>上传队列</span><span class="q-count text-xs font-medium text-ink3 tnum"></span>
      </div>
      <div class="q-list"></div>
    </div>
  </div>`;

  const drop = container.querySelector<HTMLElement>(".dropzone")!;
  const fileInput = drop.querySelector<HTMLInputElement>("input[type=file]")!;
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

  const finish = (q: QueueItem): void => {
    q.pct = 100;
    q.done = true;
    done += 1;
    q.sizeAfter = formatBytes(Math.max(1024, Math.round(q.bytes * (0.5 + Math.random() * 0.3))));
    // 重命名规则 + 按上传日期归档（月份自动更新）
    const { base, ext } = splitName(q.name);
    const newBase = applyRename(base);
    const newName = newBase + (ext ? "." + ext : "");
    q.path = buildPath(newBase, ext);
    cb.onUploaded({
      name: newName,
      type: extToType(newName),
      size: q.sizeAfter,
      dims: q.dims,
      date: nowDate(),
      objectURL: q.url,
      path: q.path,
    });
    renderQueue();
    processNext();
  };

  const processNext = (): void => {
    const q = queue.find((x) => !x.done);
    if (!q) return;
    q.status = "正在压缩图片";
    updateRow(q);
    const timer = window.setInterval(() => {
      q.pct += 2 + Math.random() * 7;
      if (q.pct >= COMPRESS_PHASE && q.status !== "正在上传图片") q.status = "正在上传图片";
      if (q.pct >= 100) {
        window.clearInterval(timer);
        finish(q);
        return;
      }
      updateRow(q);
    }, 120);
  };

  const addFiles = (fileList: FileList | null): void => {
    if (!fileList) return;
    const files = Array.from(fileList).filter((f) => f.type && f.type.startsWith("image/"));
    if (files.length === 0) {
      showToast("未检测到图片文件");
      return;
    }
    for (const f of files) {
      const q: QueueItem = {
        name: f.name,
        url: URL.createObjectURL(f),
        bytes: f.size,
        sizeBefore: formatBytes(f.size),
        sizeAfter: "",
        dims: "未知",
        status: "等待上传",
        pct: 0,
        done: false,
      };
      queue.push(q);
      total += 1;
      readDims(q.url, (w, h) => {
        if (w && h) q.dims = `${w} × ${h}`;
      });
    }
    renderQueue();
    processNext();
  };

  drop.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    addFiles(fileInput.files);
    fileInput.value = "";
  });
  for (const ev of ["dragover", "dragleave", "drop"] as const) {
    drop.addEventListener(ev, (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (ev === "dragover") drop.classList.add("bg-accent-soft", "border-accent");
      if (ev === "dragleave") drop.classList.remove("bg-accent-soft", "border-accent");
      if (ev === "drop") {
        drop.classList.remove("bg-accent-soft", "border-accent");
        addFiles(e.dataTransfer?.files ?? null);
      }
    });
  }
  queueList.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-act]");
    if (!btn) return;
    const row = btn.closest<HTMLElement>("[data-i]");
    const q = queue[Number(row?.getAttribute("data-i"))];
    if (q && q.done) cb.onQueueCopy(q, btn);
  });
}

function queueRowHTML(q: QueueItem, i: number): string {
  const progress = q.done
    ? ""
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
