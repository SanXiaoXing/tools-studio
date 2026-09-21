# RELEASE — Assets Studio

产品发布记录与发版流程。安装包统一托管在：

**https://github.com/SanXiaoXing/tools-studio/releases**

官网下载页：`website/`（下载按钮指向上述 Releases）。

---

## 当前状态

| 项目 | 版本 |
|------|------|
| 升级前基线 | **1.0.1** |
| 本次发布目标 | **1.0.2** |
| Git 标签 | `v1.0.2` |

### 版本号写入位置（升级时必须同步）

| 文件 | 字段 / 位置 |
|------|-------------|
| `package.json` | `"version"` |
| `package-lock.json` | 根节点 `"version"` 与 `packages.""` 的 `"version"` |
| `src-tauri/tauri.conf.json` | `"version"` |
| `src-tauri/Cargo.toml` | `[package] version` |
| `website/index.html` | Hero 文案 `v1.0.2` |

检查命令：

```powershell
Select-String -Path package.json,package-lock.json,src-tauri\tauri.conf.json,src-tauri\Cargo.toml,website\index.html -Pattern '"version"|version = |v1\.0\.'
```

---

## v1.0.2 Release Notes

> Assets Studio v1.0.2 · 桌面图片工作流  
> Windows · macOS · 安装包见 GitHub Releases

### 概述

本版本聚焦**产品发布体验**：上线官网下载页，收敛信息架构与视觉，安装包分发路径固定为 GitHub Releases，方便创作者按平台获取。

### 新增

- **产品下载官网**（`website/`）
  - 信息架构：Hero → 产品图 → 三步流程 → 平台下载 → Footer
  - Hero 单一主 CTA「下载 Assets Studio」；平台选择只在下载区
  - Windows / macOS 下载卡片，指向 GitHub Releases
  - 深色 / 浅色切换（圆形揭示动画，以切换按钮为中心扩散）
  - 页面融合式 Footer：品牌大字双层渐隐（上清晰、下模糊淡出），无卡片边框
  - 移动端 Footer 双列链接，避免整页竖排

### 优化

- 下载入口去重：导航与 Hero 不再重复双平台下载
- 功能与工作流合并为「从图片到链接，只需要三步」
- Footer 收缩为：功能 / 下载 / GitHub / Releases

### 分发说明

| 平台 | 产物 | 构建注意 |
|------|------|----------|
| Windows 10 / 11 x64 | NSIS 安装包（`.exe`） | `src-tauri/tauri.conf.json` 中 `bundle.targets` 含 `nsis` |
| macOS | Apple Silicon / Intel 的 `.dmg` | 需在 `bundle.targets` 增加 `dmg` 后在 mac 上构建 |

建议上传文件名：

```text
Assets_Studio_1.0.2_x64-setup.exe
Assets_Studio_1.0.2_aarch64.dmg
Assets_Studio_1.0.2_x64.dmg
```

暂无 mac 包时，官网 macOS 按钮仍可指向 Releases 列表，不阻塞 Windows 发版。

### 升级方式

- **Windows**：Releases 下载 `1.0.2` 安装包覆盖安装
- **macOS**：下载对应 dmg 替换应用
- 配置路径不变：`%USERPROFILE%\.assets-studio\config.json` / `~/.assets-studio/config.json`（升级前请自行备份）

### 已知事项

- v1 无设置界面，Worker / API Key 仍通过配置文件填写
- 桌面端逻辑仍按 `docs/DECISIONS.md`：图片处理在 Rust，前端只做展示

---

## 发版流程（v1.0.2）

未完成构建与自检前不要打 tag。

### 1. 同步版本号

将上表所有位置从 `1.0.1` 改为 `1.0.2`，然后用检查命令确认无残留。

### 2. 校验与构建

```powershell
# 前端类型检查 + 构建
npm run build

# Rust
cd src-tauri
cargo check
cargo test
cd ..

# 发布包（beforeBuildCommand 会再次 npm run build）
npm run tauri build
```

Windows NSIS 产物通常在：

```text
src-tauri\target\release\bundle\nsis\
```

### 3. 本机冒烟

- [ ] 应用可启动，界面/关于信息显示 `1.0.2`（如有展示）
- [ ] 拖入 PNG / JPG / WebP：压缩 → 上传 → 复制链接链路可用（按当前后端配置）
- [ ] 打开 `website/index.html`：Hero 为 `v1.0.2`
- [ ] 下载按钮指向 `https://github.com/SanXiaoXing/tools-studio/releases...`
- [ ] 深浅色切换正常；Footer 在桌面与手机宽度下链接可点

### 4. Git 提交与标签

```powershell
git add package.json package-lock.json src-tauri/tauri.conf.json src-tauri/Cargo.toml website/ RELEASE.md
git commit -m "chore: release v1.0.2"
git tag -a v1.0.2 -m "Assets Studio v1.0.2"
git push origin main
git push origin v1.0.2
```

> 确认要发布时再 push。若使用 worktree，在主工作区操作。

### 5. 创建 GitHub Release 并上传安装包

1. 打开 https://github.com/SanXiaoXing/tools-studio/releases/new  
2. Tag：`v1.0.2`  
3. Title：`Assets Studio v1.0.2`  
4. Description：粘贴本文「v1.0.2 Release Notes」  
5. 上传第 2 步产物（及可选 mac dmg）  
6. 发布  

或使用 `gh`：

```powershell
gh release create v1.0.2 `
  --title "Assets Studio v1.0.2" `
  --notes-file RELEASE.md `
  "src-tauri\target\release\bundle\nsis\*.exe"
```

### 6. 官网下载直链（可选）

当前 `website/main.js` 使用 `releases/latest`。资产上传后可改为直链：

```js
windows:
  "https://github.com/SanXiaoXing/tools-studio/releases/download/v1.0.2/Assets_Studio_1.0.2_x64-setup.exe",
mac:
  "https://github.com/SanXiaoXing/tools-studio/releases/download/v1.0.2/Assets_Studio_1.0.2_aarch64.dmg",
```

文件名必须与 Release 资产**完全一致**。

### 7. 发布后检查

- [ ] Releases 页可见 `v1.0.2` 与附件  
- [ ] `releases/latest` 指向 v1.0.2  
- [ ] 官网下载按钮可打开/下载对应资产  

---

## 发版清单（复制用）

```text
[ ] 版本号 1.0.1 → 1.0.2（package.json / package-lock.json / tauri.conf.json / Cargo.toml / website）
[ ] npm run build
[ ] cargo check && cargo test（src-tauri）
[ ] npm run tauri build
[ ] 冒烟：应用 + website
[ ] commit + tag v1.0.2 + push
[ ] GitHub Release 上传安装包
[ ] （可选）website/main.js 改为资产直链
[ ] 线上下载验证
```

---

## 历史版本

| 版本 | 说明 |
|------|------|
| 1.0.1 | 基线版本（package.json / tauri.conf 等） |
| 1.0.2 | 官网下载页、主题与 Footer、Releases 分发路径（本次） |

后续版本：在上表追加一行，复制「发版流程」并全局替换版本号后执行。
