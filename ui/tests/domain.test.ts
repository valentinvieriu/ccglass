import { describe, expect, it } from "vitest";
import type { RequestRecord, TimelineStep, EntrySummary } from "../src/types";
import {
  buildTimeline,
  liveFlowSteps,
  flowSteps,
  liveStepKey,
  detectPatterns,
  smartSummary,
} from "../src/lib/timeline";
import { buildCurl, shellQuote } from "../src/lib/curl";
import { mergeEntries, visibleEntries } from "../src/lib/entries";

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
    expect(rows.find((row) => row.callId === "call_1")?.result?.text).toBe("file-a file-b");
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
  it("deduplicates repeated context but keeps blocks changed beyond their prefix", () => {
    const a: TimelineStep = { kind: "user", text: "x".repeat(250) };
    const b = { ...a, text: a.text + "tail" };
    expect(liveStepKey(a)).not.toBe(liveStepKey(b));
    expect(
      detectPatterns({ kind: "user", text: "<system-reminder>Use tools</system-reminder>" }),
    ).toContain("reminder");
  });
  it("previews arbitrary tool arguments with meaningful field names and handles non-object inputs", () => {
    expect(smartSummary({ kind: "tool_use", name: "read_item", text: '{"id":"evidence-2"}' })).toBe("id: evidence-2");
    expect(smartSummary({ kind: "tool_use", name: "raise_point", text: '{"section":"evidence.saw","text":"Check the wait time","strict":true}' })).toBe("section: evidence.saw · text: Check the wait time · strict: true");
    for (const text of ["null", "[]", '"raw input"', "not json"])
      expect(smartSummary({ kind: "tool_use", name: "custom", text })).toBe(text);
  });
  it("marks all response events as new, including terminal failures, and preserves provider-specific blocks", () => {
    const captured = record("1", [{ type: "provider-extension", payload: "opaque value" }]);
    captured.parsed!.response!.stop_reason = "completed";
    const steps = flowSteps(captured);
    expect(steps.filter((step) => step.latest).map((step) => step.kind)).toEqual(["assistant", "stop"]);
    expect(steps.find((step) => step.label === "provider-extension")?.text).toContain('"payload": "opaque value"');
    captured.parsed!.response!.content = [{ type: "text" }];
    expect(flowSteps(captured).find((step) => step.kind === "assistant")?.text).toBe("");
    captured.parsed!.response = null;
    captured.response = null;
    captured.error = "transport failure";
    expect(flowSteps(captured).at(-1)).toMatchObject({ kind: "stop", latest: true, text: "error: transport failure" });
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
