import assert from "node:assert/strict";
import http from "node:http";
import { EventEmitter, once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Store } from "../src/store.js";
import { createProxy } from "../src/proxy.js";
import { createServer } from "../src/server.js";
import { loadSession } from "../src/store.js";

async function listen(t, server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  });
  return `http://127.0.0.1:${server.address().port}`;
}

function store(t) {
  const root = mkdtempSync(path.join(tmpdir(), "ccglass-setup-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return new Store({ root, format: "openai" });
}

test("dashboard capture controls preserve history and forward unrecorded traffic while stopped", async (t) => {
  const captures = store(t);
  const upstream = await listen(
    t,
    http.createServer((req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"ok":true}');
    }),
  );
  const proxy = await listen(t, createProxy({ upstream, store: captures }));
  const dashboard = await listen(t, createServer({ roots: [captures.root], store: captures }));
  const control = async (action, session = "") => {
    const response = await fetch(
      `${dashboard}/api/sessions/${action}?session=${encodeURIComponent(session)}`,
      {
        method: "POST",
        headers: { origin: dashboard },
      },
    );
    assert.equal(response.status, 200);
    return response.json();
  };
  const first = captures.sessionId;
  assert.equal(await (await fetch(proxy)).text(), '{"ok":true}');
  assert.equal((await control("stop")).live, null);
  assert.equal(await (await fetch(proxy)).text(), '{"ok":true}');
  assert.equal(captures.entries.length, 1);
  const second = (await control("start")).live;
  assert.notEqual(first, second);
  assert.equal(await (await fetch(proxy)).text(), '{"ok":true}');
  const saved = await (await fetch(`${dashboard}/api/requests?session=${first}`)).json();
  assert.equal(saved.entries.length, 1);
  const cleared = await control("reset", first);
  assert.equal(cleared.live, second);
  assert.equal(cleared.sessions.length, 2);
  assert.deepEqual(loadSession(captures.root, first), []);
  assert.equal(captures.entries.length, 1);
});

test("capture controls reject unsafe methods, cross-origin calls, unknown sessions and read-only mode", async (t) => {
  const captures = store(t);
  const dashboard = await listen(t, createServer({ roots: [captures.root], store: captures }));
  for (const action of ["start", "stop", "reset", "delete"]) {
    const get = await fetch(`${dashboard}/api/sessions/${action}`);
    assert.equal(get.status, 405);
    assert.equal(get.headers.get("allow"), "POST");
    await get.text();
    const crossOrigin = await fetch(`${dashboard}/api/sessions/${action}`, {
      method: "POST",
      headers: { origin: "https://other.example" },
    });
    assert.equal(crossOrigin.status, 403);
    await crossOrigin.text();
  }
  assert.equal(captures.recording, true);
  const missing = await fetch(`${dashboard}/api/sessions/reset?session=..%2F`, { method: "POST" });
  assert.equal(missing.status, 404);
  await missing.text();
  const readOnly = await listen(t, createServer({ roots: [captures.root] }));
  const rejected = await fetch(`${readOnly}/api/sessions/start`, { method: "POST" });
  assert.equal(rejected.status, 409);
  assert.match((await rejected.json()).error, /read-only/);
  const readOnlyDelete = await fetch(
    `${readOnly}/api/sessions/delete?session=${captures.sessionId}`,
    { method: "POST" },
  );
  assert.equal(readOnlyDelete.status, 409);
  await readOnlyDelete.text();
});

test("Delete API rejects an active session and removes only a stopped session while forwarding continues", async (t) => {
  const captures = store(t);
  const original = captures.sessionId;
  captures.add({ request: { body: "saved request" } });
  const upstream = await listen(
    t,
    http.createServer((req, res) => res.end("forwarded")),
  );
  const proxy = await listen(t, createProxy({ upstream, store: captures }));
  const dashboard = await listen(t, createServer({ roots: [captures.root], store: captures }));
  const remove = (session) =>
    fetch(`${dashboard}/api/sessions/delete?session=${encodeURIComponent(session)}`, {
      method: "POST",
      headers: { origin: dashboard },
    });
  const rejected = await remove(original);
  assert.equal(rejected.status, 409);
  assert.match((await rejected.json()).error, /Stop this session/);
  assert.equal(captures.entries.length, 1);
  captures.stop();
  captures.start();
  const active = captures.sessionId;
  const deleted = await remove(original);
  assert.equal(deleted.status, 200);
  const sessions = await deleted.json();
  assert.equal(sessions.live, active);
  assert.deepEqual(sessions.sessions, [active]);
  const exportDeleted = await fetch(`${dashboard}/api/sessions/export?session=${original}`);
  assert.equal(exportDeleted.status, 404);
  await exportDeleted.text();
  assert.equal(await (await fetch(proxy)).text(), "forwarded");
  assert.equal(captures.entries.length, 1);
  const missing = await remove("../");
  assert.equal(missing.status, 404);
  await missing.text();
});

test("SSE publishes recording transitions and selected-session reset", async (t) => {
  const captures = store(t);
  const dashboard = await listen(t, createServer({ roots: [captures.root], store: captures }));
  const controller = new AbortController();
  t.after(() => controller.abort());
  const response = await fetch(`${dashboard}/api/stream`, { signal: controller.signal });
  const reader = response.body.getReader();
  let buffer = "";
  const nextEvent = async () => {
    for (;;) {
      const end = buffer.indexOf("\n\n");
      if (end >= 0) {
        const event = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (event.startsWith("event: sessions\n")) return JSON.parse(event.split("\ndata: ")[1]);
      } else {
        const { value, done } = await reader.read();
        assert.equal(done, false);
        buffer += new TextDecoder().decode(value);
      }
    }
  };
  assert.equal((await nextEvent()).live, captures.sessionId);
  captures.stop();
  assert.equal((await nextEvent()).live, null);
  captures.start();
  const started = await nextEvent();
  assert.equal(started.sessions.length, 2);
  assert.equal(started.live, captures.sessionId);
  captures.reset(captures.sessionId);
  assert.equal((await nextEvent()).reset, captures.sessionId);
  const session = captures.sessionId;
  captures.stop();
  assert.equal((await nextEvent()).live, null);
  captures.deleteSession(session);
  const deleted = await nextEvent();
  assert.equal(deleted.sessions.includes(session), false);
  assert.equal(deleted.live, null);
  controller.abort();
});

test("a response finishing after Stop/Start stays in the original capture", async (t) => {
  const captures = store(t);
  let finish;
  const upstream = await listen(
    t,
    http.createServer((req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write("data: first\n\n");
      finish = () => res.end("data: done\n\n");
    }),
  );
  const proxy = await listen(t, createProxy({ upstream, store: captures }));
  const original = captures.sessionId;
  const response = await fetch(proxy);
  captures.stop();
  captures.start();
  finish();
  assert.equal(await response.text(), "data: first\n\ndata: done\n\n");
  assert.equal(captures.entries.length, 0);
  assert.equal(
    loadSession(captures.root, original)[0].response.raw,
    "data: first\n\ndata: done\n\n",
  );
});

test("forwarding preserves path, query, auth, body, status and streaming", async (t) => {
  const captures = store(t);
  const upstream = await listen(
    t,
    http.createServer(async (req, res) => {
      assert.equal(req.url, "/openai/v1/responses?trace=setup");
      assert.equal(req.method, "POST");
      assert.equal(req.headers.authorization, "Bearer short");
      assert.equal(req.headers["x-api-key"], "plain-secret");
      assert.equal(req.headers["accept-encoding"], undefined);
      const body = [];
      for await (const chunk of req) body.push(chunk);
      assert.equal(Buffer.concat(body).toString(), '{"model":"setup-test"}');
      res.writeHead(201, {
        "content-type": "text/event-stream",
        "x-setup": "ok",
        "access-control-allow-origin": "https://upstream.example",
        vary: "Accept-Encoding",
      });
      res.write("data: first\n\n");
      setTimeout(() => res.end("data: [DONE]\n\n"), 100);
    }),
  );
  const proxy = await listen(
    t,
    createProxy({
      upstream,
      store: captures,
      corsOrigins: "http://localhost:5173",
    }),
  );
  const updated = once(captures, "update");
  const response = await fetch(`${proxy}/openai/v1/responses?trace=setup`, {
    method: "POST",
    headers: {
      authorization: "Bearer short",
      "x-api-key": "plain-secret",
      origin: "http://localhost:5173",
    },
    body: '{"model":"setup-test"}',
  });
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("x-setup"), "ok");
  assert.equal(response.headers.get("access-control-allow-origin"), "http://localhost:5173");
  assert.equal(response.headers.get("vary"), "Accept-Encoding, Origin");
  const reader = response.body.getReader();
  assert.equal(new TextDecoder().decode((await reader.read()).value), "data: first\n\n");
  let remaining = "";
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    remaining += new TextDecoder().decode(chunk.value);
  }
  assert.equal(remaining, "data: [DONE]\n\n");
  const [rec] = await updated;
  assert.equal(rec.response.raw, "data: first\n\ndata: [DONE]\n\n");
  assert.equal(rec.request.headers.authorization, "[REDACTED]");
  assert.equal(rec.request.headers["x-api-key"], "[REDACTED]");
  assert.equal(captures.get(rec.id).response.status, 201);
});

