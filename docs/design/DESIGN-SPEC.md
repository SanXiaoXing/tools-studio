# DESIGN-SPEC: Assets Studio 设计规范

> **配套文档**: `docs/design/DESIGN.md`（设计意图）、`docs/design/prototype.html`（实现）
> **更新**: 2026-08-10
> **适用范围**: 桌面端三视图（浏览图片 / 上传图片 / 设置）

本文档是原型 `prototype.html` 的可落地规范：设计 token、组件、布局、动效、文案与实现约定。前端实现时应以此为准绳，不得引入规范外的第二套颜色、圆角或字体。

---

## 1. 设计 Token

全部颜色走 CSS 变量（`:root`），深色模式在 `@media (prefers-color-scheme: dark)` 下整体覆盖。**实现时禁止硬编码色值**，一律引用变量。

### 1.1 颜色（浅色）

| Token | 值 | 用途 |
|---|---|---|
| `--bg` | `#f6f7f9` | 页面底色（内容区） |
| `--surface` | `#ffffff` | 卡片 / 弹窗 / 表单容器 |
| `--surface-2` | `#eef0f3` | 侧边栏底 / 输入框 / 预览块 / 缩略图占位 |
| `--surface-hover` | `#f3f4f6` | 悬停底色（导航项、幽灵按钮） |
| `--border` | `#e4e7eb` | 所有 1px 分隔线 / 边框 / 输入框描边 |
| `--text-1` | `#1a1d21` | 主标题、文件名 |
| `--text-2` | `#4b5563` | 次级文字（状态、按钮文字） |
| `--text-3` | `#6b7280` | 辅助文字（meta、hint），对比度 ≥ 4.8:1 |
| `--accent` | `#2563eb` | 强调色（悬停态、链接、图标） |
| `--accent-strong` | `#1d4ed8` | 填充按钮底（白字对比度 6.4:1） |
| `--accent-soft` | `#e8effc` | 强调色浅底（激活导航、拖拽高亮） |
| `--danger` | `#dc2626` | 破坏性文字 / 描边 |
| `--danger-strong` | `#b91c1c` | 危险填充按钮底（白字 4.5:1） |
| `--danger-soft` | `#fdecec` | 危险浅底（悬停） |
| `--ok` | `#16a34a` | 成功反馈（已复制、完成态） |
| `--overlay` | `rgba(15, 23, 42, .58)` | 图片悬停遮罩渐变 |
| `--toast-bg` / `--toast-fg` | `#1f2328` / `#f2f4f7` | 轻提示（深底浅字） |

### 1.2 颜色（深色）

| Token | 值 |
|---|---|
| `--bg` | `#0e1116` |
| `--surface` | `#161a21` |
| `--surface-2` | `#1b2029` |
| `--surface-hover` | `#20262f` |
| `--border` | `#262d38` |
| `--text-1` | `#f2f4f7` |
| `--text-2` | `#a8b0bc` |
| `--text-3` | `#8a93a1` |
| `--accent` | `#7aa7ff`（提亮保持对比） |
| `--accent-strong` | `#1d4ed8`（填充按钮不变） |
| `--accent-soft` | `rgba(37, 99, 235, .20)` |
| `--danger` | `#f87171` |
| `--danger-strong` | `#b91c1c` |
| `--danger-soft` | `rgba(220, 38, 38, .16)` |
| `--ok` | `#4ade80` |
| `--overlay` | `rgba(2, 6, 12, .70)` |
| `--toast-bg` / `--toast-fg` | `#f2f4f7` / `#1a1d21`（浅底深字） |

约束：

- **禁用纯黑 `#000` 与纯白 `#fff`**，一律用近黑 / 近白。
- **单一强调色**：蓝是唯一 accent；红只用于破坏性动作、绿只用于成功反馈，二者是语义色而非装饰色。
- 深色下填充按钮保持深蓝底白字（对比度不依赖色相变化）。

### 1.3 字体

| Token | 值 |
|---|---|
| `--font` | `-apple-system, "SF Pro Text", "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif` |
| `--mono` | `"SF Mono", "Cascadia Code", Consolas, "JetBrains Mono", monospace` |

- 桌面工具用系统字体栈，不引入网络字体（原生应用质感）。
- 数值（大小、百分比、计数、路径）一律 `font-variant-numeric: tabular-nums`（等宽数字，对齐稳定）。

### 1.4 圆角体系（一页一套规则）

| 层级 | 值 | 应用 |
|---|---|---|
| 胶囊 | `999px` | 计数徽标、进度条、toast |
| 卡片 | `12px` | 图片卡片、设置卡片、队列容器 |
| 按钮 / 输入 / 缩略图 | `8px` | 所有按钮、输入框、图片缩略图 |
| 弹窗 / 拖拽区 | `16px` | 详情弹窗、大拖拽区 |

