import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { Store } from "../src/store.js";
import { createServer } from "../src/server.js";

function mkRoot(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `ccglass-server-${label}-`));
}

function anthropicResp({ input_tokens = 0, output_tokens = 0, cache_read_input_tokens = 0 } = {}) {
  return JSON.stringify({
    type: "message",
    role: "assistant",
    content: [],
    stop_reason: "end_turn",
    usage: { input_tokens, output_tokens, cache_creation_input_tokens: 0, cache_read_input_tokens },
  });
}

function record(store, model, usage) {
  const rec = store.add({
    request: { method: "POST", url: "/v1/messages", headers: {}, body: { model, messages: [], tools: [] } },
  });
  rec.response = { status: 200, raw: anthropicResp(usage) };
  store.update(rec);
}

async function withServer(roots, fn, store = null) {
  const server = createServer({ roots, store });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try { await fn(port); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

function get(port, p) {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: p }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }).on("error", reject);
  });
}

test("session export downloads all full records from live and saved sessions with redaction intact", async (t) => {
  const root = mkRoot("session-export");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new Store({ root });
  const body = {
    model: "claude-sonnet-4-6", system: "exported system",
    tools: [{ name: "lookup", input_schema: { type: "object" } }],
    messages: [{ role: "user", content: "full exported message" }],
  };
  const completed = store.add({ request: {
    method: "POST", url: "/v1/messages", headers: { authorization: "secret", "x-api-key": "short" }, body,
  } });
  completed.startedAt = completed.ts;
  completed.response = {
    status: 200, headers: { "content-type": "text/event-stream" },
    raw: 'data: {"type":"message_stop"}\n\n', firstByteAt: completed.ts + 10, finishedAt: completed.ts + 20,
  };
  store.update(completed);
  const pending = store.add({ request: { method: "POST", url: "/raw", body: "not JSON" } });
  const failed = store.add({ request: { method: "GET", url: "/failure", body: null } });
  failed.response = { error: "upstream interrupted", finishedAt: failed.ts + 5 };
  store.update(failed);
  const session = store.sessionId;
  const verify = async (port) => {
    const res = await get(port, `/api/sessions/export?session=${session}&model=nonexistent`);
    assert.equal(res.status, 200);
    assert.equal(res.headers["content-disposition"], `attachment; filename="ccglass-session-${session}.json"`);
    assert.match(res.headers["content-type"], /^application\/json/);
    assert.equal(res.headers["cache-control"], "no-store");
    const exported = JSON.parse(res.body);
    assert.equal(exported.session, session);
    assert.ok(Number.isFinite(Date.parse(exported.exportedAt)));
    assert.deepEqual(exported.entries.map((rec) => rec.id), [completed.id, pending.id, failed.id]);
    assert.deepEqual(exported.entries[0].request.body, body);
    assert.equal(exported.entries[0].request.headers.authorization, "[REDACTED]");
    assert.equal(exported.entries[0].request.headers["x-api-key"], "[REDACTED]");
    assert.deepEqual(exported.entries[0].response, completed.response);
    assert.equal(exported.entries[0].startedAt, completed.startedAt);
    assert.equal(exported.entries[1].request.body, "not JSON");
    assert.equal(exported.entries[1].response, null);
    assert.deepEqual(exported.entries[2].response, failed.response);
  };
  await withServer([root], verify, store);
  store.stop();
  store.start();
  store.add({ request: { body: "must not appear in the old session export" } });
  await withServer([root], verify, store);
  await withServer([root], verify);
});

test("session export supports empty recordings and rejects missing or unknown sessions", async (t) => {
  const root = mkRoot("export-empty");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new Store({ root });
  await withServer([root], async (port) => {
    const empty = await get(port, `/api/sessions/export?session=${store.sessionId}`);
    assert.equal(empty.status, 200);
    assert.deepEqual(JSON.parse(empty.body).entries, []);
    for (const [query, status] of [["", 400], ["?session=unknown", 404], ["?session=..%2F", 404]]) {
      const res = await get(port, "/api/sessions/export" + query);
      assert.equal(res.status, status);
      assert.equal(res.headers["content-disposition"], undefined);
      assert.ok(JSON.parse(res.body).error);
    }
    const response = await fetch(`http://127.0.0.1:${port}/api/sessions/export?session=${store.sessionId}`, { method: "POST" });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("allow"), "GET");
    await response.text();
  }, store);
});

test("GET /api/usage returns the aggregator payload", async () => {
  const root = mkRoot("usage-route");
  const store = new Store({ root, format: "anthropic" });
  record(store, "claude-opus-4-7", { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 200 });
  record(store, "claude-sonnet-4-6", { input_tokens: 40, output_tokens: 10 });

  await withServer([root], async (port) => {
    const res = await get(port, "/api/usage");
    assert.equal(res.status, 200);
    const u = JSON.parse(res.body);
    assert.equal(u.sessionCount, 1);
    assert.equal(u.requestCount, 2);
    assert.equal(u.totals.input, 140);
    assert.equal(u.totals.output, 60);
    assert.equal(u.totals.cacheRead, 200);
    assert.equal("usd" in u.totals, false);
    assert.equal(u.byModel.length, 2);
    assert.equal(u.bySession.length, 1);
    assert.equal("usd" in u.byModel[0], false);
    assert.equal("usd" in u.bySession[0], false);

    const requests = JSON.parse((await get(port, `/api/requests?session=${store.sessionId}`)).body);
    const detail = JSON.parse((await get(port, `/api/request/${encodeURIComponent(requests.entries[0].id)}`)).body);
    assert.equal("cost" in detail.parsed, false);
    assert.equal(detail.parsed.usageStats.cacheRead, 200);
    assert.equal(detail.parsed.usageStats.totalInput, 300);
  });

  fs.rmSync(root, { recursive: true, force: true });
});

test("GET /api/usage returns empty rollup when no sessions exist", async () => {
  const root = mkRoot("usage-empty");
  await withServer([root], async (port) => {
    const res = await get(port, "/api/usage");
    assert.equal(res.status, 200);
    const u = JSON.parse(res.body);
    assert.equal(u.sessionCount, 0);
    assert.equal(u.requestCount, 0);
    assert.deepEqual(u.byModel, []);
    assert.deepEqual(u.bySession, []);
  });
  fs.rmSync(root, { recursive: true, force: true });
});
