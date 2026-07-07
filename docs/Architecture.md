# Assets Studio — 技术架构文档

> 本文档定义 Assets Studio 的技术架构、分层设计、核心数据模型和模块结构。
> 架构决策记录见 [DECISIONS.md](./DECISIONS.md)。

---

## 1. 系统概览

```
                用户
                  │
        拖图片 / Ctrl+V (v1.2)
                  │
                  ▼
    ┌─────────────────────────────┐
    │       Tauri Client           │
    │  ┌─────────┐  ┌───────────┐ │
    │  │  React  │  │   Rust    │ │
    │  │ (View)  │←→│ (Pipeline)│ │
    │  └─────────┘  └───────────┘ │
    └─────────────────────────────┘
                  │
      Rust 压缩 / WebP 转换
                  │
                  ▼
         Cloudflare Worker
          (Storage Gateway)
                  │
                  ▼
                 R2
                  │
                  ▼
        R2 自定义域名 (CDN)
                  │
                  ▼
    Markdown / HTML / Base64
                  │
                  ▼
       复制到剪贴板 + 系统通知
```

**三层职责：**

| 层 | 组件 | 职责 |
|---|---|---|
| Desktop | Tauri Client (Rust + React) | 工作流：拖拽 → 压缩 → 上传 → 生成格式 → 剪贴板 → 通知 |
| Storage | Cloudflare Worker | 对象存储网关：上传、删除、列表、鉴权 |
| Distribution | R2 + 自定义域名 | 内容分发：通过 Cloudflare CDN 直接访问图片 |

---

## 2. 分层架构

```
┌──────────────────────────────────────────┐
│           React (Presentation)            │
│  拖拽 · 设置 · 状态 · 列表 · 用户交互     │
├──────────────────────────────────────────┤
│         Application Layer (Rust)          │
│  协调 Pipeline · Clipboard · Notify       │
├──────────────────────────────────────────┤
│           Pipeline (Rust)                 │
│  Compress → Upload → Generate Result      │
├──────────────────────────────────────────┤
│         Domain Models (Rust)              │
│  Job · Preset · ProcessResult · ...       │
├──────────────────────────────────────────┤
│        Infrastructure (Rust + Worker)     │
│  HTTP (reqwest) · R2 · Filesystem · Config│
└──────────────────────────────────────────┘
```

**通信规则：**
- React → Rust：Tauri Command（`invoke()`）
- Rust → React：Tauri Event（`emit()`）
- Rust → Worker：HTTP（`reqwest`）
- Worker → R2：R2 Binding（`env.BUCKET`）

---

## 3. Desktop 侧架构（Rust）

### 3.1 目录结构

```
apps/desktop/src-tauri/
├── commands/
│   └── mod.rs          # Tauri Command 入口（process_job 等）
├── services/
│   ├── pipeline.rs     # Pipeline 调度（Compress → Upload → Generate）
│   ├── compress.rs     # 图片压缩（Oxipng / image crate）
│   ├── upload.rs       # HTTP 上传到 Worker
│   ├── output.rs       # 生成 Markdown / HTML / Base64
│   ├── clipboard.rs    # 剪贴板写入（Application Layer）
│   ├── notify.rs       # 系统通知（Application Layer）
│   └── naming.rs       # 文件命名（NanoID + 日期路径）
├── models/
│   ├── job.rs          # Job, JobInput, JobState, JobId
│   ├── preset.rs       # Preset, Compression, Conversion
│   ├── result.rs       # ProcessResult, ImageInfo, OutputFormats
│   └── event.rs        # PipelineEvent, PipelineStage, PipelineError
├── config/
│   └── mod.rs          # 配置文件读取
├── error.rs            # AppError 统一错误类型
└── main.rs             # 入口，注册 Command 和 Event
```

### 3.2 核心数据模型

#### Job（领域模型）

```rust
pub struct Job {
    pub id: JobId,
    pub input: JobInput,
    pub preset: Preset,
}

pub type JobId = String;  // NanoID

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

#### Preset（处理策略）

```rust
pub struct Preset {
    pub compression: Compression,
    pub conversion: Conversion,
}

