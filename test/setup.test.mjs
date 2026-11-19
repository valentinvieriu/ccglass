import assert from 'node:assert/strict';
import http from 'node:http';
import { EventEmitter, once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { Store } from '../src/store.js';
import { createProxy } from '../src/proxy.js';
import { createServer } from '../src/server.js';

async function listen(t, server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  });
  return `http://127.0.0.1:${server.address().port}`;
}

function store(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'ccglass-setup-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return new Store({ root, format: 'openai' });
}

test('forwarding preserves path, query, auth, body, status and streaming', async (t) => {
  const captures = store(t);
  const upstream = await listen(t, http.createServer(async (req, res) => {
    assert.equal(req.url, '/openai/v1/responses?trace=setup');
    assert.equal(req.method, 'POST');
    assert.equal(req.headers.authorization, 'Bearer short');
    assert.equal(req.headers['x-api-key'], 'plain-secret');
    assert.equal(req.headers['accept-encoding'], undefined);
    const body = [];
    for await (const chunk of req) body.push(chunk);
    assert.equal(Buffer.concat(body).toString(), '{"model":"setup-test"}');
    res.writeHead(201, { 'content-type': 'text/event-stream', 'x-setup': 'ok' });
    res.write('data: first\n\n');
    setTimeout(() => res.end('data: [DONE]\n\n'), 100);
  }));
  const proxy = await listen(t, createProxy({ upstream, store: captures }));
  const updated = once(captures, 'update');
  const response = await fetch(`${proxy}/openai/v1/responses?trace=setup`, {
    method: 'POST',
    headers: { authorization: 'Bearer short', 'x-api-key': 'plain-secret' },
    body: '{"model":"setup-test"}',
  });
  assert.equal(response.status, 201);
  assert.equal(response.headers.get('x-setup'), 'ok');
  const reader = response.body.getReader();
  assert.equal(new TextDecoder().decode((await reader.read()).value), 'data: first\n\n');
  let remaining = '';
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    remaining += new TextDecoder().decode(chunk.value);
  }
  assert.equal(remaining, 'data: [DONE]\n\n');
  const [rec] = await updated;
  assert.equal(rec.response.raw, 'data: first\n\ndata: [DONE]\n\n');
  assert.equal(rec.request.headers.authorization, '[REDACTED]');
  assert.equal(rec.request.headers['x-api-key'], '[REDACTED]');
  assert.equal(captures.get(rec.id).response.status, 201);
});

test('redacts short, Basic and arbitrary API keys in persisted captures', (t) => {
  const captures = store(t);
  for (const secret of ['x', 'Basic dXNlcjpwYXNz', 'Bearer abc', 'sk-openai-secret']) {
    const rec = captures.add({ request: {
      headers: { Authorization: secret, 'X-API-Key': secret, 'content-type': 'application/json' },
      body: null,
    } });
    assert.equal(rec.request.headers.Authorization, '[REDACTED]');
    assert.equal(rec.request.headers['X-API-Key'], '[REDACTED]');
    assert.equal(rec.request.headers['content-type'], 'application/json');
    captures.entries = [];
    assert.equal(captures.get(rec.id).request.headers.Authorization, '[REDACTED]');
  }
});

test('client cancellation closes upstream and records one failure', { timeout: 5000 }, async (t) => {
  const captures = store(t);
  let upstreamClosed;
  const closed = new Promise((resolve) => { upstreamClosed = resolve; });
  const upstream = await listen(t, http.createServer((req, res) => {
    res.on('close', upstreamClosed);
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: first\n\n');
  }));
  const proxy = await listen(t, createProxy({ upstream, store: captures }));
  const updated = once(captures, 'update');
  let updates = 0;
  captures.on('update', () => updates++);
  await new Promise((resolve, reject) => {
    const req = http.get(proxy, (res) => res.once('data', () => {
      res.destroy();
      resolve();
    }));
    req.on('error', reject);
  });
  const [rec] = await updated;
  await closed;
  assert.equal(rec.response.error, 'client disconnected');
  assert.equal(updates, 1);
});

test('interrupted upstream stream fails transport and records an error', { timeout: 5000 }, async (t) => {
  const captures = store(t);
  const upstream = await listen(t, http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: partial\n\n');
    setTimeout(() => res.destroy(), 50);
  }));
  const proxy = await listen(t, createProxy({ upstream, store: captures }));
  const updated = once(captures, 'update');
  const response = await fetch(proxy);
  await assert.rejects(response.text());
  const [rec] = await updated;
  assert.equal(typeof rec.response.error, 'string');
  assert.equal(rec.response.raw, undefined);
});

test('connection errors return 502 and remain inspectable', { timeout: 5000 }, async (t) => {
  const captures = store(t);
  const unavailable = http.createServer();
  unavailable.listen(0, '127.0.0.1');
  await once(unavailable, 'listening');
  const port = unavailable.address().port;
  await new Promise((resolve) => unavailable.close(resolve));
  const proxy = await listen(t, createProxy({ upstream: `http://127.0.0.1:${port}`, store: captures }));
  const updated = once(captures, 'update');
  const response = await fetch(proxy);
  assert.equal(response.status, 502);
  assert.match(await response.text(), /ccglass: upstream error:/);
  assert.match((await updated)[0].response.error, /ECONNREFUSED/);
});

test('pauses upstream when downstream cannot accept more data', (t) => {
  const captures = store(t);
  const upstreamResponse = new EventEmitter();
  upstreamResponse.statusCode = 200;
  upstreamResponse.headers = {};
  upstreamResponse.pause = t.mock.fn();
  upstreamResponse.resume = t.mock.fn();
  const upstreamRequest = new EventEmitter();
  upstreamRequest.end = t.mock.fn(() => onResponse(upstreamResponse));
  let onResponse;
  t.mock.method(http, 'request', (options, callback) => {
    onResponse = callback;
    return upstreamRequest;
  });
  const request = new EventEmitter();
  request.method = 'GET';
  request.url = '/';
  request.headers = {};
  const response = new EventEmitter();
  response.writeHead = t.mock.fn();
  response.write = t.mock.fn(() => false);
  response.end = t.mock.fn();
  const proxy = createProxy({ upstream: 'http://127.0.0.1:6655', store: captures });
  proxy.emit('request', request, response);
  request.emit('end');
  upstreamResponse.emit('data', Buffer.from('chunk'));
  assert.equal(upstreamResponse.pause.mock.callCount(), 1);
  assert.equal(upstreamResponse.resume.mock.callCount(), 0);
  response.emit('drain');
  assert.equal(upstreamResponse.resume.mock.callCount(), 1);
  upstreamResponse.emit('end');
  assert.equal(captures.entries[0].response.raw, 'chunk');
});

test('dashboard accepts loopback hosts and rejects other hosts', async (t) => {
  const dashboard = await listen(t, createServer({ roots: [], store: undefined }));
  const status = (host) => new Promise((resolve, reject) => {
    const req = http.get(`${dashboard}/api/sessions`, { headers: { host } }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('error', reject);
  });
  for (const host of ['localhost:6657', '127.0.0.1:6657', '[::1]:6657']) {
    assert.equal(await status(host), 200);
  }
  assert.equal(await status('rebind.example:6657'), 403);
});
