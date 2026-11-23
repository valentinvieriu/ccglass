import type { RequestRecord, TimelineStep, TimelineRow } from "../types";
import { oneLine } from "./format";
export { oneLine } from "./format";

const sameArguments = (a: string, b: string) => {
  const canonical = (text: string) => {
    try {
      return JSON.stringify(JSON.parse(text));
    } catch {
      return text.trim();
    }
  };
  return canonical(a) === canonical(b);
};

/** Rebuild from immutable records so updated responses replace stale steps. */
export function buildTimeline(records: RequestRecord[]): TimelineRow[] {
  const rows: TimelineRow[] = [];
  const seen = new Set<string>();
  const toolRows = new Map<string, TimelineRow>();
  const orphanResults = new Map<string, NonNullable<TimelineRow["result"]>>();
  // Some providers stream tool calls without an id; the client then invents one
  // and uses it from the next request on. Until that request arrives these rows
  // can only be recognised by tool name and arguments.
  const unidentified: TimelineRow[] = [];
  for (const record of [...records].sort((a, b) => (a.seq || 0) - (b.seq || 0))) {
    for (const step of liveFlowSteps(record)) {
      if (step.kind === "tool_result" && step.callId) {
        const tool = toolRows.get(step.callId);
        const previous = tool?.result ?? orphanResults.get(step.callId);
        // Re-sent history must not move an unchanged output to a later request.
        const result = previous && previous.text === step.text && previous.isError === step.isError
          ? previous
          : { ...step, entryId: record.id, seq: record.seq };
        if (tool) {
          tool.result = result;
          continue;
        }
        orphanResults.set(step.callId, result);
      }
      const key = liveStepKey(step);
      if (seen.has(key)) continue;
      seen.add(key);
      const call = step.kind === "tool_use" || step.kind === "skill";
      if (call && step.callId && !step.latest) {
        const at = unidentified.findIndex(
          (row) =>
            row.kind === step.kind && row.name === step.name && sameArguments(row.text, step.text),
        );
        if (at >= 0) {
          // The same call, now with the id its output will carry.
          const [row] = unidentified.splice(at, 1);
          row.callId = step.callId;
          toolRows.set(step.callId, row);
          continue;
        }
      }
      const row: TimelineRow = {
        ...step,
        key,
        entryId: record.id,
        seq: record.seq,
        ts: record.ts ?? record.startedAt,
        model: record.parsed?.response?.model || record.request?.body?.model || record.model,
        status: record.response?.status,
        latencyMs: record.latencyMs,
      };
      if (call && !step.callId && step.latest) unidentified.push(row);
      if (call && step.callId) {
        toolRows.set(step.callId, row);
        const result = orphanResults.get(step.callId);
        if (result) {
          row.result = result;
          const orphanIndex = rows.findIndex(
            (r) => r.kind === "tool_result" && r.callId === step.callId,
          );
          if (orphanIndex >= 0) rows.splice(orphanIndex, 1);
        }
      }
      rows.push(row);
    }
  }
  return rows;
}

function skillName(text: string) {
  try {
    const o = JSON.parse(text);
    return o.skill || o.name || "";
  } catch {
    return "";
  }
}

