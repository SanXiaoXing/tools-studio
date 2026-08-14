import type { UsageInfo } from "../../lib/types";
import { SETTINGS_DEFAULTS, getSettings, parseConnectionBackup, parseSettingsBackup, updateSettings } from "../../lib/settings";
import { renderThemeSeg } from "../../lib/theme";
import { renderSlidingSeg } from "../../lib/seg";
import { fillTemplate } from "../../lib/naming";
import { icon } from "../../lib/icons";
import { copyText, errorMessage, feedbackCheck, generateApiKey, showToast } from "../../lib/utils";
import { setCloudUsage } from "../../lib/store";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { renderElasticSlider } from "./elasticSlider";

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

/** 设置视图（DESIGN-SPEC §3.4）：Worker/域名等一次性设置只读锁定，路径模板 / 压缩质量实时预览。
 *  存储统计拉取成功后直接写入 store（setCloudUsage），由订阅触发侧边栏「已用空间」刷新。
 *  onOpenDeploy：点击「部署 Worker」入口时回调，跳转到部署页面。 */
export function renderSettingsView(
  container: HTMLElement,
  opts?: { onOpenDeploy?: () => void },
): void {
  const cur = getSettings();
  container.innerHTML = `
  <div class="settings-body flex-1 min-h-0 overflow-y-auto p-5 pl-9 pr-9 pb-12 flex flex-col gap-5">
    <div class="flex flex-col gap-4">

      <section class="bg-surface border border-line rounded-xl shadow-card p-5">
        <div class="flex items-center justify-between gap-3">
          <div class="min-w-0">
            <h2 class="text-[15px] font-bold mb-1">部署 Worker</h2>
            <p class="text-xs text-ink3 leading-relaxed">复制源码粘贴到 Cloudflare 控制台，自行部署 Storage Gateway（上传 / 删除 / 统计）。</p>
          </div>
          <button id="openDeploy" type="button" class="${PRIMARY_BTN_CLS} shrink-0">去部署 ${icon.arrow}</button>
        </div>
      </section>

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
            <div class="flex items-center gap-2">
              <div class="relative flex-1 min-w-0">
                <input id="setApiKey" spellcheck="false" autocomplete="off" class="${INPUT_CLS} pr-9">
                <button id="copyApiKey" type="button" class="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center rounded-md text-ink3 hover:text-ink hover:bg-surface3 transition" title="复制 API Key" aria-label="复制 API Key">${icon.copy}</button>
              </div>
              <button id="genApiKey" type="button" class="${GHOST_BTN_CLS} shrink-0">生成随机</button>
            </div>
            <p class="${HINT_CLS}">与 Worker 环境变量 <code class="${CODE_CLS}">API_KEY</code> 的值一致，可点「生成随机」自动创建，点输入框右侧图标复制。</p>
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
          <label class="block text-[13px] font-medium mb-1.5">命名方式</label>
          <div id="nameModeMount"></div>
          <p class="${HINT_CLS}">自动命名生成「时间戳+序号」；保留原文件名则直接用图片原名（特殊字符自动替换为 <code class="${CODE_CLS}">-</code>）。</p>
        </div>
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
        <h2 class="text-[15px] font-bold mb-1">主题</h2>
        <p class="text-xs text-ink3 leading-relaxed mb-4.5">切换界面外观，跟随系统会随系统深浅色自动变化。</p>
        <div id="themeMount"></div>
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

      <section class="bg-surface border border-line rounded-xl shadow-card p-5">
        <h2 class="text-[15px] font-bold mb-1">存储用量</h2>
        <p class="text-xs text-ink3 leading-relaxed mb-4.5">查看 R2 图片服务当前占用的存储空间，需手动点击获取。「重新统计」会全量扫描校准。</p>
        <div class="flex items-center gap-2.5">
          <div class="flex-1 min-w-0 px-3 py-2.5 rounded-lg bg-surface2 text-[13px] text-ink tnum">
            <span id="usageText">尚未统计</span>
          </div>
          <button id="refreshUsage" class="${GHOST_BTN_CLS}">刷新</button>
          <button id="rescanUsage" class="${PRIMARY_BTN_CLS}">重新统计</button>
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

  // 「部署 Worker」入口：跳转到部署页面（侧边栏已移除该导航，收进设置页内）
  $<HTMLButtonElement>("#openDeploy").addEventListener("click", () => opts?.onOpenDeploy?.());

  /** Worker 连接信息：存 Rust config.json（WORKER-V2.md §7），前端只做展示与透传，不落 localStorage */
  let conn = { server: "", apiKey: "" };

  setPath.value = cur.pathTemplate;

  /** 一次性设置：编辑前只能查看，各自独立保存（DESIGN-SPEC §3.4 锁定模式） */
  const lockWorker = lockSection(
    $("#lockWorker"),
    [
      {
        input: setServer,
        display: $<HTMLElement>("#viewServer"),
        current: () => conn.server,
        render: () => conn.server || "未设置",
      },
      {
        input: setApiKey,
        display: $<HTMLElement>("#viewApiKey"),
        current: () => conn.apiKey,
        render: () => maskKey(conn.apiKey),
        noTitle: true,
      },
    ],
    ([server, apiKey]) => {
      void invoke("set_config", { server, apiKey })
        .then(() => {
          conn = { server, apiKey };
          lockWorker.exit();
          showToast("设置已保存");
        })
        .catch((e) => showToast(`保存失败：${errorMessage(e)}`));
    },
  );

  // 初始加载：连接配置从 Rust config.json 读取，回填只读展示
  void invoke<{ server: string; apiKey: string }>("get_config")
    .then((cfg) => {
      conn = { server: cfg.server ?? "", apiKey: cfg.apiKey ?? "" };
      lockWorker.exit();
    })
    .catch(() => {
      /* 未配置时保持空值展示"未设置" */
    });

  // 生成规则化 API Key（as_ 前缀 + 分段 hex）：填入输入框，保存时随 set_config 写入 config.json。
  // 生成后需同步到 Worker 环境变量 API_KEY（wrangler secret put API_KEY）。
  $<HTMLButtonElement>("#genApiKey").addEventListener("click", () => {
    setApiKey.value = generateApiKey();
    showToast("已生成随机 API Key，请点「复制」拿去配置 Worker");
  });

  // 复制 API Key 到剪贴板；成功后图标按钮变绿「✓」（feedbackCheck 纯图标对勾反馈）
  $<HTMLButtonElement>("#copyApiKey").addEventListener("click", (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    if (!setApiKey.value) {
      showToast("请先生成或填写 API Key");
      return;
    }
    void copyText(setApiKey.value).then((ok) => {
      if (ok) {
        feedbackCheck(btn);
        showToast("API Key 已复制");
      } else {
        showToast("复制失败，请手动复制");
      }
    });
  });
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

  /** 主题：三选一（跟随系统 / 深色 / 浅色），点击即保存并应用；选中态由滑动指示器表示。
   *  渲染与事件在 theme.ts 内；setTheme 供恢复默认 / 导入备份同步。 */
  const themeSeg = renderThemeSeg($("#themeMount"));

  /** 压缩质量的当前值（未保存也实时），松手后写入设置模型 */
  let quality = cur.quality;
  const qualitySlider = renderElasticSlider($("#qualityMount"), {
    value: quality,
    min: 1,
    max: 100,
    onChange: (v) => {
      quality = v;
    },
    onCommit: (v) => {
      if (v !== getSettings().quality) {
        updateSettings({ quality: v });
        showToast("设置已保存");
      }
    },
  });

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
    themeSeg.setTheme(SETTINGS_DEFAULTS.theme);
    setPath.value = SETTINGS_DEFAULTS.pathTemplate;
    nameSeg.setValue(SETTINGS_DEFAULTS.nameMode, { silent: true });
    quality = SETTINGS_DEFAULTS.quality;
    qualitySlider.setValue(quality);
    updatePreview();
    // 连接配置存 Rust config.json，恢复默认时一并清空
    void invoke("set_config", { server: "", apiKey: "" })
      .then(() => {
        conn = { server: "", apiKey: "" };
        lockWorker.exit();
      })
      .catch((e) => showToast(`恢复默认失败：${errorMessage(e)}`));
    lockDomain.exit();
    showToast("已恢复默认设置");
  });
  setPath.addEventListener("input", updatePreview);

  /** 命名方式：自动命名（时间戳+序号）/ 保留原文件名（预设模板，保存后对新上传生效）。
   *  滑动动画与主题切换共用 renderSlidingSeg（seg.ts），交互一致。 */
  type NameMode = "auto" | "original";
  const NAME_MODE_PRESETS: Record<NameMode, string> = {
    auto: SETTINGS_DEFAULTS.pathTemplate,
    original: "blog/{YYYY}/{MM}/{name}.{ext}",
  };
  const nameSeg = renderSlidingSeg<NameMode>($<HTMLElement>("#nameModeMount"), {
    options: [
      { value: "auto", label: "自动命名" },
      { value: "original", label: "原文件名" },
    ],
    value: getSettings().nameMode,
    size: "sm", // 比主题切换更紧凑
    onChange: (mode) => {
      updateSettings({ nameMode: mode, pathTemplate: NAME_MODE_PRESETS[mode] });
      setPath.value = NAME_MODE_PRESETS[mode];
      updatePreview();
      showToast(mode === "original" ? "已切换为保留原文件名" : "已切换为自动命名");
    },
  });

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
        // 备份含完整设置：连接信息（Rust config.json）与本地展示设置合并导出
        const backup = JSON.stringify({ ...getSettings(), server: conn.server, apiKey: conn.apiKey }, null, 2);
        await invoke("export_settings", { path, content: backup });
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
        // 连接信息写回 Rust config.json（旧备份无连接字段时跳过，保留当前值）
        const connBackup = parseConnectionBackup(raw);
        if (connBackup) {
          await invoke("set_config", { server: connBackup.server, apiKey: connBackup.apiKey });
          conn = { server: connBackup.server, apiKey: connBackup.apiKey };
        }
        updateSettings(parsed);
        themeSeg.setTheme(parsed.theme);
        setPath.value = parsed.pathTemplate;
        nameSeg.setValue(parsed.nameMode, { silent: true });
        quality = parsed.quality;
        qualitySlider.setValue(quality);
        updatePreview();
        lockWorker.exit();
        lockDomain.exit();
        showToast("备份已导入");
      } catch (e) {
        showToast(`导入失败：${errorMessage(e)}`);
      }
    });
  });

  /** 存储用量：用户手动触发（WORKER-V2.md §8），不做启动自动拉取。
   *  刷新 = GET /usage（读维护计数），重新统计 = POST /usage/rescan（全量校准）。 */
  const usageText = $<HTMLElement>("#usageText");
  const syncUsage = (rescan: boolean): void => {
    usageText.textContent = "统计中…";
    void invoke<UsageInfo>("sync_usage", { rescan })
      .then((u) => {
        usageText.textContent = `${u.sizeFormatted}（${u.objects} 张）`;
        setCloudUsage(u.size);
        showToast(rescan ? "重新统计完成" : "已刷新统计");
      })
      .catch((e) => {
        usageText.textContent = "统计失败";
        showToast(`统计失败：${errorMessage(e)}`);
      });
  };
  $<HTMLButtonElement>("#refreshUsage").addEventListener("click", () => syncUsage(false));
  $<HTMLButtonElement>("#rescanUsage").addEventListener("click", () => syncUsage(true));

  updatePreview();
}
