// 部署 Worker 视图：零配置、纯复制粘贴。用户只在 Cloudflare 控制台操作
// （创建 Worker → 粘贴源码 → 填环境变量 → 部署），无需安装/运行任何命令行工具。
// 架构：API 域名（Worker，需 X-API-Key）与图片域名（R2 Custom Domain，公开读取）分离，
// 图片访问不走 Worker，因此不要求 API Key（DECISIONS.md D-007）。
// 源码用 Vite `?raw` 直接引用 apps/worker/src/index.js（纯 JS，可直接粘贴到 Cloudflare 控制台），
// 界面展示与仓库文件始终一致（单一事实源）。
import workerSource from "../../../apps/worker/src/index.js?raw";
import { icon } from "../../lib/icons";
import { copyText, esc, feedbackCheck, showToast } from "../../lib/utils";

const COPY_BTN_CLS =
  "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 border border-line bg-surface text-ink2 text-xs font-medium hover:bg-surface3 hover:text-ink transition";
const CODE_CLS = "font-mono text-[11px] bg-surface3 border border-line rounded px-1.5 py-0.5 text-ink2";
const PRE_CLS = "whitespace-pre font-mono text-[11.5px] leading-relaxed text-ink overflow-auto";

/** 步骤项：序号圆点 + 文案（含行内 code 片段） */
const step = (n: number, html: string): string => `
  <li class="flex items-start gap-3 text-[13px] leading-relaxed text-ink2">
    <span class="shrink-0 w-5 h-5 mt-0.5 rounded-full bg-accent-soft text-accent text-[11px] font-bold flex items-center justify-center">${n}</span>
    <span>${html}</span>
  </li>`;

/** 域名规划表：API 域名（带鉴权）与图片域名（公开读取）分离 */
const domainRow = (api: string, img: string): string => `
  <div class="flex flex-col gap-3.5">
    <div class="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg bg-surface2">
      <span class="shrink-0 text-[13px] text-ink3">API 域名（Worker）</span>
      <span class="flex-1 min-w-0 text-right font-mono text-[13px] text-ink truncate">${api}</span>
    </div>
    <div class="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg bg-surface2">
      <span class="shrink-0 text-[13px] text-ink3">图片域名（R2）</span>
      <span class="flex-1 min-w-0 text-right font-mono text-[13px] text-ink truncate">${img}</span>
    </div>
  </div>`;

