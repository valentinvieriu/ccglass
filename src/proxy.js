// Reverse proxy: Claude Code talks plain HTTP to this server (via
// ANTHROPIC_BASE_URL), we capture the full request + streamed response and
// forward to the real Anthropic API over HTTPS. No TLS interception needed.

import http from "node:http";
import https from "node:https";

export function createProxy({ upstream, store }) {
  const up = new URL(upstream);
  const client = up.protocol === "http:" ? http : https;

  return http.createServer((req, res) => {
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
      rec.startedAt = startedAt;
      let finished = false;
      const fail = (error) => {
        if (finished) return;
        finished = true;
        rec.response = { error: error.message, finishedAt: Date.now() };
        store.update(rec);
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
          res.writeHead(proxyRes.statusCode, proxyRes.headers);
          const respChunks = [];
          let firstByteAt;
          proxyRes.on("data", (c) => {
            if (firstByteAt == null) firstByteAt = Date.now();
            respChunks.push(c);
            if (!res.write(c)) {
              proxyRes.pause();
              res.once("drain", () => proxyRes.resume());
            }
          });
          proxyRes.on("end", () => {
            if (finished) return;
            finished = true;
            res.end();
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
