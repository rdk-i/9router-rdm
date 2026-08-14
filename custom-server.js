const http = require("http");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { pathToFileURL } = require("url");

const origCreate = http.createServer.bind(http);

// RMD model masking: rewrite client-facing model ids before Next resolves providers.
const MODEL_MASKS_FILE = path.join(process.env.DATA_DIR || path.join(require("os").homedir(), ".9router"), "config", "model-masks.json");
const MODEL_MASK_PATHS = new Set(["/v1/chat/completions", "/v1/responses", "/v1beta/messages", "/v1beta/chat/completions"]);
function loadModelMasks() {
  try { const value = JSON.parse(fs.readFileSync(MODEL_MASKS_FILE, "utf8")); return Array.isArray(value) ? value : []; }
  catch { return []; }
}
function rewriteMaskedBody(raw, masks) {
  if (!masks.length) return raw;
  try {
    const body = JSON.parse(raw);
    const mask = masks.find((item) => item?.from === body?.model && typeof item.to === "string");
    if (!mask) return raw;
    body.model = mask.to;
    return JSON.stringify(body);
  } catch { return raw; }
}
function advertiseMaskedModels(raw, masks) {
  if (!masks.length) return raw;
  try {
    const body = JSON.parse(raw);
    if (!Array.isArray(body?.data)) return raw;
    const ids = new Set(body.data.map((item) => item?.id));
    for (const mask of masks) {
      if (!mask?.from || ids.has(mask.from)) continue;
      const target = body.data.find((item) => item?.id === mask.to);
      body.data.push({ ...(target || {}), id: mask.from, object: "model", owned_by: target?.owned_by || "model-mask" });
    }
    return JSON.stringify(body);
  } catch { return raw; }
}

// Model masking management UI/API. These routes are served before Next so the
// page survives Next rebuilds and edits to the mask file apply without restart.
const MODEL_MASKING_PAGE_FILE = path.join(process.env.DATA_DIR || path.join(require("os").homedir(), ".9router"), "config", "model-masking.html");
const JWT_SECRET_FILE = path.join(process.env.DATA_DIR || path.join(require("os").homedir(), ".9router"), "jwt-secret");
function isAuthed(req) {
  try {
    const cookie = req.headers.cookie || "";
    const match = cookie.match(/(?:^|;\\s*)auth_token=([^;]+)/);
    if (!match) return false;
    const token = decodeURIComponent(match[1]);
    const secret = fs.readFileSync(JWT_SECRET_FILE, "utf8").trim();
    const [header, payload, signature] = token.split(".");
    if (!header || !payload || !signature) return false;
    const expected = crypto.createHmac("sha256", secret).update(header + "." + payload).digest("base64url");
    if (expected !== signature) return false;
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return claims.authenticated === true && claims.exp > Math.floor(Date.now() / 1000);
  } catch { return false; }
}
function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", () => resolve(""));
  });
}
function sendJson(res, status, value) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(value));
}
function writeModelMasks(masks) {
  const temp = MODEL_MASKS_FILE + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(masks, null, 2));
  fs.renameSync(temp, MODEL_MASKS_FILE);
}
async function handleModelMasksApi(req, res) {
  if (!isAuthed(req)) return sendJson(res, 401, { error: "Unauthorized" });
  const url = new URL(req.url, "http://localhost");
  if (req.method === "GET") return sendJson(res, 200, { masks: loadModelMasks() });
  if (req.method === "POST") {
    let body;
    try { body = JSON.parse(await readBody(req)); } catch { return sendJson(res, 400, { error: "Invalid JSON" }); }
    const from = String(body.from || "").trim();
    const to = String(body.to || "").trim();
    if (!from || !to || from === to) return sendJson(res, 400, { error: "Valid from and to are required" });
    const masks = loadModelMasks();
    const index = masks.findIndex((item) => item?.from === from);
    if (index >= 0) masks[index] = { from, to }; else masks.push({ from, to });
    writeModelMasks(masks);
    return sendJson(res, 200, { success: true, masks });
  }
  if (req.method === "DELETE") {
    const from = String(url.searchParams.get("from") || "").trim();
    if (!from) return sendJson(res, 400, { error: "from is required" });
    const masks = loadModelMasks().filter((item) => item?.from !== from);
    writeModelMasks(masks);
    return sendJson(res, 200, { success: true, masks });
  }
  return sendJson(res, 405, { error: "Method not allowed" });
}
async function handleMaskingPage(req, res) {
  if (!isAuthed(req)) {
    res.writeHead(302, { Location: "/login" });
    return res.end();
  }
  try {
    const html = fs.readFileSync(MODEL_MASKING_PAGE_FILE, "utf8");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(html);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("model-masking.html not found");
  }
}