test("CORS preflights allow configured origins and auth headers without forwarding or capturing", async (t) => {
  const captures = store(t);
  let upstreamRequests = 0;
  const upstream = await listen(
    t,
    http.createServer((req, res) => {
      upstreamRequests++;
      res.writeHead(401);
      res.end();
    }),
  );
  const proxy = await listen(
    t,
    createProxy({
      upstream,
      store: captures,
      corsOrigins: " http://localhost:5173, http://127.0.0.1:5173 ",
    }),
  );
  for (const origin of ["http://localhost:5173", "http://127.0.0.1:5173"]) {
    for (const method of ["GET", "POST"]) {
      const response = await fetch(`${proxy}/openai/v1/models`, {
        method: "OPTIONS",
        headers: {
          origin,
          "access-control-request-method": method,
          "access-control-request-headers": "authorization, content-type, x-api-key",
        },
      });
      assert.equal(response.status, 204);
      assert.equal(response.headers.get("access-control-allow-origin"), origin);
      assert.ok(response.headers.get("access-control-allow-methods").split(", ").includes(method));
      assert.equal(
        response.headers.get("access-control-allow-headers"),
        "authorization, content-type, x-api-key",
      );
      assert.equal(await response.text(), "");
    }
  }
  assert.equal(upstreamRequests, 0);
  assert.equal(captures.entries.length, 0);
});

