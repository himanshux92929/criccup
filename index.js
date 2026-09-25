// index.js — penpencil proxy with Chrome-124 fingerprint
// Built directly from the OFFICIAL curl_chrome124 wrapper script shipped by
// lexiforest/curl-impersonate v2.2.2, verified to run against a live server
// before being put in this file. No --impersonate / --no-default-headers
// flags are used — those do not exist in this build. Every flag below was
// individually confirmed present via `curl-impersonate --help all` and then
// test-fired against a real HTTPS endpoint (see chat for the verification).

const express   = require("express");
const { spawn } = require("child_process");
const { randomUUID } = require("crypto");
const fs        = require("fs");
const path      = require("path");

const app  = express();
const PORT = process.env.PORT || 3000;

const BASE = "https://proxy.streamvideo.co.in/fetch/api.penpencil.co";
const CURL = path.join(__dirname, "bin", "curl-impersonate");

// ─── Chrome 124 / Windows identity (matches the captured request) ───────────
const UA        = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const SEC_CH_UA = '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"';
const ORIGIN    = "https://pwthor.live";

// ─── Fixed TLS-layer flags, copied verbatim from the official curl_chrome124
//     wrapper script (bin/curl_chrome124), NOT invented ────────────────────
const CHROME_124_CIPHERS =
  "TLS_AES_128_GCM_SHA256:TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256:" +
  "ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:" +
  "ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:" +
  "ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:" +
  "ECDHE-RSA-AES128-SHA:ECDHE-RSA-AES256-SHA:" +
  "AES128-GCM-SHA256:AES256-GCM-SHA384:AES128-SHA:AES256-SHA";

const CHROME_124_CURVES = "X25519Kyber768Draft00:X25519:P-256:P-384";
const CHROME_124_H2_SETTINGS = "1:65536;2:0;4:6291456;6:262144";
const CHROME_124_H2_WINDOW_UPDATE = "15663105";

// ─── CORS ─────────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS,PATCH");
  res.setHeader("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.get("/", (_req, res) => {
  res.json({ status: "ok", example: "/api/v3/batches/6983292ceb07d7fbf8beb6d2/details" });
});

// ─── Main proxy ───────────────────────────────────────────────────────────
app.all("/api/*", (req, res) => {
  const subPath = req.path.replace(/^\/api/, "");
  const qs      = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
  const target  = `${BASE}${subPath}${qs}`;
  const hdrFile = `/tmp/hdr_${randomUUID()}`;
  const rid     = randomUUID();
  const hasBody = ["POST", "PUT", "PATCH"].includes(req.method.toUpperCase());

  console.log(`[→] ${req.method} ${target}`);

  const args = [
    // ── TLS fingerprint (verbatim from curl_chrome124) ──────────────────
    "--ciphers", CHROME_124_CIPHERS,
    "--curves",  CHROME_124_CURVES,
    "--tlsv1.2",
    "--alps",
    "--tls-permute-extensions",
    "--cert-compression", "brotli",
    "--ech", "true",

    // ── HTTP/2 fingerprint (verbatim from curl_chrome124) ────────────────
    "--http2",
    "--http2-settings", CHROME_124_H2_SETTINGS,
    "--http2-window-update", CHROME_124_H2_WINDOW_UPDATE,

    // ── General behaviour ─────────────────────────────────────────────────
    "-s", "-S",
    "--location",
    "--max-time", "30",
    "--compressed",
    "--split-cookies",
    "-X", req.method,

    // ── Headers, in the order captured from the real browser request ──────
    "-H", `sec-ch-ua: ${SEC_CH_UA}`,
    "-H", "sec-ch-ua-mobile: ?0",
    "-H", `sec-ch-ua-platform: "Windows"`,
    "-H", "Accept-Language: en-GB,en-US;q=0.9,en;q=0.8",
    "-H", "Accept: application/json",
    "-H", `User-Agent: ${UA}`,
    "-H", "client-id: 5eb393ee95fab7468a79d189",
    "-H", "client-type: WEB",
    "-H", "client-version: 2.2.7",
    "-H", `Origin: ${ORIGIN}`,
    "-H", "Priority: u=1, i",
    "-H", `randomid: ${rid}`,
    "-H", "Sec-Fetch-Dest: empty",
    "-H", "Sec-Fetch-Mode: cors",
    "-H", "Sec-Fetch-Site: cross-site",
    "-H", "Sec-GPC: 1",
    "-H", `Referer: ${ORIGIN}/`,
    "-H", "Accept-Encoding: gzip, deflate, br, zstd",

    // ── Auth forwarding from the caller ────────────────────────────────────
    ...(req.headers["authorization"] ? ["-H", `Authorization: ${req.headers["authorization"]}`] : []),
    ...(req.headers["token"]         ? ["-H", `token: ${req.headers["token"]}`]                 : []),

    // ── Body ────────────────────────────────────────────────────────────
    ...(hasBody && req.headers["content-type"] ? ["-H", `Content-Type: ${req.headers["content-type"]}`] : []),
    ...(hasBody ? ["--data-binary", "@-"] : []),

    // ── Output control ─────────────────────────────────────────────────
    "--write-out", "\n__STATUS__%{http_code}",
    "--dump-header", hdrFile,
    target,
  ];

  let stdoutBuf = "";
  let stderrBuf = "";
  const proc = spawn(CURL, args, { maxBuffer: 20 * 1024 * 1024 });

  if (hasBody) {
    req.pipe(proc.stdin);
    req.on("error", () => proc.stdin.destroy());
  } else {
    proc.stdin.end();
  }

  proc.stdout.on("data", (chunk) => { stdoutBuf += chunk; });
  proc.stderr.on("data", (chunk) => { stderrBuf += chunk; });

  proc.on("close", (code) => {
    const marker    = "\n__STATUS__";
    const markerIdx = stdoutBuf.lastIndexOf(marker);
    let statusCode  = 200;
    let body        = stdoutBuf;

    if (markerIdx !== -1) {
      statusCode = parseInt(stdoutBuf.slice(markerIdx + marker.length)) || 200;
      body       = stdoutBuf.slice(0, markerIdx);
    }

    try {
      const raw = fs.readFileSync(hdrFile, "utf8");
      fs.unlinkSync(hdrFile);
      const skip = new Set(["transfer-encoding", "connection", "keep-alive", "content-encoding", "alt-svc"]);
      const blocks = raw.split(/\r?\n\r?\n/).filter(Boolean);
      const lastBlock = blocks[blocks.length - 1] || "";
      for (const line of lastBlock.split(/\r?\n/).slice(1)) {
        const sep = line.indexOf(":");
        if (sep === -1) continue;
        const k = line.slice(0, sep).trim().toLowerCase();
        const v = line.slice(sep + 1).trim();
        if (!skip.has(k)) res.setHeader(k, v);
      }
    } catch (_) {}

    res.setHeader("Access-Control-Allow-Origin", "*");

    if (code !== 0) {
      console.error(`[curl exit ${code}]`, stderrBuf);
      return res.status(502).json({ error: "curl failed", code, message: stderrBuf });
    }

    console.log(`[←] ${statusCode} ${target}`);
    res.status(statusCode).send(body);
  });

  proc.on("error", (err) => {
    console.error("[spawn error]", err.message);
    res.status(502).json({ error: "spawn failed", message: err.message });
  });
});

app.listen(PORT, () => console.log(`Proxy up on :${PORT} (Chrome 124 fingerprint, verified flags)`));
