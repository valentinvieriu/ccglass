import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createProxy, LIVE_INTERVAL_MS } from "../src/proxy.js";
import { Store, summarize } from "../src/store.js";

const chunk = (reasoning) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content: "", reasoning } }] })}\n\n`;

// An upstream that streams two thinking chunks, then waits for `release` before
// finishing, so a test can look at the capture while the reply is mid-stream.
async function startUpstream() {
  let release;
  const released = new Promise((resolve) => (release = resolve));
  const server = http.createServer((req, res) => {
    req.resume();
    req.on("end", async () => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(chunk("Let me "));
      res.write(chunk("think."));
      await released;
      if (res.destroyed) return;
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "Done." } }] })}\n\n`);
      res.end("data: [DONE]\n\n");
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, release, url: `http://127.0.0.1:${server.address().port}` };
}

async function setup() {
  const upstream = await startUpstream();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ccglass-live-"));
  const store = new Store({ root, format: "openai" });
  const proxy = createProxy({ upstream: upstream.url, store });
  await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  const close = () => {
    proxy.close();
    upstream.server.close();
  };
  return { upstream, store, proxy, close };
}

function send(proxy) {
  const received = [];
  let req;
  const firstChunk = new Promise((resolve, reject) => {
    req = http.request(
      {
        hostname: "127.0.0.1",
        port: proxy.address().port,
        path: "/v1/chat/completions",
        method: "POST",
        headers: { "content-type": "application/json" },
      },
      (res) => {
        res.on("data", (c) => {
          received.push(c.toString());
          resolve();
        });
        res.on("error", () => {});
      },
    );
    req.on("error", reject);
    req.end(JSON.stringify({ model: "qwen3", stream: true, messages: [] }));
  });
  return { req, received, firstChunk };
}

const nextUpdate = (store) => new Promise((resolve) => store.once("update", resolve));

test("a streaming reply reaches the dashboard before it finishes, without being saved yet", async () => {
  const { upstream, store, proxy, close } = await setup();
  const { received, firstChunk } = send(proxy);
  await firstChunk;
  // The client already has the chunks: the proxy does not hold them back.
  assert.match(received.join(""), /Let me/);

  const started = Date.now();
  const rec = await nextUpdate(store);
  assert.ok(Date.now() - started <= LIVE_INTERVAL_MS + 200);
  assert.equal(rec.response.streaming, true);
  assert.match(rec.response.raw, /Let me .*think\./s);
  assert.deepEqual(
    { pending: summarize(rec).pending, streaming: summarize(rec).streaming },
    { pending: true, streaming: true },
  );
  const saved = JSON.parse(fs.readFileSync(store._file(rec), "utf8"));
  assert.equal(saved.response, null, "a partial reply is not written to disk");

  const finished = new Promise((resolve) =>
    store.on("update", (r) => !r.response.streaming && resolve(r)),
  );
  upstream.release();
  const done = await finished;
  assert.equal(done.response.streaming, undefined);
  assert.match(done.response.raw, /\[DONE\]/);
  assert.equal(summarize(done).pending, false);
  close();
});

test("a reply cancelled mid-stream keeps what arrived", async () => {
  const { upstream, store, proxy, close } = await setup();
  const { req, firstChunk } = send(proxy);
  await firstChunk;
  const saved = new Promise((resolve) => store.on("update", (r) => r.response.error && resolve(r)));
  req.destroy();
  const rec = await saved;
  assert.equal(rec.response.error, "client disconnected");
  assert.equal(rec.response.status, 200);
  assert.match(rec.response.raw, /Let me /);
  assert.equal(rec.response.streaming, undefined);
  const onDisk = JSON.parse(fs.readFileSync(store._file(rec), "utf8"));
  assert.match(onDisk.response.raw, /Let me /, "the partial reply is saved");
  upstream.release();
  close();
});
