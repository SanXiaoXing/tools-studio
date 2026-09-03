/**
 * Assets Studio Image Edge Worker v1
 * 职责：公开图片读取 + Referer 防盗链 + CORS 白名单（Issue #1）
 * 契约：docs/API.md §12；与 API Worker（src/index.js，纯 Storage Gateway）职责分离：
 *   API Worker   → PUT / DELETE / HEAD /objects、GET /objects、GET /usage（全部 X-API-Key 鉴权）
 *   Image Worker → GET / HEAD /{key} 公开读图（本文件），只做访问控制与分发，不涉及上传/统计。
 *
 * 部署（零配置，纯控制台操作，与 API Worker 同一 R2 桶）：
 *   1. 图片域名从 R2 自定义域名改为绑定本 Worker：
 *      Cloudflare 控制台 → Workers & Pages → 创建 Worker → 编辑代码（粘贴本文件全部内容）→ 部署
 *   2. Worker「设置 → 域名和路由」添加自定义域名 img.sanxiaoxing.cn
 *      （先删除 R2 桶上原 img.sanxiaoxing.cn 自定义域，并关闭桶公开访问，
 *        否则可绕过 Worker 直接访问 R2 —— 历史图片 URL 不变，仍为 https://img.sanxiaoxing.cn/{key}）
 *   3. Worker「设置 → 绑定」添加 R2 存储桶绑定，绑定名称填 IMAGES（与 API Worker 同一桶）
 *   4. Worker「设置 → 变量」添加下方环境变量
 *
 * 环境变量（在 Cloudflare 控制台填写，本文件不包含密钥值）：
 *   IMAGES             R2 桶绑定（必填）
 *   ALLOWED_REFERERS   可选，防盗链 Referer host 白名单（逗号分隔，精确 host 或子域均可；
 *                      默认 sanxiaoxing.cn,www.sanxiaoxing.cn）
 *   ALLOWED_ORIGINS    可选，CORS 白名单（逗号分隔的完整 origin，如 https://sanxiaoxing.cn；
 *                      缺省时由 ALLOWED_REFERERS 自动推导为 https://<host>）
 *   ALLOW_EMPTY_REFERER 可选，无 Referer 请求是否放行（默认 1 = 放行；0 = 拒绝）
 *   CACHE_TTL_SECONDS  可选，Cache API 缓存时长秒（默认 86400 = 1 天）
 *
 * 防盗链规则（Issue #1 §Referer 处理规则）：
 *   - 有 Referer 且 host 命中白名单（含子域）            → 200 放行
 *   - 有 Referer 且 host 不在白名单（第三方站点盗链）     → 403
 *   - 无 Referer（地址栏直开 / 隐私模式 / 桌面端 / curl） → 默认 200 放行
 *
 * 后续扩展：Token / 签名 URL / 有效期可在此文件内按 /public/*、/private/* 前缀分支实现。
 */

/**
 * @typedef {Object} Env
 * @property {R2Bucket} IMAGES - R2 存储桶绑定（与 API Worker 同一桶）
 * @property {string} [ALLOWED_REFERERS] - Referer host 白名单（逗号分隔）
 * @property {string} [ALLOWED_ORIGINS] - CORS 白名单 origin（逗号分隔）
 * @property {string} [ALLOW_EMPTY_REFERER] - 无 Referer 是否放行（1/0）
 * @property {string} [CACHE_TTL_SECONDS] - 缓存秒数
 */

/** 默认 Referer 白名单（与 Issue #1 验收一致；子域匹配，无需重复列出 www / img） */
const DEFAULT_REFERERS = ["sanxiaoxing.cn", "www.sanxiaoxing.cn"];

/** 扩展名 → MIME（与 API Worker 一致；只服务图片，天然拒绝非图片类型）
 * @type {Record<string, string>} */
const EXT_MIME = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
};

/** 允许 Unicode 字母/数字 + `._/-`（支持中文等原文件名，与 API Worker 上传校验一致） */
const KEY_PATTERN = /^[\p{L}\p{N}._/-]+$/u;
const MAX_KEY_LEN = 1024;

