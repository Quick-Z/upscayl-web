const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const host = process.env.WEB_HOST || "127.0.0.1";
const port = Number.parseInt(process.env.WEB_PORT || "5173", 10);
const webRoot = path.resolve(__dirname);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};

function send(response, status, body, headers = {}) {
  response.writeHead(status, {
    "Cache-Control": "no-cache",
    ...headers,
  });
  response.end(body);
}

const server = http.createServer((request, response) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    send(response, 405, "Method Not Allowed", { Allow: "GET, HEAD" });
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url || "/", `http://${host}:${port}`).pathname);
  } catch {
    send(response, 400, "Bad Request");
    return;
  }

  const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = path.resolve(webRoot, relativePath);
  if (filePath !== webRoot && !filePath.startsWith(`${webRoot}${path.sep}`)) {
    send(response, 403, "Forbidden");
    return;
  }

  fs.stat(filePath, (statError, stats) => {
    if (!statError && stats.isDirectory()) {
      send(response, 403, "Forbidden");
      return;
    }

    fs.readFile(filePath, (readError, data) => {
      if (readError) {
        send(response, readError.code === "ENOENT" ? 404 : 500, readError.code === "ENOENT" ? "Not Found" : "Internal Server Error");
        return;
      }

      const extension = path.extname(filePath).toLowerCase();
      const headers = {
        "Content-Type": mimeTypes[extension] || "application/octet-stream",
        "Content-Length": data.length,
      };
      if (request.method === "HEAD") {
        response.writeHead(200, { "Cache-Control": "no-cache", ...headers });
        response.end();
      } else {
        send(response, 200, data, headers);
      }
    });
  });
});

server.on("error", (error) => {
  console.error("Web server error:", error.message);
  process.exitCode = 1;
});

server.listen(port, host, () => {
  console.log(`Upscayl web UI listening on http://${host}:${port}`);
  console.log(`Serving ${webRoot}`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
