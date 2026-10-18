"use strict";

const { spawn } = require("node:child_process");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");

const WEB_PORT = 8099;
const EXPO_PORT = 45118;
const HOST = "127.0.0.1";
// Expo's dev server binds IPv6 localhost (::1), not 127.0.0.1.
const EXPO_HOST = "::1";
const root = path.join(__dirname, "..");
const cli = path.join(root, "node_modules", "expo", "bin", "cli");

function withIsolation(headers) {
  const next = { ...headers };
  delete next["cross-origin-opener-policy"];
  delete next["cross-origin-embedder-policy"];
  next["Cross-Origin-Opener-Policy"] = "same-origin";
  next["Cross-Origin-Embedder-Policy"] = "require-corp";
  return next;
}

function forwardHeaders(incoming) {
  const headers = {};
  for (const [key, value] of Object.entries(incoming)) {
    if (value == null) continue;
    headers[key] = key.toLowerCase() === "host" ? `localhost:${EXPO_PORT}` : value;
  }
  headers.host = `localhost:${EXPO_PORT}`;
  return headers;
}

const expo = spawn(
  process.execPath,
  [cli, "start", "--web", "--host", "localhost", "--port", String(EXPO_PORT)],
  {
    cwd: root,
    env: { ...process.env, EXPO_NO_TELEMETRY: "1", BROWSER: "none" },
    stdio: ["inherit", "pipe", "pipe"],
  },
);

expo.stdout.on("data", (chunk) => {
  process.stdout.write(chunk);
});
expo.stderr.on("data", (chunk) => {
  process.stderr.write(chunk);
});
expo.on("exit", (code) => {
  process.exit(code == null ? 1 : code);
});

const server = http.createServer((req, res) => {
  const upstream = http.request(
    {
      hostname: EXPO_HOST,
      port: EXPO_PORT,
      path: req.url,
      method: req.method,
      headers: forwardHeaders(req.headers),
    },
    (proxied) => {
      res.writeHead(proxied.statusCode ?? 502, withIsolation(proxied.headers));
      proxied.pipe(res);
    },
  );
  upstream.on("error", () => {
    if (!res.headersSent) {
      res.statusCode = 503;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("The grid is still starting.");
    }
  });
  req.pipe(upstream);
});

server.on("upgrade", (req, socket, head) => {
  const upstream = net.connect(EXPO_PORT, EXPO_HOST, () => {
    const lines = [`${req.method} ${req.url} HTTP/1.1`];
    for (const [key, value] of Object.entries(forwardHeaders(req.headers))) {
      const list = Array.isArray(value) ? value : [value];
      for (const item of list) lines.push(`${key}: ${item}`);
    }
    upstream.write(`${lines.join("\r\n")}\r\n\r\n`);
    if (head.length > 0) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  const stop = () => {
    socket.destroy();
    upstream.destroy();
  };
  upstream.on("error", stop);
  socket.on("error", stop);
});

server.listen(WEB_PORT, HOST, () => {
  process.stdout.write(`MyDTC: http://${HOST}:${WEB_PORT}\n`);
  if (process.env.HABIT_LOG_NO_OPEN === "1") return;
  const opener = process.platform === "darwin" ? "open" : null;
  if (!opener) return;
  const child = spawn(opener, [`http://${HOST}:${WEB_PORT}`], { stdio: "ignore" });
  child.on("error", () => undefined);
});

function shutdown() {
  server.close();
  expo.kill("SIGTERM");
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
