const express = require("express");
const { execFile } = require("child_process");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

const BASE_TARGET = "https://proxy.streamvideo.co.in/fetch/api.penpencil.co";

// Path to curl-impersonate-chrome binary (bundled in /app/bin/ on Render)
const CURL_BIN = path.join(__dirname, "bin", "curl-impersonate-chrome");

// CORS for all origins
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS, PATCH");
  res.setHeader("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Health check
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    usage: "GET /api/<path> → proxied to api.penpencil.co with real Chrome TLS fingerprint",
    example: "/api/v3/batches/6983292ceb07d7fbf8beb6d2/details",
  });
});

// Proxy all /api/* requests
app.all("/api/*", (req, res) => {
  const subPath = req.path.replace(/^\/api/, "");
  const queryString = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
  const targetUrl = `${BASE_TARGET}${subPath}${queryString}`;

  console.log(`[PROXY] ${req.method} ${req.path} → ${targetUrl}`);

  // Build curl-impersonate args — mimics a real Chrome 110 browser request
  const args = [
    "--silent",
    "--show-error",
    "--location",                          // follow redirects
    "--max-time", "30",
    "--compressed",                        // accept brotli/gzip like a browser
    "-X", req.method,
    // Headers exactly matching the target app's expected values
    "-H", "Accept: application/json",
    "-H", "Accept-Language: en-US,en;q=0.9",
    "-H", "client-id: 5eb393ee95fab7468a79d189",
    "-H", "client-type: WEB",
    "-H", "client-version: 2.2.7",
    "-H", "priority: u=1, i",
    "-H", "randomid: 4bb61dbd-bc60-4a20-a1aa-44e7c0c8e0ec",
    "-H", "Sec-Fetch-Dest: empty",
    "-H", "Sec-Fetch-Mode: cors",
    "-H", "Sec-Fetch-Site: cross-site",
    "-H", "Sec-GPC: 1",
    // Forward Authorization/token from the incoming request if present
    ...(req.headers["authorization"] ? ["-H", `Authorization: ${req.headers["authorization"]}`] : []),
    ...(req.headers["token"] ? ["-H", `token: ${req.headers["token"]}`] : []),
    // Write response headers to stderr-side file so we can parse them
    "--dump-header", "/tmp/resp_headers_" + process.pid,
    targetUrl,
  ];

  execFile(CURL_BIN, args, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
    const headerFile = "/tmp/resp_headers_" + process.pid;

    // Parse dumped response headers
    let statusCode = 200;
    try {
      const fs = require("fs");
      const raw = fs.readFileSync(headerFile, "utf8");
      fs.unlinkSync(headerFile);
      const lines = raw.split("\r\n").filter(Boolean);
      const statusLine = lines[0] || "";
      const match = statusLine.match(/HTTP\/[\d.]+ (\d+)/);
      if (match) statusCode = parseInt(match[1]);

      // Forward select response headers
      for (const line of lines.slice(1)) {
        const sep = line.indexOf(":");
        if (sep === -1) continue;
        const key = line.slice(0, sep).trim().toLowerCase();
        const val = line.slice(sep + 1).trim();
        const skip = ["transfer-encoding", "connection", "keep-alive", "content-encoding"];
        if (!skip.includes(key)) res.setHeader(key, val);
      }
    } catch (_) {}

    res.setHeader("Access-Control-Allow-Origin", "*");

    if (err && !stdout) {
      console.error("[curl-impersonate error]", stderr);
      return res.status(502).json({ error: "Bad Gateway", message: stderr });
    }

    res.status(statusCode).send(stdout);
  });
});

app.listen(PORT, () => {
  console.log(`curl-impersonate proxy running on port ${PORT}`);
});
