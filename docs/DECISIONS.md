# 架构决策记录 (ADR)

> 本文档记录 Assets Studio 项目从 Idea 到编码前的所有架构决策。
> 每条决策包含：背景、决策、理由、影响。

---

## Decision-001: 压缩库选型 — 纯 Rust

**背景：** PRD 定义了压缩管线（PNG → Oxipng / JPEG → MozJPEG / WebP 转换），需要选择 Rust 侧的图像处理 crate。MozJPEG 是 C 库，通过 FFI 绑定引入会增加跨平台编译复杂度。

**决策：** 采用纯 Rust 路线。PNG 压缩用 `oxipng`，JPEG 重编码和 WebP 转换用 `image` crate 内置 encoder。不引入任何 C 依赖。

**理由：**
- 零 C 依赖，Windows + macOS 双平台编译零障碍
- `oxipng` 是纯 Rust 的 PNG 无损优化库，质量可靠
- `image` crate 内置 JPEG/WebP encoder，API 统一
- JPEG 压缩率比 MozJPEG 差约 5-10%，对个人图床场景影响极小
- 首次使用 Rust，编译体验优先于极致压缩率

**影响：**
- Rust 依赖：`oxipng`、`image`，无需 C 编译链
- 如果后续压缩质量不满意，可在 v1.1+ 引入 `mozjpeg-sys`，用 trait 隔离实现
- 压缩管线通过 `Compression` / `Conversion` 配置控制，替换底层库不影响上层

---

## Decision-002: 业务逻辑在 Rust，展示逻辑在 React

**背景：** 需要确定图片处理管线（压缩 → 上传 → 拼接格式 → 剪贴板 → 通知）中哪些步骤在 Rust 侧完成，哪些在前端（React/JS）侧完成。

**决策：** 所有业务逻辑（Business Logic）在 Rust 完成，所有用户界面（Presentation Logic）在 React 完成。Rust 侧采用 Pipeline 架构，按 `commands/ → services/ → models/` 分层。React 永远不碰图片二进制、HTTP 上传、Base64、文件 IO。

```
React (Presentation)          Rust (Business Logic)
├── 拖拽                      ├── commands/    (Tauri Command 入口)
├── 设置页                    ├── services/    (Pipeline + 各服务)
├── 图片列表                  ├── models/      (领域模型)
├── 状态展示                  ├── config/      (配置读取)
└── invoke()                  └── main.rs
         │                           │
         └────────── Tauri Command ──┘
                     Tauri Event
```

**理由：**
- 图片二进制从压缩到上传全程在 Rust 内存中，不经过 JS 序列化，性能最好
- `reqwest` 做大文件上传比浏览器 `fetch` 更可靠（流式、超时、重试）
- 整条管线的错误在 Rust 侧用 `Result` 统一处理
- 前端极简，符合 v1 "一个拖拽框 + 状态文本" 的 UI 设计
- 职责边界清晰，后续增加 Dock 拖拽、剪贴板监听、OCR 等不会打破结构

**影响：**
- React 侧代码量很少，主要是事件监听和状态渲染
- Rust 侧是项目核心，复杂度集中在 services/ 层
- 所有跨语言通信通过 Tauri Command（React → Rust）和 Tauri Event（Rust → React）

---

## Decision-003: Command 只启动任务，所有结果走 Event

**背景：** Tauri Command 可以返回值，同时也可以通过 Event 推送状态。如果 Command 既返回结果又推送事件，会形成双出口。

**决策：** Command 只负责启动任务，返回 `Result<(), AppError>`。所有业务结果（ProcessResult、进度、错误）全部通过 Event 传递。

```rust
#[tauri::command]
async fn process_job(request: ProcessRequest, app: AppHandle) -> Result<(), AppError>
```

**理由：**
- 消除双出口，前端只有一个数据来源（Event 监听）
- 天然支持批量上传：每个 Job 独立 emit，不需要 `Vec<ProcessResult>`
- 天然支持异步长任务：Pipeline 每个阶段 emit 状态，前端实时更新
- Command 签名稳定：未来增加功能不改返回类型

**影响：**
- 前端必须监听 Event，不能只靠 `await invoke()`
- Event 携带 `job_id`，前端维护 `HashMap<JobId, JobCard>` 管理多个并发 Job
- 前端不需要等 Command 返回后才更新 UI

---

## Decision-004: ProcessResult 拆分为 ImageInfo + OutputFormats

**背景：** Pipeline 完成后需要返回图片信息（URL、尺寸、大小）和多种输出格式（Markdown、HTML、Base64）。这些是两类不同的数据。

**决策：** ProcessResult 拆分为 `ImageInfo`（图片元数据）和 `OutputFormats`（输出格式集合）。

```rust
pub struct ProcessResult {
    image: ImageInfo,
    output: OutputFormats,
}

pub struct ImageInfo {
    key: String,
    url: String,
    width: u32,
    height: u32,
    original_size: usize,
    compressed_size: usize,
}

pub struct OutputFormats {
    markdown: String,
    html: String,
    base64: String,
}
```

**理由：**
- 图片元数据和输出格式是两个关注点，分离后各自可扩展
- 未来增加 Typora / Obsidian / Notion 等格式只需扩展 OutputFormats，不影响 ImageInfo
- 未来增加 width/height/format 等 ImageInfo 字段不影响 OutputFormats
- 消费层（Application Layer）根据 UI State 选择格式，Pipeline 始终生成全部格式