### 1.5 阴影（随背景色调，禁用纯黑投影）

| Token | 浅色 | 深色 |
|---|---|---|
| `--shadow-card` | `0 1px 2px rgba(17,24,39,.05), 0 4px 12px -6px rgba(17,24,39,.10)` | `0 1px 2px rgba(0,0,0,.35), 0 4px 12px -6px rgba(0,0,0,.45)` |
| `--shadow-card-hover` | `0 2px 4px rgba(17,24,39,.06), 0 12px 28px -10px rgba(17,24,39,.18)` | `0 2px 4px rgba(0,0,0,.4), 0 14px 30px -10px rgba(0,0,0,.6)` |
| `--shadow-modal` | `0 24px 64px -16px rgba(17,24,39,.30)` | `0 24px 64px -12px rgba(0,0,0,.65)` |

### 1.6 尺寸与间距

| 项 | 值 |
|---|---|
| 侧边栏展开 / 折叠 | `236px` / `68px` |
| 内容区左右内边距 | `36px`（≤768px 时为 `18px`） |
| 图片栅格 | `repeat(auto-fill, minmax(220px, 1fr))`，gap `20px`（≤1024px 180px/14px，≤768px 150px/12px） |
| 卡片内边距 | `10px`，缩略图 4:3 |
| 上传 / 设置滚动区 | 上 `20px`、下 `48px`、gap `20px` |
| 队列行 | 缩略图 52px、行内边距 `12px 18px` |

---

## 2. 排版规范

| 用途 | 字号 / 字重 | 说明 |
|---|---|---|
| 视图标题 `h1` | 22px / 700 / `letter-spacing: -.02em` | 图片库、上传图片、设置 |
| 弹窗标题 | 18px / 700 | 详情弹窗文件名 |
| 卡片名 / 队列文件名 | 13px / 600 | 单行省略（`ellipsis`） |
| 正文 / 主按钮 | 14px | 幽灵按钮、危险按钮同 |
| 辅助文字 | 12px | meta、hint、进度、计数、toast |
| 浮层小按钮 | 12px / 600 | 复制链接、确认删除 |
| 等宽文本 | 11-12px `--mono` | 路径、链接、正则 hint |

规则：

- 中文正文行高 `1.7`，辅助说明不缩进堆叠。
- 所有数字（大小、日期、百分比、计数、路径）使用 `tabular-nums`。
- 文件名一律单行省略，不换行不折行；弹窗标题允许 `word-break: break-all`。

---

## 3. 组件规范

### 3.1 按钮

| 变体 | 样式 | 状态 |
|---|---|---|
| `.primary-btn` 主按钮 | `--accent-strong` 底 + 白字，8px 圆角 | hover 变 `--accent`，`:active` `scale(.985)` |
| `.ghost-btn` 幽灵按钮 | `--border` 描边 + `--text-2` 字 | hover 换 `--surface-hover` 底 |
| `.danger-btn` 危险按钮 | `--danger` 描边 + 红字 | hover `--danger-soft` 底；`.confirming` 红底白字 |
| `.mini-btn` 浮层小按钮 | 12px，浮于图片遮罩上 | `primary` / `copied`（绿）/ `ghost`（半透明白）/ `danger-solid` |
| `.mini-icon` 图标按钮 | 32px 方，白字白描边半透明底 | danger 变体 hover 红底 |
| 禁用态 | `opacity: .45` + `pointer-events: none` | 不换色，仅降透明度 |

约束：**按钮文字必须单行**（中文 4 字内）；白底页面禁用「白底白字」；浮在照片上的按钮必须带半透明底或描边保证可读。

### 3.2 侧边栏

- 展开 `236px` / 折叠 `68px`，宽度过渡 `.28s cubic-bezier(.32, .72, .24, 1)`，折叠状态存 `localStorage("as-collapsed")`。
- 折叠后隐藏：`.brand-name`、`.cta-label`、`.nav-label`、`.nav-count`、`.storage`、`.collapse-label`。
- 激活导航项：`--accent-soft` 底 + `--accent` 字 + 徽标反白，**无装饰圆点**。
- 顶部主 CTA「上传图片」为填充按钮；底部为空间用量条（信息性 mock）+ 折叠按钮（折叠时图标旋转 180°）。

### 3.3 图片卡片（浏览视图）

- 白底 12px 圆角 + `--shadow-card`；hover 上浮 2px + `--shadow-card-hover`。
- 缩略图 4:3 `cover`；hover / `focus-within` 出现底部渐变遮罩（`--overlay`）与操作行：
  「复制链接」主按钮 + 详情图标 + 删除图标。
