# Assets Studio

> 桌面图片工作流工具：拖拽 → 压缩 → 上传 → 复制链接。

Assets Studio 是 SanXiaoXing Studio 的第一个模块，面向内容创作者（个人博客、微信公众号等）的桌面图片工作流工具。它不是传统图床，而是连接「本地图片 → 图片优化 → 云端存储 → Markdown 链接」的完整管线：

```text
拖拽图片 → 二次确认 → Rust 转为 WebP 并压缩 → 上传 Cloudflare Worker → R2 存储
        → 生成访问 URL → 复制链接（URL / Markdown）→ 系统轻提示
```

图片读取由 **R2 自定义域名（CDN）** 直接提供，不经过 Worker；Worker 只做带鉴权的存储网关（上传 / 列表 / 删除 / 统计）。

当前版本：`0.1.0-beta`。

---

## 功能特性

- **拖拽上传**：拖文件进窗口任意位置即弹出全屏拖拽遮罩，松开后进入二次确认；也支持点击选择文件（可多选）
- **自动压缩**：图片在 Rust 侧转为 WebP（`image` + `webp` crate，纯 Rust 无 C 依赖），压缩质量 1–100 可调，并发转换窗口最多 3 张，不卡 UI
- **上传队列**：实时进度（转换 / 上传分阶段显示）、压缩前后体积对比、失败阶段标注（转换失败 / 上传失败）
- **图片库**：启动时从云端分页拉取历史图片（`GET /objects`），网格浏览、点击看详情
- **链接复制**：一键复制纯 URL 或 Markdown 图片语法，成功后按钮变绿 ✓ + 底部轻提示
- **详情弹窗**：预览、格式 / 尺寸 / 大小 / 上传时间 / 存储路径、链接格式切换、两阶段删除（远程对象先删，成功后才移出本地列表）
- **设置页**：Worker 地址与 API Key（一次性锁定字段，存 Rust 侧 `config.json`）、链接域名、路径模板（`{YYYY}/{MM}/{DD}/{YYYYMMDD}-{HHmmss}-{seq}` 等占位符实时预览）、命名方式（自动 / 保留原文件名）、主题（跟随系统 / 深色 / 浅色）、压缩质量滑块、备份导入导出、存储用量统计（`GET /usage` / `POST /usage/rescan`）
- **部署指南**：应用内置 Cloudflare Worker 部署页，纯控制台鼠标操作、零命令行，源码一键复制
- **云端用量**：侧边栏实时显示「已用空间」与进度条（10 GB 套餐额度为前端默认值）

## 架构

```
                用户
                  │
      拖拽 / 选择图片（Tauri 拖拽事件 / 文件对话框）
                  │
                  ▼
      ┌─────────────────────────────┐
      │      Tauri Client (桌面)     │
      │  ┌─────────┐   ┌─────────┐  │
      │  │  前端    │←─→│  Rust   │  │
      │  │ Vanilla │invoke│ 后端   │  │
      │  │   TS    │   │ Services│  │
      │  └─────────┘   └─────────┘  │
      └─────────────────────────────┘
                  │
        Rust：转 WebP / 压缩（CPU 密集任务走 spawn_blocking）
                  │  HTTP（reqwest，X-API-Key 鉴权）
                  ▼
      ┌─────────────────────────────┐
      │    Cloudflare Worker        │  仅存储网关，不做图片处理
      │   (Storage Gateway)         │
      └─────────────────────────────┘
                  │  R2 Binding（IMAGES）
                  ▼
              Cloudflare R2
                  │
                  ▼
        R2 自定义域名（CDN 公开读取）
                  │
                  ▼
        复制链接（URL / Markdown）到剪贴板
```

**核心设计原则**（详见 [docs/DECISIONS.md](docs/DECISIONS.md)）：

- 业务逻辑在 Rust（commands → services），前端只做展示，无图片字节 / HTTP / Base64
- Worker 是 **Storage Gateway 而非 Image Gateway**：只负责上传、删除、列表、统计与鉴权；压缩、格式拼接、Base64 都在客户端完成
- **双域名分离**：API 域名（Worker，需 `X-API-Key`）与图片域名（R2 自定义域，公开读取）分离——别人能看图，但不能借用你的 Worker 上传

### 数据流（一次完整上传）

```text
前端拖拽/选择 → 二次确认弹窗（可移除文件）→ 入队
  → invoke("convert_to_webp", { input, quality })      # Rust 转 WebP 到系统临时目录
  → 按路径模板生成 R2 key（naming.ts buildPath）
  → invoke("upload_image", { key, contentType, filePath })
  → PUT /objects/{key}（X-API-Key）→ Worker 校验类型/大小 → R2 写入
  → 返回 { key, url } → 加入图片库 → 复制链接 → 刷新云端用量
```

