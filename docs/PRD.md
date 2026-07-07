# PRD: Assets Studio

> **状态**: ready-for-agent
> **项目**: Assets Studio（SanXiaoXing Studio 第一个模块）
> **技术栈**: Tauri 2 + React + TypeScript + Cloudflare Worker + R2
> **版本**: 1.0

---

## 产品定位

Assets Studio 是一款面向内容创作者的桌面图片工作流工具。

它不是传统图床，而是连接「本地图片 → 图片优化 → 云端存储 → Markdown / 微信公众号」的完整工作流。

它充分利用 Tauri 的桌面能力（拖拽、Dock 上传、剪贴板、系统通知等）以及 Cloudflare R2 的低成本对象存储，为个人博客和微信公众号创作者提供最快速的图片管理体验。

## 为什么选择 Tauri

浏览器无法实现以下能力，而 Electron 体积过大（100MB+）：

- 拖到 Dock / 任务栏图标上传
- 系统通知
- 剪贴板监听
- Finder / Explorer 拖放
- Rust 图片压缩（原生性能）
- 全局快捷键
- 截图自动上传

因此采用：**Rust + Tauri 2 + React**。安装包 < 15MB，启动 < 1s。

## 架构

```
                用户
                  │
        拖图片 / Ctrl+V
                  │
                  ▼
        ┌──────────────┐
        │  Tauri Client │  (Rust + React)
        └──────────────┘
                  │
      Rust 压缩 / WebP 转换
                  │
                  ▼
        Cloudflare Worker
                  │
                  ▼
                 R2
                  │
                  ▼
           返回图片 URL
                  │
                  ▼
     Markdown / HTML / Base64
                  │
                  ▼
        复制到剪贴板 + 系统通知
```

## Solution

这不是一个图床，是一个**图片工作流工具**。上传只是能力，完整流程才是产品：

```
图片 → 拖进窗口 → Rust 压缩/转 WebP → 上传 Worker → R2 → 复制 Markdown → 通知 → 结束
```

v1 只做这条主线，砍掉一切非核心功能。不做历史记录、不做托盘、不做设置界面、不做 Template Repository。配置写死在配置文件里，首次手动填写。

## User Stories

1. 作为内容创作者，我想要拖拽图片到应用窗口，这样图片自动压缩并上传，我不需要任何额外操作
2. 作为内容创作者，我想要上传完成后自动复制 Markdown 格式链接到剪贴板，这样我可以直接粘贴到文档中
3. 作为内容创作者，我想要选择复制格式（Markdown / URL / Base64），这样我可以适配博客和公众号不同场景
4. 作为内容创作者，我想要图片在上传前自动压缩并转为 WebP，这样节省存储和加载时间
5. 作为内容创作者，我想要上传成功后看到系统通知，这样我知道流程完成了
6. 作为内容创作者，我想要上传失败时看到明确的错误信息，这样我可以排查问题
7. 作为用户，我想要通过编辑配置文件设置 Worker 地址、API Key、域名和压缩参数，这样我可以连接自己的后端
8. 作为 Windows 用户，我想要应用在 Windows 上正常运行
9. 作为用户，我想要应用体积小、启动快，这样它不会成为系统负担

## 功能优先级 (MoSCoW)

### Must (v1 必须完成)

- 图片拖拽上传
- Rust 图片压缩（Oxipng / image crate / WebP，纯 Rust 无 C 依赖）
- 复制 Markdown 链接到剪贴板
- 复制纯 URL 到剪贴板
- 复制 Base64 到剪贴板（公众号场景）
- 系统通知
- API Key 认证
- Cloudflare Worker + R2 存储

### Should (v1.1)

- 图片列表查看
- 删除图片
- 上传历史记录
- 文件选择上传（不只是拖拽）
- 拖拽至 Dock / 任务栏图标

### Could (v1.2)

- 剪贴板自动监听上传
- 热键截屏上传
- 系统托盘 / 菜单栏常驻
- 批量上传
- 自动重命名（模板化命名策略）

### Won't (v1 不做)

- AI 图片描述
- OCR 文字识别
- 多用户体系
- 数据库
- 图片编辑（裁剪/标注/水印）
- Web 管理界面
- 移动端

## Implementation Decisions

### 核心工作流

整个产品就是一条管线，Pipeline 只负责生成结果，消费行为（剪贴板/通知）由 Application Layer 负责：

```
拖拽接收 → Rust Pipeline (压缩 → 上传 → 生成全部格式) → Application Layer (剪贴板 + 通知)
```

详见 [Architecture.md](./Architecture.md) 和 [DECISIONS.md](./DECISIONS.md)。

### 项目结构

Monorepo（pnpm workspace），v1 只建最小结构：

