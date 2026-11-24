import type { RequestRecord, TimelineStep, ToolDefinition } from "../types";
import { CANCELLED_NOTE } from "./entries";
import {
  TAG_INFO,
  detectPatterns,
  envelopeName,
  flowSteps,
  humanText,
  smartSummary,
  toolCategory,
} from "./timeline";

export type FlowZone = "prefix" | "carried" | "new" | "response";
export type FlowKind =
  | "system"
  | "tools"
  | "user"
  | "assistant"
  | "thinking"
  | "tool"
  | "output"
  | "failed"
  /** The client closed the connection before the response finished. */
  | "cancelled"
  /** A response that stopped for an unusual reason, such as a token limit. */
  | "stop"
  /** A whole request with no conversation steps, such as a model listing. */
  | "request";
export type FlowStatus = "ok" | "error" | "awaiting" | "missing";

/** One scannable line: a message, or a tool call together with its output. */
export interface FlowItem {
  id: string;
  zone: FlowZone;
  kind: FlowKind;
  name: string;
  summary: string;
  text: string;
  /** Size of everything this item contributes, output included. */
  chars: number;
  tags: string[];
  /** A user-role message the harness wrote, not the person. */
  injected?: boolean;
  /** Instructions sent in their own role, such as "developer": never typed by the person. */
  role?: string;
  /** What the person typed, when the sent message wraps it in harness envelopes. */
  human?: string;
  callId?: string;
  callNumber?: number;
  /** Name of the called tool as it is written in the request, e.g. "Skill". */
  tool?: string;
  status?: FlowStatus;
  output?: string;
  description?: string;
  tools?: ToolDefinition[];
  /** Replaces the computed outcome column, e.g. "HTTP 404". */
  outcomeText?: string;
}

export interface FlowSection {
  id: "system" | "tools" | "carried" | "new";
  label: string;
  chars: number;
  share: number;
  tokens: number | null;
  target?: string;
}

export interface FlowModel {
  items: FlowItem[];
  sections: FlowSection[];
  inputTokens: number | null;
  /** True when the input total is ccglass's own estimate, not provider usage. */
  estimated: boolean;
  cacheRead: number | null;
  outputTokens: number | null;
  stopReason?: string;
  waiting: boolean;
}

export type FlowFilter = "all" | "prompt" | "assistant" | "tool" | "error" | "harness";

// Harness-written messages that arrive as plain text, without an envelope.
const PLAIN_HARNESS = new Set(["memory", "caveat", "recap", "skill-load"]);

const isCall = (step: TimelineStep) => step.kind === "tool_use" || step.kind === "skill";
const modelSide = (step: TimelineStep) =>
  step.kind === "assistant" || step.kind === "thinking" || isCall(step);
const finite = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

export interface StepResult {
  text: string;
  isError?: boolean;
}

/** "developer" → "Developer". */
export const roleName = (role: string) => role.charAt(0).toUpperCase() + role.slice(1);