### 目录结构

```text
assets-studio/
├── src/                          # 前端（Vanilla TypeScript + Tailwind CSS 4）
│   ├── main.ts                   # 应用入口：视图切换、全局拖拽遮罩、启动时恢复图片库
│   ├── app/
│   │   └── sidebar.ts            # 侧边栏：品牌、上传 CTA、导航、已用空间、折叠
│   ├── features/
│   │   ├── gallery/              # 图片库：网格卡片 + 详情弹窗（两阶段删除）
│   │   ├── upload/               # 上传：拖拽/选择、二次确认、并发队列与进度
│   │   ├── settings/             # 设置页：一次性锁定字段、路径模板、滑块、备份、用量
│   │   └── deploy/               # 部署 Worker 指南（源码 ?raw 引入，单一事实源）
│   ├── lib/
│   │   ├── store.ts              # 应用状态单例（items / cloudUsage / 订阅重绘）
│   │   ├── settings.ts           # 前端设置（localStorage "as-settings"）
│   │   ├── naming.ts             # 路径模板占位符填充、文件名清洗
│   │   ├── types.ts / utils.ts / icons.ts
│   │   ├── theme.ts              # 主题（data-theme 驱动 CSS 变量，跟随系统）
│   │   └── seg.ts                # 弹簧动画分段选择器（主题 / 命名方式共用）
│   └── styles.css                # Tailwind 4 入口 + 主题 CSS 变量
├── src-tauri/                    # Rust 后端（Tauri 2）
│   └── src/
│       ├── commands/mod.rs       # 9 个 Tauri 命令（见下）
│       ├── config/mod.rs         # config.json（server / apiKey），ConfigState 内存缓存
│       ├── services/
│       │   ├── compress.rs       # WebP 转换（image + webp crate，含单元测试）
│       │   ├── http.rs           # 共享 reqwest 客户端 + X-API-Key 请求封装
│       │   ├── upload.rs         # PUT /objects/{key}
│       │   ├── list.rs           # GET /objects（分页）
│       │   ├── delete.rs         # DELETE /objects/{key}（404 视为幂等删除）
│       │   └── usage.rs          # GET /usage / POST /usage/rescan
│       └── error.rs              # AppError 统一错误类型
├── apps/worker/                  # Cloudflare Worker（单文件纯 JS）
│   └── src/index.js              # Storage Gateway v2，部署页源码与其保持同一份
├── docs/                         # 中文设计文档（PRD / 架构 / API / ADR / 设计稿）
├── assets/                       # 品牌图标
├── index.html
├── package.json
├── vite.config.ts                # 固定端口 1420（strictPort）
└── tsconfig.json                 # strict / noUnusedLocals / noUnusedParameters
```

### Tauri 命令（Rust ⇄ 前端）

| 命令 | 说明 |
|---|---|
| `get_config` / `set_config` | 读取 / 保存 Worker 连接配置（server / apiKey，存 Rust 侧 `config.json`） |
| `convert_to_webp` | 本地图片转 WebP（quality 1–100，返回输入/输出大小与输出路径） |
| `upload_image` | 上传本地文件到 Worker → R2，返回 `{ key, url }` |
| `list_images` | 分页拉取云端图片列表（limit / cursor），启动时恢复图片库 |
| `delete_image` | 删除 R2 对象（对象不存在视为已删除） |
| `sync_usage` | 拉取存储统计（`rescan=false` 走 GET /usage，`true` 走 POST /usage/rescan 全量校准） |
| `export_settings` / `import_settings` | 设置备份导出 / 导入（读写用户选择的文件） |

### Worker API（[docs/API.md](docs/API.md)）

| 方法 | 路径 | 说明 |
|---|---|---|
| `PUT` | `/objects/{key}` | 上传对象（校验 Content-Type 白名单、扩展名一致性、大小上限） |
| `GET` | `/objects?limit&cursor` | 分页列出图片对象（排除 `_meta/` 元对象与目录占位） |
| `DELETE` | `/objects/{key}` | 删除对象 |
| `HEAD` | `/objects/{key}` | 检查对象是否存在 |
| `GET` | `/usage` | 读取维护的存储统计（未初始化时自动全量校准） |
| `POST` | `/usage/rescan` | 全量重算统计并写回 `_meta/usage.json` |