- `apps/desktop` - Tauri 2 客户端（React + Vite + Rust）
- `apps/worker` - Cloudflare Worker（单文件即可）
- `packages/shared` - 共享类型（上传请求/响应的 type 定义）

不提前建多余的目录。后续模块需要时再加。

### Worker 职责边界

> **Worker 是 Storage Gateway，不是 Image Gateway。** 详见 [DECISIONS.md](./DECISIONS.md) Decision-007。

Worker 负责：
- 上传对象到 R2（`PUT /objects/{key}`）
- 删除 R2 中的对象（`DELETE /objects/{key}`）
- 列出 R2 中的对象（`GET /objects`）
- API Key 认证

Worker 不负责：
- ❌ 图片读取（R2 自定义域名直接访问）
- ❌ Base64 编码（客户端的事）
- ❌ Markdown 拼接（客户端的事）
- ❌ 图片压缩/转换/缩放/水印（客户端 Rust 的事）

### API 契约

REST 语义，详见 [API.md](./API.md)：

```
PUT /objects/{key}      — 上传对象（v1）
GET /objects            — 列出对象（v1.1）
DELETE /objects/{key}   — 删除对象（v1.1）
HEAD /objects/{key}     — 检查存在（v1.1）
```

成功响应：
```json
{ "key": "2026/07/07/Aj92KsP91L.webp", "url": "https://images.yourdomain.com/..." }
```

错误响应：
```json
{ "code": "UNAUTHORIZED", "message": "..." }
```

v1 只实现 `PUT /objects/{key}`。其余端点在 v1.1 实现。

### 认证

- Worker 端 `API_KEY` 环境变量（Cloudflare Worker Secrets 管理）
- 客户端请求头 `X-API-Key` 携带
- 不匹配返回 401

### 压缩管线 (Compression Pipeline)

不同格式走不同管线，在 Rust 侧完成：

**PNG:**
```
PNG → Oxipng 无损压缩 → 仍大于 2MB? → 转 WebP (quality 85) → 上传
```

**JPEG:**
```
JPEG → image crate 重编码 (quality 85) → 上传
```

**其他格式 (GIF/BMP 等):**
```
原图 → 转 WebP (quality 85) → 上传
```

- 压缩使用纯 Rust crate：`oxipng` + `image`（无 C 依赖，详见 [DECISIONS.md](./DECISIONS.md) Decision-001）
- 质量参数默认 85，可在配置文件中调整
- 可在配置中关闭压缩（`compression.enabled: false`），上传原图
- 可在配置中关闭 WebP 转换（`conversion: "keep"`），保留原格式

### 文件命名

- v1 格式：`{YYYY}/{MM}/{DD}/{nanoid}.{ext}`
- 例如：`2026/07/07/Aj92KsP91L.webp`
- 使用 NanoID（10 字符）替代 UUID，URL 更短更美观
- 不做 prefix 配置，v1 写死。需要分类的人自己改代码
- v1.2 引入自动重命名模板，支持 `{yyyy}/{MM}/{dd}/{nanoid}.webp` 等自定义格式

### 配置文件（无 UI）

v1 不做设置界面。配置文件路径：
- Windows: `%USERPROFILE%\.assets-studio\config.json`
- macOS: `~/.assets-studio/config.json`

```json
{
  "server": "https://your-worker.workers.dev",
  "apiKey": "your-api-key",
  "defaultPreset": {
    "compression": { "enabled": true, "quality": 85 },
    "conversion": "webp"
  },
  "defaultOutput": "markdown"
}
```

| 字段 | 说明 | 默认值 |
|------|------|--------|
| `server` | Worker API 地址 | 无（必填） |
| `apiKey` | API Key | 无（必填） |
| `defaultPreset` | 默认处理策略（压缩 + 转换） | enabled=true, quality=85, conversion=webp |
| `defaultOutput` | 默认输出格式: `markdown` / `url` / `base64` | `markdown` |

首次使用手动创建。Worker 直接返回完整 URL，客户端不需要拼接域名（不含 `baseUrl` 字段）。

配置层级详见 [Architecture.md](./Architecture.md) §5。

### 为什么不使用数据库

v1 仅服务于个人创作者。图片数量预计 1000~5000 张，Cloudflare R2 List API 完全够用。

不引入 D1。后续如需标签、全文搜索、引用关系等能力，再增加数据库。

### 剪贴板与通知

- Pipeline 一次性生成全部格式（markdown / html / base64），详见 [DECISIONS.md](./DECISIONS.md) Decision-004/006
- Application Layer 根据 UI State（用户当前选择的格式）写入剪贴板：
  - `markdown`: `![image](https://images.yourdomain.com/2026/07/07/Aj92KsP91L.webp)`
  - `url`: `https://images.yourdomain.com/2026/07/07/Aj92KsP91L.webp`
  - `base64`: `data:image/webp;base64,...`