// `request: true` includes everything else the client sent — system prompt
// blocks and the tools array — in prompt order (system → tools → messages),
// so the live stream reflects the full request, not just the conversation.
export function flowSteps(
  rec: RequestRecord,
  {
    request = false,
    requestMessages = true,
    requestToolResults = requestMessages,
  }: { request?: boolean; requestMessages?: boolean; requestToolResults?: boolean } = {},
): TimelineStep[] {
  const parsed = rec.parsed || {};
  const steps: TimelineStep[] = [];
  if (request) {
    for (const s of parsed.view?.system || []) {
      steps.push({ kind: "system", label: s.label, text: s.text || "" });
    }
    const tools = parsed.view?.tools || [];
    if (tools.length) {
      const list = tools.map((t) => ({
        name: t.name,
        description: String(t.description || "").trim(),
      }));
      steps.push({
        kind: "tools",
        count: tools.length,
        tools: list, // rendered by liveStepEl
        // `text` isn't displayed but feeds liveStepKey and the hasBody check.
        text: list.map((t) => t.name + (t.description ? "\n" + t.description : "")).join("\n\n"),
      });
    }
  }
  if (requestMessages || requestToolResults) {
    for (const m of parsed.view?.messages || []) {
      if (m.type === "tool_result") {
        // A tool_result is a tool/function OUTPUT (OpenAI function_call_output
        // shows up on the *next* request), not prompt context — keep it even
        // when the request side is suppressed (Codex) so it can merge into the
        // prior turn's pending tool row and reveal the command output.
        if (!requestToolResults) continue;
        steps.push({
          kind: "tool_result",
          callId: m.callId,
          isError: m.isError,
          text: m.text || "",
        });
        continue;
      }
      if (!requestMessages) continue;
      if (m.type === "tool_use") {
        const isSkill = m.name === "Skill";
        steps.push({
          kind: isSkill ? "skill" : "tool_use",
          name: isSkill ? skillName(m.text || "") || "skill" : m.name,
          callId: m.callId,
          text: m.text || "",
        });
      } else if (m.type === "thinking") {
        steps.push({ kind: "thinking", text: m.text || "" });
      } else {
        steps.push({ kind: m.role === "assistant" ? "assistant" : "user", text: m.text || "" });
      }
    }
  }
  // The reply to THIS request lives in the response, not yet in messages[].
  const r = parsed.response;
  let emittedResponse = false;
  if (r && Array.isArray(r.content)) {
    for (const b of r.content) {
      if (b.type === "tool_use") {
        const isSkill = b.name === "Skill";
        steps.push({
          kind: isSkill ? "skill" : "tool_use",
          name: isSkill ? b.input?.skill || "skill" : b.name,
          callId: b.id,
          text: JSON.stringify(b.input ?? {}, null, 2),
          latest: true,
        });
      } else if (b.type === "thinking") {
        steps.push({ kind: "thinking", text: b.thinking ?? "", latest: true });
      } else {
        steps.push({
          kind: "assistant",
          label: b.type === "text" ? undefined : b.type,
          text: b.text ?? (b.type === "text" ? "" : JSON.stringify(b, null, 2)),
          latest: true,
        });
      }
      emittedResponse = true;
    }
    if (r.stop_reason) {
      steps.push({ kind: "stop", text: r.stop_reason, latest: true });
      emittedResponse = true;
    }
  }
  // A failed turn carries no content array (API error body, or a non-2xx with
  // nothing to reassemble). Emit a terminal row so the turn stays visible —
  // critical in the live view, where the request side may be suppressed (Codex)
  // and the entry would otherwise disappear entirely.
  if (!emittedResponse) {
    const status = rec.response?.status;
    const err = r?.error ?? rec.response?.error ?? rec.error;
    if (err || (status && status >= 400)) {
      const msg = err?.message || err?.type || (typeof err === "string" ? err : "");
      // callId keys this row per-turn so two turns that fail with the *same*
      // error aren't deduped into one (which would re-hide the second failure).
      steps.push({
        kind: "stop",
        callId: "resp-error|" + (rec.id ?? rec.seq ?? ""),
        text: `error${status ? " " + status : ""}${msg ? ": " + oneLine(msg, 140) : ""}`,
        latest: true,
      });
    }
  }
  return steps;
}

// Harness envelopes (<system-reminder>, <current_datetime>, <canvas-context>…)
// all carry a dash or underscore in the tag name; ordinary HTML does not.
const ENVELOPE = /<((?=[\w-]*[-_])[a-zA-Z][\w-]*)>[\s\S]*?<\/\1>/g;

