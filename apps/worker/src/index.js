/**
 * Assets Studio Storage Gateway v2
 * 契约：docs/API.md；职责：仅对象存储（DECISIONS.md D-007），不做图片消费。
 *
 * 双域名架构（API 与图片分离）：
 *   API 域名（Worker）：https://xxx.workers.dev
 *     负责 PUT / DELETE / HEAD /objects、GET /objects、GET /usage、POST /usage/rescan，
 *     所有请求必须带 X-API-Key 或 Authorization: Bearer。
 *   图片域名（R2 自定义域 / Public Bucket）
 *     图片读取由 R2 直接提供，不经过本 Worker，因此不需要 API Key。
 *     上传响应的 url = 「图片域名 + key」，别人可直接打开看图，但不能调用本 API。
 *
 * 部署（零配置，纯控制台操作，无需安装/运行任何命令行工具）：
 *   1. 创建 R2 存储桶，并添加自定义域名（R2 → 桶 → 设置 → 自定义域）用于公开读取图片
 *   2. Cloudflare 控制台（dash.cloudflare.com）→ Workers & Pages → 创建 Worker → 编辑代码
 *   3. 全选删除模板代码，粘贴本文件全部内容，点「部署」
 *   4. Worker「设置 → 变量和机密」添加下方环境变量（API_KEY 类型选「机密」）
 *   5. Worker「设置 → 绑定」添加 R2 存储桶绑定，绑定名称填 IMAGES
 *
 * 环境变量（在 Cloudflare 控制台填写，本文件不包含密钥值）：
 *   API_KEY         必填，共享密钥，与客户端设置页 API Key 一致（存为 Secret）
 *   PUBLIC_BASE_URL 必填，图片域名（R2 自定义域），如 https://img.sanxiaoxing.cn，结尾无斜杠；
 *                   注意：不是 API 域名（img-service.sanxiaoxing.cn）
 *   ALLOWED_TYPES   可选，逗号分隔的 Content-Type 白名单（默认内置图片五类）
 *   MAX_SIZE_MB     可选，单文件上限 MB（默认 20，与前端"单张不超过 20 MB"一致）
 *
 * R2 binding：IMAGES
 *
 * 存储统计（v1.2）：上传/删除时增量维护 `_meta/usage.json`（维护计数 + 定期校准），
 * 元对象被 GET /objects 列表排除，不影响用户图片视图。
 */

/**
 * @typedef {Object} Env
 * @property {R2Bucket} IMAGES - R2 存储桶绑定
 * @property {string} API_KEY - 共享密钥
 * @property {string} PUBLIC_BASE_URL - 图片域名（R2 自定义域，非 API 域名，结尾无斜杠）
 * @property {string} [ALLOWED_TYPES] - Content-Type 白名单（逗号分隔）
 * @property {string} [MAX_SIZE_MB] - 单文件上限 MB
 */

const DEFAULT_ALLOWED = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
]);

/** 扩展名 → MIME（key 由客户端生成，这里做交叉校验，防改后缀绕过）
 * @type {Record<string, string>} */
const EXT_MIME = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
};

/** 允许 Unicode 字母/数字 + `._/-`（支持中文等原文件名，如 我的图片.webp） */
const KEY_PATTERN = /^[\p{L}\p{N}._/-]+$/u;
const MAX_KEY_LEN = 1024;

/** 统计元对象 key：固定前缀，list 时排除，避免混入用户图片 */
const META_KEY = "_meta/usage.json";
const META_PREFIX = "_meta/";

/**
 * @typedef {Object} UsageMeta
 * @property {number} objects
 * @property {number} size
 * @property {string} updatedAt
 */