- 删除两阶段：遮罩内切换为「确认删除？ 删除 取消」，鼠标移出卡片自动取消。
- meta 行：文件名（13px/600 单行省略）+ `大小 日期`（12px tabular-nums）。

### 3.4 表单（设置页）

- label 在输入框上方（**禁止 placeholder 当 label**）。
- 输入框：`--surface-2` 底 + `--border` 描边，focus 换 `--accent` 描边。
- hint 12px `--text-3`，`code` 用 `--mono` + 浅底描边。
- 预览块 `.preview-box`：label 在左、mono 值右对齐；重命名预览显示「删除线原名 → 绿色新名」。

### 3.5 上传队列

- 容器：白底 12px 圆角 + 表头（标题 + 完成计数 `n / m 已完成`）。
- 行：52px 缩略图 + 文件名 + 5px 胶囊进度条 + 阶段文案（正在压缩图片 → 正在上传图片）+ 百分比。
- 完成态：绿字「已完成，链接已生成」+ `压缩前 → 压缩后` 体积对比；右侧「复制链接」按钮完成前 `disabled`。
- 行间仅 `border-top` 分隔（行数不限，不画逐行上下线）。

### 3.6 详情弹窗

- 全屏遮罩 `rgba(9,12,18,.55)` + `backdrop-filter: blur(4px)`；面板 16px 圆角，宽 `min(920px, 100%)`。
- 左：预览区固定高 `min(560px, 60dvh)`（≤1024px `min(220px, 35dvh)`），图片 `contain` 等比。
- 右：标题 + meta 列表（格式 / 尺寸 / 大小 / 上传时间 / 存储路径；小屏两列并排，存储路径跨整行）+ 链接格式分段控件（URL / Markdown，选择持久化并作用于全部复制入口）+ 复制内容（mono 只读输入框）+ 底部「复制链接」主按钮 /「删除图片」危险按钮（两阶段确认）。
- 关闭：右上 X、遮罩点击、`Escape`；`role="dialog"` + `aria-modal`。

### 3.7 轻提示 Toast

- 底部居中胶囊，`z-index 60`，2s 自动消失，`pointer-events: none`。
- 浅色模式深底浅字、深色模式浅底深字（`--toast-bg` / `--toast-fg`）。

### 3.8 空状态 / 骨架屏

- 空状态：2px 虚线拖拽区（16px 圆角），hover / `dragover` 变 `--accent` 描边 + `--accent-soft` 底；文案引导去上传页。
- 骨架屏：首屏 8 个 shimmer 卡片（`--surface-2` 渐变扫光动画）；`prefers-reduced-motion` 下动画关闭，保持静态灰块。

---

## 4. 布局与响应式

- 应用外壳：`height: 100vh` + `100dvh` 回退，flex 横排（侧边栏 + 内容），`overflow: hidden`，仅内容区独立滚动。
- 内容区 `.content` 纵向布局：标题区（`.header`）+ 滚动区（`.gallery` / `.upload-body` / `.settings-body`）。
- 栅格一律 CSS Grid（`repeat(auto-fill, minmax(220px, 1fr))`），**禁止 flex 百分比数学**（如 `w-[calc(33%-1rem)]`）。
- 断点：
  - `≤1024px`：栅格 180px / gap 14px；详情弹窗单列（预览在上、信息在下）。
  - `≤768px`：侧边栏强制折叠为图标轨；内容区 padding 18px；栅格 150px / gap 12px；标题区纵向堆叠。
- 弹窗预览区固定高度（`min(560px, 60dvh)` / 窄屏 `min(220px, 35dvh)`），防止大图撑破面板。

---

## 5. 动效规范

| 动效 | 时长 / 缓动 | 触发 |
|---|---|---|
| 侧边栏折叠 | `.28s cubic-bezier(.32, .72, .24, 1)` | 点击折叠按钮 |
| 卡片 hover | `.2s ease` | transform 上浮 + 阴影 |
| 浮层（遮罩操作行） | `.18s ease` | 卡片 hover / focus |
| 进度条 | `width .15s linear` | 上传队列 |
| 按钮按压 | `.1s ease` | `:active` `scale(.985)` |
| Toast 出现 | `.2s ease` | opacity + translateY |
| 骨架屏 | `1.2s linear` | 首屏 shimmer |

约束：

- 常规动效只动画 `transform` 与 `opacity`（进度条 width 为低频例外）。
- **`prefers-reduced-motion: reduce` 时全局过渡/动画缩至 `.01ms`**，骨架屏退化为静态灰块。
- 动效必须有理由（层级、反馈、状态变化），不添加装饰性无限循环动画。

---

## 6. 交互状态清单