/** Turns one timeline step, plus its paired tool output, into a display item. */
export function stepItem(
  step: TimelineStep,
  id: string,
  zone: FlowZone,
  result?: StepResult,
  pendingStatus: FlowStatus = "missing",
): FlowItem {
  const patterns = detectPatterns(step);
  const category = isCall(step) ? toolCategory(step.name) : null;
  const tags = patterns.filter((tag) => tag !== category);
  const base = { id, zone, text: step.text, tags, callId: step.callId };
  if (isCall(step)) {
    const empty = step.text.trim() === "{}" || !step.text.trim();
    return {
      ...base,
      kind: "tool",
      name: step.kind === "skill" ? `/${step.name || "skill"}` : step.name || "Unnamed tool",
      tool: step.kind === "skill" ? "Skill" : step.name,
      summary: empty ? "No arguments" : smartSummary(step) || "No arguments",
      chars: step.text.length + (result?.text.length ?? 0),
      status: result ? (result.isError ? "error" : "ok") : pendingStatus,
      output: result?.text,
    };
  }
  if (step.kind === "tool_result")
    return {
      ...base,
      kind: "output",
      name: "Tool output",
      summary: smartSummary(step) || "Empty output",
      chars: step.text.length,
      status: step.isError ? "error" : "ok",
    };
  if (step.kind === "stop" && step.cancelled)
    return {
      ...base,
      kind: "cancelled",
      name: "Cancelled",
      summary: CANCELLED_NOTE.charAt(0).toUpperCase() + CANCELLED_NOTE.slice(1),
      chars: step.text.length,
    };
  if (step.kind === "stop")
    return {
      ...base,
      kind: "failed",
      name: "Request failed",
      summary: step.text,
      chars: step.text.length,
    };
  if (step.kind === "system")
    return {
      ...base,
      kind: "system",
      // Chat Completions puts developer messages with the system blocks.
      name: /\.developer$/.test(step.label ?? "") ? "Developer message" : "System prompt",
      summary: smartSummary(step) || "Empty",
      chars: step.text.length,
    };
  if (step.kind === "tools")
    return {
      ...base,
      kind: "tools",
      name: "Tool definitions",
      summary: `${step.count ?? step.tools?.length ?? 0} tools · ${(step.tools ?? []).map((tool) => tool.name).join(", ")}`,
      chars: step.text.length,
      tools: step.tools,
    };
  const thinking =
    step.kind === "thinking" || (step.kind === "assistant" && step.label === "reasoning");
  if (thinking)
    return {
      ...base,
      kind: "thinking",
      name: "Thinking",
      summary: smartSummary(step) || "Empty",
      chars: step.text.length,
    };
  if (step.kind === "assistant")
    return {
      ...base,
      kind: "assistant",
      name: step.label ? `Assistant · ${step.label}` : "Assistant",
      summary: smartSummary(step) || "Empty message",
      chars: step.text.length,
    };
  // A developer or system message is the application's instructions, which
  // the model ranks above the user's: name it by its role, never as a prompt.
  if (step.role)
    return {
      ...base,
      kind: "user",
      name: roleName(step.role),
      summary: smartSummary(step) || "Empty message",
      chars: step.text.length,
      injected: true,
      role: step.role,
    };
  // Nothing left once the envelopes are gone means the harness wrote all of
  // it. A slash command is the exception: the person typed that.
  const human = humanText(step.text);
  const injected = human
    ? tags.some((tag) => PLAIN_HARNESS.has(tag))
    : !!step.text.trim() && !tags.includes("slash");
  const envelope = envelopeName(step.text);
  return {
    ...base,
    kind: "user",
    name: injected ? "Harness" : "User",
    summary: smartSummary(step) || "Empty message",
    chars: step.text.length,
    tags: injected && !tags.length && envelope ? [envelope] : tags,
    injected,
    human: !injected && human && human !== step.text.trim() ? human : undefined,
  };
}

/**
 * Where "new" starts in the sent messages: the model's last reply plus whatever
 * the agent appended after it. Each request re-sends the whole history, so
 * this tail is the only part the model has not already answered.
 */
export function newStart(steps: TimelineStep[]) {
  let index = steps.length;
  while (index > 0 && !modelSide(steps[index - 1])) index--;
  if (index === 0) return 0;
  while (index > 0 && modelSide(steps[index - 1])) index--;
  return index;
}

const isBlank = (step: TimelineStep) =>
  step.kind === "assistant" && !step.label && !step.text.trim();

/**
 * A text block with nothing in it, in a reply that also calls a tool or says
 * something. Some models send one before every tool call; as a row of its own
 * it reads "Assistant · Empty message" and says nothing. A reply that is empty
 * altogether is kept: that the model returned nothing is worth a row.
 */
export function isBlankReply(steps: TimelineStep[], index: number) {
  const step = steps[index];
  if (!step || !isBlank(step)) return false;
  const sameReply = (other: TimelineStep | undefined) =>
    !!other && modelSide(other) && !!other.latest === !!step.latest;
  for (let at = index - 1; sameReply(steps[at]); at--) if (!isBlank(steps[at])) return true;
  for (let at = index + 1; sameReply(steps[at]); at++) if (!isBlank(steps[at])) return true;
  return false;
}

