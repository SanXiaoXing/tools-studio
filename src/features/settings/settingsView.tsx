import { createRoot } from "react-dom/client";
import { SETTINGS_DEFAULTS, fillTemplate, getSettings, saveSettings } from "../../lib/settings";
import { showToast } from "../../lib/utils";
import ElasticSlider from "./ElasticSlider";

const INPUT_CLS =
  "w-full px-3 py-2.5 rounded-lg border border-line bg-surface2 text-ink text-[13px] outline-none focus:border-accent transition-colors";
const HINT_CLS = "text-xs text-ink3 mt-1.5 leading-relaxed";
const CODE_CLS = "font-mono text-[11px] bg-surface3 border border-line rounded px-1.5 py-0.5 text-ink2";

/** 设置视图（DESIGN-SPEC §3.4）：域名 / 路径模板 / 正则重命名 / 压缩质量，实时预览 */
export function renderSettingsView(container: HTMLElement): void {
  const cur = getSettings();
  container.innerHTML = `
  <div class="settings-body flex-1 min-h-0 overflow-y-auto p-5 pl-9 pr-9 pb-12 flex flex-col gap-5">
    <div class="flex flex-col gap-4">

      <section class="bg-surface border border-line rounded-xl shadow-card p-5">
        <h2 class="text-[15px] font-bold mb-1">链接域名</h2>
        <p class="text-xs text-ink3 leading-relaxed mb-4.5">上传完成后生成的链接使用此域名，保存后立即生效。</p>
        <div>
          <label for="setDomain" class="block text-[13px] font-medium mb-1.5">域名</label>
          <input id="setDomain" spellcheck="false" autocomplete="off" class="${INPUT_CLS}">
          <p class="${HINT_CLS}">例如 <code class="${CODE_CLS}">https://cdn.assets-studio.dev</code>，结尾无需斜杠。</p>
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
            <code class="${CODE_CLS}">{name}</code> 重命名后文件名、<code class="${CODE_CLS}">{ext}</code> 扩展名
          </p>
        </div>
        <div class="preview-box flex items-center gap-3 mt-3.5 px-3 py-2.5 rounded-lg bg-surface2 text-xs tnum">
          <span class="shrink-0 text-ink3">将存入</span>
          <span id="pathPreview" class="flex-1 min-w-0 text-right font-mono text-ink whitespace-nowrap overflow-hidden text-ellipsis"></span>
        </div>
      </section>

      <section class="bg-surface border border-line rounded-xl shadow-card p-5">
        <h2 class="text-[15px] font-bold mb-1">文件名重命名</h2>
        <p class="text-xs text-ink3 leading-relaxed mb-4.5">上传时用正则查找替换文件名主体，用于清理空格、中文或非法字符，扩展名保持不变。</p>
        <div class="mb-3.5">
          <label for="setFind" class="block text-[13px] font-medium mb-1.5">查找（正则表达式）</label>
          <input id="setFind" spellcheck="false" autocomplete="off" class="${INPUT_CLS}">
        </div>
        <div>
          <label for="setReplace" class="block text-[13px] font-medium mb-1.5">替换为</label>
          <input id="setReplace" spellcheck="false" autocomplete="off" class="${INPUT_CLS}">
        </div>
        <div class="preview-box flex items-center gap-3 mt-3.5 px-3 py-2.5 rounded-lg bg-surface2 text-xs">
          <span class="shrink-0 text-ink3">预览</span>
          <span class="flex-1 min-w-0 text-right font-mono whitespace-nowrap overflow-hidden text-ellipsis tnum">
            <span id="renameOld" class="text-ink3 line-through"></span>
            <span class="text-ink3"> → </span>
            <span id="renameNew" class="text-ok"></span>
          </span>
        </div>
      </section>

      <section class="bg-surface border border-line rounded-xl shadow-card p-5">
        <h2 class="text-[15px] font-bold mb-1">压缩质量</h2>
        <p class="text-xs text-ink3 leading-relaxed mb-4.5">上传时转为 WebP 的压缩率，越低体积越小。保存后对新上传生效。</p>
        <div id="qualityMount"></div>
      </section>

    </div>
    <div class="flex items-center gap-2.5 py-0.5 pb-2">
      <button id="saveSettings" class="inline-flex items-center gap-2 rounded-lg px-4.5 py-2.5 bg-accent-strong text-white text-sm font-semibold hover:bg-accent active:scale-[.985] transition" type="button">保存设置</button>
      <button id="resetSettings" class="inline-flex items-center gap-2 rounded-lg px-4.5 py-2.5 border border-line bg-surface text-ink2 text-sm font-medium hover:bg-surface3 hover:text-ink transition" type="button">恢复默认</button>
    </div>
  </div>`;

  const $ = <T extends HTMLElement>(sel: string): T => container.querySelector(sel) as T;
  const setDomain = $<HTMLInputElement>("#setDomain");
  const setPath = $<HTMLInputElement>("#setPath");
  const setFind = $<HTMLInputElement>("#setFind");
  const setReplace = $<HTMLInputElement>("#setReplace");
  const pathPreview = $<HTMLElement>("#pathPreview");
  const renameOld = $<HTMLElement>("#renameOld");
  const renameNew = $<HTMLElement>("#renameNew");
  const saveBtn = $<HTMLButtonElement>("#saveSettings");
  const resetBtn = $<HTMLButtonElement>("#resetSettings");

  setDomain.value = cur.domain;
  setPath.value = cur.pathTemplate;
  setFind.value = cur.renameFind;
  setReplace.value = cur.renameReplace;

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
    let renamed = base;
    const find = setFind.value;
    if (find) {
      try {
        renamed = base.replace(new RegExp(find, "g"), setReplace.value);
      } catch {
        /* 非法正则保留原名 */
      }
    }
    renameOld.textContent = sample;
    renameNew.textContent = renamed + "." + ext;
    pathPreview.textContent = fillTemplate(setPath.value || SETTINGS_DEFAULTS.pathTemplate, renamed, ext);
  };

  saveBtn.addEventListener("click", () => {
    saveSettings({
      ...getSettings(), // 保留 copyFormat 等未在表单中的字段
      domain: setDomain.value.trim() || SETTINGS_DEFAULTS.domain,
      pathTemplate: setPath.value.trim() || SETTINGS_DEFAULTS.pathTemplate,
      renameFind: setFind.value,
      renameReplace: setReplace.value,
      quality,
    });
    showToast("设置已保存");
    updatePreview();
  });
  resetBtn.addEventListener("click", () => {
    saveSettings({ ...SETTINGS_DEFAULTS });
    setDomain.value = SETTINGS_DEFAULTS.domain;
    setPath.value = SETTINGS_DEFAULTS.pathTemplate;
    setFind.value = "";
    setReplace.value = "";
    quality = SETTINGS_DEFAULTS.quality;
    renderQuality();
    updatePreview();
    showToast("已恢复默认设置");
  });
  for (const el of [setPath, setFind, setReplace]) {
    el.addEventListener("input", updatePreview);
  }

  updatePreview();
}
