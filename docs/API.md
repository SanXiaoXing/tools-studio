# Assets Studio — API 契约文档

> 本文档定义 Worker (Storage Gateway) 的 REST API 契约。
> 架构原则：Worker 只负责对象存储，不负责对象消费。详见 [DECISIONS.md](./DECISIONS.md) Decision-007。

---

## 1. 概述

**Base URL:** `https://your-worker.workers.dev`

**认证方式:** 所有请求必须携带 `X-API-Key` 请求头。Worker 从环境变量 `API_KEY` 读取预期值进行比对。

**内容分发:** 图片不通过 Worker 读取。R2 Bucket 绑定自定义域名后，图片通过 `https://images.yourdomain.com/{key}` 直接访问。

---

## 2. 端点总览

| Method | Path | 认证 | 说明 | 版本 |
|---|---|---|---|---|
| `PUT` | `/objects/{key}` | ✅ | 上传对象到 R2 | v1 |
| `GET` | `/objects` | ✅ | 列出 R2 中的对象 | v1.1 |
| `DELETE` | `/objects/{key}` | ✅ | 删除 R2 中的对象 | v1.1 |
| `HEAD` | `/objects/{key}` | ✅ | 检查对象是否存在 | v1.1 |

---

## 3. 上传对象

### `PUT /objects/{key}`

将图片二进制数据上传到 R2。Key 由客户端生成（NanoID + 日期路径）。

**请求：**

```
PUT /objects/2026/07/07/Aj92KsP91L.webp HTTP/1.1
Host: your-worker.workers.dev
X-API-Key: your-api-key
Content-Type: image/webp
Content-Length: 51200

<binary data>
```

| Header | 必填 | 说明 |
|---|---|---|
| `X-API-Key` | ✅ | API Key，用于认证 |
| `Content-Type` | ✅ | 图片 MIME 类型（`image/webp`、`image/png`、`image/jpeg` 等） |
| `Content-Length` | ✅ | 文件大小（字节） |

**Path 参数：**

| 参数 | 说明 | 示例 |
|---|---|---|
| `key` | R2 存储路径，由客户端生成 | `2026/07/07/Aj92KsP91L.webp` |

**Body：** raw binary（图片文件二进制数据）

**成功响应 `200 OK`：**

