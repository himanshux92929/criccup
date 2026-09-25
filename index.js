const express = require("express");
const { execFile } = require("child_process");
const { randomUUID } = require("crypto");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const BASE = "https://proxy.streamvideo.co.in/fetch/api.penpencil.co";
const CURL = path.join(__dirname, "bin", "curl-impersonate-chrome");

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS,PATCH");
  res.setHeader("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.get("/", (_req, res) => {
  res.json({
    status: "ok",
    example: "/api/v3/batches/6983292ceb07d7fbf8beb6d2/details",
  });
});

app.all("/api/*", (req, res) => {
  const subPath  = req.path.replace(/^\/api/, "");
  const qs       = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
  const target   = `${BASE}${subPath}${qs}`;
  const hdrFile  = `/tmp/hdr_${randomUUID()}`;

  console.log(`[→] ${req.method} ${target}`);

  const args = [
    "-s", "-S",                       // silent but show errors
    "--location",                     // follow redirects
    "--max-time", "30",
    "--compressed",                   // brotli/gzip like a real browser
    "-X", req.method,
    // ---- penpencil required headers ----
    "-H", "Accept: application/json",
    "-H", "Accept-Language: en-US,en;q=0.9",
    "-H", "client-id: 5eb393ee95fab7468a79d189",
    "-H", "client-type: WEB",
    "-H", "client-version: 2.2.7",
    "-H", "priority: u=1, i",
    "-H", `randomid: ${randomUUID()}`,   // fresh per request
    "-H", "Sec-Fetch-Dest: empty",
    "-H", "Sec-Fetch-Mode: cors",
    "-H", "Sec-Fetch-Site: cross-site",
    "-H", "Sec-GPC: 1",
    // ---- forward auth from caller if present ----
    ...(req.headers["authorization"] ? ["-H", `Authorization: ${req.headers["authorization"]}`] : []),
    ...(req.headers["token"]         ? ["-H", `token: ${req.headers["token"]}`]                 : []),
    // ---- status code appended to end of stdout ----
    "--write-out", "\n__STATUS__%{http_code}",
    "--dump-header", hdrFile,
    target,
  ];

  execFile(CURL, args, { maxBuffer: 20 * 1024 * 1024 }, (err, stdout, stderr) => {
    // --- parse status code from write-out marker ---
    const marker = "\n__STATUS__";
    const markerIdx = stdout.lastIndexOf(marker);
    let statusCode = 200;
    let body = stdout;

    if (markerIdx !== -1) {
      statusCode = parseInt(stdout.slice(markerIdx + marker.length)) || 200;
      body = stdout.slice(0, markerIdx);
    }

    // --- parse + forward response headers ---
    try {
      const raw = fs.readFileSync(hdrFile, "utf8");
      fs.unlinkSync(hdrFile);
      const skip = new Set(["transfer-encoding","connection","keep-alive","content-encoding"]);
      for (const line of raw.split("\r\n").slice(1)) {
        const sep = line.indexOf(":");
        if (sep === -1) continue;
        const k = line.slice(0, sep).trim().toLowerCase();
        const v = line.slice(sep + 1).trim();
        if (!skip.has(k)) res.setHeader(k, v);
      }
    } catch (_) {}

    res.setHeader("Access-Control-Allow-Origin", "*");

    if (err) {
      // curl itself failed (network error, timeout, etc.)
      console.error("[curl error]", err.message, stderr);
      return res.status(502).json({ error: "curl failed", message: err.message || stderr });
    }

    console.log(`[←] ${statusCode} ${target}`);
    res.status(statusCode).send(body);
  });
});

app.listen(PORT, () => console.log(`Proxy up on :${PORT}`));