/**
 * What the person typed: the first stretch of text outside the envelopes a
 * harness wraps around it. Later stretches are usually the harness explaining
 * one of its own envelopes.
 */
export function humanText(text: string) {
  return (
    String(text || "")
      .replace(ENVELOPE, "\u0000")
      .split("\u0000")
      .map((part) => part.trim())
      .find(Boolean) ?? ""
  );
}

/** Name of the first envelope in a message, e.g. "system-reminder". */
export function envelopeName(text: string) {
  return /<((?=[\w-]*[-_])[a-zA-Z][\w-]*)>/.exec(String(text || ""))?.[1];
}

export function smartSummary(step: TimelineStep) {
  if (step.kind === "user")
    return oneLine(humanText(step.text) || step.text.replace(/<\/?[a-zA-Z][\w-]*>/g, " "), 200);
  if (step.kind === "tool_result") {
    let inner = String(step.text || "");
    try {
      const o = JSON.parse(inner);
      if (Array.isArray(o))
        inner = o
          .map((x) => (typeof x === "string" ? x : (x?.text ?? JSON.stringify(x))))
          .join("\n");
      else if (typeof o === "object" && o) inner = o.text ?? JSON.stringify(o);
    } catch {
      /* not JSON */
    }
    return oneLine(inner, 140);
  }
  if (step.kind === "stop") return step.text || "";
  if (step.kind === "tool_use" || step.kind === "skill") {
    let input: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(step.text);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
        input = parsed as Record<string, unknown>;
    } catch {
      /* not JSON */
    }
    const name = step.name || "";
    if (name === "Bash") return oneLine(input.command, 140);
    if (name === "Read") {
      const loc = oneLine(input.file_path, 140);
      const end = typeof input.offset === "number" && typeof input.limit === "number" && input.limit
        ? `-${input.offset + input.limit}`
        : "";
      const rng =
        typeof input.offset === "number"
          ? `:${input.offset}${end}`
          : "";
      return loc + rng;
    }
    if (name === "Edit" || name === "Write" || name === "NotebookEdit")
      return oneLine(input.file_path, 140);
    if (name === "Grep")
      return oneLine(
        [input.pattern && `"${input.pattern}"`, input.path].filter(Boolean).join(" in "),
        140,
      );
    if (name === "Glob") return oneLine(input.pattern, 140);
    if (name === "WebFetch" || name === "WebSearch") return oneLine(input.url || input.query, 140);
    if (step.kind === "skill" || name === "Skill")
      return oneLine(input.skill || input.name || name, 140);
    if (name === "TaskCreate" || name === "TaskUpdate")
      return oneLine(input.subject || input.description, 140);
    if (name === "AskUserQuestion" && Array.isArray(input.questions))
      return oneLine(input.questions[0]?.question, 140);
    if (/sql|query|exec/i.test(name))
      return oneLine(input.sql || input.query || input.statement, 140);
    const fields = Object.entries(input).filter(
      ([, value]) =>
        typeof value === "string" || typeof value === "number" || typeof value === "boolean",
    );
    if (fields.length)
      return oneLine(
        fields.slice(0, 3).map(([key, value]) => `${key}: ${value}`).join(" · "),
        180,
      );
    return oneLine(step.text, 180);
  }
  if (step.kind === "tools") return `${step.count} tools offered to the model`;
  return oneLine(step.text, 200);
}

export function liveStepKey(s: TimelineStep) {
  if (s.callId) return s.kind + "|" + s.callId;
  // Length is part of the key so a block that changes anywhere (not just in
  // its first 200 chars) re-appears in the stream instead of being deduped.
  const t = String(s.text || "");
  return s.kind + "|" + t.length + "|" + t.slice(0, 200);
}

