import type { ContentBlock, RequestRecord } from "../types";
import { buildFlow, newStart, stepItem, type FlowItem, type FlowZone } from "./flow";
import { flowSteps } from "./timeline";

/** A stretch of a user-role message: typed text, or one harness envelope. */
export interface Segment {
  kind: "text" | "envelope";
  /** Envelope tag name, e.g. "system-reminder". */
  name?: string;
  text: string;
  /** The first stretch of plain text is what the person typed. */
  human?: boolean;
}

/** One content block of a message, in the order it was sent. */
export interface MessagePart {
  /** Same id as the matching Flow row, e.g. "m-12". */
  id: string;
  index: number;
  item: FlowItem;
  zone: FlowZone;
  /** Ends a cacheable prefix: the block carries a cache breakpoint. */
  cache: boolean;
  /** For a tool output: the tool that produced it, when its call was sent too. */
  toolName?: string;
  /** The other half of a call/output pair. */
  pair?: { id: string; group: number };
  segments?: Segment[];
}

/** One entry of the request's message array. */
export interface MessageGroup {
  key: string;
  /** Position in the request body, e.g. "messages[8]"; absent for unlabelled captures. */
  path?: string;
  number: number;
  /** Role as written in the request. */
  role: string;
  /** What the entry is to a reader: User, Harness, Assistant, Tool output. */
  label: string;
  tone: "user" | "assistant" | "tool" | "quiet";
  zone: FlowZone;
  chars: number;
  parts: MessagePart[];
}

export interface MessagesModel {
  groups: MessageGroup[];
  parts: MessagePart[];
  chars: number;
  /** Estimated tokens for all messages, from Flow's split of the input. */
  tokens: number | null;
  /** Index of the first group the model has not answered yet. */
  newFrom: number;
  largest?: MessagePart;
}

// Same rule as timeline.ts: harness envelopes carry a dash or underscore.
const ENVELOPE = /<((?=[\w-]*[-_])[a-zA-Z][\w-]*)>[\s\S]*?<\/\1>/g;

/** Splits a user-role message into what was typed and what was wrapped around it. */
export function splitEnvelopes(text: string): Segment[] {
  const segments: Segment[] = [];
  let position = 0;
  let human = false;
  const plain = (value: string) => {
    if (!value.trim()) return;
    segments.push({ kind: "text", text: value.trim(), human: !human });
    human = true;
  };
  for (const match of String(text || "").matchAll(ENVELOPE)) {
    plain(text.slice(position, match.index));
    segments.push({ kind: "envelope", name: match[1], text: match[0] });
    position = match.index + match[0].length;
  }
  plain(text.slice(position));
  return segments;
}

const groupKey = (label: string | undefined) => /^(msg|input)\[(\d+)\]/.exec(label || "");

/** Number of entries in the message array, as opposed to content blocks. */
export function countMessages(messages: ContentBlock[] | undefined) {
  if (!messages?.length) return 0;
  let count = 0;
  let previous: string | undefined;
  for (const message of messages) {
    const key = groupKey(message.label)?.[0];
    if (!key || key !== previous) count++;
    previous = key;
  }
  return count;
}