/** 统计元对象前缀：公开读图一律拒绝，防止泄露 R2 用量元数据 */
const META_PREFIX = "_meta/";

export default {
  /**
   * @param {Request} request
   * @param {Env} env
   * @param {ExecutionContext} ctx
   * @returns {Promise<Response>}
   */
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // CORS 预检：仅按白名单回头；无 Origin 的 OPTIONS（curl 等）直接 204 不设 ACAO
    if (request.method === "OPTIONS") {
      return handlePreflight(request, env);
    }

    // 公开读图只允许 GET / HEAD
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    // 防盗链：有 Referer 必须命中白名单；无 Referer 按 ALLOW_EMPTY_REFERER 放行
    const refererGate = checkReferer(request, env);
    if (!refererGate.ok) {
      return plain(refererGate.status, refererGate.message);
    }

    // 路径即 key：解码后做与上传侧一致的 key 校验
    let key;
    try {
      key = decodeURIComponent(url.pathname.slice(1));
    } catch {
      return plain(400, "Bad Request");
    }
    const keyErr = validateKey(key);
    if (keyErr) return plain(400, keyErr);
    if (key.startsWith(META_PREFIX)) return plain(404, "Not Found");

    // Origin 是否命中 CORS 白名单（决定响应是否带 ACAO 头，不影响读取本身）
    const origin = request.headers.get("Origin");
    const originOk = !origin || originAllowed(origin, env);

    // 命中白名单的 GET/HEAD 请求 → 附 ACAO 供 JS 跨域读取（如站点内 canvas/懒加载库）
    const allowOrigin = originOk && origin ? origin : null;

    // HEAD：R2.head 元数据查询，不传输对象体
    if (request.method === "HEAD") {
      const obj = await env.IMAGES.head(key);
      if (!obj) return plain(404, "Not Found");
      const headers = new Headers();
      obj.writeHttpMetadata(headers);
      if (!headers.has("Content-Type")) headers.set("Content-Type", contentTypeFor(key));
      headers.set("Cache-Control", `public, max-age=${cacheTtl(env)}`);
      if (allowOrigin) applyCors(headers, allowOrigin);
      return new Response(null, { status: 200, headers });
    }

    // GET：Cache API 优先（仅缓存无 Origin 的纯图片请求；带 Origin 的 CORS 请求直读 R2，
    // 保证不同来源拿到的 ACAO 头正确，不会被缓存串味）
    if (!origin) {
      const cached = await defaultCache().match(request);
      if (cached) return cached;
    }

    const obj = await env.IMAGES.get(key);
    if (!obj) return plain(404, "Not Found");

    const headers = new Headers();
    obj.writeHttpMetadata(headers);
    if (!headers.has("Content-Type")) headers.set("Content-Type", contentTypeFor(key));
    headers.set("Cache-Control", `public, max-age=${cacheTtl(env)}`);
    if (allowOrigin) applyCors(headers, allowOrigin);

    const response = new Response(obj.body, {
      status: 200,
      headers,
    });

    // 缓存成功响应（异步回填，不阻塞响应）；仅缓存无 Origin 的纯图片 200，防 ACAO 串味
    if (!origin && response.status === 200) {
      ctx.waitUntil(cacheResponse(request, response.clone(), env));
    }

    return response;
  },
};

/* ---------- 防盗链与 CORS ---------- */

/**
 * Referer 检查：无 Referer → 按配置放行/拒绝；有 Referer → host 须命中白名单（含子域）。
 * @param {Request} request
 * @param {Env} env
 * @returns {{ok: true}|{ok: false, status: number, message: string}}
 */
function checkReferer(request, env) {
  const referer = request.headers.get("Referer");
  if (!referer) {
    if (env.ALLOW_EMPTY_REFERER === "0") {
      return { ok: false, status: 403, message: "Referer is required" };
    }
    return { ok: true };
  }

  let host;
  try {
    host = new URL(referer).hostname.toLowerCase();
  } catch {
    host = "";
  }
  if (host && refererAllowed(host, env)) return { ok: true };
  return { ok: false, status: 403, message: "Hotlinking is not allowed" };
}

/**
 * host 是否命中白名单：精确相等或为白名单 host 的子域。
 * @param {string} host
 * @param {Env} env
 * @returns {boolean}
 */