// Per-process secret proving x-9r-real-ip was stamped below rather than sent by the client.
// A bare `next start` / `next dev` never loads this file, so it cannot produce a matching
// header even though the env var is inherited by child processes. Named like x-9r-cli-token
// so the request-detail header sanitizer redacts it too.
const PEER_TOKEN = crypto.randomBytes(24).toString("hex");
process.env.NINEROUTER_PEER_TOKEN = PEER_TOKEN;

let backgroundRefreshStarted = false;

function startBackgroundTokenRefreshFromCustomServer() {
  if (backgroundRefreshStarted) return;
  backgroundRefreshStarted = true;
  // Prefer source path (repo / standalone that still has src). Fail-open if missing
  // — initializeApp also starts the same scheduler when the Next app boots.
  const modPath = path.join(__dirname, "src", "sse", "services", "backgroundTokenRefresh.js");
  import(pathToFileURL(modPath).href)
    .then((m) => {
      try {
        m.startBackgroundTokenRefresh();
      } catch (e) {
        console.error("[BackgroundTokenRefresh] start failed:", e && e.message ? e.message : e);
      }
      const stop = () => {
        try {
          m.stopBackgroundTokenRefresh();
        } catch {
          /* ignore */
        }
      };
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
    })
    .catch((e) => {
      // Expected in published CLI standalone (src/ not on disk). App bootstrap covers it.
      if (process.env.DEBUG_BACKGROUND_TOKEN_REFRESH) {
        console.error("[BackgroundTokenRefresh] import failed:", e && e.message ? e.message : e);
      }
    });
}

