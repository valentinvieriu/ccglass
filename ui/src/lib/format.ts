export const fmt = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString());
export function fmtMs(ms: number | null | undefined) {
  if (ms == null) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms >= 10_000 ? 1 : 2)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}
export function fmtTps(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 100) return `${Math.round(n).toLocaleString("en-US")} tok/s`;
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

/** "1 call", "2 calls", "1,204 requests". */
export const plural = (count: number, one: string, many = `${one}s`) =>
  `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;

/** A count short enough to scan: 912, 47.2k, 1.06M. Pair it with `fmt` for the exact value. */
export function fmtCompact(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs < 1000) return String(Math.round(n));
  const [scaled, unit] = abs < 999_950 ? [n / 1000, "k"] : [n / 1_000_000, "M"];
  return `${scaled.toFixed(Math.abs(scaled) >= 100 ? 0 : Math.abs(scaled) >= 10 ? 1 : 2)}${unit}`;
}

/**
 * Tokens are the unit a context is limited and measured in, so sizes are shown
 * in tokens. A single block has no measured count, so this is the server's
 * estimate for Latin text (four characters per token); always shown with "~".
 */
export const charTokens = (chars: number) => Math.ceil(chars / 4);
export const fmtApproxTokens = (chars: number) => `~${fmtCompact(charTokens(chars))} tok`;
export const fmtChars = (chars: number) => plural(chars, "character");

/** A share that is a fact only when something was measured: "—" for 0 of 0. */
export const pctOf = (part: number | null | undefined, total: number | null | undefined) =>
  !total || part == null ? "—" : pct(part / total);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const two = (n: number) => String(n).padStart(2, "0");
const validDate = (ts: number | string | null | undefined) => {
  if (ts == null || ts === "") return null;
  const date = new Date(ts);
  return Number.isNaN(date.getTime()) ? null : date;
};
const clockOf = (date: Date) =>
  `${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}`;
const dayOf = (date: Date, now: Date) =>
  `${MONTHS[date.getMonth()]} ${date.getDate()}` +
  (date.getFullYear() === now.getFullYear() ? "" : `, ${date.getFullYear()}`);

/** The one time format: 24-hour wall clock, "23:34:56". */
export function fmtClock(ts: number | string | null | undefined) {
  const date = validDate(ts);
  return date ? clockOf(date) : "—";
}
/** Date and time, "Nov 23 · 23:34:56". The year is added only when it is not this one. */
export function fmtDateTime(ts: number | string | null | undefined, now = new Date()) {
  const date = validDate(ts);
  return date ? `${dayOf(date, now)} · ${clockOf(date)}` : "—";
}
/** Like `fmtDateTime`, without the date for something that happened today. */
export function fmtWhen(ts: number | string | null | undefined, now = new Date()) {
  const date = validDate(ts);
  if (!date) return "—";
  return date.toDateString() === now.toDateString() ? clockOf(date) : fmtDateTime(ts, now);
}
/** Time since a session started: "+0:57", "+12:05", "+1:02:03". */
export function fmtOffset(ms: number | null | undefined) {
  if (ms == null || !Number.isFinite(ms)) return "—";
  const total = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return `+${hours ? `${hours}:${two(minutes)}` : minutes}:${two(total % 60)}`;
}
/** A running duration for a clock that ticks: "00:12:31". */
export function fmtElapsed(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${two(Math.floor(total / 3600))}:${two(Math.floor((total % 3600) / 60))}:${two(total % 60)}`;
}
/** When a capture id like 2026-11-23T20-45-10-567 was started, in local time. */
export function sessionStart(id: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})/.exec(id);
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
  const date = new Date(year, month - 1, day, hour, minute, second);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}
/** Turns a capture id like 2026-11-23T20-45-10-567 into "Nov 23 · 20:45:10". */
export function sessionLabel(id: string, now = new Date()) {
  const start = sessionStart(id);
  return start == null ? id : fmtDateTime(start, now);
}