function refererAllowed(host, env) {
  const list = parseList(env.ALLOWED_REFERERS, DEFAULT_REFERERS);
  return list.some((entry) => {
    const e = entry.toLowerCase();
    return host === e || host.endsWith("." + e);
  });
}

/**
 * CORS 预检（OPTIONS）：Origin 命中白名单才回 ACAO / 允许方法；未命中仅 204 不带头。
 * @param {Request} request
 * @param {Env} env
 * @returns {Response}
 */
function handlePreflight(request, env) {
  const origin = request.headers.get("Origin");
  const headers = new Headers({
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  });
  if (origin && originAllowed(origin, env)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
  }
  return new Response(null, { status: 204, headers });
}

/**
 * CORS origin 是否命中白名单：优先 ALLOWED_ORIGINS，缺省由 ALLOWED_REFERERS 推导 https://<host>。
 * @param {string} origin
 * @param {Env} env
 * @returns {boolean}
 */
function originAllowed(origin, env) {
  const explicit = env.ALLOWED_ORIGINS;
  if (explicit) return parseList(explicit, []).includes(origin.replace(/\/+$/, ""));
  const referers = parseList(env.ALLOWED_REFERERS, DEFAULT_REFERERS);
  return referers.some((entry) => origin === `https://${entry}`);
}

/**
 * 给响应附 CORS 头（仅白名单来源命中时调用）。
 * @param {Headers} headers
 * @param {string} origin
 * @returns {void}
 */
function applyCors(headers, origin) {
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Vary", "Origin");
}

/* ---------- 缓存 ---------- */

/**
 * 异步写入 Cache API（失败静默，不影响本次响应）。
 * @param {Request} request
 * @param {Response} response
 * @param {Env} env
 * @returns {Promise<void>}
 */
async function cacheResponse(request, response, env) {
  try {
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", `public, max-age=${cacheTtl(env)}`);
    const clone = new Response(response.body, { status: response.status, headers });
    await defaultCache().put(request, clone);
  } catch (e) {
    console.error("Cache write failed:", e);
  }
}

/**
 * @returns {Cache} Cloudflare 默认缓存（types 未含 caches.default，做窄化）
 */
function defaultCache() {
  return /** @type {{default: Cache}} */ (/** @type {unknown} */ (caches)).default;
}

/**
 * @param {Env} env
 * @returns {number}
 */
function cacheTtl(env) {
  const n = Number(env.CACHE_TTL_SECONDS ?? 86400);
  return Number.isFinite(n) && n > 0 ? n : 86400;
}

/* ---------- 工具 ---------- */

/**
 * @param {string} key
 * @returns {string}
 */
function contentTypeFor(key) {
  const ext = key.slice(key.lastIndexOf(".") + 1).toLowerCase();
  return EXT_MIME[ext] ?? "application/octet-stream";
}

/**
 * key 校验（与 API Worker validateKey 一致）：长度 / 路径穿越 / 字符集 / 图片扩展名。
 * @param {string} key
 * @returns {string|null} 非法时返回错误描述，合法返回 null
 */
function validateKey(key) {
  if (key.length === 0 || key.length > MAX_KEY_LEN) return "Invalid key length";
  if (key.startsWith("/") || key.includes("..") || !KEY_PATTERN.test(key)) {
    return "Key contains invalid characters";
  }
  const ext = key.slice(key.lastIndexOf(".") + 1).toLowerCase();
  if (!EXT_MIME[ext]) return "Unsupported file extension";
  return null;
}

/**
 * 解析逗号分隔配置（去空白、去空项）；缺省返回 defaults。
 * @param {string|undefined} raw
 * @param {string[]} defaults
 * @returns {string[]}
 */
function parseList(raw, defaults) {
  if (!raw) return defaults;
  const items = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return items.length > 0 ? items : defaults;
}

/**
 * 纯文本响应（防盗链 403 / 非法请求 400 / 缺失对象 404 等，不做 JSON 封装）。
 * @param {number} status
 * @param {string} message
 * @returns {Response}
 */
function plain(status, message) {
  return new Response(message + "\n", {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