// Wrap Next standalone HTTP server: derive client IP from the TCP socket
// (unspoofable) and strip client-supplied forwarding headers so downstream
// rate-limiting keys on the real peer address instead of attacker-controlled XFF.
http.createServer = (...args) => {
  const handler = args.find((a) => typeof a === "function");
  const rest = args.filter((a) => typeof a !== "function");
  if (!handler) return origCreate(...args);
  const wrapped = (req, res) => {
    const socketIp = req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : "";
    const xff = req.headers["x-forwarded-for"];
    const xRealIp = req.headers["x-real-ip"];
    const viaProxy = !!(xff || xRealIp);
    const isLoopbackProxy = socketIp === "127.0.0.1" || socketIp === "::1" || socketIp === "::ffff:127.0.0.1";
    // Trust forwarding headers only when the TCP peer is a local reverse proxy.
    // Direct/public sockets remain keyed by the unspoofable peer address.
    const proxyIp = xRealIp || (xff ? String(xff).split(",")[0].trim() : "");
    const ip = isLoopbackProxy && proxyIp ? proxyIp : socketIp;
    delete req.headers["x-9r-real-ip"];
    delete req.headers["x-forwarded-for"];
    delete req.headers["x-9r-via-proxy"];
    delete req.headers["x-9r-peer-token"];
    req.headers["x-9r-real-ip"] = ip;
    req.headers["x-9r-peer-token"] = PEER_TOKEN;
    if (viaProxy) req.headers["x-9r-via-proxy"] = "1";
    if (req.url.startsWith("/dashboard/model-masking")) {
      handleMaskingPage(req, res).catch(() => { try { res.writeHead(500); res.end(); } catch {} });
      return;
    }
    if (req.url.startsWith("/api/model-masks")) {
      handleModelMasksApi(req, res).catch((error) => sendJson(res, 500, { error: String(error?.message || error) }));
      return;
    }
    const requestPath = String(req.url || "").split("?", 1)[0];
    if (req.method === "GET" && requestPath === "/v1/models") {
      const originalWrite = res.write.bind(res);
      const originalEnd = res.end.bind(res);
      const chunks = [];
      res.write = (chunk, ...rest) => { if (chunk) chunks.push(Buffer.from(chunk)); return true; };
      res.end = (chunk, ...rest) => {
        if (chunk) chunks.push(Buffer.from(chunk));
        const rewritten = advertiseMaskedModels(Buffer.concat(chunks).toString("utf8"), loadModelMasks());
        res.write = originalWrite;
        res.end = originalEnd;
        res.setHeader("content-length", String(Buffer.byteLength(rewritten)));
        return originalEnd(rewritten, ...rest);
      };
    }
    if (req.method === "POST" && MODEL_MASK_PATHS.has(requestPath) && loadModelMasks().length) {
      const chunks = [];
      let received = 0;
      req.on("data", (chunk) => { chunks.push(chunk); received += chunk.length; });
      req.on("end", () => {
        const raw = Buffer.concat(chunks, received).toString("utf8");
        const rewritten = rewriteMaskedBody(raw, loadModelMasks());
        const replay = new http.IncomingMessage(req.socket);
        Object.assign(replay, {
          method: req.method,
          url: req.url,
          headers: { ...req.headers, "content-length": String(Buffer.byteLength(rewritten)) },
          complete: true,
        });
        replay.push(Buffer.from(rewritten, "utf8"));
        replay.push(null);
        handler(replay, res);
      });
      return;
    }
    return handler(req, res);
  };
  const server = origCreate(...rest, wrapped);
  server.once("listening", () => {
    startBackgroundTokenRefreshFromCustomServer();
  });
  const origEmit = server.emit;
  // JBR 25 sends h2c upgrades that the HTTP/1.1 server would otherwise close.
  server.emit = function (event, ...eventArgs) {
    const [req, socket, head] = eventArgs;
    if (event !== "upgrade" || String(req.headers.upgrade || "").toLowerCase() !== "h2c") {
      return origEmit.call(this, event, ...eventArgs);
    }

    const contentLength = Number(req.headers["content-length"] || 0);
    if (!Number.isSafeInteger(contentLength) || contentLength < 0) {
      socket.destroy();
      return true;
    }
    const chunks = [head];
    let received = head.length;
    const serve = () => {
      // Replay the upgraded request through the existing HTTP/1.1 handler.
      const replay = new http.IncomingMessage(socket);
      Object.assign(replay, { method: req.method, url: req.url, headers: req.headers, complete: true });
      if (received) replay.push(Buffer.concat(chunks, received).subarray(0, contentLength));
      replay.push(null);
      const res = new http.ServerResponse(replay);
      res.shouldKeepAlive = false;
      res.assignSocket(socket);
      res.once("finish", () => socket.end());
      Promise.resolve().then(() => wrapped(replay, res)).catch((error) => {
        console.error("Failed to downgrade h2c request", error);
        socket.destroy();
      });
    };
    if (received >= contentLength) serve();
    else {
      socket.on("data", function readBody(chunk) {
        chunks.push(chunk);
        received += chunk.length;
        if (received < contentLength) return;
        socket.off("data", readBody);
        serve();
      });
      socket.resume();
    }
    delete req.headers.upgrade;
    delete req.headers["http2-settings"];
    req.headers.connection = "close";
    return true;
  };
  return server;
};

if (require.main === module) {
  const standalone = path.join(__dirname, "server.js");
  if (fs.existsSync(standalone)) {
    require(standalone);
  } else {
    // Repo checkout has no standalone build next to us. `next start` builds its HTTP
    // server in-process, so the wrapper above still sanitizes every request.
    const nextBin = require.resolve("next/dist/bin/next");
    process.argv = [process.argv[0], nextBin, "start", ...process.argv.slice(2)];
    require(nextBin);
  }
}