/** 部署 Worker 视图（从设置页「部署 Worker」入口进入，侧边栏已无独立导航） */
export function renderDeployView(
  container: HTMLElement,
  opts?: { onBack?: () => void },
): void {
  container.innerHTML = `
  <div class="settings-body flex-1 min-h-0 overflow-y-auto p-5 pl-9 pr-9 pb-12 flex flex-col gap-5">
    <div class="flex items-center">
      <button id="backToSettings" type="button" class="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 border border-line bg-surface text-ink2 text-xs font-medium hover:bg-surface3 hover:text-ink transition">
        ${icon.arrow} 返回设置
      </button>
    </div>
    <div class="flex flex-col gap-4">

      <section class="bg-surface border border-line rounded-xl shadow-card p-5">
        <h2 class="text-[15px] font-bold mb-1">域名规划：API 与图片分离</h2>
        <p class="text-xs text-ink3 leading-relaxed mb-4.5">
          Worker 只负责带鉴权的 API（上传 / 删除 / 列表 / 统计），图片读取由 <strong class="text-ink2">R2 自定义域名</strong>直接提供，
          不经过 Worker、不需要 API Key。这样别人能看图，但不能利用你的 Worker 上传。部署时请准备两个域名：
        </p>
        ${domainRow("api.example.com", "img.example.com")}
        <div class="flex flex-col gap-2 mt-3.5">
          <div class="flex items-start gap-2 text-xs text-ink2 leading-relaxed">
            <span class="shrink-0 w-4 h-4 mt-0.5 rounded bg-accent-soft text-accent text-[10px] font-bold flex items-center justify-center">A</span>
            <span><strong>API 域名</strong>：指向 Worker（<code class="${CODE_CLS}">https://xxx.workers.dev</code> 或自定义路由），所有请求必须带 <code class="${CODE_CLS}">X-API-Key</code>。</span>
          </div>
          <div class="flex items-start gap-2 text-xs text-ink2 leading-relaxed">
            <span class="shrink-0 w-4 h-4 mt-0.5 rounded bg-accent-soft text-accent text-[10px] font-bold flex items-center justify-center">B</span>
            <span><strong>图片域名</strong>：R2 桶的自定义域名（<code class="${CODE_CLS}">Public Bucket</code>），公开读取，无需 Key。上传返回的链接就用它。</span>
          </div>
        </div>
      </section>

      <section class="bg-surface border border-line rounded-xl shadow-card p-5">
        <h2 class="text-[15px] font-bold mb-1">部署 Cloudflare Worker</h2>
        <p class="text-xs text-ink3 leading-relaxed mb-4.5">
          全程在 Cloudflare 控制台用鼠标操作：复制下方源码粘贴进 Worker，填好环境变量，点「部署」即可。
          不需要安装或运行任何命令行工具。
        </p>
        <ol class="flex flex-col gap-2.5">
          ${step(1, `创建 R2 存储桶：R2 →「创建存储桶」（如 <code class="${CODE_CLS}">tools-studio</code>）。`)}
          ${step(2, `给存储桶添加自定义域名：R2 → 存储桶 →「设置」→「自定义域」→ 添加图片域名（如 <code class="${CODE_CLS}">img.example.com</code>），状态变为 <code class="${CODE_CLS}">Active</code> 后图片可公开读取。`)}
          ${step(3, `创建 Worker：<code class="${CODE_CLS}">dash.cloudflare.com</code> → Workers & Pages →「创建 Worker」（模板选 Hello World）→「编辑代码」。`)}
          ${step(4, `全选删除模板代码，点下方「复制源码」粘贴进去，然后点右上角「部署」。`)}
          ${step(5, `进入「设置 → 变量和机密」添加下方 4 个环境变量（<code class="${CODE_CLS}">API_KEY</code> 类型选「机密」）。`)}
          ${step(6, `进入「设置 → 绑定」→「添加绑定」→ R2 存储桶，绑定名称填 <code class="${CODE_CLS}">IMAGES</code>，选择第 1 步创建的桶。`)}
          ${step(7, `回到本应用「设置」页，把 API 域名（<code class="${CODE_CLS}">https://xxx.workers.dev</code>）和 API Key 填入并保存。`)}
        </ol>
      </section>

      <section class="bg-surface border border-line rounded-xl shadow-card p-5">
        <div class="flex items-center justify-between gap-3 mb-1">
          <h2 class="text-[15px] font-bold">Worker 源码</h2>
          <button id="copyWorker" type="button" class="${COPY_BTN_CLS}">${icon.copy}<span>复制源码</span></button>
        </div>
        <p class="text-xs text-ink3 leading-relaxed mb-3.5">
          <code class="${CODE_CLS}">src/index.js</code> — Storage Gateway（上传 / 列表 / 删除 / 统计），整体粘贴到 Worker 编辑器，不要改动。
        </p>
        <pre class="${PRE_CLS} max-h-[420px] p-4 rounded-lg bg-surface2 border border-line">${esc(workerSource)}</pre>
      </section>

      <section class="bg-surface border border-line rounded-xl shadow-card p-5">
        <h2 class="text-[15px] font-bold mb-1">环境变量</h2>
        <p class="text-xs text-ink3 leading-relaxed mb-3.5">
          在 Worker「设置 → 变量和机密」页面填写（<code class="${CODE_CLS}">API_KEY</code> 存为机密，其余存为文本），无需任何命令行操作。
        </p>
        <div class="overflow-hidden rounded-lg border border-line">
          <table class="w-full text-[12.5px]">
            <thead>
              <tr class="bg-surface2 text-ink3 text-left">
                <th class="px-3 py-2 font-medium">变量</th>
                <th class="px-3 py-2 font-medium">必填</th>
                <th class="px-3 py-2 font-medium">说明</th>
              </tr>
            </thead>
            <tbody class="text-ink2 divide-y divide-line">
              <tr><td class="px-3 py-2 font-mono text-ink">API_KEY</td><td class="px-3 py-2">是</td><td class="px-3 py-2">访问密钥，与设置页 API Key 一致（类型选「机密」）</td></tr>
              <tr><td class="px-3 py-2 font-mono text-ink">PUBLIC_BASE_URL</td><td class="px-3 py-2">是</td><td class="px-3 py-2"><strong class="text-ink">图片域名</strong>（R2 自定义域，如 https://img.example.com，结尾无斜杠），不是 API 域名</td></tr>
              <tr><td class="px-3 py-2 font-mono text-ink">ALLOWED_TYPES</td><td class="px-3 py-2">否</td><td class="px-3 py-2">Content-Type 白名单，默认 image/png,image/jpeg,image/webp,image/gif,image/avif</td></tr>
              <tr><td class="px-3 py-2 font-mono text-ink">MAX_SIZE_MB</td><td class="px-3 py-2">否</td><td class="px-3 py-2">单文件上限（MB），默认 20</td></tr>
            </tbody>
          </table>
        </div>
        <p class="text-xs text-ink3 leading-relaxed mt-3.5">提示：API Key 可在「设置」页点「生成随机」自动创建，再复制到这里填写，两端保持一致。</p>
      </section>

    </div>
  </div>`;

  /** 返回设置页 */
  container.querySelector<HTMLButtonElement>("#backToSettings")?.addEventListener("click", () => opts?.onBack?.());

  /** 复制源码：成功 → 绿色 ✓ 反馈 + toast；失败 → 提示手动复制 */
  const copyWorker = container.querySelector<HTMLButtonElement>("#copyWorker");
  copyWorker?.addEventListener("click", () => {
    void (async () => {
      const ok = await copyText(workerSource);
      if (ok) {
        feedbackCheck(copyWorker, "已复制");
        showToast("Worker 源码已复制");
      } else {
        showToast("复制失败，请手动复制");
      }
    })();
  });
}