export default {
  /**
   * @param {Request} request
   * @param {Env} env
   * @returns {Promise<Response>}
   */
  async fetch(request, env) {
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

/**
 * @param {Request} request
 * @param {Env} env
 * @param {string} key
 * @param {Headers} cors
 * @returns {Promise<Response>}
 */
async function putObject(request, env, key, cors) {
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

  let storedSize;
  try {
    const obj = await env.IMAGES.put(key, request.body, {
      httpMetadata: {
        contentType,
      },
    });
    storedSize = obj.size;
  } catch (e) {
    console.error("R2 PUT failed:", e);

    return error(
      "R2_WRITE_FAILED",
      e instanceof Error
        ? `${e.name}: ${e.message}`
        : String(e),
      500,
      cors,
    );
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

/**
 * @param {Env} env
 * @param {string} key
 * @param {Headers} cors
 * @returns {Promise<Response>}
 */
async function headObject(env, key, cors) {
  const obj = await env.IMAGES.head(key);
  if (!obj) return error("NOT_FOUND", "Object not found", 404, cors);
  return new Response(null, { status: 200, headers: cors });
}

/**
 * @param {Env} env
 * @param {string} key
 * @param {Headers} cors
 * @returns {Promise<Response>}
 */
async function deleteObject(env, key, cors) {
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

/**
 * @param {Env} env
 * @param {URL} url
 * @param {Headers} cors
 * @returns {Promise<Response>}
 */
async function listObjects(env, url, cors) {
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 100) || 100, 1), 1000);
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const listed = await env.IMAGES.list({ limit, cursor });
  const base = env.PUBLIC_BASE_URL.replace(/\/+$/, "");
  return success(
    {
      items: listed.objects
        // 排除统计元对象（_meta/）与目录占位对象（key 以 / 结尾、无图片扩展名），只返回图片
        .filter((o) => !o.key.startsWith(META_PREFIX) && isImageKey(o.key))
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

/** GET /usage：读取维护的统计；元对象从未创建时自动做一次全量校准，保证首次返回真实值
 * @param {Env} env
 * @param {Headers} cors
 * @returns {Promise<Response>} */
async function getUsage(env, cors) {
  const { meta, etag } = await readUsage(env);
  if (etag === null) return rescanUsage(env, cors);
  return usageResponse(meta, cors);
}

/** POST /usage/rescan：分页全量扫描，重算 objects / size 并写回元对象（校准入口）
 * @param {Env} env
 * @param {Headers} cors
 * @returns {Promise<Response>} */
async function rescanUsage(env, cors) {
  let objects = 0;
  let size = 0;
  let cursor;
  do {
    const listed = await env.IMAGES.list({ cursor, limit: 1000 });
    for (const o of listed.objects) {
      if (o.key.startsWith(META_PREFIX)) continue;
      objects += 1;
      size += o.size;
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);

  const meta = { objects, size, updatedAt: new Date().toISOString() };
  await env.IMAGES.put(META_KEY, JSON.stringify(meta));
  return usageResponse(meta, cors);
}

/* ---------- usage helpers ---------- */

/**
 * @param {UsageMeta} meta
 * @param {Headers} cors
 * @returns {Response}
 */
function usageResponse(meta, cors) {
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

/** 读取统计元对象；不存在时返回默认值 + etag=null（调用方据此触发自动校准）
 * @param {Env} env
 * @returns {Promise<{meta: UsageMeta, etag: string|null}>} */
async function readUsage(env) {
  const obj = await env.IMAGES.get(META_KEY);
  if (!obj) return { meta: { objects: 0, size: 0, updatedAt: "" }, etag: null };
  try {
    const parsed = JSON.parse(await obj.text());
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
 * @param {Env} env
 * @param {{objects: number, size: number}} delta
 * @param {number} [maxRetries]
 * @returns {Promise<void>}
 */
async function updateUsage(env, delta, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const { meta, etag } = await readUsage(env);
    const next = {
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

/** 人类可读大小（B/KB/MB/GB/TB，1024 进制）
 * @param {number} bytes
 * @returns {string} */
function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const v = bytes / Math.pow(1024, i);
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(2)} ${units[i]}`;
}

/* ---------- validation helpers ---------- */

/** 是否图片对象：key 以图片扩展名结尾（自动排除目录占位对象与 _meta 等非图片对象）
 * @param {string} key
 * @returns {boolean} */
function isImageKey(key) {
  if (key.endsWith("/")) return false; // 目录占位对象（R2 中 key 以 / 结尾）
  const ext = key.slice(key.lastIndexOf(".") + 1).toLowerCase();
  return Boolean(EXT_MIME[ext]);
}

/**
 * @param {string} key
 * @returns {{code: string, message: string}|null}
 */
function validateKey(key) {
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

/**
 * @param {string|undefined} raw
 * @returns {Set<string>}
 */
function parseTypes(raw) {
  if (!raw) return DEFAULT_ALLOWED;
  return new Set(
    raw.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean),
  );
}

/**
 * @param {Env} env
 * @returns {number}
 */
function maxSize(env) {
  const mb = Number(env.MAX_SIZE_MB ?? 20);
  return (Number.isFinite(mb) && mb > 0 ? mb : 20) * 1024 * 1024;
}

/** 恒定时间比较：先 SHA-256 再逐字节 XOR，避免长度/前缀时序泄露
 * @param {string} a
 * @param {string} b
 * @returns {Promise<boolean>} */
async function timingSafeEqual(a, b) {
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

/** 流式大小兜底：超过上限即报错，防止无 Content-Length 的大 body 绕过检查
 * @param {ReadableStream} stream
 * @param {number} max
 * @returns {ReadableStream} */
function withLimit(stream, max) {
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

/**
 * @returns {Headers}
 */
function corsHeaders() {
  return new Headers({
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, PUT, DELETE, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "X-API-Key, Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
  });
}

/**
 * @param {Record<string, unknown>} data
 * @param {number} status
 * @param {Headers} cors
 * @returns {Response}
 */
function success(data, status, cors) {
  return Response.json(data, { status, headers: cors });
}

/**
 * @param {string} code
 * @param {string} message
 * @param {number} status
 * @param {Headers} cors
 * @returns {Response}
 */
function error(code, message, status, cors) {
  return Response.json({ code, message }, { status, headers: cors });
}
