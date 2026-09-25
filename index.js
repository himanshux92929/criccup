// index.js — penpencil proxy with maximum browser authenticity
// Uses lexiforest/curl-impersonate v2.2.2 with full Chrome 124 impersonation
// Covers: TLS (JA3/JA4/BoringSSL), HTTP/2 Akamai fingerprint, header order, GREASE, ECH, ZSTD

const express   = require("express");
const { spawn } = require("child_process");
const { randomUUID } = require("crypto");
const fs        = require("fs");
const path      = require("path");

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── Target ──────────────────────────────────────────────────────────────────
const BASE = "https://proxy.streamvideo.co.in/fetch/api.penpencil.co";

// ─── Binary — use the v2 lexiforest fork (single binary, --impersonate flag) ─
const CURL = path.join(__dirname, "bin", "curl-impersonate");

// ─── Chrome identity ─────────────────────────────────────────────────────────
// Chrome 124 on Windows 10 — matches the capture exactly, and has stable
// JA4 support including X25519Kyber768 (post-quantum) introduced in Chrome 124
const CHROME_VER      = "124";
const CHROME_FULL     = "124.0.6367.60";
const UA              = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_FULL} Safari/537.36`;
const SEC_CH_UA       = `"Chromium";v="${CHROME_VER}", "Google Chrome";v="${CHROME_VER}", "Not-A.Brand";v="99"`;
const ORIGIN          = "https://pwthor.live";

// ─── CORS middleware ──────────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS,PATCH");
  res.setHeader("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// ─── Health ───────────────────────────────────────────────────────────────────
app.get("/", (_req, res) => {
  res.json({
    status:  "ok",
    binary:  CURL,
    chrome:  CHROME_FULL,
    example: "/api/v3/batches/6983292ceb07d7fbf8beb6d2/details",
  });
});

// ─── Main proxy ───────────────────────────────────────────────────────────────
app.all("/api/*", (req, res) => {
  const subPath = req.path.replace(/^\/api/, "");
  const qs      = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
  const target  = `${BASE}${subPath}${qs}`;
  const hdrFile = `/tmp/hdr_${randomUUID()}`;
  const rid     = randomUUID();
  const hasBody = ["POST", "PUT", "PATCH"].includes(req.method.toUpperCase());

  console.log(`[→] ${req.method} ${target}`);

  // ── Build curl-impersonate args ─────────────────────────────────────────
  //
  // --impersonate chrome124 handles ALL of:
  //   • BoringSSL TLS library (not OpenSSL) → real Chrome JA3/JA4
  //   • Cipher suite order (GREASE + Chrome's list)
  //   • TLS extension list + permutation (Chrome 110+ randomises order)
  //   • Supported groups including X25519Kyber768 (Chrome 124+)
  //   • ALPN negotiation (h2,http/1.1)
  //   • ALPS extension
  //   • Encrypted Client Hello (ECH) support
  //   • Signature algorithms
  //   • Certificate compression (brotli)
  //   • HTTP/2 SETTINGS frame: 1:65536;2:0;3:1000;4:6291456;6:262144
  //   • HTTP/2 WINDOW_UPDATE: 15663105
  //   • HTTP/2 pseudo-header order: :method :authority :scheme :path (maps)
  //   • HTTP/2 stream priority weight/exclusivity
  //   • ZSTD decompression (Chrome 123+)
  //   • No Server Push (Chrome dropped it)
  //
  // We supply our own application-level headers (--no-default-headers prevents
  // the built-in browser headers so we control the exact set and order).

  const args = [
    // ── Core behaviour ─────────────────────────────────────────────────────
    "--impersonate",    "chrome124",   // full TLS + HTTP/2 fingerprint
    "--no-default-headers",            // we set headers ourselves (order matters)
    "-s", "-S",                        // silent + show errors
    "--location",                      // follow redirects
    "--max-time",       "30",
    "--compressed",                    // brotli / gzip / zstd

    // ── Method ─────────────────────────────────────────────────────────────
    "-X", req.method,

    // ── Application headers in EXACT order from the captured request ───────
    // Note: HTTP/2 pseudo-headers (:method :authority :scheme :path) are
    // inserted by curl-impersonate automatically in Chrome's order (maps).
    // Regular headers follow the order below, which must match Chrome's wire
    // ordering for the Akamai/JA4H HTTP-layer fingerprint.
    "-H", `sec-ch-ua: ${SEC_CH_UA}`,
    "-H", "sec-ch-ua-mobile: ?0",
    "-H", `sec-ch-ua-platform: "Windows"`,
    "-H", "Accept-Language: en-GB,en-US;q=0.9,en;q=0.8",
    "-H", "Accept: application/json",
    "-H", `user-agent: ${UA}`,
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

    // ── Auth forwarding ────────────────────────────────────────────────────
    ...(req.headers["authorization"]
        ? ["-H", `Authorization: ${req.headers["authorization"]}`] : []),
    ...(req.headers["token"]
        ? ["-H", `token: ${req.headers["token"]}`] : []),

    // ── Body ───────────────────────────────────────────────────────────────
    ...(hasBody && req.headers["content-type"]
        ? ["-H", `Content-Type: ${req.headers["content-type"]}`] : []),
    ...(hasBody ? ["--data-binary", "@-"] : []),

    // ── Output control ─────────────────────────────────────────────────────
    "--write-out",    "\n__STATUS__%{http_code}",
    "--dump-header",  hdrFile,
    target,
  ];

  // ── Spawn (use spawn not execFile so we can pipe stdin) ──────────────────
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
    // ── Parse status from write-out marker ──────────────────────────────
    const marker    = "\n__STATUS__";
    const markerIdx = stdoutBuf.lastIndexOf(marker);
    let statusCode  = 200;
    let body        = stdoutBuf;

    if (markerIdx !== -1) {
      statusCode = parseInt(stdoutBuf.slice(markerIdx + marker.length)) || 200;
      body       = stdoutBuf.slice(0, markerIdx);
    }

    // ── Parse + forward response headers ────────────────────────────────
    try {
      const raw  = fs.readFileSync(hdrFile, "utf8");
      fs.unlinkSync(hdrFile);
      const skip = new Set([
        "transfer-encoding", "connection", "keep-alive", "content-encoding",
        "alt-svc",  // don't forward HTTP/3 upgrade hints
      ]);
      // Handle redirect chain — take the last header block
      const blocks = raw.split(/\r?\n\r?\n/).filter(Boolean);
      const lastBlock = blocks[blocks.length - 1] || "";
      for (const line of lastBlock.split(/\r?\n/).slice(1)) {
        const sep = line.indexOf(":");
        if (sep === -1) continue;
        const k = line.slice(0, sep).trim().toLowerCase();
        const v = line.slice(sep + 1).trim();
        if (!skip.has(k)) res.setHeader(k, v);
      }
    } catch (_) { /* header file missing on curl error */ }

    res.setHeader("Access-Control-Allow-Origin", "*");

    if (code !== 0 && statusCode === 200) {
      console.error(`[curl exit ${code}]`, stderrBuf);
      return res.status(502).json({
        error:   "curl failed",
        code,
        message: stderrBuf,
      });
    }

    console.log(`[←] ${statusCode} ${target}`);
    res.status(statusCode).send(body);
  });

  proc.on("error", (err) => {
    console.error("[spawn error]", err.message);
    res.status(502).json({ error: "spawn failed", message: err.message });
  });
});

app.listen(PORT, () => console.log(`Proxy up on :${PORT}  (Chrome ${CHROME_FULL} fingerprint)`));