export function buildFlow(record: RequestRecord): FlowModel {
  const view = record.parsed?.view;
  const items: FlowItem[] = [];

  const system = view?.system ?? [];
  system.forEach((block, index) => {
    const item = stepItem(
      { kind: "system", label: block.label, text: block.text || "" },
      `sys-${index}`,
      "prefix",
    );
    if (system.length > 1) item.name = `${item.name} ${index + 1}`;
    if (block.cache) item.tags = [...item.tags, "cached"];
    items.push(item);
  });
  const tools = view?.tools ?? [];
  if (tools.length)
    items.push({
      id: "tools",
      zone: "prefix",
      kind: "tools",
      name: "Tool definitions",
      summary: `${tools.length} ${tools.length === 1 ? "tool" : "tools"} · ${tools.map((tool) => tool.name).join(", ")}`,
      text: tools
        .map((tool) => tool.name + (tool.description ? "\n" + String(tool.description).trim() : ""))
        .join("\n\n"),
      // The schemas are sent too, so they count toward the weight.
      chars: JSON.stringify(tools).length,
      tags: [],
      tools,
    });

  const steps = flowSteps(record);
  const sent = steps.filter((step) => !step.latest);
  const returned = steps.filter((step) => step.latest);
  const split = newStart(sent);
  const results = new Map<string, TimelineStep>();
  const calls = new Set<string>();
  for (const step of sent) {
    if (step.kind === "tool_result" && step.callId && !results.has(step.callId))
      results.set(step.callId, step);
    else if (isCall(step) && step.callId) calls.add(step.callId);
  }

  let callNumber = 0;
  sent.forEach((step, index) => {
    const zone: FlowZone = index < split ? "carried" : "new";
    // An output is shown on its call's row; only unmatched ones get their own.
    if (step.kind === "tool_result" && step.callId && calls.has(step.callId)) return;
    if (isBlankReply(sent, index)) return;
    const result = isCall(step) && step.callId ? results.get(step.callId) : undefined;
    const item = stepItem(step, `m-${index}`, zone, result);
    if (item.kind === "tool") {
      item.callNumber = ++callNumber;
      item.description = tools.find((tool) => tool.name === step.name)?.description;
    }
    items.push(item);
  });

  const requestFailed =
    record.parsed?.response?.error != null ||
    record.response?.error != null ||
    record.error != null ||
    (record.response?.status ?? 0) >= 400;
  let stopReason: string | undefined;
  returned.forEach((step, index) => {
    if (isBlankReply(returned, index)) return;
    if (step.kind === "stop") {
      if (step.cancelled || requestFailed || /^error(?:[\s:]|$)/.test(step.text))
        items.push(stepItem(step, `r-${index}`, "response"));
      else stopReason = step.text;
      return;
    }
    const item = stepItem(step, `r-${index}`, "response", undefined, "awaiting");
    if (item.kind === "tool") {
      item.callNumber = ++callNumber;
      item.description = tools.find((tool) => tool.name === step.name)?.description;
    }
    items.push(item);
  });

  const stats = (record.parsed?.usageStats ?? record.usageStats) as
    | { totalInput?: number; output?: number; cacheRead?: number }
    | undefined;
  // A request that never finished reports zeros: that is no usage, not "0 tokens".
  const reported = !!(stats?.totalInput || stats?.output);
  const measured = reported ? finite(stats?.totalInput) : null;
  const inputTokens = measured ?? finite(record.parsed?.estTokens);
  const sum = (zone: FlowZone, kind?: FlowKind) =>
    items
      .filter((item) => item.zone === zone && (!kind || item.kind === kind))
      .reduce((total, item) => total + item.chars, 0);
  const raw: Omit<FlowSection, "share" | "tokens">[] = [
    { id: "system", label: "System prompt", chars: sum("prefix", "system"), target: "sys-0" },
    { id: "tools", label: "Tool definitions", chars: sum("prefix", "tools"), target: "tools" },
    {
      id: "carried",
      label: "Earlier turns",
      chars: sum("carried"),
      target: items.find((item) => item.zone === "carried")?.id,
    },
    {
      id: "new",
      label: "New",
      chars: sum("new"),
      target: items.find((item) => item.zone === "new")?.id,
    },
  ];
  const total = raw.reduce((all, section) => all + section.chars, 0);
  const sections = raw
    .filter((section) => section.chars > 0)
    .map((section) => ({
      ...section,
      share: section.chars / total,
      // Providers report one input total; the split follows character counts.
      tokens: inputTokens == null ? null : Math.round((inputTokens * section.chars) / total),
    }));

  return {
    items,
    sections,
    inputTokens,
    estimated: measured == null && inputTokens != null,
    cacheRead: reported ? finite(stats?.cacheRead) : null,
    outputTokens: reported ? finite(stats?.output) : null,
    stopReason,
    waiting: !record.response && !returned.length,
  };
}

export function matchesFilter(filter: FlowFilter, item: FlowItem) {
  if (filter === "prompt") return item.kind === "user" && !item.injected;
  if (filter === "assistant") return item.kind === "assistant" || item.kind === "thinking";
  if (filter === "tool") return item.kind === "tool" || item.kind === "output";
  // Requests without conversation steps are setup noise: listed, never filtered for.
  if (item.kind === "request") return filter === "all";
  if (filter === "error")
    return item.status === "error" || item.kind === "failed" || item.kind === "stop";
  if (filter === "harness")
    return !!item.injected || item.kind === "system" || item.kind === "tools";
  return true;
}