**影响：**
- Pipeline 一次性生成所有格式，消费层选择复制哪个
- 用户在历史记录中随时可复制其他格式（v1.1），不需要重新跑 Pipeline

---

## Decision-005: Job = 一次完整工作流（非批量）

**背景：** 需要确定核心领域模型。以 Image 为中心还是以 Job 为中心？

**决策：** Job 表示一次完整的用户工作流（Workflow），不是图片集合（Batch）。一次用户操作（拖拽 / Ctrl+V / Dock / 截图）= 一个 Job。Job 当前只有一个输入源（本地图片），未来批量上传 = 多个独立 Job，而非一个 Job 含多张图。

```rust
pub struct Job {
    id: JobId,
    input: JobInput,
    preset: Preset,
}

pub enum JobInput {
    Image(PathBuf),
    // 未来: Clipboard, Screenshot, ...
}

pub enum JobState {
    Created,
    Running,
    Succeeded,
    Failed,
}
```

**理由：**
- Job ≠ Batch。Job 存在的原因是"一次用户操作就是一个工作流"，不是为了批量上传
- 不引入 `Vec<JobImage>`，因为 Vec 已经在暗示 Batch，而 v1 没有 Batch
- 未来批量 = `BatchJob(Vec<Job>)`，失败一个不影响其他，取消也是 Job 级别
- JobInput 枚举化，未来增加 Clipboard / Screenshot 输入源不改 Pipeline
- 不含 `created_at`，因为 v1 没有排序/历史/统计需求（YAGNI）

**影响：**
- Pipeline 处理的是 Job，不是 Image 集合
- 未来扩展（批量、取消、重试）几乎不需要重构 Pipeline
- Event 携带 `job_id`，前端按 Job 管理状态

---

## Decision-006: 分离处理策略和消费策略

**背景：** 配置文件中的 `copy` 字段（输出格式）和 `compress`/`quality`/`webp`（处理参数）属于不同层级。Pipeline 不应该关心用户想复制哪个格式。

**决策：** 明确分离三层：

| 层级 | 职责 | 包含 |
|------|------|------|
| Config | 应用级配置，决定默认行为和连接信息 | server, apiKey, defaultPreset, defaultOutput |
| Preset | 图片处理策略，决定如何压缩和转换 | Compression(enabled, quality), Conversion(Keep/WebP) |
| Application Layer | 消费策略，决定复制哪个格式、是否通知 | Clipboard, Notification, UI State |

Pipeline 只负责根据 `Job + Preset` 生成 `ProcessResult`（含全部格式）。Clipboard 和 Notification 属于 Application Layer，根据用户当前选择（UI State）决定复制哪种格式。

```
Config (应用配置)     Preset (处理策略)     Application (消费层)
├── server           ├── Compression       ├── Clipboard
├── apiKey           │   ├── enabled       ├── Notification
├── defaultPreset    │   └── quality       └── UI State
└── defaultOutput    └── Conversion
                        ├── Keep
                        └── WebP
```

**理由：**
- Pipeline 不关心 UI 和剪贴板，只生成结果
- 剪贴板/通知属于"消费结果"，不是"处理图片"
- 未来可能关闭自动复制、批量上传不复制，Clipboard 从 Pipeline 剥离后这些是消费层的事
- Config 的 `defaultOutput` 只决定默认展示方式，不强制 Pipeline 行为
- Preset 语义干净：只回答"这张图怎么处理"

**影响：**
- Rust 侧增加 Application Layer（协调 Pipeline + Clipboard + Notification）
- Pipeline 的 services/ 不包含 clipboard.rs 和 notify.rs，它们在 Application Layer
- Config 文件结构调整：`copy` → `defaultOutput`，增加 `defaultPreset`

---

## Decision-007: Worker 是 Storage Gateway，不是 Image Gateway

**背景：** 需要确定 Worker 的职责边界。Worker 是否应该代理图片读取？是否应该支持图片缩放/水印等消费行为？

**决策：** Worker 只负责对象存储（Storage），不负责对象消费（Distribution/Consumption）。图片通过 R2 自定义域名直接访问，不经过 Worker。

Worker 职责：
- ✅ 上传（PUT /objects/{key}）
- ✅ 删除（DELETE /objects/{key}）
- ✅ 列表（GET /objects）
- ✅ 鉴权（API Key）
- ❌ 图片读取
- ❌ 图片压缩
- ❌ 图片转换
- ❌ 图片缩放
- ❌ CDN
- ❌ 水印

**架构原则：**

> Infrastructure 必须保持无状态（Stateless）且职责单一。Desktop 负责工作流（Workflow），Worker 负责对象存储（Storage），R2 + 自定义域名负责内容分发（Distribution）。任何图片消费行为（读取、缩放、水印等）都不属于 Worker 的职责。

**理由：**
- 如果 Worker 支持图片读取，未来会有人提出 Resize / Watermark / WebP 转换 / Auth，Worker 会越来越胖
- R2 自定义域名是 Cloudflare CDN 原生能力，比 Worker 代理更高效
- 用户群体是 Self-hosted 开发者，配置 R2 自定义域名是部署步骤，不是产品功能
- Worker 代码极简，维护成本最低

**影响：**
- 部署要求：必须绑定 R2 自定义域名，README 中作为必选步骤
- 不做 Worker 代理读取 fallback
- Worker 直接返回 full URL（含域名），客户端不需要拼接 `baseUrl`
- Config 删除 `baseUrl` 字段