// Tool name → category (file/shell/search/web/task/agent/plan/q&a/cron/notify/mcp)
export function toolCategory(name?: string) {
  if (!name) return null;
  if (name.startsWith("mcp__")) return "mcp";
  if (/^(Read|Edit|Write|MultiEdit|NotebookEdit)$/.test(name)) return "file";
  if (/^(Bash|BashOutput|KillShell)$/.test(name)) return "shell";
  if (/^(Grep|Glob|LS)$/.test(name)) return "search";
  if (/^(WebFetch|WebSearch)$/.test(name)) return "web";
  if (/^Task(Create|Update|Get|List|Output|Stop)$/.test(name)) return "task";
  if (/^Agent$/.test(name)) return "agent";
  if (/^Skill$/.test(name)) return "skill";
  if (/^(EnterPlanMode|ExitPlanMode)$/.test(name)) return "plan";
  if (/^AskUserQuestion$/.test(name)) return "ask";
  if (/^(ScheduleWakeup|CronCreate|CronDelete|CronList)$/.test(name)) return "cron";
  if (/^PushNotification$/.test(name)) return "notify";
  if (/^TodoWrite$/.test(name)) return "task";
  return null;
}

// Recognize common envelope patterns in flow steps and return pattern tags.
// These are passive labels — they don't filter, just classify, so you can scan
// the stream and see "ah, this user row is a system-reminder, not a real input".
const PAT_DETECTORS: {
  kinds: string[];
  match: (text: string, step: TimelineStep) => unknown;
  tag: string;
}[] = [
  // ---- user-side text envelopes ----------------------------------------
  {
    kinds: ["user"],
    match: (t) => /^<command-name>|^<command-message>|^<command-args>/m.test(t),
    tag: "slash",
  },
  { kinds: ["user"], match: (t) => /<local-command-stdout>/.test(t), tag: "cmd-out" },
  {
    kinds: ["user"],
    match: (t) =>
      /<user-prompt-submit-hook>|<session-start-hook>|<post-tool-use-hook>|<stop-hook>/.test(t),
    tag: "hook",
  },
  { kinds: ["user"], match: (t) => /<system[-_]reminder>/.test(t), tag: "reminder" },
  {
    kinds: ["user"],
    match: (t) => /Caveat: The messages below were generated/i.test(t),
    tag: "caveat",
  },
  {
    kinds: ["user"],
    match: (t) => /\[Image #\d+\]|image_path=|<channel source="(imessage|telegram)"/.test(t),
    tag: "image",
  },
  {
    kinds: ["user"],
    match: (t) =>
      /Contents of \/.+CLAUDE\.md|Codebase and user instructions are shown below|# auto memory|# currentDate|# userEmail/.test(
        t,
      ),
    tag: "memory",
  },
  {
    kinds: ["user"],
    match: (t) =>
      /Previous Conversation Compacted|This session is being continued|<auto-compact-summary>|stepped away and is coming back|Recap in under \d+ words|recap.*1-2 plain sentences/i.test(
        t,
      ),
    tag: "recap",
  },
  // Skill invocation/return — appears as user-role text in Claude Code
  {
    kinds: ["user"],
    match: (t) => /^Launching skill:|^Base directory for this skill:/m.test(t),
    tag: "skill-load",
  },
  // ---- assistant-side text -----------------------------------------------
  { kinds: ["assistant"], match: (t, s) => s.text.length === 0, tag: "empty" },
];

export function detectPatterns(step: TimelineStep) {
  const out: string[] = [];
  const t = String(step.text || "");
  for (const d of PAT_DETECTORS) {
    if (!d.kinds.includes(step.kind)) continue;
    try {
      if (d.match(t, step)) out.push(d.tag);
    } catch {
      /* skip */
    }
  }
  if (step.kind === "tool_use" || step.kind === "skill") {
    const cat = toolCategory(step.name);
    if (cat) out.push(cat);
  }
  return out;
}

