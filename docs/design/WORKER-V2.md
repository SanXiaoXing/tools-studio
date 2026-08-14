# Worker v2 优化方案（Storage Gateway）

> 状态：已定稿（2026-08-13）
> 范围：Cloudflare Worker 安全加固 + 契约对齐 + 密钥收敛到 Rust 侧 + 存储使用量统计
> 契约依据：`docs/API.md`、`docs/DECISIONS.md`（D-002 / D-007）
> 旧版参考：`docs/assets/worker.md`（编译产物，仅存档，勿编辑）

---

## 1. 背景与问题

旧版 Worker（`docs/assets/worker.md` 对应的部署版）存在四类问题：

| 维度 | 旧版现状 | 风险 |
|---|---|---|
| 鉴权 | `/upload` 完全公开，无任何鉴权 | 任何人可上传，刷爆 R2 / 浪费配额 |
| 文件类型 | 任意扩展名、任意 Content-Type | `.exe` / `.zip` / `.mp4` 可进入 R2 |
| 大小限制 | 无 | 可被塞入巨型文件 |
| 契约 | `POST /upload`（旧），客户端是 `PUT /objects/{key}`（API.md） | **契约不一致**，App 实际上传会 404 |
| 密钥存放 | `apiKey` 存前端 localStorage（`src/lib/settings.ts`） | 敏感信息进前端，违反 D-002「业务逻辑在 Rust」 |
| 存储统计 | 无 usage 概念 | 客户端只能靠累计列表估算，无法反映 Bucket 真实用量 |

---

## 2. 核心决策

1. **契约对齐 API.md**：Worker 实现 `PUT / GET / HEAD / DELETE /objects/{key}` + `X-API-Key`。客户端请求形状零改动（`src-tauri/src/services/upload.rs` 已是该协议）。
2. **鉴权兼容两种头**：接受 `X-API-Key: xxx`（客户端现状）或 `Authorization: Bearer xxx`（通用习惯），统一做恒定时间比较。
3. **密钥放 Rust 侧**：`upload_image` 命令内部 `config::load()` 读 `%USERPROFILE%\.assets-studio\config.json`，前端不再传 / 存 `apiKey`。
4. **不做公开服务级防御**：个人自用场景下 Token + 白名单 + 大小限制足够；Rate Limit / WAF 等 Worker 公开化后再加（防过度设计，D-007 职责边界同理）。
5. **存储统计用「维护计数 + 定期校准」**：不每次查询都全量 list（图片多时会越来越慢）。上传/删除时对 R2 元对象 `_meta/usage.json` 做增量维护，提供 `POST /usage/rescan` 全量重算作为校准入口；增量写入用 etag 乐观锁（CAS）防并发丢更新。
6. **端点形态保持既有契约**：对话建议的 `POST /upload`、`GET /images`、`DELETE /image/:key` 是通用 REST 形态，与项目已定契约（API.md / 客户端 `upload.rs`）不一致。本方案保留 `PUT /objects/{key}` / `GET /objects` / `DELETE /objects/{key}`，只新增 `GET /usage` 与 `POST /usage/rescan`，能力等价且不重写客户端。
7. **API Key 格式约定（产品级命名）**：Key 体现产品身份而非个人身份，前缀固定为 `as_live_`（`as` = Assets Studio 产品标识，`live` = 环境）。随机段用 Crockford Base32（去易混淆字符 I/L/O/U，每字符 5 位熵），4 段 × 4 字符 ≈ 80 位熵，短小易读。未来可自然扩展 `as_test_` / `as_dev_` 环境前缀；权限不编码进 Key，由服务端保存 Key 元数据（scopes）管理。客户端生成实现见 `src/lib/utils.ts` 的 `generateApiKey()`，Worker 端只做恒定时间比对，不关心 Key 具体格式。

---

## 3. 架构

```text
Assets Studio (Tauri)
      │
      ▼
Rust commands/upload_image ── config::load() 取 server/api_key
      │
      │ PUT /objects/{key}
      │ X-API-Key: Bearer 值
      ▼
Cloudflare Worker（Storage Gateway v2）
      │  校验 Token → 校验 key → 校验类型/大小 → R2.put → 统计 +1
      │  DELETE → 统计 -1；GET /usage → 读统计；POST /usage/rescan → 全量校准
      ▼
R2 Bucket
  ├── blog/2026/08/13/xxx.webp   ← 用户图片（自定义域名分发）
  └── _meta/usage.json           ← 统计元对象（维护计数，不参与图片列表）
```