const titleCase = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export function buildMessages(record: RequestRecord): MessagesModel {
  const blocks = record.parsed?.view?.messages ?? [];
  // One step per block, in order: the same reading Flow and Session replay use.
  const steps = flowSteps(record).filter((step) => !step.latest);
  const split = newStart(steps);
  const calls = new Map<string, number>();
  const outputs = new Map<string, number>();
  steps.forEach((step, index) => {
    if (!step.callId) return;
    if (step.kind === "tool_result") {
      if (!outputs.has(step.callId)) outputs.set(step.callId, index);
    } else if (step.kind === "tool_use" || step.kind === "skill") calls.set(step.callId, index);
  });

  const parts: MessagePart[] = steps.map((step, index) => {
    const output = step.kind === "tool_result";
    const call = step.kind === "tool_use" || step.kind === "skill";
    const resultAt = call && step.callId ? outputs.get(step.callId) : undefined;
    const result = resultAt == null ? undefined : steps[resultAt];
    const item = stepItem(step, `m-${index}`, index < split ? "carried" : "new", result);
    const callAt = output && step.callId ? calls.get(step.callId) : undefined;
    const caller = callAt == null ? undefined : steps[callAt];
    return {
      id: item.id,
      index,
      item,
      zone: item.zone,
      cache: !!blocks[index]?.cache,
      toolName: caller ? (caller.kind === "skill" ? `/${caller.name}` : caller.name) : undefined,
      segments: item.kind === "user" ? splitEnvelopes(step.text) : undefined,
    };
  });

  const groups: MessageGroup[] = [];
  parts.forEach((part) => {
    const block = blocks[part.index] ?? {};
    const match = groupKey(block.label);
    const last = groups[groups.length - 1];
    if (match && last?.key === match[0]) {
      last.parts.push(part);
      last.chars += part.item.text.length;
      return;
    }
    groups.push({
      key: match?.[0] ?? `part-${part.index}`,
      path: match ? `${match[1] === "msg" ? "messages" : "input"}[${match[2]}]` : undefined,
      number: match ? Number(match[2]) : groups.length + 1,
      role: String(block.role || ""),
      label: "",
      tone: "quiet",
      zone: part.zone,
      chars: part.item.text.length,
      parts: [part],
    });
  });

  const groupOf = new Map<string, number>();
  groups.forEach((group, at) => {
    group.parts.forEach((part) => groupOf.set(part.id, at));
    const kinds = group.parts.map((part) => part.item.kind);
    const userRole = !group.role || group.role === "user";
    const typed = group.parts.some((part) => part.item.kind === "user" && !part.item.injected);
    if (kinds.some((kind) => kind === "assistant" || kind === "thinking" || kind === "tool")) {
      group.label = "Assistant";
      group.tone = "assistant";
    } else if (typed && userRole) {
      group.label = "User";
      group.tone = "user";
    } else if (kinds.includes("output")) {
      group.label = "Tool output";
      group.tone = "tool";
    }
    // Sent in the user role, yet nobody typed it.
    else if (userRole) group.label = "Harness";
    else group.label = titleCase(group.role);
  });
  parts.forEach((part) => {
    const id = part.item.callId;
    if (!id) return;
    const other = part.item.kind === "tool" ? outputs.get(id) : part.item.kind === "output" ? calls.get(id) : undefined;
    if (other == null || other === part.index) return;
    part.pair = { id: `m-${other}`, group: groups[groupOf.get(`m-${other}`) ?? 0].number };
  });

  const first = groups.findIndex((group) => group.zone === "new");
  const sections = buildFlow(record).sections.filter(
    (section) => section.id === "carried" || section.id === "new",
  );
  return {
    groups,
    parts,
    chars: parts.reduce((total, part) => total + part.item.text.length, 0),
    tokens:
      sections.length && sections.every((section) => section.tokens != null)
        ? sections.reduce((total, section) => total + (section.tokens ?? 0), 0)
        : null,
    newFrom: first < 0 ? groups.length : first,
    largest: parts.reduce<MessagePart | undefined>(
      (best, part) => (!best || part.item.text.length > best.item.text.length ? part : best),
      undefined,
    ),
  };
}

/** The model's reply to this request, in the same shape as a sent message. */
export function buildReply(record: RequestRecord): MessageGroup | undefined {
  const steps = flowSteps(record).filter((step) => step.latest && step.kind !== "stop");
  if (!steps.length) return undefined;
  const parts: MessagePart[] = steps.map((step, index) => {
    const item = stepItem(step, `r-${index}`, "response", undefined, "awaiting");
    return { id: item.id, index, item, zone: "response", cache: false };
  });
  return {
    key: "reply",
    number: 0,
    role: "assistant",
    label: "Assistant",
    tone: "assistant",
    zone: "response",
    chars: parts.reduce((total, part) => total + part.item.text.length, 0),
    parts,
  };
}