test("CORS rejects other origins and preserves model responses for browsers and CLI clients", async (t) => {
  const captures = store(t);
  let upstreamRequests = 0;
  const upstream = await listen(
    t,
    http.createServer((req, res) => {
      upstreamRequests++;
      assert.equal(req.url, "/openai/v1/models");
      assert.equal(req.headers.authorization, "Bearer short");
      res.writeHead(200, {
        "content-type": "application/json",
        "access-control-allow-origin": "*",
      });
      res.end('{"data":[]}');
    }),
  );
  const proxy = await listen(
    t,
    createProxy({
      upstream,
      store: captures,
      corsOrigins: "http://localhost:5173",
    }),
  );
  for (const method of ["OPTIONS", "GET"]) {
    const response = await fetch(`${proxy}/openai/v1/models`, {
      method,
      headers: { origin: "https://other.example", "access-control-request-method": "GET" },
    });
    assert.equal(response.status, 403);
    assert.equal(response.headers.get("access-control-allow-origin"), null);
    await response.text();
  }
  assert.equal(upstreamRequests, 0);
  assert.equal(captures.entries.length, 0);
  for (const origin of ["http://localhost:5173", undefined]) {
    const updated = once(captures, "update");
    const response = await fetch(`${proxy}/openai/v1/models`, {
      headers: { authorization: "Bearer short", ...(origin ? { origin } : {}) },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), origin || "*");
    assert.equal(await response.text(), '{"data":[]}');
    await updated;
  }
  assert.equal(upstreamRequests, 2);
});

