import type { ImageItem, QueueItem } from "../../lib/types";
import { esc, formatBytes, nowDate, readDims, showToast } from "../../lib/utils";
import { icon } from "../../lib/icons";
import { applyRename, buildPath, getSettings, splitName } from "../../lib/settings";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";

export interface UploadCallbacks {
  /** 单张转换完成，交由主流程入列浏览视图 */
  onUploaded: (it: ImageItem) => void;
  onQueueCopy: (q: QueueItem, btn: HTMLButtonElement) => void;
}

const basename = (p: string): string => p.split(/[\\/]/).pop() || p;

/** 读取转换后图片尺寸（promise 封装） */
const readDimsAsync = (url: string): Promise<string> =>
  new Promise((resolve) => {
    readDims(url, (w, h) => resolve(w && h ? `${w} × ${h}` : "未知"));
  });

export function renderUploadView(container: HTMLElement, cb: UploadCallbacks): void {
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
    <div class="queue bg-surface border border-line rounded-xl shadow-card overflow-hidden" hidden>
      <div class="flex items-center justify-between px-4.5 py-3.5 text-[13px] font-semibold border-b border-line">
        <span>上传队列</span><span class="q-count text-xs font-medium text-ink3 tnum"></span>
      </div>
      <div class="q-list"></div>
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

  const finish = (q: QueueItem, inSize: number, outSize: number, outPath: string): void => {
    q.pct = 100;
    q.done = true;
    done += 1;
    q.bytes = outSize;
    q.sizeBefore = formatBytes(inSize);
    q.sizeAfter = formatBytes(outSize);
    q.dims = "读取中…";
    q.outputPath = outPath;
    // 重命名规则 + 按上传日期归档（月份自动更新），扩展名恒为 webp
    const { base } = splitName(q.name);
    const newBase = applyRename(base);
    const newName = newBase + ".webp";
    // 日期模板同批多图会生成相同 key；模板 {YYYYMMDD} 已含日期，这里只拼 时分秒 + 队列序号区分（同秒内多张靠序号兜底）
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, "0");
    const ts = `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
    const uniqueId = `${ts}-${++seq}`;
    const path = buildPath(newBase, "webp").replace(/\.webp$/, `-${uniqueId}.webp`);
    q.path = path;
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
        path,
      });
    });
    renderQueue();
    processNext();
  };

  const processNext = (): void => {
    const q = queue.find((x) => !x.done && !x.failed);
    if (!q) return;
    q.status = "正在转换为 WebP";
    q.pct = 45;
    updateRow(q);
    invoke<[number, number, string]>("convert_to_webp", {
      input: q.inputPath,
      quality: getSettings().quality,
    })
      .then(([inSize, outSize, outPath]) => finish(q, inSize, outSize, outPath))
      .catch((e) => {
        q.failed = true;
        q.status = "转换失败";
        q.pct = 100;
        showToast(`转换失败：${String(e)}`);
        renderQueue();
        processNext();
      });
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

  // 点击选择文件 → Tauri 对话框（返回真实路径）
  drop.addEventListener("click", () => {
    void open({
      multiple: true,
      filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "webp"] }],
    }).then((picked) => {
      if (!picked) return;
      addPaths(Array.isArray(picked) ? picked : [picked]);
    });
  });

  // 原生拖拽事件（Tauri 拦截 HTML5 drop，必须用它拿真实路径）
  void getCurrentWebview().onDragDropEvent((event) => {
    const t = event.payload.type;
    if (t === "over") drop.classList.add("bg-accent-soft", "border-accent");
    if (t === "leave") drop.classList.remove("bg-accent-soft", "border-accent");
    if (t === "drop") {
      drop.classList.remove("bg-accent-soft", "border-accent");
      addPaths(event.payload.paths);
    }
  });

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
    : q.failed
      ? `<div class="flex justify-between mt-1.5 text-xs"><span class="text-danger font-semibold">转换失败</span></div>`
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
