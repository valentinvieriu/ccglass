// Reverse proxy: Claude Code talks plain HTTP to this server (via
// ANTHROPIC_BASE_URL), we capture the full request + streamed response and
// forward to the real Anthropic API over HTTPS. No TLS interception needed.

import http from "node:http";
import https from "node:https";

export function createProxy({ upstream, store, corsOrigins = process.env.CCGLASS_CORS_ORIGINS || "" }) {
  const up = new URL(upstream);
  const client = up.protocol === "http:" ? http : https;
  const allowedOrigins = new Set(corsOrigins.split(",").map((origin) => origin.trim()).filter(Boolean));
  const corsEnabled = allowedOrigins.size > 0;

  return http.createServer((req, res) => {
    const origin = req.headers.origin;
    const corsOrigin = allowedOrigins.has("*") ? "*" : origin;
    if (corsEnabled) {
      res.setHeader("vary", "Origin");
      if (origin && !allowedOrigins.has("*") && !allowedOrigins.has(origin)) {
        req.resume();
        res.writeHead(403, { "content-type": "text/plain" });
        res.end("ccglass: origin is not allowed");
        return;
      }
      if (origin) {
        res.setHeader("access-control-allow-origin", corsOrigin);
        if (req.method === "OPTIONS" && req.headers["access-control-request-method"]) {
          req.resume();
          res.setHeader("vary", "Origin, Access-Control-Request-Method, Access-Control-Request-Headers");
          res.setHeader("access-control-allow-methods", "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS");
          if (req.headers["access-control-request-headers"]) {
            res.setHeader("access-control-allow-headers", req.headers["access-control-request-headers"]);
          }
          res.setHeader("access-control-max-age", "600");
          res.writeHead(204);
          res.end();
          return;
        }
      }
    }

    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const bodyBuf = Buffer.concat(chunks);
      let body;
      try {
        body = JSON.parse(bodyBuf.toString("utf8"));
      } catch {
        body = bodyBuf.length ? bodyBuf.toString("utf8") : null;
      }

      const rec = store.add({
        request: {
          method: req.method,
          url: req.url,
          headers: { ...req.headers },
          body,
        },
      });
      const startedAt = Date.now();
      if (rec) rec.startedAt = startedAt;
      let finished = false;
      const fail = (error) => {
        if (finished) return;
        finished = true;
        if (rec) {
          rec.response = { error: error.message, finishedAt: Date.now() };
          store.update(rec);
        }
        if (res.destroyed) return;
        if (res.headersSent) {
          res.destroy(error);
        } else {
          res.writeHead(502, { "content-type": "text/plain" });
          res.end(`ccglass: upstream error: ${error.message}`);
        }
      };

      // Forward upstream. Strip accept-encoding so the captured response is
      // plain text (no gzip/br to decode) — Claude Code handles uncompressed fine.
      const headers = { ...req.headers, host: up.host };
      delete headers["accept-encoding"];

      const proxyReq = client.request(
        {
          protocol: up.protocol,
          hostname: up.hostname,
          port: up.port || (up.protocol === "http:" ? 80 : 443),
          path: (up.pathname === "/" ? "" : up.pathname) + req.url,
          method: req.method,
          headers,
        },
        (proxyRes) => {
          if (finished) {
            proxyRes.destroy();
            return;
          }
          proxyRes.on("error", fail);
          const responseHeaders = { ...proxyRes.headers };
          if (corsEnabled) {
            responseHeaders.vary = [...new Set([
              ...(proxyRes.headers.vary || "").split(",").map((value) => value.trim()).filter(Boolean),
              "Origin",
            ])].join(", ");
            if (origin) responseHeaders["access-control-allow-origin"] = corsOrigin;
          }
          res.writeHead(proxyRes.statusCode, responseHeaders);
          const respChunks = [];
          let firstByteAt;
          proxyRes.on("data", (c) => {
            if (firstByteAt == null) firstByteAt = Date.now();
            if (rec) respChunks.push(c);
            if (!res.write(c)) {
              proxyRes.pause();
              res.once("drain", () => proxyRes.resume());
            }
          });
          proxyRes.on("end", () => {
            if (finished) return;
            finished = true;
            res.end();
            if (!rec) return;
            const doneAt = Date.now();
            rec.response = {
              status: proxyRes.statusCode,
              headers: proxyRes.headers,
              raw: Buffer.concat(respChunks).toString("utf8"),
              firstByteAt: firstByteAt ?? doneAt,
              finishedAt: doneAt,
            };
            store.update(rec);
          });
        }
      );

      proxyReq.on("error", fail);
      res.on("close", () => {
        if (!res.writableEnded) {
          fail(new Error("client disconnected"));
          proxyReq.destroy();
        }
      });

      proxyReq.end(bodyBuf);
    });
  });
}