test("wildcard environment setting permits any origin on preflights and upstream errors", async (t) => {
  const captures = store(t);
  const upstream = await listen(
    t,
    http.createServer((req, res) => {
      assert.equal(req.method, "GET");
      assert.equal(req.headers.authorization, "Bearer short");
      res.writeHead(401, { "access-control-allow-origin": "https://upstream.example" });
      res.end("invalid API key");
    }),
  );
  const previousOrigins = process.env.CCGLASS_CORS_ORIGINS;
  let server;
  try {
    process.env.CCGLASS_CORS_ORIGINS = "*";
    server = createProxy({ upstream, store: captures });
  } finally {
    if (previousOrigins === undefined) delete process.env.CCGLASS_CORS_ORIGINS;
    else process.env.CCGLASS_CORS_ORIGINS = previousOrigins;
  }
  const proxy = await listen(t, server);
  for (const origin of ["http://localhost:5173", "https://another.example"]) {
    const capturedBefore = captures.entries.length;
    const preflight = await fetch(`${proxy}/openai/v1/models`, {
      method: "OPTIONS",
      headers: {
        origin,
        "access-control-request-method": "GET",
        "access-control-request-headers": "authorization",
      },
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-origin"), "*");
    assert.equal(preflight.headers.get("access-control-allow-headers"), "authorization");
    assert.equal(captures.entries.length, capturedBefore);
    const updated = once(captures, "update");
    const response = await fetch(`${proxy}/openai/v1/models`, {
      headers: { origin, authorization: "Bearer short" },
    });
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("access-control-allow-origin"), "*");
    assert.equal(await response.text(), "invalid API key");
    await updated;
  }
});

test("disabled CORS passes preflights and upstream CORS headers through", async (t) => {
  const captures = store(t);
  const upstream = await listen(
    t,
    http.createServer((req, res) => {
      assert.equal(req.method, "OPTIONS");
      assert.equal(req.headers.origin, "https://other.example");
      res.writeHead(401, {
        "access-control-allow-origin": "https://other.example",
        vary: "Origin",
      });
      res.end("upstream auth required");
    }),
  );
  const proxy = await listen(t, createProxy({ upstream, store: captures, corsOrigins: "" }));
  const updated = once(captures, "update");
  const response = await fetch(`${proxy}/openai/v1/models`, {
    method: "OPTIONS",
    headers: { origin: "https://other.example", "access-control-request-method": "GET" },
  });
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("access-control-allow-origin"), "https://other.example");
  assert.equal(response.headers.get("vary"), "Origin");
  assert.equal(await response.text(), "upstream auth required");
  await updated;
  assert.equal(captures.entries.length, 1);
});

test("redacts short, Basic and arbitrary API keys in persisted captures", (t) => {
  const captures = store(t);
  for (const secret of ["x", "Basic dXNlcjpwYXNz", "Bearer abc", "sk-openai-secret"]) {
    const rec = captures.add({
      request: {
        headers: { Authorization: secret, "X-API-Key": secret, "content-type": "application/json" },
        body: null,
      },
    });
    assert.equal(rec.request.headers.Authorization, "[REDACTED]");
    assert.equal(rec.request.headers["X-API-Key"], "[REDACTED]");
    assert.equal(rec.request.headers["content-type"], "application/json");
    captures.entries = [];
    assert.equal(captures.get(rec.id).request.headers.Authorization, "[REDACTED]");
  }
});

test(
  "client cancellation closes upstream and records one failure",
  { timeout: 5000 },
  async (t) => {
    const captures = store(t);
    let upstreamClosed;
    const closed = new Promise((resolve) => {
      upstreamClosed = resolve;
    });
    const upstream = await listen(
      t,
      http.createServer((req, res) => {
        res.on("close", upstreamClosed);
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write("data: first\n\n");
      }),
    );
    const proxy = await listen(t, createProxy({ upstream, store: captures }));
    const updated = once(captures, "update");
    let updates = 0;
    captures.on("update", () => updates++);
    await new Promise((resolve, reject) => {
      const req = http.get(proxy, (res) =>
        res.once("data", () => {
          res.destroy();
          resolve();
        }),
      );
      req.on("error", reject);
    });
    const [rec] = await updated;
    await closed;
    assert.equal(rec.response.error, "client disconnected");
    assert.equal(updates, 1);
  },
);