## 4. 请求处理流水线

```text
fetch()
 ├── OPTIONS → 204（CORS 预检，不鉴权）
 ├── 鉴权：X-API-Key 或 Bearer，SHA-256 恒定时间比较 → 401
 ├── /usage/rescan → POST 全量扫描重算 → 写回统计
 ├── /usage         → GET 读取维护的统计（元对象缺失时自动校准一次）
 ├── /objects        → GET 列表（排除 _meta/ 前缀）
 ├── /objects/{key}
 │    ├── PUT    → ① key 校验 ② Content-Type 白名单 ③ 扩展名↔类型交叉校验
 │    │             ④ Content-Length 上限 ⑤ 流式计数兜底 ⑥ R2.put
 │    │             ⑦ 统计 +1（size 取实际写入字节，CAS 重试）
 │    ├── HEAD   → 存在性检查 → 200/404
 │    └── DELETE → 存在性检查 → 删除 → 统计 -1（head 取 size，CAS 重试）
 └── 其他 → 404
```

---

## 5. 完整 Worker 源码

> **部署内容为纯 JavaScript（ESM）**：`apps/worker/src/index.js`，可直接整体粘贴到 Cloudflare 控制台 Worker 编辑器（控制台是 JS 环境，TS 源码无法直接粘贴运行）。
> 下方 TS 源码为设计稿参考，逻辑与 `index.js` 一致；以 `apps/worker/src/index.js` 为准。

