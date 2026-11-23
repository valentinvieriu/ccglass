import type { EntrySummary, RequestRecord, TimelineRow } from "../types";
import { stepItem, type FlowItem } from "./flow";
import { fmtCost, fmtMs } from "./format";

/** One line of the session replay: an item and the request it first appeared in. */
export interface ReplayLine {
  item: FlowItem;
  entry: EntrySummary;
  /** A prompt the person typed: starts a new group. */
  prompt: boolean;
  /** Runs of setup requests share a fold id and collapse to one line. */
  fold?: string;
  where: string;
  /** For prompts: how much work followed, e.g. "5 requests · 4 tool calls · 1m". */
  meta?: string;
}

export interface ReplayFold {
  id: string;
  label: string;
  sub: string;
}

export interface Replay {
  lines: ReplayLine[];
  folds: Map<string, ReplayFold>;
  /** Entries in which a typed prompt first appears. */
  promptEntries: Set<string>;
}

// Ordinary ways for a response to end. Anything else is worth a row.
const NORMAL_STOP = /^(stop|end_turn|tool_use|tool_calls|stop_sequence|function_call|completed)$/i;
const isErrorStop = (text: string) => /^error(?:[\s:]|$)/.test(text);

export const entryFailed = (entry: EntrySummary, record?: RequestRecord) =>
  ((record?.response?.status ?? entry.status) ?? 0) >= 400 ||
  entry.error != null ||
  record?.error != null;

/** A request that carries no conversation: model listings, health probes. */
export const isSetup = (entry: EntrySummary) => !entry.model && !entry.nMessages;

function path(url: string | undefined) {
  if (!url) return "";
  try {
    return new URL(url, "http://local").pathname;
  } catch {
    return url;
  }
}

function rowItem(row: TimelineRow): FlowItem | null {
  if (row.kind === "stop") {
    if (isErrorStop(row.text)) return stepItem(row, row.key, "response");
    if (NORMAL_STOP.test(row.text.trim())) return null;
    return {
      id: row.key,
      zone: "response",
      kind: "stop",
      name: "Stopped early",
      summary: row.text,
      text: row.text,
      chars: row.text.length,
      tags: [],
    };
  }
  return stepItem(row, row.key, row.latest ? "response" : "new", row.result, "awaiting");
}

function where(row: TimelineRow, item: FlowItem) {
  const request = row.seq != null ? `#${row.seq}` : "";
  if (item.kind === "tool") {
    const asked = row.latest
      ? `Asked for in response ${request}.`
      : `First seen as history in request ${request}.`;
    if (!row.result) return `${asked} No output captured yet.`;
    return row.result.seq != null
      ? `${asked} Output sent back in request #${row.result.seq}.`
      : asked;
  }
  if (item.kind === "failed") return `Request ${request} ended with an error.`;
  if (row.latest) return `Returned in response ${request}.`;
  if (item.kind === "assistant" || item.kind === "thinking")
    return `First seen as history in request ${request}.`;
  return `First sent in request ${request}.`;
}

/** A stand-in line for a request that produced no conversation rows. */
function requestItem(
  entry: EntrySummary,
  record: RequestRecord | undefined,
  summary: string | null,
  detail: string,
): FlowItem {
  const status = record?.response?.status ?? entry.status;
  const failed = entryFailed(entry, record);
  const url = record?.request?.url ?? entry.url;
  const method = record?.request?.method ?? entry.method ?? "Request";
  const text = [
    `${method} ${url || ""}`.trim(),
    status != null ? `HTTP ${status}` : "",
    detail,
  ]
    .filter(Boolean)
    .join("\n");
  return {
    id: `request|${entry.id}`,
    zone: "response",
    kind: "request",
    name: method,
    summary: summary ?? (path(url) || entry.model || "No conversation steps"),
    text,
    chars: text.length,
    tags: [],
    status: failed ? "error" : undefined,
    outcomeText: summary ? "" : status != null ? `HTTP ${status}` : entry.pending ? "pending" : "",
  };
}

const plural = (count: number, one: string) => `${count} ${one}${count === 1 ? "" : "s"}`;

