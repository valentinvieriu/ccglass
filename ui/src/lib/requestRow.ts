import type { EntrySummary, RequestRecord, TimelineStep } from "../types";
import { isCancelled } from "./entries";
import { newStart, stepItem } from "./flow";
import { fmtCompact, fmtMs, fmtOffset, oneLine } from "./format";
import { isModelRequest, requestTokens } from "./request";
import { flowSteps } from "./timeline";

/**
 * What set a request off. An agent sends a request either because the person
 * typed something or because tools finished and their outputs go back.
 */
export interface RequestLead {
  kind: "prompt" | "tools" | "harness";
  text: string;
}

const isCall = (step: TimelineStep) => step.kind === "tool_use" || step.kind === "skill";
const leads = new WeakMap<RequestRecord, RequestLead | null>();

export function requestLead(record: RequestRecord): RequestLead | null {
  const known = leads.get(record);
  if (known !== undefined) return known;
  const lead = findLead(record);
  leads.set(record, lead);
  return lead;
}

function findLead(record: RequestRecord): RequestLead | null {
  if (!isModelRequest(record)) return null;
  const sent = flowSteps(record).filter((step) => !step.latest);
  // Everything after the model's last reply is what this request adds.
  const added = sent.slice(newStart(sent));
  const users = added
    .filter((step) => step.kind === "user")
    .map((step) => stepItem(step, "", "new"));
  const typed = [...users].reverse().find((item) => !item.injected);
  if (typed) return { kind: "prompt", text: oneLine(typed.human ?? typed.summary, 140) };

  const names = new Map<string, string>();
  for (const step of sent) if (isCall(step) && step.callId) names.set(step.callId, step.name || "tool");
  const outputs = added.filter((step) => step.kind === "tool_result");
  if (outputs.length) {
    const tools = [...new Set(outputs.map((step) => names.get(step.callId ?? "") ?? "tool output"))];
    return { kind: "tools", text: tools.join(", ") };
  }
  const harness = users.at(-1);
  return harness ? { kind: "harness", text: oneLine(harness.summary, 140) } : null;
}

/** "GET /v1/models" for a request that names no model. */
export function endpointLabel(entry: EntrySummary) {
  if (!entry.url) return null;
  let path = entry.url;
  try {
    path = new URL(entry.url, "http://local").pathname;
  } catch {
    /* keep the raw value */
  }
  return `${entry.method || "GET"} ${path}`;
}

/**
 * A request named in one line, the way its row in the list names it:
 * "#20 · → open_canvas" or "#3 · can you open the browser". A request that is
 * not loaded yet, or carries no conversation, falls back to its model or path.
 */
export function requestLabel(
  entry: Pick<EntrySummary, "id"> & Partial<EntrySummary>,
  record: RequestRecord | undefined,
  showModel = false,
) {
  const seq = entry.seq ?? record?.seq;
  if (seq == null) return entry.id;
  const lead = record ? requestLead(record) : null;
  const model = entry.model ?? record?.model;
  const what = lead
    ? (lead.kind === "tools" ? "→ " : "") + oneLine(lead.text, 60)
    : model || (entry.url ? endpointLabel(entry as EntrySummary) : null);
  return [`#${seq}`, what, lead && showModel ? model : null].filter(Boolean).join(" · ");
}

/** Anything but a plain success: a healthy session shows no status at all. */
export function rowStatus(
  entry: EntrySummary,
): { label: string; tone: "error" | "pending" | "cancelled" } | null {
  if (isCancelled(entry)) return { label: "cancelled", tone: "cancelled" };
  if (entry.error != null) return { label: "error", tone: "error" };
  if (entry.pending) return { label: "pending", tone: "pending" };
  if (entry.status == null) return { label: "no status", tone: "pending" };
  return entry.status >= 400 ? { label: String(entry.status), tone: "error" } : null;
}

/**
 * The second line of a request row: when it started, how long it took and how
 * much the model wrote. What is the same on every row of a session is left out.
 */
export function rowFacts(
  entry: EntrySummary,
  record: RequestRecord | undefined,
  origin: number | null,
) {
  const started = entry.startedAt ?? entry.ts;
  const output = record ? requestTokens(record).output : undefined;
  return [
    started && origin != null ? fmtOffset(started - origin) : null,
    entry.latencyMs != null ? fmtMs(entry.latencyMs) : null,
    output ? `${fmtCompact(output)} tok out` : null,
  ].filter((fact): fact is string => !!fact);
}