```ts
/**
 * Assets Studio Storage Gateway v2
 * 契约：docs/API.md；职责：仅对象存储（DECISIONS.md D-007），不做图片消费。
 *
 * 环境变量：
 *   API_KEY         必填，共享密钥（wrangler secret put API_KEY）
 *   PUBLIC_BASE_URL 必填，R2 自定义域名，如 https://img.sanxiaoxing.cn
 *   ALLOWED_TYPES   可选，逗号分隔的 Content-Type 白名单（默认内置图片五类）
 *   MAX_SIZE_MB     可选，单文件上限 MB（默认 20，与前端"单张不超过 20 MB"一致）
 *
 * R2 binding：IMAGES
 *
 * 存储统计（v1.2）：上传/删除时增量维护 `_meta/usage.json`（维护计数 + 定期校准），
 * 元对象被 GET /objects 列表排除，不影响用户图片视图。
 */

interface Env {
  IMAGES: R2Bucket;
  API_KEY: string;
  PUBLIC_BASE_URL: string;
  ALLOWED_TYPES?: string;
  MAX_SIZE_MB?: string;
}

const DEFAULT_ALLOWED = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
]);

/** 扩展名 → MIME（key 由客户端生成，这里做交叉校验，防改后缀绕过） */
const EXT_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
};

const KEY_PATTERN = /^[a-zA-Z0-9._/-]+$/;
const MAX_KEY_LEN = 1024;

/** 统计元对象 key：固定前缀，list 时排除，避免混入用户图片 */
const META_KEY = "_meta/usage.json";
const META_PREFIX = "_meta/";

interface UsageMeta {
  objects: number;
  size: number;
  updatedAt: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const cors = corsHeaders();

    // CORS 预检：直接 204，不经过鉴权（API.md §10）
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    // 鉴权：接受 X-API-Key 或 Authorization: Bearer，恒定时间比较
    const expected = env.API_KEY ?? "";
    if (!expected) return error("INTERNAL", "Server misconfigured: API_KEY missing", 500, cors);
    const provided =
      request.headers.get("X-API-Key") ??
      (request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ?? "");
    if (!(await timingSafeEqual(provided, expected))) {
      return error("UNAUTHORIZED", "API key is missing or invalid", 401, cors);
    }

    const url = new URL(request.url);
    const prefix = "/objects";

    // GET /usage —— 存储统计（v1.2，读维护计数，不全量 list）
    if (url.pathname === "/usage") {
      if (request.method === "GET") return getUsage(env, cors);
      return error("METHOD_NOT_ALLOWED", "Method not allowed", 405, cors);
    }

    // POST /usage/rescan —— 全量重算校准统计（v1.2）
    if (url.pathname === "/usage/rescan") {
      if (request.method === "POST") return rescanUsage(env, cors);
      return error("METHOD_NOT_ALLOWED", "Method not allowed", 405, cors);
    }

    // GET /objects —— 列表（v1.1）
    if (url.pathname === prefix) {
      if (request.method === "GET") return listObjects(env, url, cors);
      return error("METHOD_NOT_ALLOWED", "Method not allowed", 405, cors);
    }

    // /objects/{key}
    if (url.pathname.startsWith(prefix + "/")) {
      const key = decodeURIComponent(url.pathname.slice(prefix.length + 1));
      const keyErr = validateKey(key);
      if (keyErr) return error(keyErr.code, keyErr.message, 400, cors);
      switch (request.method) {
        case "PUT": return putObject(request, env, key, cors);
        case "HEAD": return headObject(env, key, cors);
        case "DELETE": return deleteObject(env, key, cors);
      }
      return error("METHOD_NOT_ALLOWED", "Method not allowed", 405, cors);
    }

    return error("NOT_FOUND", "Not Found", 404, cors);
  },
};

/* ---------- handlers ---------- */

async function putObject(request: Request, env: Env, key: string, cors: Headers): Promise<Response> {
  // ① Content-Type 白名单
  const contentType = (request.headers.get("Content-Type") ?? "").split(";")[0].trim().toLowerCase();
  if (!parseTypes(env.ALLOWED_TYPES).has(contentType)) {
    return error("UNSUPPORTED_TYPE", `Unsupported Content-Type: ${contentType}`, 415, cors);
  }

  // ② 扩展名与 Content-Type 一致性（防"png 后缀 + 非图片类型"绕过）
  const ext = key.slice(key.lastIndexOf(".") + 1).toLowerCase();
  if (EXT_MIME[ext] !== contentType) {
    return error("MISMATCH", "Extension and Content-Type mismatch", 400, cors);
  }

  // ③ 大小限制：先看 Content-Length，流式传输时再计数兜底
  const maxBytes = maxSize(env);
  if (Number(request.headers.get("Content-Length") ?? 0) > maxBytes) {
    return error("TOO_LARGE", "File too large", 413, cors);
  }
  if (!request.body) return error("EMPTY_BODY", "Empty body", 400, cors);

  let storedSize: number;
  try {
    const obj = await env.IMAGES.put(key, withLimit(request.body, maxBytes), {
      httpMetadata: { contentType },
    });
    storedSize = obj.size;
  } catch (e) {
    if ((e as Error).message === "TOO_LARGE") return error("TOO_LARGE", "File too large", 413, cors);
    return error("INTERNAL", "R2 write failed", 500, cors);
  }

  // ④ 统计 +1：size 取实际写入字节；统计失败不影响上传结果（靠 rescan 校准）
  try {
    await updateUsage(env, { objects: 1, size: storedSize });
  } catch {
    /* 统计暂不一致，可调用 /usage/rescan 校准 */
  }

  return success(
    { key, url: `${env.PUBLIC_BASE_URL.replace(/\/+$/, "")}/${key}` },
    200,
    cors,
  );
}

async function headObject(env: Env, key: string, cors: Headers): Promise<Response> {
  const obj = await env.IMAGES.head(key);
  if (!obj) return error("NOT_FOUND", "Object not found", 404, cors);
  return new Response(null, { status: 200, headers: cors });
}

async function deleteObject(env: Env, key: string, cors: Headers): Promise<Response> {
  const obj = await env.IMAGES.head(key);
  if (!obj) return error("NOT_FOUND", "Object not found", 404, cors);
  await env.IMAGES.delete(key);

  // 统计 -1：head 结果带 size；统计失败不影响删除结果（靠 rescan 校准）
  try {
    await updateUsage(env, { objects: -1, size: -obj.size });
  } catch {
    /* 统计暂不一致，可调用 /usage/rescan 校准 */
  }

  return success({ key }, 200, cors);
}

async function listObjects(env: Env, url: URL, cors: Headers): Promise<Response> {
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 100) || 100, 1), 1000);
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const listed = await env.IMAGES.list({ limit, cursor });
  const base = env.PUBLIC_BASE_URL.replace(/\/+$/, "");
  return success(
    {
      items: listed.objects
        .filter((o) => !o.key.startsWith(META_PREFIX)) // 排除统计元对象
        .map((o) => ({
          key: o.key,
          url: `${base}/${o.key}`,
          size: o.size,
          uploaded: o.uploaded.toISOString(),
        })),
      cursor: listed.truncated ? listed.cursor : null,
      has_more: listed.truncated,
    },
    200,
    cors,
  );
}

/** GET /usage：读取维护的统计；元对象从未创建时自动做一次全量校准，保证首次返回真实值 */
async function getUsage(env: Env, cors: Headers): Promise<Response> {
  const { meta, etag } = await readUsage(env);
  if (etag === null) return rescanUsage(env, cors);
  return usageResponse(meta, cors);
}

/** POST /usage/rescan：分页全量扫描，重算 objects / size 并写回元对象（校准入口） */
async function rescanUsage(env: Env, cors: Headers): Promise<Response> {
  let objects = 0;
  let size = 0;
  let cursor: string | undefined;
  do {
    const listed = await env.IMAGES.list({ cursor, limit: 1000 });
    for (const o of listed.objects) {
      if (o.key.startsWith(META_PREFIX)) continue;
      objects += 1;
      size += o.size;
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);

  const meta: UsageMeta = { objects, size, updatedAt: new Date().toISOString() };
  await env.IMAGES.put(META_KEY, JSON.stringify(meta));
  return usageResponse(meta, cors);
}

/* ---------- usage helpers ---------- */

function usageResponse(meta: UsageMeta, cors: Headers): Response {
  return success(
    {
      objects: meta.objects,
      size: meta.size,
      sizeFormatted: formatBytes(meta.size),
      updatedAt: meta.updatedAt,
    },
    200,
    cors,
  );
}

/** 读取统计元对象；不存在时返回默认值 + etag=null（调用方据此触发自动校准） */
async function readUsage(env: Env): Promise<{ meta: UsageMeta; etag: string | null }> {
  const obj = await env.IMAGES.get(META_KEY);
  if (!obj) return { meta: { objects: 0, size: 0, updatedAt: "" }, etag: null };
  try {
    const parsed = JSON.parse(await obj.text()) as Partial<UsageMeta>;
    return {
      meta: {
        objects: Number(parsed.objects) || 0,
        size: Number(parsed.size) || 0,
        updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : "",
      },
      etag: obj.httpEtag,
    };
  } catch {
    // 元对象损坏：重置计数，仍保留 etag 以便 CAS 覆盖
    return { meta: { objects: 0, size: 0, updatedAt: "" }, etag: obj.httpEtag };
  }
}

/**
 * 增量更新统计：读 → 加 delta → 带 etag（CAS）写回。
 * 并发上传/删除冲突时 put 返回 null，重试（上限 3 次）；
 * 重试耗尽则本次更新静默失败，靠 /usage/rescan 校准。
 */
async function updateUsage(env: Env, delta: { objects: number; size: number }, maxRetries = 3): Promise<void> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const { meta, etag } = await readUsage(env);
    const next: UsageMeta = {
      objects: Math.max(0, meta.objects + delta.objects),
      size: Math.max(0, meta.size + delta.size),
      updatedAt: new Date().toISOString(),
    };
    const putResult = await env.IMAGES.put(
      META_KEY,
      JSON.stringify(next),
      etag ? { onlyIf: { etagMatches: etag } } : undefined,
    );
    if (putResult !== null) return; // CAS 成功，或首次创建
    // 冲突：循环重读重试
  }
  throw new Error("usage update conflict after retries");
}

/** 人类可读大小（B/KB/MB/GB/TB，1024 进制） */
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const v = bytes / Math.pow(1024, i);
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(2)} ${units[i]}`;
}