pub struct Compression {
    pub enabled: bool,
    pub quality: u8,  // 1-100
}

pub enum Conversion {
    Keep,   // 保留原格式
    WebP,   // 转 WebP
}
```

#### ProcessResult（Pipeline 输出）

```rust
pub struct ProcessResult {
    pub image: ImageInfo,
    pub output: OutputFormats,
}

pub struct ImageInfo {
    pub key: String,            // R2 存储路径
    pub url: String,            // 完整访问 URL（Worker 返回）
    pub width: u32,
    pub height: u32,
    pub original_size: usize,   // 原始文件大小
    pub compressed_size: usize, // 压缩后大小
}

pub struct OutputFormats {
    pub markdown: String,       // ![image](url)
    pub html: String,           // <img src="url" />
    pub base64: String,         // data:image/webp;base64,...
}
```

#### Event（事件模型）

```rust
pub enum PipelineEvent {
    Started { job_id: JobId },
    StageChanged { job_id: JobId, stage: PipelineStage, message: String },
    Succeeded { job_id: JobId, result: ProcessResult },
    Failed { job_id: JobId, error: PipelineError },
}

pub enum PipelineStage {
    Reading,
    Compressing,
    Uploading,
    Generating,
}

pub struct PipelineError {
    pub stage: PipelineStage,
    pub kind: ErrorKind,
    pub message: String,
}

pub enum ErrorKind {
    Io,
    Compression,
    Upload,
    Network,
    Authentication,
    Clipboard,
}
```

### 3.3 Pipeline 设计

Pipeline 是一组顺序执行的 Stage，每个 Stage 接收上一个 Stage 的输出：

```
Job
  │
  ▼
┌─────────┐     ┌────────────┐     ┌─────────┐     ┌──────────┐
│ Reading │ ──→ │ Compressing│ ──→ │ Upload  │ ──→ │Generating│
└─────────┘     └────────────┘     └─────────┘     └──────────┘
  │                  │                  │               │
  │ 读取文件         │ Oxipng/image    │ reqwest PUT   │ 拼接 MD/HTML/Base64
  │ 获取尺寸         │ 压缩+转换        │ 上传到 Worker  │ 生成 ProcessResult
  │                  │                  │               │
  ▼                  ▼                  ▼               ▼
emit(StageChanged) emit(StageChanged) emit(StageChanged) emit(StageChanged)
                                                        emit(Succeeded)
```

**Pipeline 只负责生成 ProcessResult，不负责剪贴板和通知。** 剪贴板和通知由 Application Layer 在收到 `Succeeded` 事件后执行。

### 3.4 Application Layer

Application Layer 协调 Pipeline 和消费行为：

```
React invoke("process_job", { request })
  │
  ▼
Command: process_job()
  │
  ├── 创建 Job
  ├── 启动 Pipeline
  │     ├── emit(Started)
  │     ├── Stage: Reading → emit(StageChanged)
  │     ├── Stage: Compressing → emit(StageChanged)
  │     ├── Stage: Uploading → emit(StageChanged)
  │     ├── Stage: Generating → emit(StageChanged)
  │     └── emit(Succeeded { result })
  │
  ├── [Application Layer] 根据 UI State 写剪贴板
  ├── [Application Layer] 发送系统通知
  └── return Ok(())
```

### 3.5 Tauri Command 契约

```rust
#[tauri::command]
async fn process_job(
    request: ProcessRequest,
    app: AppHandle,
) -> Result<(), AppError>
```

```rust
pub struct ProcessRequest {
    pub path: String,        // 图片文件路径
    pub output_format: OutputFormat,  // 当前选择的输出格式
}

