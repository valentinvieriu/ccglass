import type { RequestRecord } from "../types";
import { CANCELLED_NOTE, isCancelError, type Outcome } from "./entries";
import { fmt, fmtDateTime, fmtMs, fmtTps, oneLine, pctOf, plural } from "./format";
import { countMessages } from "./messages";

/** What went wrong, wherever the capture recorded it. */
export function recordError(record: RequestRecord) {
  return record.parsed?.response?.error ?? record.response?.error ?? record.error;
}

/** The client closed the connection before the response finished; see `isCancelError`. */
export const recordCancelled = (record: RequestRecord) =>
  (record.response?.status ?? 0) < 400 && isCancelError(recordError(record));

export const recordFailed = (record: RequestRecord) =>
  (record.response?.status ?? 0) >= 400 ||
  (recordError(record) != null && !recordCancelled(record));

function errorText(error: unknown): string {
  if (error == null) return "";
  if (typeof error === "string") return error;
  if (typeof error === "object") {
    const { message, error: inner } = error as { message?: unknown; error?: unknown };
    if (typeof message === "string") return message;
    if (inner != null) return errorText(inner);
  }
  return JSON.stringify(error);
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/**
 * A call to the model, as opposed to a model listing or a health probe. Those
 * carry no prompt, so the views about system, messages and tools do not apply.
 */
export function isModelRequest(record: RequestRecord) {
  const view = record.parsed?.view;
  const body = record.request?.body;
  if (
    record.model ||
    record.parsed?.response?.model ||
    (isObject(body) && (body.model || body.messages || body.input || body.prompt)) ||
    view?.messages?.length ||
    view?.system?.length ||
    view?.tools?.length
  )
    return true;
  // Nothing was captured about the request itself: keep every view available.
  return !record.request?.url;
}

export function requestPath(url: string | undefined) {
  if (!url) return "/";
  try {
    return new URL(url, "http://local").pathname;
  } catch {
    return url;
  }
}

/** The model for a model request, "GET /v1/models" for anything else. */
export function requestTitle(record: RequestRecord) {
  const body = record.request?.body;
  const model =
    record.parsed?.response?.model || record.model || (isObject(body) ? body.model : null);
  if (model) return String(model);
  if (!isModelRequest(record))
    return `${record.request?.method || "GET"} ${requestPath(record.request?.url)}`;
  return "Unknown model";
}

export type RequestOutcome = Outcome;

function usage(record: RequestRecord) {
  const parsed = record.parsed;
  const stats = parsed?.usageStats ?? parsed?.cost;
  const raw = parsed?.response?.usage;
  const cacheRead = stats?.cacheRead ?? raw?.cache_read_input_tokens;
  const cacheWrite = stats?.cacheWrite ?? raw?.cache_creation_input_tokens;
  // One meaning for "input" in both wire formats: everything sent, cached or not.
  const totalInput =
    stats?.totalInput ??
    (stats?.input != null
      ? stats.input + (cacheRead ?? 0) + (cacheWrite ?? 0)
      : (raw?.input_tokens as number | undefined));
  const output = stats?.output ?? (raw?.output_tokens as number | undefined);
  return { totalInput, cacheRead, cacheWrite, output, estimate: parsed?.estTokens };
}

export interface RequestTokens {
  /** Everything sent to the model, cached or not. Undefined when nothing was measured. */
  totalInput?: number;
  cacheRead?: number;
  cacheWrite?: number;
  output?: number;
  /** "98%" of the input read from cache, or "—" when there is no input to take a share of. */
  cachedShare: string;
  /** ccglass's own count, for requests the provider reported no usage for. */
  estimate?: number;
  /** True when the provider reported usage for this request. */
  measured: boolean;
}

export function requestTokens(record: RequestRecord): RequestTokens {
  const { totalInput, cacheRead, cacheWrite, output, estimate } = usage(record);
  const measured = !!totalInput || !!output;
  return {
    totalInput: measured ? totalInput : undefined,
    cacheRead: measured ? cacheRead : undefined,
    cacheWrite: measured ? cacheWrite : undefined,
    output: measured ? output : undefined,
    cachedShare: pctOf(cacheRead, measured ? totalInput : 0),
    estimate: estimate || undefined,
    measured,
  };
}

/** How long it took and, for a streamed model reply, when the first token arrived. */
function timingText(record: RequestRecord) {
  const latency = record.latencyMs ?? record.timing?.totalMs;
  const timing = record.timing;
  // Without a stream the "first token" is just the whole response arriving,
  // so it is only worth saying when it reads differently from the total.
  const streamed =
    timing?.ttftMs != null &&
    latency != null &&
    fmtMs(timing.ttftMs) !== fmtMs(latency) &&
    timing.ttftMs < latency &&
    isModelRequest(record) &&
    !recordFailed(record) &&
    !recordCancelled(record);
  return { latency, firstToken: streamed ? timing!.ttftMs! : null };
}

export interface RequestFacts {
  status: { label: string; tone: RequestOutcome };
  facts: string[];
}

/**
 * The line that stays visible on every tab of a request:
 * "HTTP 200 · 2.25s, first token 1.27s · 47,247 tokens in (98% cached) · 102 tokens out · stop: tool_calls".
 */
export function requestFacts(record: RequestRecord): RequestFacts {
  const status = record.response?.status;
  const error = recordError(record);
  const failed = recordFailed(record);
  const cancelled = recordCancelled(record);
  const { latency, firstToken } = timingText(record);
  const tokens = requestTokens(record);
  const label = cancelled
    ? "Cancelled"
    : status != null
      ? `HTTP ${status}`
      : error != null
        ? "Failed"
        : record.response
          ? "No status"
          : "Waiting for a response";
  const tone: RequestOutcome = failed
    ? "error"
    : cancelled
      ? "cancelled"
      : status == null
        ? "pending"
        : "ok";
  const facts: string[] = [];
  if (status == null && error != null) facts.push(oneLine(errorText(error), 90));
  if (latency != null)
    facts.push(
      status == null && error != null
        ? `after ${fmtMs(latency)}`
        : fmtMs(latency) + (firstToken != null ? `, first token ${fmtMs(firstToken)}` : ""),
    );
  if (tokens.measured) {
    facts.push(
      `${fmt(tokens.totalInput ?? 0)} tokens in` +
        (tokens.cachedShare !== "—" ? ` (${tokens.cachedShare} cached)` : ""),
    );
    if (tokens.output != null) facts.push(`${fmt(tokens.output)} tokens out`);
  } else if (tokens.estimate) facts.push(`≈ ${fmt(tokens.estimate)} tokens in (estimate)`);
  const stop = record.parsed?.response?.stop_reason;
  if (stop) facts.push(`stop: ${stop}`);
  return { status: { label, tone }, facts };
}

/** One sentence on how the response went, for the top of the Response tab. */
export function responseSentence(record: RequestRecord) {
  const status = record.response?.status;
  const error = recordError(record);
  const { latency, firstToken } = timingText(record);
  const after = latency != null ? ` after ${fmtMs(latency)}` : "";
  if (recordCancelled(record)) return `Cancelled${after} · ${CANCELLED_NOTE}`;
  if (status == null && error != null) return `Failed${after} · ${oneLine(errorText(error), 160)}`;
  if ((status ?? 0) >= 400) return `The server answered with an error${after}`;
  const output = requestTokens(record).output;
  const parts = [
    output
      ? `${fmt(output)} tokens${latency != null ? ` in ${fmtMs(latency)}` : ""}`
      : latency != null
        ? fmtMs(latency)
        : "",
    firstToken != null ? `first token after ${fmtMs(firstToken)}` : "",
  ];
  return parts.filter(Boolean).join(" · ");
}

/**
 * Overview is the request as one list: everything sent, then the reply. The
 * other tabs each read one part of it in full.
 */
export type RequestTab = "overview" | "system" | "messages" | "tools" | "response" | "http";
const ALL_TABS: RequestTab[] = ["overview", "system", "messages", "tools", "response", "http"];

/** Tabs that have something to show for this request. */
export const requestTabs = (record: RequestRecord): RequestTab[] =>
  isModelRequest(record) ? ALL_TABS : ["response", "http"];

/**
 * The tab a request opens on. The tab the reader last chose carries over from
 * request to request, except that a failure is shown first: otherwise a failed
 * request can open on Messages with no sign that anything went wrong. A
 * cancelled request is not a failure and opens like any other.
 */
export function openingTab(record: RequestRecord, preferred: RequestTab): RequestTab {
  const tabs = requestTabs(record);
  if (recordFailed(record) || !tabs.includes(preferred)) return "response";
  return preferred;
}

export interface DetailRow {
  label: string;
  value: string;
  /** What the number counts or how it was measured. */
  note?: string;
}
export interface DetailGroup {
  title: string;
  rows: DetailRow[];
}

/**
 * Everything measured about a request, behind the facts line: the numbers a
 * reader needs now and then, not on the way to what was sent.
 */
export function requestDetails(record: RequestRecord): DetailGroup[] {
  const parsed = record.parsed;
  const timing = record.timing;
  const tokens = requestTokens(record);
  const view = parsed?.view;
  const body = record.request?.body;
  const model = (isObject(body) && body.model) || parsed?.response?.model || record.model;
  // A response that never finished has no first token or generation to time.
  const complete = !recordFailed(record) && !recordCancelled(record);
  const timingRows: DetailRow[] = [
    { label: "Total latency", value: fmtMs(record.latencyMs ?? timing?.totalMs) },
  ];
  if (complete && isModelRequest(record))
    timingRows.push(
      { label: "First token", value: fmtMs(timing?.ttftMs), note: "time to the first byte" },
      { label: "Generation", value: fmtMs(timing?.genMs), note: "duration of the stream" },
      { label: "Input speed", value: fmtTps(timing?.inTps), note: "before the first byte" },
      { label: "Output speed", value: fmtTps(timing?.outTps), note: "after the first byte" },
    );
  // A number is never shown without its unit.
  const count = (value: number | undefined) => (value == null ? "—" : `${fmt(value)} tokens`);
  const tokenRows: DetailRow[] = tokens.measured
    ? [
        { label: "Input (total)", value: count(tokens.totalInput), note: "including cached" },
        {
          label: "of which cached",
          value: count(tokens.cacheRead),
          note: tokens.cachedShare === "—" ? undefined : `${tokens.cachedShare} of the input`,
        },
        { label: "Cache write", value: count(tokens.cacheWrite) },
        { label: "Output", value: count(tokens.output) },
      ]
    : [
        {
          label: "Input (estimate)",
          value: tokens.estimate == null ? "—" : `≈ ${fmt(tokens.estimate)} tokens`,
          note: "the provider reported no usage",
        },
      ];
  // ccglass does not price requests; an older capture may carry a recorded cost.
  const usd = parsed?.cost?.usd;
  if (usd != null) tokenRows.push({ label: "Estimated cost", value: `$${Number(usd).toFixed(5)}` });
  const groups: DetailGroup[] = [{ title: "Timing", rows: timingRows }];
  if (isModelRequest(record)) groups.push({ title: "Tokens", rows: tokenRows });
  groups.push({
    title: "Request",
    rows: [
      ...(isModelRequest(record)
        ? [{ label: "Model", value: String(model || "Unknown model") }]
        : []),
      { label: "Format", value: parsed?.format || record.format || "—" },
      ...(isModelRequest(record)
        ? [
            { label: "Stop reason", value: parsed?.response?.stop_reason || "—" },
            {
              label: "Context",
              value: [
                plural(view?.system?.length || 0, "system block"),
                plural(countMessages(view?.messages), "message"),
                plural(view?.tools?.length || 0, "tool"),
              ].join(" · "),
            },
          ]
        : []),
      { label: "Captured", value: fmtDateTime(record.ts ?? record.startedAt) },
    ],
  });
  return groups;
}