/* ---------- validation helpers ---------- */

function validateKey(key: string): { code: string; message: string } | null {
  if (key.length === 0 || key.length > MAX_KEY_LEN) {
    return { code: "INVALID_KEY", message: "Invalid key length" };
  }
  if (key.startsWith("/") || key.includes("..") || !KEY_PATTERN.test(key)) {
    return { code: "INVALID_KEY", message: "Key contains invalid characters" };
  }
  if (!EXT_MIME[key.slice(key.lastIndexOf(".") + 1).toLowerCase()]) {
    return { code: "INVALID_KEY", message: "Unsupported file extension" };
  }
  return null;
}

function parseTypes(raw: string | undefined): Set<string> {
  if (!raw) return DEFAULT_ALLOWED;
  return new Set(
    raw.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean),
  );
}

function maxSize(env: Env): number {
  const mb = Number(env.MAX_SIZE_MB ?? 20);
  return (Number.isFinite(mb) && mb > 0 ? mb : 20) * 1024 * 1024;
}

/** 恒定时间比较：先 SHA-256 再逐字节 XOR，避免长度/前缀时序泄露 */
async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  if (a.length === 0 || b.length === 0) return a === b;
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const da = new Uint8Array(ha);
  const db = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < da.length; i++) diff |= da[i] ^ db[i];
  return diff === 0;
}