pub enum OutputFormat {
    Markdown,
    Url,
    Base64,
}
```

**Command 只返回 `Result<(), AppError>`。** 所有业务结果通过 Event 传递。

### 3.6 Tauri Event 契约

Event 命名采用协议风格：

| Event Name | Payload | 时机 |
|---|---|---|
| `pipeline://started` | `{ job_id }` | Job 开始执行 |
| `pipeline://status` | `{ job_id, stage, message }` | Pipeline 阶段变更 |
| `pipeline://completed` | `{ job_id, result }` | Job 成功完成 |
| `pipeline://error` | `{ job_id, error: { stage, kind, message } }` | Job 失败 |

### 3.7 压缩管线

```
┌─────────────────────────────────────────────────┐
│                  输入: Image(PathBuf)             │
└──────────────────────────┬──────────────────────┘
                           │
                    读取文件 + 获取格式
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
           PNG          JPEG         Other
              │            │            │
     Oxipng 无损    image crate     image crate
     优化          重编码 Q85       转 WebP Q85
              │            │            │
              │            │            │
     仍 > 2MB?      ──┐    │    ┌──      │
        ↓ Yes          │    │    │        │
     转 WebP Q85 ──────┼────┴────┴────────┘
                      │
                      ▼
              输出: Vec<u8> (压缩后二进制)
              + width, height, original_size, compressed_size
```

- 配置 `compress: false` 时跳过所有压缩，直接上传原图
- 配置 `webp: false`（Conversion::Keep）时保留原格式，仅做压缩优化
- `quality` 参数仅对有损压缩（JPEG / WebP）生效，PNG 走 Oxipng 无损

### 3.8 文件命名

使用 NanoID（10 字符）替代 UUID，URL 更短更美观：

```
格式: {YYYY}/{MM}/{DD}/{nanoid}.{ext}
示例: 2026/07/07/Aj92KsP91L.webp
```

NanoID 生成在 Rust 侧（`nanoid` crate），Client 生成 key，通过 `PUT /objects/{key}` 传递给 Worker。

---

## 4. Worker 侧架构

### 4.1 目录结构

```
apps/worker/
├── src/
│   ├── routes/
│   │   └── objects.ts      # PUT/DELETE/GET/HEAD /objects
│   ├── middleware/
│   │   └── auth.ts         # API Key 认证中间件
│   ├── utils/
│   │   ├── response.ts     # 统一响应格式
│   │   ├── error.ts        # 统一错误码
│   │   └── r2.ts           # R2 操作封装
│   └── index.ts            # 入口，路由注册
├── wrangler.jsonc          # Cloudflare Worker 配置
├── .dev.vars               # 本地开发环境变量（.gitignore）
└── package.json
```

### 4.2 职责边界

> **Worker 是 Storage Gateway，不是 Image Gateway。**

| 职责 | 状态 |
|---|---|
| 上传对象到 R2 | ✅ |
| 删除 R2 中的对象 | ✅ |
| 列出 R2 中的对象 | ✅ |
| API Key 认证 | ✅ |
| 图片读取 | ❌（R2 自定义域名直接访问） |
| 图片压缩/转换 | ❌（Desktop Rust 负责） |
| 图片缩放/水印 | ❌（永久排除） |
| CDN 缓存 | ❌（Cloudflare CDN 原生能力） |

### 4.3 R2 配置

`wrangler.jsonc` 中配置 R2 Binding：

```jsonc
{
  "r2_buckets": [{
    "binding": "BUCKET",
    "bucket_name": "assets-studio"
  }]
}
```

R2 Bucket 必须绑定自定义域名（如 `images.yourdomain.com`），作为部署必选步骤。Worker 直接使用该域名拼接返回的 URL。

---

## 5. 配置系统

### 5.1 配置文件

路径：
- Windows: `%USERPROFILE%\.assets-studio\config.json`
- macOS: `~/.assets-studio/config.json`

```json
{
  "server": "https://your-worker.workers.dev",
  "apiKey": "your-api-key",
  "defaultPreset": {
    "compression": {
      "enabled": true,
      "quality": 85
    },
    "conversion": "webp"
  },
  "defaultOutput": "markdown"
}
```