export function isCodexRecord(rec: RequestRecord) {
  const model = rec.parsed?.response?.model || rec.request?.body?.model || rec.model || "";
  if (String(model).toLowerCase().includes("codex")) return true;
  // Codex CLI (codex_cli_rs) stamps its own user-agent/originator. That client
  // signature — not merely a /v1/responses URL — is what tells real Codex
  // traffic apart from a generic OpenAI Responses client, so we don't suppress
  // the latter's request side (prompt, tools, function-call outputs).
  const h = rec.request?.headers || {};
  const ua = String(h["user-agent"] || h["User-Agent"] || h.originator || "").toLowerCase();
  return ua.includes("codex");
}

export function liveFlowSteps(rec: RequestRecord) {
  const showRequest = !isCodexRecord(rec);
  // For Codex, hide prompt/system/tool-call context but keep tool_result rows:
  // the function_call_output arrives on the NEXT request and is what merges into
  // the prior turn's pending tool row, so dropping it would leave that row stuck
  // at "pending…" and hide the command/function output.
  return flowSteps(rec, {
    request: showRequest,
    requestMessages: showRequest,
    requestToolResults: true,
  });
}

export const TAG_INFO: Record<string, { headline: string; desc: string; doc?: string }> = {
  // ---- pattern tags: user-side envelopes -------------------------------
  reminder: {
    headline: "system-reminder",
    desc: "A <system-reminder> block — the CLI injected guidance into the user's message slot to nudge the model (e.g. 'consider using the task tools', 'be terse', 'auto-mode active'). The user didn't type this; it's harness instrumentation. Models are trained to take these seriously, so they shape behavior even though they're invisible in normal chat UIs.",
  },
  hook: {
    headline: "hook output",
    desc: "Output from a Claude Code hook — user-configured shell commands that fire on lifecycle events (session start, user prompt submit, after each tool use, on stop). Whatever the hook prints to stdout gets injected as a synthetic user-role message. The model treats it as user input, so a misbehaving hook can effectively steer the agent.",
    doc: "https://docs.claude.com/en/docs/claude-code/hooks",
  },
  slash: {
    headline: "slash command",
    desc: "The user typed a slash command like /skill-name, /clear, or /help. The CLI resolves it into a structured envelope (<command-name>, <command-message>, <command-args>) before sending to the model — that envelope is what you see in the body.",
    doc: "https://docs.claude.com/en/docs/claude-code/slash-commands",
  },
  "cmd-out": {
    headline: "local command output",
    desc: "stdout of a local shell command the user ran inline via the ! prefix (e.g. `!ls`). The CLI wraps it in <local-command-stdout> tags and feeds it back to the model as user-role context.",
  },
  caveat: {
    headline: "caveat banner",
    desc: "The CLI prepends 'Caveat: The messages below were generated by the user while running local commands' when content was produced by side-channel tools (file edits via /edit, etc), not the assistant. Marks a provenance boundary.",
  },
  memory: {
    headline: "memory context",
    desc: "The CLI's auto-loaded context: CLAUDE.md files (project + user-level), environment info (cwd, OS, git branch), current date, user email. This bootstraps every session and usually lives in the first user message — explains why turn 1 is huge.",
    doc: "https://docs.claude.com/en/docs/claude-code/memory",
  },
  recap: {
    headline: "recap",
    desc: "A synthetic message asking the model to compress or restate prior state. Two common triggers: (1) auto-compaction — the CLI hit the context window and condensed earlier turns into a summary, so the model continues from a digest rather than full history; (2) the user stepped away and came back, and the harness injects a 'recap where we are' prompt to re-orient the model.",
  },
  image: {
    headline: "image attached",
    desc: "The user attached an image (screenshot, IM channel photo, drag-and-drop). The body shows the surrounding text; the image itself was sent as a separate content block alongside.",
  },
  "skill-load": {
    headline: "skill loaded",
    desc: "A Skill's full instructions were dropped into the conversation. Once loaded, the skill's content acts as additional system-level guidance for the rest of the turn (sometimes longer). Usually preceded by a slash-command invocation.",
    doc: "https://docs.claude.com/en/docs/claude-code/skills",
  },
  empty: {
    headline: "empty block",
    desc: "An empty text content block — no characters. Harmless but odd; usually a model output quirk.",
  },
  // ---- pattern tags: tool categories ------------------------------------
  file: {
    headline: "file operation",
    desc: "Read / Edit / Write / MultiEdit / NotebookEdit — the model is touching files on disk. The body shows the file content after a successful call.",
  },
  shell: {
    headline: "shell command",
    desc: "Bash — the model executed a shell command locally. The title shows the command; the body shows stdout (and stderr) plus exit code.",
  },
  search: {
    headline: "codebase search",
    desc: "Grep (regex over files) or Glob (filename patterns). The model is exploring the codebase. Output is typically a short list of matches with line numbers.",
  },
  web: {
    headline: "web access",
    desc: "WebFetch (load a URL and summarize) or WebSearch (query a search engine). The model went off-machine to get context.",
  },
  task: {
    headline: "task tracking",
    desc: "TaskCreate / TaskUpdate / TaskList / TodoWrite — the model is managing its own to-do list for multi-step work. Visible in the CLI's spinner.",
  },
  agent: {
    headline: "sub-agent",
    desc: "Spawned a specialized sub-agent via the Agent tool. The sub-agent runs in an isolated context and returns a single summary message. Useful for parallel exploration without polluting the main context.",
    doc: "https://docs.claude.com/en/docs/claude-code/sub-agents",
  },
  skill: {
    headline: "skill",
    desc: "Invoked a Claude skill via the Skill tool. The skill's instructions get loaded and the model follows that workflow.",
    doc: "https://docs.claude.com/en/docs/claude-code/skills",
  },
  plan: {
    headline: "plan mode",
    desc: "EnterPlanMode / ExitPlanMode — the model is in plan-first mode, where it must present an implementation plan and get user approval before writing code. Common for non-trivial features.",
  },
  ask: {
    headline: "user question",
    desc: "AskUserQuestion — the model paused execution to ask the user a multiple-choice question. Conversation can't continue until the user answers.",
  },
  cron: {
    headline: "scheduled",
    desc: "CronCreate / CronDelete / CronList / ScheduleWakeup — the model scheduled a future prompt. The harness fires the prompt back at the scheduled time, resuming the loop.",
  },
  notify: {
    headline: "notification",
    desc: "PushNotification — the model sent a desktop and/or phone notification to grab the user's attention. Usually for long-running tasks or when blocked.",
  },
  mcp: {
    headline: "MCP tool",
    desc: "Model Context Protocol — the model called a tool exposed by an external MCP server (e.g. mcp__github__*, mcp__filesystem__*). MCP is how Claude Code plugs into databases, APIs, IDEs.",
    doc: "https://docs.claude.com/en/docs/claude-code/mcp",
  },
  // ---- operational tags -------------------------------------------------
  ok: {
    headline: "ok",
    desc: "The tool call returned successfully. The body shows the exact output text the model received — that's what the model will reason about next.",
  },
  err: {
    headline: "error",
    desc: "The tool reported an error (non-zero exit code, exception, validation failure, refusal). The body shows the error text the model saw — it may retry with a different approach or surface the failure to the user.",
  },
  pending: {
    headline: "pending",
    desc: "The model asked for this tool call but its tool_result hasn't arrived yet. Either the tool is still running locally (Bash command, network fetch), or this was the very last action in the captured trace and the CLI hasn't sent the next request.",
  },
  latest: {
    headline: "this turn",
    desc: "This step belongs to the assistant's response of the most recent HTTP round-trip. Earlier rows are reconstructed from prior conversation history; this one came in just now over the wire.",
  },
  id: {
    headline: "call id",
    desc: "Tool-call ID assigned by the model when it requested the tool. ccglass uses it to pair a tool_use row with its matching tool_result — they share the same colored left stripe so you can read across.",
  },
};