所有请求需携带 `X-API-Key`（或 `Authorization: Bearer`），恒定时间比较防时序攻击。统计元对象用 etag CAS 增量维护，并发冲突自动重试，失败可靠 `rescan` 校准。

## 技术栈

| 层 | 技术 |
|---|---|
| 桌面框架 | Tauri 2 |
| 前端 | Vanilla TypeScript + Vite 6 + Tailwind CSS 4 |
| 后端 | Rust（`image`、`webp`、`reqwest`、`serde`） |
| 存储 | Cloudflare Worker + R2（单文件纯 JS） |
| 插件 | dialog（文件选择）、window-state（窗口记忆）、opener |

## 快速开始

环境要求：Node.js 18+、Rust stable、Tauri 2 平台依赖（详见 [Tauri 官方文档](https://v2.tauri.app/start/prerequisites/)）。

```bash
npm install          # 安装依赖
npm run tauri dev    # 开发模式（Vite 固定端口 1420，strictPort，端口被占用会失败）
```

常用命令：

```bash
npm run build        # 前端类型检查 + 构建（tsc && vite build）
npm run tauri build  # 打包发布安装包（Windows 为 NSIS 安装程序）
cargo check          # Rust 侧检查（在 src-tauri/ 下）
cargo test           # Rust 侧测试（在 src-tauri/ 下）
```

> 注意：`src-tauri/src/lib.rs` 的库名带 `_lib` 后缀（`assets_studio_lib`），这是 Windows 下避免与 bin 名冲突所必需的，不要改。

## 部署 Worker

应用「设置 → 部署 Worker」页内置完整图文步骤，全程在 Cloudflare 控制台用鼠标完成，无需命令行：

1. 创建 R2 存储桶，并添加**自定义域名**（图片域名，如 `img.example.com`）用于公开读取
2. `dash.cloudflare.com` → Workers & Pages → 创建 Worker → 粘贴内置源码（与 `apps/worker/src/index.js` 一致）
3. 添加环境变量（见下），并把 R2 存储桶绑定到 `IMAGES`

| 变量 | 必填 | 说明 |
|---|---|---|
| `API_KEY` | 是 | 共享密钥，类型选「机密」，与客户端设置页的 API Key 一致（可在设置页点「生成随机」） |
| `PUBLIC_BASE_URL` | 是 | **图片域名**（R2 自定义域，如 `https://img.example.com`，结尾无斜杠），不是 API 域名 |
| `ALLOWED_TYPES` | 否 | Content-Type 白名单，默认 `image/png,image/jpeg,image/webp,image/gif,image/avif` |
| `MAX_SIZE_MB` | 否 | 单文件上限（MB），默认 20 |

部署完成后，在应用「设置」页填写 Worker 地址（API 域名）与 API Key 即可使用。

## 配置

- **Worker 连接信息**（`server` / `apiKey`）：存 Rust 侧配置文件，前端不落盘
  - Windows：`%USERPROFILE%\.assets-studio\config.json`
  - macOS：`~/.assets-studio/config.json`
- **展示类设置**（域名、路径模板、命名方式、复制格式、压缩质量、主题）：存前端 `localStorage("as-settings")`
- 可在设置页「备份与恢复」一键导出 / 导入全部设置（含连接信息）

## 文档

`docs/` 下为中文设计文档，是产品的需求与契约来源：

- [PRD.md](docs/PRD.md) — 产品需求文档
- [Architecture.md](docs/Architecture.md) — 技术架构
- [API.md](docs/API.md) — Worker API 契约
- [DECISIONS.md](docs/DECISIONS.md) — 架构决策记录（ADR）
- [design/](docs/design/) — 交互设计稿与组件规范（含 `slider.md`、`WORKER-V2.md` 等）

> 提示：`docs/` 描述的是目标形态（React 前端 + pnpm monorepo）。当前代码为 **Vanilla TypeScript 单仓结构**（前端在仓库根目录），实现以代码为准，文档作为需求与设计意图的参考。

## 路线图

- **v1.0（进行中）**：拖拽上传、Rust 压缩转 WebP、复制 URL / Markdown 链接、系统轻提示、API Key 认证、Worker + R2 存储
- **v1.1**：图片列表、删除图片、上传历史、文件选择上传、拖拽至 Dock / 任务栏
- **v1.2**：剪贴板监听上传、热键截屏上传、系统托盘、批量上传、模板化自动重命名
- **v2.0**：OCR、AI 图片描述与自动命名

## License

Copyright (c) 2026 SanXiaoXing. All rights reserved.
