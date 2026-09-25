const express = require("express");
const fetch = require("node-fetch");

const app = express();
const PORT = process.env.PORT || 3000;

const BASE_TARGET = "https://proxy.streamvideo.co.in/fetch/api.penpencil.co";

// Browser-like headers that mimic a real Chrome request
const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
  Accept: "application/json",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  "client-id": "5eb393ee95fab7468a79d189",
  "client-type": "WEB",
  "client-version": "2.2.7",
  priority: "u=1, i",
  randomid: "4bb61dbd-bc60-4a20-a1aa-44e7c0c8e0ec",
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "cross-site",
  "Sec-GPC": "1",
  Connection: "keep-alive",
};

// Allow CORS from any origin so browsers can call this proxy
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, DELETE, OPTIONS, PATCH"
  );
  res.setHeader("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Proxy handler for /api/* routes (Express 5 uses :path* syntax)
app.all("/api/{*path}", async (req, res) => {
  // Strip the leading /api from the path and append the rest to the target
  const subPath = req.path.replace(/^\/api/, "");
  const queryString = req.url.includes("?")
    ? req.url.slice(req.url.indexOf("?"))
    : "";
  const targetUrl = `${BASE_TARGET}${subPath}${queryString}`;

  console.log(`[PROXY] ${req.method} ${req.path} → ${targetUrl}`);

  try {
    // Forward any extra headers the client passed (excluding hop-by-hop ones)
    const hopByHop = new Set([
      "host",
      "connection",
      "transfer-encoding",
      "upgrade",
      "proxy-authorization",
      "proxy-authenticate",
      "te",
      "trailer",
    ]);

    const forwardedHeaders = { ...BROWSER_HEADERS };
    for (const [key, value] of Object.entries(req.headers)) {
      if (!hopByHop.has(key.toLowerCase())) {
        // Let client override specific headers (e.g. Authorization, token)
        if (
          !forwardedHeaders[key] ||
          key.toLowerCase() === "authorization" ||
          key.toLowerCase() === "token"
        ) {
          forwardedHeaders[key] = value;
        }
      }
    }

    const fetchOptions = {
      method: req.method,
      headers: forwardedHeaders,
      redirect: "follow",
      // Disable compression handling so we pass through raw bytes if needed
      compress: true,
    };

    // Forward body for POST/PUT/PATCH
    if (["POST", "PUT", "PATCH"].includes(req.method)) {
      fetchOptions.body = req;
    }

    const upstream = await fetch(targetUrl, fetchOptions);

    // Forward response status and headers back to client
    res.status(upstream.status);

    const skipHeaders = new Set([
      "transfer-encoding",
      "connection",
      "keep-alive",
      "upgrade",
      "proxy-authenticate",
      "proxy-authorization",
    ]);

    for (const [key, value] of upstream.headers.entries()) {
      if (!skipHeaders.has(key.toLowerCase())) {
        res.setHeader(key, value);
      }
    }

    // Always expose CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");

    // Stream the body back
    upstream.body.pipe(res);
  } catch (err) {
    console.error(`[ERROR] ${err.message}`);
    res.status(502).json({
      error: "Bad Gateway",
      message: err.message,
      target: targetUrl,
    });
  }
});

// Health check
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    usage: "Send any GET to /api/<path> and it will be proxied to api.penpencil.co",
    example: "/api/v3/batches/6983292ceb07d7fbf8beb6d2/details",
  });
});

app.listen(PORT, () => {
  console.log(`Proxy server running on port ${PORT}`);
  console.log(`Example: http://localhost:${PORT}/api/v3/batches/.../details`);
});