/** 流式大小兜底：超过上限即报错，防止无 Content-Length 的大 body 绕过检查 */
function withLimit(stream: ReadableStream, max: number): ReadableStream {
  let total = 0;
  return stream.pipeThrough(
    new TransformStream({
      transform(chunk, controller) {
        total += chunk.byteLength;
        if (total > max) controller.error(new Error("TOO_LARGE"));
        else controller.enqueue(chunk);
      },
    }),
  );
}

function corsHeaders(): Headers {
  return new Headers({
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, PUT, DELETE, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "X-API-Key, Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
  });
}

function success(data: Record<string, unknown>, status: number, cors: Headers): Response {
  return Response.json(data, { status, headers: cors });
}

function error(code: string, message: string, status: number, cors: Headers): Response {
  return Response.json({ code, message }, { status, headers: cors });
}
```

---

## 6. 部署要点

```toml
# wrangler.toml
name = "assets-studio-gateway"
main = "src/index.ts"

[[r2_buckets]]
binding = "IMAGES"
bucket_name = "your-bucket"

[vars]
PUBLIC_BASE_URL = "https://img.sanxiaoxing.cn"
ALLOWED_TYPES = "image/png,image/jpeg,image/webp,image/gif,image/avif"
MAX_SIZE_MB = "20"
```

```bash
wrangler secret put API_KEY    # 生成长随机串，只存在 Worker 环境
wrangler deploy
```

注意：`PUBLIC_BASE_URL` 不能以 `/` 结尾，源码已用 `replace(/\/+$/, "")` 兜底。

### 6.1 错误码对照（对齐 API.md §7）

| Code | HTTP | 触发条件 |
|---|---|---|
| `UNAUTHORIZED` | 401 | X-API-Key / Bearer 缺失或不匹配 |
| `INVALID_KEY` | 400 | key 长度/字符/扩展名非法，含路径穿越（`..`） |
| `UNSUPPORTED_TYPE` | 415 | Content-Type 不在白名单 |
| `MISMATCH` | 400 | 扩展名与 Content-Type 不一致 |
| `EMPTY_BODY` | 400 | 请求体为空 |
| `TOO_LARGE` | 413 | 超过 `MAX_SIZE_MB` |
| `METHOD_NOT_ALLOWED` | 405 | 路径合法但方法不支持 |
| `NOT_FOUND` | 404 | 路径不存在 / HEAD、DELETE 对象不存在 |
| `INTERNAL` | 500 | R2 写入失败 / 服务端配置缺失 |

---

## 7. 存储使用量统计（v1.2）

### 7.1 目标与口径

区分两种「用量」：

- **本次上传大小**：上传响应已含 `size`（单文件字节数），客户端可直接用。
- **Bucket 总使用量**：整个 R2 Bucket 的图片数量与字节总和，供侧边栏 / 设置页展示 `1.71 GB / 10 GB · 183 images`。

统计是**业务统计值**，不是 Cloudflare 计费值；真实计费以 Cloudflare 控制台 R2 用量为准。

### 7.2 方案：维护计数 + 定期校准

- 统计值存 R2 元对象 `_meta/usage.json`（`{objects, size, updatedAt}`），Worker 自身保持无状态（D-007）。
- 上传成功 → `objects +1`、`size += 实际写入字节`（取 `R2.put` 返回对象的 `.size`，不用客户端声明值）。
- 删除成功 → 先 `head` 取 `size`，再 `objects -1`、`size -= size`。
- 增量写入带 **etag 乐观锁（CAS）**：`put({ onlyIf: { etagMatches } })`，并发冲突时重试（上限 3 次），避免并发上传丢更新。
- `GET /usage` 只读元对象（O(1)）；元对象从未创建时自动做一次全量校准，保证首次返回真实值。
- `POST /usage/rescan` 分页全量扫描（1000/页）重算并写回，是「重新统计」校准入口。

### 7.3 一致性边界（明确说明）

| 场景 | 后果 | 恢复 |
|---|---|---|
| 上传成功但统计写失败（含 CAS 重试耗尽） | 统计偏小 | `POST /usage/rescan` 校准 |
| 删除成功但统计写失败 | 统计偏大 | `POST /usage/rescan` 校准 |
| 元对象损坏 / 手动改 R2 | 统计失真 | `POST /usage/rescan` 校准 |

日常查询走 O(1) 计数；偶发不一致由校准兜底，不会永久错误。

### 7.4 API 端点

| Method | Path | 认证 | 说明 |
|---|---|---|---|
| `GET` | `/usage` | ✅ | 读取维护的统计（`objects` / `size` / `sizeFormatted` / `updatedAt`） |
| `POST` | `/usage/rescan` | ✅ | 全量重算并写回统计（校准入口） |

响应示例（`GET /usage`）：

```json
{
  "objects": 183,
  "size": 1837291024,
  "sizeFormatted": "1.71 GB",
  "updatedAt": "2026-08-13T08:00:00Z"
}
```

两个端点与上传/删除一样走 Token 鉴权，避免他人借 `/usage` 窥探 R2 用量。

---

## 8. 客户端配套改动

| 改动 | 位置 | 说明 |
|---|---|---|
| `upload_image` 不再接收 `server`/`apiKey` 参数 | `src-tauri/src/commands/mod.rs` | 命令内部 `config::load()` 取 `server`/`api_key`，失败返回 `AppError::Config` |
| 新增 `set_config` 命令 | `src-tauri/src/commands/mod.rs` | 写入 `config.json` 的 `server`/`api_key` |
| 设置页 server/apiKey 走 Rust 读写 | `src/features/settings/settingsView.tsx` | 初始化 `get_config` 回填，保存走 `set_config`；`apiKey` 只展示打码 |
| 删除前端 `apiKey` 字段 | `src/lib/types.ts` / `src/lib/settings.ts` | `Settings` 只保留展示类字段，连接信息不再进 localStorage |
| 上传流程不再传 key | `src/features/upload/upload.ts` | `invoke("upload_image", { key, contentType, filePath })` |
| 存储用量：手动触发 | `src-tauri/src/services/usage.rs` + `sync_usage` 命令 | **由用户在设置页手动点击**「刷新」（GET /usage 读维护计数）或「重新统计」（POST /usage/rescan 全量校准），不做启动自动拉取 |
| 侧边栏用量覆盖 | `src/main.ts` `renderSettingsView(settingsBody, { onUsageResolved })` | 统计成功后把 R2 真实字节数写入侧边栏「已用空间」 |

收益：同时解决「`config.rs` 存在但前端未用、apiKey 却在前端 localStorage」的割裂。

---

## 9. 明确不做（防过度设计）

- **Rate Limit / WAF**：Worker 公开化后再加（Cloudflare 仪表盘配置即可，不动代码）。
- **魔法字节校验**：App 只上传自己压缩的 WebP，扩展名↔类型交叉校验已足够。
- **防盗链 / 水印 / 缩放 / CDN 代理**：D-007 明确这些不属于 Worker 职责，走 R2 自定义域名分发。
- **计费口径统计**：`/usage` 返回业务统计值；与 Cloudflare 账单对账不在本方案范围。

---

## 10. 变更记录

| 日期 | 内容 |
|---|---|
| 2026-08-13 | 初稿：安全加固 + 契约对齐 + 密钥收敛到 Rust 侧 |
| 2026-08-13 | v1.2：新增存储使用量统计（`_meta/usage.json` 维护计数 + `/usage` + `/usage/rescan` 校准，etag CAS 防并发丢更新） |
