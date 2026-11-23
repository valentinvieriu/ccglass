import type { CapturedRequest, RequestRecord } from "../types";
const SKIP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-connection",
  "transfer-encoding",
  "upgrade",
  "te",
  "trailers",
  "accept-encoding",
  "content-length",
  "host",
]);
export function resolveRequestUrl(request: CapturedRequest = {}) {
  const raw = request.url || "/";
  if (/^https?:\/\//i.test(raw)) return raw;
  const host = request.headers?.host || request.headers?.Host;
  if (!host) return raw;
  const h = String(Array.isArray(host) ? host[0] : host);
  const protocol = /^(127\.|localhost|\[::1\])/i.test(h) ? "http" : "https";
  return `${protocol}://${h}${raw.startsWith("/") ? raw : `/${raw}`}`;
}
export function shellQuote(value: unknown) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}
export function buildCurl(record: RequestRecord) {
  const request = record.request || {};
  const method = (request.method || "GET").toUpperCase();
  const parts = [`curl -sS -X ${method}`, shellQuote(resolveRequestUrl(request))];
  for (const [name, value] of Object.entries(request.headers || {})) {
    if (SKIP_HEADERS.has(name.toLowerCase()) || value == null || value === "") continue;
    parts.push(`-H ${shellQuote(`${name}: ${Array.isArray(value) ? value.join(", ") : value}`)}`);
  }
  if (request.body != null && !["GET", "HEAD"].includes(method)) {
    parts.push(
      `-d ${shellQuote(typeof request.body === "string" ? request.body : JSON.stringify(request.body))}`,
    );
  }
  return parts.join(" \\\n  ");
}