| 动作 | 入口 | 反馈 |
|---|---|---|
| 上传图片 | 侧边栏 CTA / 上传页拖拽或选择 | 队列进度（压缩 → 上传）、完成态、加入浏览列表、toast |
| 复制链接 | 卡片浮层 / 队列完成行 / 详情弹窗 | 按钮变绿「已复制」约 1.6s + toast |
| 删除图片 | 卡片浮层 / 详情弹窗 | 两阶段确认；删除后计数、空状态联动 + toast |
| 查看详情 | 点击缩略图 | 详情弹窗；X / 遮罩 / ESC 关闭 |
| 视图切换 | 导航 / 顶部 CTA / 空状态按钮 | active 态切换、隐藏视图显隐 |
| 保存设置 | 设置页「保存设置」 | 行内「已保存」2s + `localStorage` 持久化 |
| 正则非法 | 设置页输入 | 预览回退为原名，不报错 |
| 复制失败 | 任意复制入口 | toast「复制失败，请手动复制链接」 |

---

## 7. 文案规范

- 界面文案仅中文；产品名 Assets Studio 保持英文。
- 核心动作文案全局统一：上传图片 / 浏览图片 / 复制链接 / 删除图片 / 查看详情 / 确认删除 / 取消 / 保存设置 / 恢复默认 / 选择图片文件 / 去上传图片。
- **同一意图只用一个文案**：删除一律「删除图片」，确认一律「确认删除？」，复制一律「复制链接」。
- **禁用 em-dash 与 en-dash 字符**，只用中文标点（，。、（））；列表分隔用顿号。
- 阶段与状态文案动词化：「正在压缩图片」「正在上传图片」「已完成，链接已生成」「已复制」。
- 不写 AI 味文案（优雅、无缝、赋能、极致等），不用装饰性小节标题。
- 文件名、路径、链接、正则等机器可读内容用 `--mono` 展示。

---

## 8. 实现约定

1. **`[hidden]` 规则（关键）**：全局 `[hidden] { display: none !important; }`。任何设置了 `display: flex/grid` 又用 `hidden` 属性控制显隐的元素（弹窗、空状态、确认区、视图、队列），都必须依赖此规则，否则 `hidden` 会被 display 覆盖，出现「弹窗关不掉、空状态常显」类 bug。
2. **图标**：内联 SVG，`stroke-width="1.7"`、`stroke-linecap/linejoin="round"`、`fill="none"`、`aria-hidden="true"`，全站同一描边宽；不手绘复杂图形，不混用 emoji。
3. **z-index 分层**：弹窗遮罩 `40`、toast `60`；禁止随意堆 `z-*`，滚动容器不设 z-index。
4. **图片预览**：`URL.createObjectURL` 仅用于展示（缩略图 / 弹窗 / 队列），不参与业务数据持久化。
5. **本地存储 key**：`as-collapsed`（侧边栏折叠态）、`as-settings`（设置 JSON）、`as-cache`（图片库与存储用量缓存 JSON，启动秒开 + 离线兜底）。
6. **骨架屏**：shimmer 动画与 `prefers-reduced-motion` 冲突时回退静态灰块。
7. **表单**：输入框 `autocomplete="off"`、`spellcheck="false"`；label 在输入框上方。
8. **删除**：一律两阶段确认，不可一键完成（不可逆操作）。
9. **mock 数据**：原型内 mock（图片数据、空间用量、压缩体积）在代码注释中显式标注「原型演示用」。

---

## 9. Pre-flight 检查表（原型自检）

- [ ] 全部颜色引用 CSS 变量，无硬编码色值
- [ ] 单一强调色：accent 全站一致；红 = 破坏、绿 = 成功
- [ ] 圆角一页一套规则（卡片 12 / 按钮 8 / 弹窗 16 / 胶囊 999）
- [ ] 按钮文字对比度 ≥ 4.5:1，无白底白字
- [ ] CTA 文案单行不换行，同一意图仅一个文案
- [ ] 侧边栏折叠后仅图标，无文字残留
- [ ] 弹窗可关闭（X / 遮罩 / ESC），`hidden` 与 `[hidden]` 规则配合正确
- [ ] 上传队列有进度、阶段文案、完成态与复制入口
- [ ] 删除一律两阶段确认
- [ ] 空状态、骨架屏、失败反馈（复制失败）齐全
- [ ] 全站零 em-dash / en-dash，中文标点
- [ ] 深色模式对比度达标，无纯黑 `#000` / 纯白 `#fff`
- [ ] `prefers-reduced-motion` 下无残留动画
- [ ] `100dvh` 视口，无滚动跳动
- [ ] mock 数据在文件中显式标注（原型演示用）


