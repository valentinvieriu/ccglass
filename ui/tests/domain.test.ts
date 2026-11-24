import { describe, expect, it } from "vite-plus/test";
import type { RequestRecord, TimelineStep, EntrySummary } from "../src/types";
import {
  buildTimeline,
  liveFlowSteps,
  flowSteps,
  liveStepKey,
  detectPatterns,
  smartSummary,
  humanText,
} from "../src/lib/timeline";
import { buildFlow, previewHeading, stepItem } from "../src/lib/flow";
import { buildReplay } from "../src/lib/replay";
import { buildCurl, shellQuote } from "../src/lib/curl";
import {
  comparePick,
  isCancelled,
  isFailed,
  mergeEntries,
  previousRequest,
  visibleEntries,
} from "../src/lib/entries";

function record(id: string, content: any[] = []): RequestRecord {
  return {
    id: "session/" + id,
    seq: Number(id),
    model: "gpt-5-codex",
    request: {
      url: "/v1/responses",
      headers: { "user-agent": "codex_cli_rs/0.20.0" },
      body: { model: "gpt-5-codex" },
    },
    response: { status: 200 },
    parsed: {
      view: {
        system: [{ label: "instructions", text: "private system" }],
        tools: [{ name: "shell" }],
        messages: [{ role: "user", type: "message", text: "private prompt" }],
      },
      response: { model: "gpt-5-codex", content },
    },
  };
}
describe("timeline normalization", () => {
  it("merges next-request Codex tool results while hiding prompt context", () => {
    const first = record("1", [
      { type: "tool_use", name: "shell", id: "call_1", input: { command: "ls" } },
    ]);
    const next = record("2", [{ type: "text", text: "done" }]);
    next.parsed!.view!.messages.push({
      type: "tool_result",
      callId: "call_1",
      text: "file-a file-b",
    });
    const rows = buildTimeline([next, first]);
    expect(rows.find((row) => row.callId === "call_1")?.result).toMatchObject({
      text: "file-a file-b",
      entryId: "session/2",
      seq: 2,
    });
    expect(rows.filter((row) => row.callId === "call_1")).toHaveLength(1);
    expect(rows.some((row) => row.text.includes("private"))).toBe(false);
    expect(rows.some((row) => row.text === "done")).toBe(true);
  });
  it("identifies Codex by client signature even with a generic model", () => {
    const item = record("1", [{ type: "text", text: "answer" }]);
    item.model = "gpt-5";
    item.request!.body.model = "gpt-5";
    item.parsed!.response!.model = "gpt-5";
    expect(liveFlowSteps(item).map((step) => step.kind)).toEqual(["assistant"]);
    item.request!.headers!["user-agent"] = "openai-python/1.30.0";
    expect(liveFlowSteps(item).map((step) => step.kind)).toEqual([
      "system",
      "tools",
      "user",
      "assistant",
    ]);
  });
  it("keeps two identical failed turns visible and captures transport errors", () => {
    const failed = (id: string) => {
      const item = record(id);
      item.response = { status: 401 };
      item.parsed!.response = { error: { message: "invalid api key" } };
      return item;
    };
    expect(buildTimeline([failed("1"), failed("2")])).toHaveLength(2);
    const interrupted = record("3");
    interrupted.response = { error: "client disconnected" };
    interrupted.parsed!.response = null;
    expect(flowSteps(interrupted).at(-1)?.text).toContain("client disconnected");
    // The client hanging up closes the turn as cancelled, not as an error.
    expect(flowSteps(interrupted).at(-1)).toMatchObject({
      kind: "stop",
      cancelled: true,
      latest: true,
    });
    const flow = buildFlow(interrupted);
    expect(flow.items.at(-1)).toMatchObject({
      zone: "response",
      kind: "cancelled",
      name: "Cancelled",
      summary: "The client closed the connection before the response finished",
    });
    // The zeros reported for a response that never finished are not a measurement.
    interrupted.parsed = {
      ...interrupted.parsed,
      estTokens: 900,
      usageStats: { totalInput: 0, output: 0, cacheRead: 0 },
    };
    expect(buildFlow(interrupted)).toMatchObject({
      inputTokens: 900,
      estimated: true,
      outputTokens: null,
      cacheRead: null,
    });
    interrupted.response = { error: "socket hang up" };
    expect(flowSteps(interrupted).at(-1)).toMatchObject({
      kind: "stop",
      text: "error: socket hang up",
    });
    expect(flowSteps(interrupted).at(-1)?.cancelled).toBeUndefined();
    expect(buildFlow(interrupted).items.at(-1)?.kind).toBe("failed");
  });
  it("replaces pending tool rows with updated full records without duplicating them", () => {
    const item = record("1", [
      { type: "tool_use", name: "shell", id: "call_1", input: { command: "pwd" } },
    ]);
    const next = record("2");
    next.parsed!.view!.messages = [{ type: "tool_result", callId: "call_1", text: "/workspace" }];
    expect(buildTimeline([item])[0].result).toBeUndefined();
    const complete = buildTimeline([item, next]);
    expect(complete).toHaveLength(1);
    expect(complete[0].result?.text).toBe("/workspace");
  });
  it("retains the first request that carried an output when later requests resend the same history", () => {
    const first = record("1", [
      { type: "tool_use", name: "shell", id: "call_1", input: { command: "pwd" } },
    ]);
    const second = record("2");
    const third = record("3");
    second.parsed!.view!.messages = [{ type: "tool_result", callId: "call_1", text: "/workspace" }];
    third.parsed!.view!.messages = [...second.parsed!.view!.messages];
    expect(buildTimeline([first, second, third])[0].result).toMatchObject({
      text: "/workspace",
      entryId: "session/2",
      seq: 2,
    });
    third.parsed!.view!.messages = [
      { type: "tool_result", callId: "call_1", text: "Updated output" },
    ];
    expect(buildTimeline([first, second, third])[0].result).toMatchObject({
      text: "Updated output",
      entryId: "session/3",
      seq: 3,
    });
  });
  it("deduplicates repeated context but keeps blocks changed beyond their prefix", () => {
    const a: TimelineStep = { kind: "user", text: "x".repeat(250) };
    const b = { ...a, text: a.text + "tail" };
    expect(liveStepKey(a)).not.toBe(liveStepKey(b));
    expect(
      detectPatterns({ kind: "user", text: "<system-reminder>Use tools</system-reminder>" }),
    ).toContain("reminder");
  });
  it("previews arbitrary tool arguments with meaningful field names and handles non-object inputs", () => {
    expect(smartSummary({ kind: "tool_use", name: "read_item", text: '{"id":"evidence-2"}' })).toBe(
      "id: evidence-2",
    );
    expect(
      smartSummary({
        kind: "tool_use",
        name: "raise_point",
        text: '{"section":"evidence.saw","text":"Check the wait time","strict":true}',
      }),
    ).toBe("section: evidence.saw · text: Check the wait time · strict: true");
    for (const text of ["null", "[]", '"raw input"', "not json"])
      expect(smartSummary({ kind: "tool_use", name: "custom", text })).toBe(text);
  });
  it("marks all response events as new, including terminal failures, and preserves provider-specific blocks", () => {
    const captured = record("1", [{ type: "provider-extension", payload: "opaque value" }]);
    captured.parsed!.response!.stop_reason = "completed";
    const steps = flowSteps(captured);
    expect(steps.filter((step) => step.latest).map((step) => step.kind)).toEqual([
      "assistant",
      "stop",
    ]);
    expect(steps.find((step) => step.label === "provider-extension")?.text).toContain(
      '"payload": "opaque value"',
    );
    captured.parsed!.response!.content = [{ type: "text" }];
    expect(flowSteps(captured).find((step) => step.kind === "assistant")?.text).toBe("");
    captured.parsed!.response = null;
    captured.response = null;
    captured.error = "transport failure";
    expect(flowSteps(captured).at(-1)).toMatchObject({
      kind: "stop",
      latest: true,
      text: "error: transport failure",
    });
  });
});
describe("flow and replay models", () => {
  const chat = (id: string, messages: any[], content: any[]): RequestRecord => ({
    id: "session/" + id,
    seq: Number(id),
    model: "local",
    request: { method: "POST", url: "/v1/chat/completions", body: { model: "local" } },
    response: { status: 200 },
    latencyMs: 1000,
    parsed: {
      view: {
        system: [{ text: "Be brief." }],
        tools: [{ name: "Bash", description: "Run a command" }],
        messages,
      },
      response: { model: "local", content },
      usageStats: { totalInput: 400, output: 20, cacheRead: 100 },
    },
  });
  const prompt = {
    role: "user",
    type: "message",
    text: "<current_datetime>now</current_datetime>\n\nRun the tests\n\n<canvas-context>none</canvas-context>\n\nThis reference identifies the message.",
  };
  const reminder = {
    role: "user",
    type: "message",
    text: "<system_reminder>\nStay in the sandbox.\n</system_reminder>",
  };
  const call = {
    role: "assistant",
    type: "tool_use",
    name: "Bash",
    callId: "client-1",
    text: '{"command":"npm test"}',
  };
  const result = {
    role: "tool",
    type: "tool_result",
    callId: "client-1",
    text: "1 failed",
    isError: true,
  };

  it("finds what the person typed inside harness envelopes and leaves ordinary markup alone", () => {
    expect(humanText(prompt.text)).toBe("Run the tests");
    expect(humanText(reminder.text)).toBe("");
    expect(humanText("Why does <div>x</div> overflow?")).toBe("Why does <div>x</div> overflow?");
    expect(smartSummary({ kind: "user", text: reminder.text })).toBe("Stay in the sandbox.");
    expect(detectPatterns({ kind: "user", text: reminder.text })).toContain("reminder");
  });

  it("splits a request into what is re-sent, what is new since the last reply, and the response", () => {
    const flow = buildFlow(
      chat("2", [reminder, prompt, call, result], [{ type: "text", text: "One test fails." }]),
    );
    const zones = (zone: string) =>
      flow.items.filter((item) => item.zone === zone).map((item) => item.name);
    expect(zones("prefix")).toEqual(["System prompt", "Tool definitions"]);
    expect(zones("carried")).toEqual(["Harness", "User"]);
    expect(zones("new")).toEqual(["Bash"]);
    expect(zones("response")).toEqual(["Assistant"]);
    const bash = flow.items.find((item) => item.name === "Bash")!;
    expect(bash).toMatchObject({
      status: "error",
      output: "1 failed",
      callNumber: 1,
      description: "Run a command",
    });
    expect(flow.items.find((item) => item.name === "User")).toMatchObject({
      human: "Run the tests",
      injected: false,
    });
    expect(flow.sections.map((section) => section.id)).toEqual([
      "system",
      "tools",
      "carried",
      "new",
    ]);
    expect(flow.sections.reduce((total, section) => total + section.share, 0)).toBeCloseTo(1);
    expect(flow.sections.reduce((total, section) => total + section.tokens!, 0)).toBeGreaterThan(
      395,
    );
    expect(flow).toMatchObject({
      inputTokens: 400,
      estimated: false,
      cacheRead: 100,
      outputTokens: 20,
    });
    const first = buildFlow(chat("1", [prompt], []));
    expect(first.items.filter((item) => item.zone === "carried")).toHaveLength(0);
    expect(first.items.filter((item) => item.zone === "new")).toHaveLength(1);
  });

  it("leaves out an empty text block that only accompanies a tool call", () => {
    const blank = { role: "assistant", type: "text", text: " " };
    const flow = buildFlow(
      chat(
        "2",
        [prompt, blank, call, result],
        [
          { type: "text", text: "\n" },
          { type: "tool_use", id: "next", name: "Bash", input: { command: "ls" } },
        ],
      ),
    );
    expect(flow.items.filter((item) => item.kind === "assistant")).toHaveLength(0);
    expect(flow.items.filter((item) => item.kind === "tool").map((item) => item.id)).toEqual([
      "m-2",
      "r-1",
    ]);
    // Ids still follow the position in the request, so Messages can be linked to.
    const records = {
      "session/2": chat(
        "2",
        [prompt],
        [
          { type: "text", text: " " },
          { type: "tool_use", id: "c", name: "Bash", input: {} },
        ],
      ),
    };
    const entries = [
      {
        id: "session/2",
        session: "session",
        seq: 2,
        ts: 2,
        model: "local",
        status: 200,
        nMessages: 1,
      },
    ] as EntrySummary[];
    const replay = buildReplay(entries, records, buildTimeline(Object.values(records)), false);
    expect(replay.lines.map((line) => line.item.kind)).toEqual(["system", "tools", "user", "tool"]);
    // A reply with nothing in it at all is still worth a row.
    const empty = buildFlow(chat("3", [prompt], [{ type: "text", text: "" }]));
    expect(empty.items.at(-1)).toMatchObject({ kind: "assistant", summary: "Empty message" });
  });

  it("names a developer message by its role and never takes it for a prompt", () => {
    const developer = {
      label: "input[0].developer",
      role: "developer",
      type: "message",
      text: "Follow the style guide.",
    };
    const record = chat("2", [developer, prompt], [{ type: "text", text: "Done." }]);
    const entries = [
      { id: record.id, session: "session", seq: 2, ts: 2, model: "local", nMessages: 2 },
    ] as EntrySummary[];
    const replay = buildReplay(entries, { [record.id]: record }, buildTimeline([record]), false);
    const line = replay.lines.find((line) => line.item.text === developer.text)!;
    expect(line.item).toMatchObject({ kind: "user", name: "Developer", role: "developer" });
    expect(line.prompt).toBe(false);
    expect(replay.lines.filter((line) => line.prompt).map((line) => line.item.name)).toEqual([
      "User",
    ]);
    expect(previewHeading(line.item)).toEqual({
      eyebrow: "Sent in the developer role",
      title: "Developer message",
    });
    // Chat Completions sends it among the system blocks.
    const chatRecord = chat("3", [prompt], []);
    chatRecord.parsed!.view!.system = [
      { label: "system[0].system", text: "Be brief." },
      { label: "system[1].developer", text: "Follow the style guide." },
    ];
    expect(
      buildFlow(chatRecord)
        .items.slice(0, 2)
        .map((item) => item.name),
    ).toEqual(["System prompt 1", "Developer message 2"]);
  });

  it("titles the preview without saying the same thing twice", () => {
    const heading = (step: TimelineStep) => previewHeading(stepItem(step, "x", "new"));
    expect(heading({ kind: "user", text: "Run the tests" })).toEqual({
      eyebrow: "",
      title: "User prompt",
    });
    expect(heading({ kind: "user", text: reminder.text })).toEqual({
      eyebrow: "Sent in the user role · system-reminder",
      title: "Harness message",
    });
    expect(heading({ kind: "assistant", text: "Done." })).toEqual({
      eyebrow: "",
      title: "Assistant message",
    });
    expect(heading({ kind: "assistant", label: "refusal", text: "{}" }).title).toBe(
      "Assistant message · refusal",
    );
    expect(heading({ kind: "tool_use", name: "Bash", text: '{"command":"ls"}' })).toEqual({
      eyebrow: "Tool call",
      title: "Bash",
    });
    const flow = buildFlow(chat("1", [prompt], []));
    expect(previewHeading(flow.items.find((item) => item.kind === "tools")!)).toEqual({
      eyebrow: "1 tool offered to the model",
      title: "Tool definitions",
    });
    expect(previewHeading(flow.items.find((item) => item.kind === "system")!)).toEqual({
      eyebrow: "",
      title: "System prompt",
    });
  });

  it("recognises a tool call that was streamed without an id once the client names it", () => {
    const first = chat(
      "1",
      [prompt],
      [{ type: "tool_use", name: "Bash", input: { command: "npm test" } }],
    );
    const second = chat("2", [prompt, call, result], [{ type: "text", text: "One test fails." }]);
    expect(buildTimeline([first]).filter((row) => row.kind === "tool_use")).toHaveLength(1);
    const rows = buildTimeline([first, second]);
    const calls = rows.filter((row) => row.kind === "tool_use");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ seq: 1, latest: true, callId: "client-1" });
    expect(calls[0].result).toMatchObject({ text: "1 failed", isError: true, seq: 2 });
    expect(rows.some((row) => row.kind === "tool_result")).toBe(false);
    const other = chat("2", [prompt, { ...call, text: '{"command":"ls"}' }], []);
    expect(buildTimeline([first, other]).filter((row) => row.kind === "tool_use")).toHaveLength(2);
  });

  it("groups the replay by prompt and folds runs of setup requests", () => {
    const probe = (seq: number, status: number): EntrySummary =>
      ({
        id: "session/" + seq,
        session: "session",
        seq,
        ts: seq,
        method: "GET",
        url: "/v1/models",
        status,
      }) as EntrySummary;
    const entry = (seq: number): EntrySummary =>
      ({
        id: "session/" + seq,
        session: "session",
        seq,
        ts: seq,
        model: "local",
        status: 200,
        nMessages: 1,
        latencyMs: 1000,
      }) as EntrySummary;
    const first = chat(
      "3",
      [prompt],
      [{ type: "tool_use", name: "Bash", input: { command: "npm test" } }],
    );
    first.parsed!.response!.stop_reason = "tool_calls";
    const second = chat("4", [prompt, call, result], [{ type: "text", text: "One test fails." }]);
    second.parsed!.response!.stop_reason = "length";
    const records = { [first.id]: first, [second.id]: second };
    const entries = [probe(1, 404), probe(2, 200), entry(3), entry(4), probe(5, 200)];
    const replay = buildReplay(entries, records, buildTimeline([first, second]), false);
    expect(replay.lines.map((line) => line.item.kind)).toEqual([
      "request",
      "request",
      "system",
      "tools",
      "user",
      "tool",
      "assistant",
      "stop",
      "request",
    ]);
    expect([...replay.folds.values()]).toMatchObject([
      { label: "2 setup requests", sub: "GET /v1/models · 1 failed" },
    ]);
    expect(replay.lines.filter((line) => line.fold).map((line) => line.entry.seq)).toEqual([1, 2]);
    expect(replay.lines.at(-1)!.fold).toBeUndefined();
    const asked = replay.lines.find((line) => line.prompt)!;
    expect(asked.meta).toBe("2 requests · 1 tool · 2.00s");
    expect([...replay.promptEntries]).toEqual(["session/3"]);
    expect(replay.lines.find((line) => line.item.kind === "tool")!.where).toBe(
      "Asked for in response #3. Output sent back in request #4.",
    );
    expect(replay.lines.find((line) => line.item.kind === "stop")!.item.summary).toBe("length");
    const waiting = buildReplay([entry(9)], {}, [], true);
    expect(waiting.lines[0].item.summary).toBe("Loading request…");
  });
});
describe("request state and export", () => {
  it("merges SSE updates over stale snapshots and preserves new captures", () => {
    const pending = { id: "s/1", session: "s", seq: 1, ts: 1, pending: true } as EntrySummary;
    const complete = { ...pending, pending: false, status: 200 };
    const second = { ...pending, id: "s/2", seq: 2 };
    expect(mergeEntries([pending], [complete, second])).toEqual([complete, second]);
    expect(
      visibleEntries(
        [
          { ...complete, model: "a" },
          { ...second, model: "b", error: "failed" },
        ],
        "b",
        true,
      ),
    ).toHaveLength(1);
  });
  it("quotes cURL bodies safely, reconstructs URLs, and omits hop headers", () => {
    const curl = buildCurl({
      id: "s/1",
      request: {
        method: "POST",
        url: "/v1/messages",
        headers: { host: "localhost:6656", authorization: "[REDACTED]", "content-length": "23" },
        body: { message: "it's fine" },
      },
    });
    expect(curl).toContain("'http://localhost:6656/v1/messages'");
    expect(curl).toContain("authorization: [REDACTED]");
    expect(curl).not.toContain("content-length");
    expect(shellQuote("it's fine")).toBe("'it'" + String.fromCharCode(92) + "''s fine'");
    expect(curl).toContain(" " + String.fromCharCode(92, 10) + "  ");
  });
});

