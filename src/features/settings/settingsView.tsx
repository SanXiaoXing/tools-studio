import { createRoot } from "react-dom/client";
import { SETTINGS_DEFAULTS, getSettings, parseSettingsBackup, updateSettings } from "../../lib/settings";
import { fillTemplate } from "../../lib/naming";
import { errorMessage, showToast } from "../../lib/utils";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import ElasticSlider from "./ElasticSlider";

const INPUT_CLS =
  "w-full px-3 py-2.5 rounded-lg border border-line bg-surface2 text-ink text-[13px] outline-none focus:border-accent transition-colors";
const HINT_CLS = "text-xs text-ink3 mt-1.5 leading-relaxed";
const CODE_CLS = "font-mono text-[11px] bg-surface3 border border-line rounded px-1.5 py-0.5 text-ink2";
const GHOST_BTN_CLS =
  "inline-flex items-center rounded-lg px-3 py-1.5 border border-line bg-surface text-ink2 text-xs font-medium hover:bg-surface3 hover:text-ink transition";
const PRIMARY_BTN_CLS =
  "inline-flex items-center rounded-lg px-4 py-1.5 bg-accent-strong text-white text-[13px] font-semibold hover:bg-accent active:scale-[.985] transition";

/** API Key 只读态打码：8 个圆点 + 尾号 4 位（DESIGN-SPEC §3.4） */
const maskKey = (v: string): string => (v ? "•".repeat(8) + v.slice(-4) : "未设置");

/** 一次性设置锁定字段：只读展示 + 编辑输入 */
interface LockField {
  input: HTMLInputElement;
  display: HTMLElement;
  /** 当前已保存值（进入编辑态时回填输入框） */
  current: () => string;
  /** 只读态展示文本（未设置 / 打码由调用方负责） */
  render: () => string;
  /** 不把原文写入 title 提示（API Key 打码场景） */
  noTitle?: boolean;
}

interface Lock {
  /** 退出编辑态并刷新只读展示（保存 / 取消 / 恢复默认共用） */
  exit: () => void;
}

/** 一次性设置：编辑前只能查看，点「编辑」进入可编辑态，保存 / 取消 / Enter / Esc */
function lockSection(section: HTMLElement, fields: LockField[], onSave: (values: string[]) => void): Lock {
  const view = section.querySelector<HTMLElement>("[data-lock-view]")!;
  const edit = section.querySelector<HTMLElement>("[data-lock-edit]")!;
  const editBtn = section.querySelector<HTMLButtonElement>("[data-lock-edit-btn]")!;
  const saveBtn = section.querySelector<HTMLButtonElement>("[data-lock-save]")!;
  const cancelBtn = section.querySelector<HTMLButtonElement>("[data-lock-cancel]")!;

  const exit = (): void => {
    fields.forEach((f) => {
      const v = f.current();
      if (!f.noTitle) f.display.title = v;
      f.display.textContent = f.render();
    });
    view.hidden = false;
    edit.hidden = true;
    editBtn.hidden = false;
  };

  editBtn.addEventListener("click", () => {
    fields.forEach((f) => {
      f.input.value = f.current();
    });
    view.hidden = true;
    edit.hidden = false;
    editBtn.hidden = true;
    fields[0].input.focus();
  });
  saveBtn.addEventListener("click", () => {
    onSave(fields.map((f) => f.input.value.trim()));
    exit();
  });
  cancelBtn.addEventListener("click", exit);
  edit.addEventListener("keydown", (e) => {
    if (!(e.target instanceof HTMLInputElement)) return;
    if (e.isComposing || e.keyCode === 229) return; // 中文输入法组合中不触发
    if (e.key === "Enter") {
      e.preventDefault();
      saveBtn.click();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      cancelBtn.click();
    }
  });

  exit(); // 初始渲染只读态
  return { exit };
}