```json
{
  "key": "2026/07/07/Aj92KsP91L.webp",
  "url": "https://images.yourdomain.com/2026/07/07/Aj92KsP91L.webp"
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `key` | string | R2 存储路径 |
| `url` | string | 完整访问 URL（R2 自定义域名 + key） |

**错误响应：**

| Status | Code | 说明 |
|---|---|---|
| 401 | `UNAUTHORIZED` | API Key 缺失或不匹配 |
| 400 | `INVALID_KEY` | key 格式无效（空、含非法字符） |
| 400 | `EMPTY_BODY` | 请求体为空 |
| 413 | `TOO_LARGE` | 文件超过大小限制（100MB） |
| 500 | `INTERNAL` | R2 写入失败 |

---

## 4. 列出对象

### `GET /objects`

列出 R2 中已上传的对象。v1.1 实现。

**请求：**

```
GET /objects?cursor=xxx&limit=100 HTTP/1.1
Host: your-worker.workers.dev
X-API-Key: your-api-key
```

**Query 参数：**

| 参数 | 必填 | 默认 | 说明 |
|---|---|---|---|
| `limit` | ❌ | 100 | 每页数量（最大 1000） |
| `cursor` | ❌ | - | 分页游标（上次返回的 `cursor`） |

**成功响应 `200 OK`：**

```json
{
  "items": [
    {
      "key": "2026/07/07/Aj92KsP91L.webp",
      "url": "https://images.yourdomain.com/2026/07/07/Aj92KsP91L.webp",
      "size": 51200,
      "uploaded": "2026-07-07T08:00:00Z"
    }
  ],
  "cursor": "xxx",
  "has_more": false
}
```

---

## 5. 删除对象

### `DELETE /objects/{key}`

从 R2 中删除指定对象。v1.1 实现。

**请求：**

```
DELETE /objects/2026/07/07/Aj92KsP91L.webp HTTP/1.1
Host: your-worker.workers.dev
X-API-Key: your-api-key
```

**成功响应 `200 OK`：**

```json
{
  "key": "2026/07/07/Aj92KsP91L.webp"
}
```

**错误响应：**

| Status | Code | 说明 |
|---|---|---|
| 401 | `UNAUTHORIZED` | API Key 缺失或不匹配 |
| 404 | `NOT_FOUND` | 对象不存在 |

---

## 6. 检查对象是否存在

### `HEAD /objects/{key}`

检查对象是否存在于 R2 中。v1.1 实现。

**请求：**

```
HEAD /objects/2026/07/07/Aj92KsP91L.webp HTTP/1.1
Host: your-worker.workers.dev
X-API-Key: your-api-key
```

**成功响应 `200 OK`：** 无 Body，通过状态码判断。

**错误响应：**

| Status | Code | 说明 |
|---|---|---|
| 401 | `UNAUTHORIZED` | API Key 缺失或不匹配 |
| 404 | `NOT_FOUND` | 对象不存在 |

---

## 7. 统一错误格式

所有错误响应使用统一的 JSON 格式：

```json
{
  "code": "UNAUTHORIZED",
  "message": "API key is missing or invalid"
}
```

**错误码列表：**

| Code | HTTP Status | 说明 |
|---|---|---|
| `UNAUTHORIZED` | 401 | API Key 缺失或不匹配 |
| `INVALID_KEY` | 400 | key 格式无效 |
| `EMPTY_BODY` | 400 | 请求体为空 |
| `TOO_LARGE` | 413 | 文件超过大小限制 |
| `NOT_FOUND` | 404 | 对象不存在 |
| `INTERNAL` | 500 | 内部错误 |

---

## 8. Key 命名规范

Key 由客户端（Rust 侧）生成，格式：

```
{YYYY}/{MM}/{DD}/{nanoid}.{ext}
```

| 部分 | 说明 | 示例 |
|---|---|---|
| `{YYYY}` | 四位数年份 | `2026` |
| `{MM}` | 两位数月份 | `07` |
| `{DD}` | 两位数日期 | `07` |
| `{nanoid}` | 10 字符 NanoID | `Aj92KsP91L` |
| `{ext}` | 文件扩展名 | `webp` |

**完整示例：** `2026/07/07/Aj92KsP91L.webp`

**Key 限制：**
- 长度：1-1024 字符
- 允许字符：字母、数字、`/`、`-`、`_`、`.`
- 不允许以 `/` 开头

---

## 9. 文件大小限制

| 限制 | 值 | 说明 |
|---|---|---|
| 最大文件大小 | 100MB | Worker 请求体限制 |
| 超限响应 | 413 `TOO_LARGE` | |

R2 本身支持最大 5TB 单对象，100MB 是 Worker 层面的保护性限制。图片场景远小于此。

---

## 10. CORS 配置

Worker 需配置 CORS 头，允许 Desktop 客户端直接请求（如果未来有 Web 客户端）：

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, PUT, DELETE, HEAD, OPTIONS
Access-Control-Allow-Headers: X-API-Key, Content-Type
Access-Control-Max-Age: 86400
```

`OPTIONS` 请求直接返回 204，不经过认证中间件。

---

## 11. TypeScript 共享类型

`packages/shared/src/api.ts` 中定义与 Worker 响应对应的 TypeScript 类型：

```typescript
// 上传响应
export interface UploadResponse {
  key: string;
  url: string;
}

// 列表响应
export interface ListResponse {
  items: ObjectItem[];
  cursor: string | null;
  has_more: boolean;
}

export interface ObjectItem {
  key: string;
  url: string;
  size: number;
  uploaded: string;
}

// 错误响应
export interface ErrorResponse {
  code: string;
  message: string;
}

// 错误码
export type ErrorCode =
  | 'UNAUTHORIZED'
  | 'INVALID_KEY'
  | 'EMPTY_BODY'
  | 'TOO_LARGE'
  | 'NOT_FOUND'
  | 'INTERNAL';
```

Rust 侧通过 `serde` 序列化/反序列化，类型结构与此对应。v1 手动同步，不引入代码生成工具。