/** Facts about one request, for the gutter tooltip and the preview. */
export function entryFacts(entry: EntrySummary, record?: RequestRecord) {
  const status = record?.response?.status ?? entry.status;
  const model = record?.parsed?.response?.model || entry.model || record?.model;
  const usageStats =
    (record?.parsed as { usageStats?: { usd?: number } } | undefined)?.usageStats ??
    record?.usageStats;
  const cost = record?.parsed?.cost?.usd ?? usageStats?.usd;
  const latency = record?.latencyMs ?? entry.latencyMs;
  return [
    `Request #${entry.seq}`,
    model,
    entry.ts ? new Date(entry.ts).toLocaleTimeString([], { hour12: false }) : null,
    latency != null ? fmtMs(latency) : null,
    status != null ? `HTTP ${status}` : null,
    typeof cost === "number" ? fmtCost(cost) : null,
  ].filter((fact): fact is string => !!fact);
}

export function buildReplay(
  entries: EntrySummary[],
  records: Record<string, RequestRecord>,
  rows: TimelineRow[],
  loading: boolean,
): Replay {
  const byEntry = new Map<string, TimelineRow[]>();
  for (const row of rows) {
    const group = byEntry.get(row.entryId) ?? [];
    group.push(row);
    byEntry.set(row.entryId, group);
  }

  const lines: ReplayLine[] = [];
  const folds = new Map<string, ReplayFold>();
  const promptEntries = new Set<string>();
  let run: ReplayLine[] = [];
  // Two or more setup requests in a row say nothing individually: fold them.
  const closeRun = () => {
    if (run.length > 1) {
      const id = `fold|${run[0].entry.id}`;
      const failed = run.filter((line) => line.item.status === "error").length;
      const paths = [...new Set(run.map((line) => `${line.item.name} ${line.item.summary}`))];
      folds.set(id, {
        id,
        label: `${run.length} setup requests`,
        sub: [
          paths.slice(0, 2).join(", ") + (paths.length > 2 ? "…" : ""),
          failed ? `${failed} failed` : "",
        ]
          .filter(Boolean)
          .join(" · "),
      });
      for (const line of run) line.fold = id;
    }
    run = [];
  };

  for (const entry of entries) {
    const record = records[entry.id];
    const entryRows = byEntry.get(entry.id) ?? [];
    const whereRequest = `Request #${entry.seq}.`;
    if (isSetup(entry)) {
      const error = entryRows.find((row) => row.kind === "stop" && isErrorStop(row.text));
      const line: ReplayLine = {
        item: requestItem(entry, record, null, error?.text ?? ""),
        entry,
        prompt: false,
        where: `${whereRequest} It carries no conversation.`,
      };
      run.push(line);
      lines.push(line);
      continue;
    }
    closeRun();
    const items = entryRows.flatMap((row) => {
      const item = rowItem(row);
      return item ? [{ row, item }] : [];
    });
    if (!items.length) {
      const summary = !record
        ? loading
          ? "Loading request…"
          : "Request details are unavailable. Click this turn to retry."
        : entry.pending || !record.response
          ? "Waiting for the response…"
          : "No new conversation steps";
      lines.push({
        item: requestItem(entry, record, summary, ""),
        entry,
        prompt: false,
        where: whereRequest,
      });
      continue;
    }
    for (const { row, item } of items) {
      const prompt = item.kind === "user" && !item.injected;
      if (prompt) promptEntries.add(entry.id);
      lines.push({ item, entry, prompt, where: where(row, item) });
    }
  }
  closeRun();

  // Each prompt says how much work it set off, up to the next prompt.
  for (let index = 0; index < lines.length; index++) {
    if (!lines[index].prompt) continue;
    const seen = new Map<string, EntrySummary>();
    let tools = 0;
    for (let next = index; next < lines.length && (next === index || !lines[next].prompt); next++) {
      const line = lines[next];
      if (isSetup(line.entry)) continue;
      seen.set(line.entry.id, line.entry);
      if (line.item.kind === "tool") tools++;
    }
    const latency = [...seen.values()].reduce(
      (total, entry) => total + (records[entry.id]?.latencyMs ?? entry.latencyMs ?? 0),
      0,
    );
    lines[index].meta = [
      plural(seen.size, "request"),
      tools ? plural(tools, "tool") : "",
      latency ? fmtMs(latency) : "",
    ]
      .filter(Boolean)
      .join(" · ");
  }

  return { lines, folds, promptEntries };
}