describe("request outcomes and comparison picks", () => {
  const entry = (seq: number, extra: Partial<EntrySummary> = {}): EntrySummary => ({
    id: `s/${seq}`,
    session: "s",
    seq,
    ts: seq,
    model: "main",
    status: 200,
    nMessages: seq,
    ...extra,
  });

  it("counts a client that hung up as cancelled, and everything else without a response as failed", () => {
    const cancelled = entry(1, { status: null, error: "client disconnected" });
    const dropped = entry(2, { status: null, error: "socket hang up" });
    expect([isCancelled(cancelled), isFailed(cancelled)]).toEqual([true, false]);
    expect([isCancelled(dropped), isFailed(dropped)]).toEqual([false, true]);
    expect([isCancelled(entry(3)), isFailed(entry(3))]).toEqual([false, false]);
    expect(isFailed(entry(4, { status: 500, error: "client disconnected" }))).toBe(true);
    expect(visibleEntries([cancelled, dropped, entry(3)], "all", true)).toEqual([dropped]);
  });

  it("compares a request with the one before it to the same model", () => {
    const entries = [
      entry(1),
      entry(2, { model: "titles" }),
      entry(3, { model: null, nMessages: 0 }),
      entry(4),
    ];
    expect(previousRequest(entries, "s/4")?.id).toBe("s/1");
    expect(previousRequest(entries, "s/1")).toBeUndefined();
    expect(previousRequest(entries, "s/2")).toBeUndefined();
    expect(previousRequest(entries, "unknown")).toBeUndefined();
  });

  it("makes a clicked request B and leaves the baseline alone", () => {
    const entries = [entry(1), entry(2), entry(3), entry(4)];
    expect(comparePick(entries, ["s/1", "s/2"], "s/4")).toEqual(["s/1", "s/4"]);
    // Clicking the baseline swaps the two; clicking B changes nothing.
    expect(comparePick(entries, ["s/1", "s/4"], "s/1")).toEqual(["s/4", "s/1"]);
    expect(comparePick(entries, ["s/1", "s/4"], "s/4")).toEqual(["s/1", "s/4"]);
    // With no baseline yet, it is the request before the clicked one.
    expect(comparePick(entries, [], "s/3")).toEqual(["s/2", "s/3"]);
    expect(comparePick(entries, [], "s/1")).toEqual(["", "s/1"]);
  });
});