| 字段 | 说明 | 默认值 |
|---|---|---|
| `server` | Worker API 地址 | 无（必填） |
| `apiKey` | API Key | 无（必填） |
| `defaultPreset` | 默认处理策略 | compression.enabled=true, quality=85, conversion=webp |
| `defaultOutput` | 默认输出格式: `markdown` / `url` / `base64` | `markdown` |

**注意：** 配置文件不含 `baseUrl`。Worker 直接返回完整 URL，客户端不拼接域名。

### 5.2 配置层级

```
Config (应用配置)        →  启动时读取，决定默认值
  ↓
Preset (处理策略)        →  随 Job 携带，Pipeline 使用
  ↓
UI State (运行时状态)    →  用户切换按钮，决定复制格式
```

Config 只决定默认行为，不参与 Pipeline 执行。Preset 是 Pipeline 的输入，UI State 是 Application Layer 的输入。

---

## 6. Monorepo 结构

```
assets-studio/
├── apps/
│   ├── desktop/              # Tauri 2 客户端
│   │   ├── src/              # React 前端
│   │   ├── src-tauri/        # Rust 后端
│   │   ├── package.json
│   │   └── vite.config.ts
│   └── worker/               # Cloudflare Worker
│       ├── src/
│       ├── wrangler.jsonc
│       └── package.json
├── packages/
│   └── shared/               # 共享类型定义
│       ├── src/
│       │   ├── api.ts        # API 请求/响应类型
│       │   └── event.ts      # Event payload 类型
│       └── package.json
├── docs/
│   ├── PRD.md
│   ├── Architecture.md       # 本文档
│   ├── API.md
│   ├── DECISIONS.md
│   └── plan/
│       └── PLAN.md
├── .github/
│   └── workflows/            # CI/CD（v1.1+）
├── pnpm-workspace.yaml
├── package.json
├── README.md
└── LICENSE
```

`packages/shared` 定义前后端共享的类型（API 请求/响应、Event payload），确保 Rust 侧的 struct 和 TypeScript 侧的 interface 保持同步。v1 手动同步，不引入代码生成工具。

---

## 7. 测试策略

### 7.1 测试接缝

| 接缝 | 工具 | 覆盖范围 |
|---|---|---|
| Worker API | Vitest + Miniflare | 上传/删除/列表/鉴权的外部行为 |
| Rust 图片处理 | `#[cfg(test)]` | 压缩/转换/命名生成 |
| Rust Pipeline | `#[cfg(test)]` | Pipeline 各 Stage 的输入输出 |

不做 React 组件测试。v1 的 UI 就一个拖拽框，没有测试价值。

### 7.2 Worker API 测试

```
测试用例:
- PUT /objects/{key} 正确 Key → 200 + { url, key }
- PUT /objects/{key} 错误 Key → 401
- PUT /objects/{key} 无 Key → 401
- PUT /objects/{key} 空 Body → 400
- DELETE /objects/{key} 正确 Key → 200
- GET /objects 正确 Key → 200 + items[]
```

### 7.3 Rust 测试

```
测试用例:
- PNG → Oxipng 压缩后体积减小
- JPEG → image crate 重编码后体积减小
- 大 PNG → 转 WebP 后体积减小
- compress=false → 输出 == 输入
- naming: {YYYY}/{MM}/{DD}/{nanoid}.webp 格式正确
- Pipeline: mock upload → ProcessResult 字段完整
```

---

## 8. 技术栈汇总

| 层 | 技术 | 版本 |
|---|---|---|
| Desktop 框架 | Tauri | 2.x |
| 前端框架 | React | 18+ |
| 前端构建 | Vite | 5+ |
| 前端语言 | TypeScript | 5+ |
| 后端语言 | Rust | stable |
| 图片压缩 | oxipng + image crate | latest |
| HTTP 客户端 | reqwest | latest |
| ID 生成 | nanoid | latest |
| Worker 运行时 | Cloudflare Workers | latest |
| 对象存储 | Cloudflare R2 | - |
| 包管理 | pnpm | 9+ |
| Monorepo | pnpm workspace | - |
| Worker 测试 | Vitest + Miniflare | latest |
| Rust 测试 | cargo test (内置) | - |
