export const fmt = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString());
export function fmtMs(ms: number | null | undefined) {
  if (ms == null) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms >= 10_000 ? 1 : 2)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}
export function fmtTps(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 100) return `${Math.round(n)} tok/s`;
  return `${n.toFixed(n >= 10 ? 1 : 2)} tok/s`;
}
export const fmtCost = (n: number | null | undefined) => `$${Number(n || 0).toFixed(4)}`;
export const pct = (n: number | null | undefined) => `${Math.round((n || 0) * 100)}%`;
export function oneLine(text: unknown, limit = 100) {
  const value = String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return value.length > limit ? `${value.slice(0, limit)}…` : value;
}
export function statusClass(status?: number | null) {
  return status == null ? "pending" : status < 400 ? "ok" : status < 500 ? "4xx" : "5xx";
}
export function idHue(id: string) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}
export function callColor(id: string) {
  return `oklch(0.58 0.12 ${idHue(id)})`;
}