- 同时弹系统通知："已复制到剪贴板"
- 使用 Tauri 2 内置的 clipboard 和 notification 插件

### 客户端 UI（极简）

一个窗口，一个拖拽区域，一个状态文本，一个格式切换按钮。没有侧边栏、没有 Tab、没有历史列表。

```
┌──────────────────────────────┐
│                              │
│      拖拽图片到此处           │
│                              │
│      [状态文本/进度]          │
│                              │
│   [Markdown] [URL] [Base64]  │
│                              │
└──────────────────────────────┘
```

### Secrets 管理策略

- **代码仓库（公开）**：Worker 名称、Bucket 名称、R2 Binding 配置
- **GitHub Secrets**：`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`
- **Cloudflare Worker Secrets**：`API_KEY`（运行时认证密钥）
- **本地开发**：`.dev.vars` 文件（已加入 `.gitignore`）

## Testing Decisions

### 测试原则

- 只测试外部行为，不测试实现细节
- v1 只在两个接缝测试：Worker API + Rust 图片处理

### 测试接缝

1. **Worker API 测试**
   - Vitest + Miniflare（Cloudflare 官方本地模拟环境）
   - 测试：正确 Key 上传成功返回 `{ url, key, size }`、错误 Key 返回 401、无 Key 返回 401
   - 验证 R2 写入和返回的 URL 格式

2. **Rust 图片处理测试**
   - `#[cfg(test)]` 单元测试
   - 测试：PNG → Oxipng 压缩后体积减小
   - 测试：JPEG → MozJPEG 重编码后体积减小
   - 测试：大 PNG → 转 WebP 后体积减小
   - 测试：文件名生成格式 `{YYYY}/{MM}/{DD}/{uuid}.{ext}` 正确

不做 React 组件测试。v1 的 UI 就一个拖拽框，没有测试价值。

### 测试先行策略

- Worker API 契约（上方已定义）作为前后端契约的单一来源
- `packages/shared` 中的类型定义与 API 契约保持同步
- 前端开发时 mock Worker API，后端独立测试

## Roadmap

### v1.0 - 核心管线

- [x] 拖拽上传
- Rust 压缩（Oxipng / image crate / WebP，纯 Rust 无 C 依赖）
- [x] 复制 Markdown 链接
- [x] 复制纯 URL
- [x] 复制 Base64（公众号场景）
- [x] 系统通知
- [x] API Key 认证
- [x] Cloudflare Worker + R2

### v1.1 - 可用性增强

- [ ] 图片列表查看
- [ ] 删除图片
- [ ] 上传历史记录
- [ ] 文件选择上传
- [ ] 拖拽至 Dock / 任务栏图标

### v1.2 - 系统集成

- [ ] 剪贴板自动监听上传
- [ ] 热键截屏上传
- [ ] 系统托盘 / 菜单栏常驻
- [ ] 批量上传
- [ ] 自动重命名（模板化命名：`{yyyy}/{MM}/{dd}/{nanoid}.webp`、`{yyyy}/{MM}/{dd}/{original}.webp` 等）

### v2.0 - 智能化

- [ ] OCR 文字识别
- [ ] AI 图片描述（Alt 文本自动生成）
- [ ] AI 自动命名

### 永久排除

- 多存储后端（只做 R2）
- 多用户体系
- 图片编辑（裁剪/标注/水印）
- Web 管理界面
- 移动端

## Out of Scope (v1)

以下功能明确不在 v1 范围内，详见 Roadmap 中的版本规划。

## Further Notes

### 产品定位

这个工具的核心价值不是"存储图片"，而是**把图片变成 Markdown 链接的最短路径**。存储是 R2 的事，工具只负责管线。如果用户需要管理已上传的图片，那是 R2 Dashboard 的工作，不是这个工具的事。

### 与 SanXiaoXing Studio 的关系

Assets Studio 是 SanXiaoXing Studio 平台的第一个模块。Monorepo 结构为后续模块预留空间，但 v1 不为未来做任何提前抽象。`packages/shared` 只放当前用到的类型，不预测未来需求。

### 开源发布清单（v1.1+）

以下在 v1.1 完成后推进：
- [ ] GitHub Actions 自动部署 Worker
- [ ] Template Repository + 初始化脚本
- [ ] README 部署指南
- [ ] LICENSE 文件（MIT）
- [ ] 配置导入导出

### Nuitka 打包说明

如需 Python 辅助工具打包（非 Tauri 客户端本身），使用 Nuitka 单文件输出：
```
--windows-company-name="SanXiaoXing" --windows-product-name="Assets Studio" --file-description="桌面图片工作流工具" --copyright="Copyright (c) 2026 SanXiaoXing. All rights reserved."
```