test(
  "interrupted upstream stream fails transport and records an error",
  { timeout: 5000 },
  async (t) => {
    const captures = store(t);
    const upstream = await listen(
      t,
      http.createServer((req, res) => {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write("data: partial\n\n");
        setTimeout(() => res.destroy(), 50);
      }),
    );
    const proxy = await listen(t, createProxy({ upstream, store: captures }));
    const updated = once(captures, "update");
    const response = await fetch(proxy);
    await assert.rejects(response.text());
    const [rec] = await updated;
    assert.equal(typeof rec.response.error, "string");
    // What streamed before the break is kept for reading.
    assert.equal(rec.response.raw, "data: partial\n\n");
  },
);

test("connection errors return 502 and remain inspectable", { timeout: 5000 }, async (t) => {
  const captures = store(t);
  const unavailable = http.createServer();
  unavailable.listen(0, "127.0.0.1");
  await once(unavailable, "listening");
  const port = unavailable.address().port;
  await new Promise((resolve) => unavailable.close(resolve));
  const proxy = await listen(
    t,
    createProxy({
      upstream: `http://127.0.0.1:${port}`,
      store: captures,
      corsOrigins: "http://localhost:5173",
    }),
  );
  const updated = once(captures, "update");
  const response = await fetch(proxy, { headers: { origin: "http://localhost:5173" } });
  assert.equal(response.status, 502);
  assert.equal(response.headers.get("access-control-allow-origin"), "http://localhost:5173");
  assert.match(await response.text(), /ccglass: upstream error:/);
  assert.match((await updated)[0].response.error, /ECONNREFUSED/);
});

test("pauses upstream when downstream cannot accept more data", (t) => {
  const captures = store(t);
  const upstreamResponse = new EventEmitter();
  upstreamResponse.statusCode = 200;
  upstreamResponse.headers = {};
  upstreamResponse.pause = t.mock.fn();
  upstreamResponse.resume = t.mock.fn();
  const upstreamRequest = new EventEmitter();
  upstreamRequest.end = t.mock.fn(() => onResponse(upstreamResponse));
  let onResponse;
  t.mock.method(http, "request", (options, callback) => {
    onResponse = callback;
    return upstreamRequest;
  });
  const request = new EventEmitter();
  request.method = "GET";
  request.url = "/";
  request.headers = {};
  const response = new EventEmitter();
  response.writeHead = t.mock.fn();
  response.write = t.mock.fn(() => false);
  response.end = t.mock.fn();
  const proxy = createProxy({ upstream: "http://127.0.0.1:6655", store: captures });
  proxy.emit("request", request, response);
  request.emit("end");
  upstreamResponse.emit("data", Buffer.from("chunk"));
  assert.equal(upstreamResponse.pause.mock.callCount(), 1);
  assert.equal(upstreamResponse.resume.mock.callCount(), 0);
  response.emit("drain");
  assert.equal(upstreamResponse.resume.mock.callCount(), 1);
  upstreamResponse.emit("end");
  assert.equal(captures.entries[0].response.raw, "chunk");
});

test("dashboard accepts loopback hosts and rejects other hosts", async (t) => {
  const dashboard = await listen(t, createServer({ roots: [], store: undefined }));
  const status = (host) =>
    new Promise((resolve, reject) => {
      const req = http.get(`${dashboard}/api/sessions`, { headers: { host } }, (res) => {
        res.resume();
        resolve(res.statusCode);
      });
      req.on("error", reject);
    });
  for (const host of ["localhost:6657", "127.0.0.1:6657", "[::1]:6657"]) {
    assert.equal(await status(host), 200);
  }
  assert.equal(await status("rebind.example:6657"), 403);
});