/** Row that Arrow keys, j/k, Home and End move to, or undefined for other keys. */
export function keyTarget<T>(key: string, rows: T[], current: T | undefined): T | undefined {
  const step = key === "ArrowDown" || key === "j" ? 1 : key === "ArrowUp" || key === "k" ? -1 : 0;
  if (!rows.length || (!step && key !== "Home" && key !== "End")) return undefined;
  if (key === "Home") return rows[0];
  if (key === "End") return rows[rows.length - 1];
  const at = current === undefined ? -1 : rows.indexOf(current);
  return rows[Math.max(0, Math.min(rows.length - 1, at + step))];
}

export function matchesQuery(query: string, item: FlowItem) {
  if (!query) return true;
  return [item.name, item.summary, item.text, item.output ?? ""].some((part) =>
    part.toLowerCase().includes(query),
  );
}

/** "ok · 1,979 chars" — the right-hand column of a row. */
export function outcome(item: FlowItem): {
  text: string;
  /** Character count the text refers to; rendered with a hideable unit. */
  size?: number;
  tone: "ok" | "error" | "warn" | "quiet";
} {
  if (item.outcomeText != null)
    return { text: item.outcomeText, tone: item.status === "error" ? "error" : "quiet" };
  if (item.kind === "failed") return { text: "failed", tone: "error" };
  if (item.kind === "cancelled") return { text: "cancelled", tone: "warn" };
  if (item.kind === "stop") return { text: "stopped early", tone: "error" };
  if (item.kind === "tool") {
    if (item.status === "ok") return { text: "ok · ", size: item.output?.length ?? 0, tone: "ok" };
    if (item.status === "error")
      return { text: "error · ", size: item.output?.length ?? 0, tone: "error" };
    return {
      text: item.status === "awaiting" ? "awaiting output" : "no output captured",
      tone: "quiet",
    };
  }
  if (item.kind === "output" && item.status === "error")
    return { text: "error · ", size: item.chars, tone: "error" };
  return { text: "", size: item.chars, tone: "quiet" };
}

export const approxTokens = (tokens: number) =>
  tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : String(tokens);

export const KIND_LABEL: Record<FlowKind, string> = {
  system: "System prompt",
  tools: "Tool definitions",
  user: "User prompt",
  assistant: "Assistant message",
  thinking: "Reasoning",
  tool: "Tool call",
  output: "Tool output",
  failed: "Request failed",
  cancelled: "Request cancelled",
  stop: "Response stopped early",
  request: "Request without conversation steps",
};

/**
 * The two lines that title an item in the preview pane. The title names the
 * item; the line above adds only what the title does not already say, so a
 * prompt is not headed "User prompt / User".
 */
export function previewHeading(item: FlowItem): { eyebrow: string; title: string } {
  const tags = item.tags.map((tag) => TAG_INFO[tag]?.headline ?? tag);
  const line = (...parts: (string | false | undefined)[]) =>
    [...parts, ...tags].filter(Boolean).join(" · ");
  switch (item.kind) {
    case "tool":
      return { eyebrow: line("Tool call"), title: item.name };
    case "user":
      if (item.role)
        return { eyebrow: line(`Sent in the ${item.role} role`), title: `${item.name} message` };
      return item.injected
        ? { eyebrow: line("Sent in the user role"), title: "Harness message" }
        : { eyebrow: line(), title: KIND_LABEL.user };
    case "assistant": {
      // "Assistant · refusal": the part after the dot is the block's own type.
      const label = item.name.split(" · ")[1];
      return { eyebrow: line(), title: KIND_LABEL.assistant + (label ? ` · ${label}` : "") };
    }
    case "system":
      // Several system blocks are numbered: "System prompt 2".
      return { eyebrow: line(), title: item.name };
    case "tools": {
      const count = item.tools?.length ?? 0;
      return {
        eyebrow: line(`${count} ${count === 1 ? "tool" : "tools"} offered to the model`),
        title: KIND_LABEL.tools,
      };
    }
    case "output":
      return { eyebrow: line("No matching call in this request"), title: KIND_LABEL.output };
    case "request":
      // The first line of its text is "GET /v1/models".
      return { eyebrow: line(KIND_LABEL.request), title: item.text.split("\n")[0] || item.name };
    default:
      return { eyebrow: line(), title: KIND_LABEL[item.kind] };
  }
}