/** 设置视图（DESIGN-SPEC §3.4）：Worker/域名等一次性设置只读锁定，路径模板 / 压缩质量实时预览 */
export function renderSettingsView(container: HTMLElement): void {
  const cur = getSettings();
  container.innerHTML = `
  <div class="settings-body flex-1 min-h-0 overflow-y-auto p-5 pl-9 pr-9 pb-12 flex flex-col gap-5">
    <div class="flex flex-col gap-4">

      <section id="lockWorker" class="bg-surface border border-line rounded-xl shadow-card p-5">
        <div class="flex items-center justify-between gap-3 mb-1">
          <h2 class="text-[15px] font-bold">Cloudflare Worker</h2>
          <button type="button" data-lock-edit-btn class="${GHOST_BTN_CLS}">编辑</button>
        </div>
        <p class="text-xs text-ink3 leading-relaxed mb-4.5">上传图片通过 Worker 网关写入 R2，保存后生效。</p>

        <div data-lock-view class="flex flex-col gap-2.5">
          <div class="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg bg-surface2">
            <span class="shrink-0 text-[13px] text-ink3">Worker 地址</span>
            <span id="viewServer" class="flex-1 min-w-0 text-right font-mono text-[13px] text-ink truncate"></span>
          </div>
          <div class="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg bg-surface2">
            <span class="shrink-0 text-[13px] text-ink3">API Key</span>
            <span id="viewApiKey" class="font-mono text-[13px] text-ink"></span>
          </div>
        </div>

        <div data-lock-edit hidden class="flex flex-col gap-3.5">
          <div>
            <label for="setServer" class="block text-[13px] font-medium mb-1.5">Worker 地址</label>
            <input id="setServer" spellcheck="false" autocomplete="off" class="${INPUT_CLS}">
            <p class="${HINT_CLS}">例如 <code class="${CODE_CLS}">https://your-worker.workers.dev</code>，结尾无需斜杠。</p>
          </div>
          <div>
            <label for="setApiKey" class="block text-[13px] font-medium mb-1.5">API Key</label>
            <input id="setApiKey" spellcheck="false" autocomplete="off" class="${INPUT_CLS}">
            <p class="${HINT_CLS}">与 Worker 环境变量 <code class="${CODE_CLS}">API_KEY</code> 的值一致。</p>
          </div>
          <div class="flex items-center gap-2.5 mt-1">
            <button type="button" data-lock-save class="${PRIMARY_BTN_CLS}">保存</button>
            <button type="button" data-lock-cancel class="${GHOST_BTN_CLS}">取消</button>
          </div>
        </div>
      </section>

      <section id="lockDomain" class="bg-surface border border-line rounded-xl shadow-card p-5">
        <div class="flex items-center justify-between gap-3 mb-1">
          <h2 class="text-[15px] font-bold">链接域名</h2>
          <button type="button" data-lock-edit-btn class="${GHOST_BTN_CLS}">编辑</button>
        </div>
        <p class="text-xs text-ink3 leading-relaxed mb-4.5">上传完成后生成的链接使用此域名，保存后立即生效。</p>

        <div data-lock-view class="flex flex-col gap-2.5">
          <div class="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg bg-surface2">
            <span class="shrink-0 text-[13px] text-ink3">域名</span>
            <span id="viewDomain" class="flex-1 min-w-0 text-right font-mono text-[13px] text-ink truncate"></span>
          </div>
        </div>

        <div data-lock-edit hidden class="flex flex-col gap-3.5">
          <div>
            <label for="setDomain" class="block text-[13px] font-medium mb-1.5">域名</label>
            <input id="setDomain" spellcheck="false" autocomplete="off" class="${INPUT_CLS}">
            <p class="${HINT_CLS}">例如 <code class="${CODE_CLS}">https://cdn.assets-studio.dev</code>，结尾无需斜杠。</p>
          </div>
          <div class="flex items-center gap-2.5 mt-1">
            <button type="button" data-lock-save class="${PRIMARY_BTN_CLS}">保存</button>
            <button type="button" data-lock-cancel class="${GHOST_BTN_CLS}">取消</button>
          </div>
        </div>
      </section>

      <section class="bg-surface border border-line rounded-xl shadow-card p-5">
        <h2 class="text-[15px] font-bold mb-1">存储路径</h2>
        <p class="text-xs text-ink3 leading-relaxed mb-4.5">图片按上传日期自动归档到当月目录，月份随日期自动切换，无需手动迁移旧图。</p>
        <div>
          <label for="setPath" class="block text-[13px] font-medium mb-1.5">路径模板</label>
          <input id="setPath" spellcheck="false" autocomplete="off" class="${INPUT_CLS}">
          <p class="${HINT_CLS}">
            可用占位符：
            <code class="${CODE_CLS}">{YYYY}</code> 年、<code class="${CODE_CLS}">{MM}</code> 月、
            <code class="${CODE_CLS}">{DD}</code> 日、<code class="${CODE_CLS}">{YYYYMMDD}</code> 年月日、
            <code class="${CODE_CLS}">{HHmmss}</code> 时分秒、<code class="${CODE_CLS}">{seq}</code> 序号、
            <code class="${CODE_CLS}">{name}</code> 文件名、<code class="${CODE_CLS}">{ext}</code> 扩展名
          </p>
        </div>
        <div class="preview-box flex items-center gap-3 mt-3.5 px-3 py-2.5 rounded-lg bg-surface2 text-xs tnum">
          <span class="shrink-0 text-ink3">将存入</span>
          <span id="pathPreview" class="flex-1 min-w-0 text-right font-mono text-ink whitespace-nowrap overflow-hidden text-ellipsis"></span>
        </div>
      </section>

      <section class="bg-surface border border-line rounded-xl shadow-card p-5">
        <h2 class="text-[15px] font-bold mb-1">压缩质量</h2>
        <p class="text-xs text-ink3 leading-relaxed mb-4.5">上传时转为 WebP 的压缩率，越低体积越小。保存后对新上传生效。</p>
        <div id="qualityMount"></div>
      </section>

      <section class="bg-surface border border-line rounded-xl shadow-card p-5">
        <h2 class="text-[15px] font-bold mb-1">备份与恢复</h2>
        <p class="text-xs text-ink3 leading-relaxed mb-4.5">导出全部设置（含 Worker 地址、API Key、域名）为 JSON 文件，或从备份文件一键恢复。</p>
        <div class="flex items-center gap-2.5">
          <button id="exportBackup" class="inline-flex items-center gap-2 rounded-lg px-4.5 py-2.5 bg-accent-strong text-white text-sm font-semibold hover:bg-accent active:scale-[.985] transition" type="button">导出备份</button>
          <button id="importBackup" class="inline-flex items-center gap-2 rounded-lg px-4.5 py-2.5 border border-line bg-surface text-ink2 text-sm font-medium hover:bg-surface3 hover:text-ink transition" type="button">导入备份</button>
        </div>
      </section>

    </div>
    <div class="flex items-center gap-2.5 py-0.5 pb-2">
      <button id="resetSettings" class="inline-flex items-center gap-2 rounded-lg px-4.5 py-2.5 border border-line bg-surface text-ink2 text-sm font-medium hover:bg-surface3 hover:text-ink transition" type="button">恢复默认</button>
    </div>
  </div>`;

  const $ = <T extends HTMLElement>(sel: string): T => container.querySelector(sel) as T;
  const setServer = $<HTMLInputElement>("#setServer");
  const setApiKey = $<HTMLInputElement>("#setApiKey");
  const setDomain = $<HTMLInputElement>("#setDomain");
  const setPath = $<HTMLInputElement>("#setPath");
  const pathPreview = $<HTMLElement>("#pathPreview");
  const resetBtn = $<HTMLButtonElement>("#resetSettings");

  setPath.value = cur.pathTemplate;

  /** 一次性设置：编辑前只能查看，各自独立保存（DESIGN-SPEC §3.4 锁定模式） */
  const lockWorker = lockSection(
    $("#lockWorker"),
    [
      {
        input: setServer,
        display: $<HTMLElement>("#viewServer"),
        current: () => getSettings().server,
        render: () => getSettings().server || "未设置",
      },
      {
        input: setApiKey,
        display: $<HTMLElement>("#viewApiKey"),
        current: () => getSettings().apiKey,
        render: () => maskKey(getSettings().apiKey),
        noTitle: true,
      },
    ],
    ([server, apiKey]) => {
      updateSettings({ server, apiKey });
      showToast("设置已保存");
    },
  );
  const lockDomain = lockSection(
    $("#lockDomain"),
    [
      {
        input: setDomain,
        display: $<HTMLElement>("#viewDomain"),
        current: () => getSettings().domain,
        render: () => getSettings().domain || "未设置",
      },
    ],
    ([domain]) => {
      updateSettings({ domain: domain || SETTINGS_DEFAULTS.domain });
      showToast("设置已保存");
    },
  );

  /** 弹性滑块的当前值（未保存也实时），保存后写入设置模型 */
  let quality = cur.quality;
  const qualityRoot = createRoot($("#qualityMount"));
  const renderQuality = (): void => {
    qualityRoot.render(
      <ElasticSlider
        defaultValue={quality}
        startingValue={1}
        maxValue={100}
        isStepped
        stepSize={1}
        leftIcon={<>−</>}
        rightIcon={<>+</>}
        onChange={(v) => {
          quality = v;
        }}
        onCommit={(v) => {
          if (v !== getSettings().quality) {
            updateSettings({ quality: v });
            showToast("设置已保存");
          }
        }}
      />,
    );
  };
  renderQuality();

  /** 预览基于输入框当前值（未保存也实时），保存后写入设置模型 */
  const updatePreview = (): void => {
    const sample = "我的 图片 01.webp";
    const dot = sample.lastIndexOf(".");
    const base = sample.slice(0, dot);
    const ext = sample.slice(dot + 1);
    pathPreview.textContent = fillTemplate(setPath.value || SETTINGS_DEFAULTS.pathTemplate, base, ext, undefined, 1);
  };

  /** 非重要设置：路径模板失焦即自动保存（DESIGN-SPEC §3.4），无需底部保存按钮 */
  setPath.addEventListener("blur", () => {
    const v = setPath.value.trim() || SETTINGS_DEFAULTS.pathTemplate;
    if (v !== getSettings().pathTemplate) {
      updateSettings({ pathTemplate: v });
      showToast("设置已保存");
    }
    updatePreview();
  });
  resetBtn.addEventListener("click", () => {
    updateSettings({ ...SETTINGS_DEFAULTS });
    setPath.value = SETTINGS_DEFAULTS.pathTemplate;
    quality = SETTINGS_DEFAULTS.quality;
    renderQuality();
    updatePreview();
    lockWorker.exit();
    lockDomain.exit();
    showToast("已恢复默认设置");
  });
  setPath.addEventListener("input", updatePreview);

  /** 备份与恢复：导出当前设置为 JSON 文件，从备份文件一键恢复（含一次性设置） */
  const exportBtn = $<HTMLButtonElement>("#exportBackup");
  const importBtn = $<HTMLButtonElement>("#importBackup");

  exportBtn.addEventListener("click", () => {
    void save({
      title: "导出设置备份",
      defaultPath: "assets-studio-settings.json",
      filters: [{ name: "JSON", extensions: ["json"] }],
    }).then(async (path) => {
      if (!path) return;
      try {
        await invoke("export_settings", { path, content: JSON.stringify(getSettings(), null, 2) });
        showToast("备份已导出");
      } catch (e) {
        showToast(`导出失败：${errorMessage(e)}`);
      }
    });
  });

  importBtn.addEventListener("click", () => {
    void open({
      title: "导入设置备份",
      multiple: false,
      filters: [{ name: "JSON", extensions: ["json"] }],
    }).then(async (picked) => {
      if (!picked || Array.isArray(picked)) return;
      try {
        const raw = await invoke<string>("import_settings", { path: picked });
        const parsed = parseSettingsBackup(raw);
        if (!parsed) {
          showToast("备份文件格式无效");
          return;
        }
        updateSettings(parsed);
        setPath.value = parsed.pathTemplate;
        quality = parsed.quality;
        renderQuality();
        updatePreview();
        lockWorker.exit();
        lockDomain.exit();
        showToast("备份已导入");
      } catch (e) {
        showToast(`导入失败：${errorMessage(e)}`);
      }
    });
  });

  updatePreview();
}
