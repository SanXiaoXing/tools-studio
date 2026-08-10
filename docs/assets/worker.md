var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/utils/filename.ts
function generateFilename(ext) {
const now = /* @__PURE__ */ new Date();
const year = now.getFullYear();
const month = String(now.getMonth() + 1).padStart(2, "0");
const day = String(now.getDate()).padStart(2, "0");
const random = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
return `blog/${year}/${month}/${day}/${random}.${ext}`;
}
__name(generateFilename, "generateFilename");

// src/utils/response.ts
function success(data, status = 200) {
return Response.json(
{
success: true,
...data ?? {}
},
{ status }
);
}
__name(success, "success");
function error(message, status = 400) {
return Response.json(
{
success: false,
message
},
{ status }
);
}
__name(error, "error");

// src/handlers/upload.ts
async function upload(request, env) {
const formData = await request.formData();
const file = formData.get("file");
if (!(file instanceof File)) {
return error("No file uploaded", 400);
}
const ext = file.name.split(".").pop()?.toLowerCase() || "bin";
const key = generateFilename(ext);
await env.IMAGES.put(
key,
file.stream(),
{
httpMetadata: {
contentType: file.type
}
}
);
return success({
key,
url: `https://img.sanxiaoxing.cn/${key}`,
size: file.size,
contentType: file.type
});
}
__name(upload, "upload");

// src/index.ts
var index_default = {
async fetch(request, env) {
const url = new URL(request.url);
if (request.method === "POST" && url.pathname === "/upload") {
return upload(request, env);
}
return error("Not Found", 404);
}
};
export {
index_default as default
};
//# sourceMappingURL=index.js.map
