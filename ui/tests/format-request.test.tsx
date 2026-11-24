import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import RequestDetail from "../src/components/RequestDetail";
import { RequestList } from "../src/components/RequestList";
import { SessionMetrics } from "../src/components/SessionMetrics";
import {
  fmtApproxTokens,
  fmtClock,
  fmtCompact,
  fmtDateTime,
  fmtElapsed,
  fmtOffset,
  fmtWhen,
  pctOf,
  plural,
  sessionLabel,
  sessionStart,
} from "../src/lib/format";
import {
  isModelRequest,
  openingTab,
  recordCancelled,
  recordFailed,
  requestDetails,
  requestFacts,
  requestTabs,
  requestTitle,
  requestTokens,
  responseSentence,
} from "../src/lib/request";
import { matchesReplayFilter, type ReplayLine } from "../src/lib/replay";
import { sessionFacts } from "../src/lib/session";
import type { EntrySummary, RequestRecord } from "../src/types";

describe("one format for time, counts and sizes", () => {
  const at = new Date(2026, 10, 23, 23, 34, 56).getTime();
  const sameYear = new Date(2026, 10, 24, 9, 0, 0);

  it("writes every time on the 24-hour clock, with a date only when it helps", () => {
    expect(fmtClock(at)).toBe("23:34:56");
    expect(fmtDateTime(at, sameYear)).toBe("Nov 23 · 23:34:56");
    expect(fmtDateTime(at, new Date(2027, 0, 2))).toBe("Nov 23, 2026 · 23:34:56");
    expect(fmtWhen(at, sameYear)).toBe("Nov 23 · 23:34:56");
    expect(fmtWhen(at, new Date(2026, 10, 23, 23, 59))).toBe("23:34:56");
    for (const format of [fmtClock, fmtDateTime, fmtWhen]) {
      expect(format(null)).toBe("—");
      expect(format("not a date")).toBe("—");
    }
  });

  it("reads a session's start from its id, the same way wherever a session is named", () => {
    const id = "2026-11-23T23-34-32-264";
    expect(sessionStart(id)).toBe(new Date(2026, 10, 23, 23, 34, 32).getTime());
    expect(sessionLabel(id, sameYear)).toBe("Nov 23 · 23:34:32");
    expect(sessionStart("saved")).toBeNull();
    expect(sessionLabel("saved")).toBe("saved");
  });

  it("measures time inside a session from its first request", () => {
    expect(fmtOffset(0)).toBe("+0:00");
    expect(fmtOffset(57_400)).toBe("+0:57");
    expect(fmtOffset(725_000)).toBe("+12:05");
    expect(fmtOffset(3_723_000)).toBe("+1:02:03");
    expect(fmtOffset(-5)).toBe("+0:00");
    expect(fmtElapsed(751_900)).toBe("00:12:31");
  });

  it("never drops a unit or the singular", () => {
    expect(plural(1, "call")).toBe("1 call");
    expect(plural(2, "call")).toBe("2 calls");
    expect(plural(1204, "request")).toBe("1,204 requests");
    expect(fmtCompact(912)).toBe("912");
    expect(fmtCompact(47_247)).toBe("47.2k");
    expect(fmtCompact(1_056_742)).toBe("1.06M");
    expect(fmtCompact(999_960)).toBe("1.00M");
    expect(fmtApproxTokens(28)).toBe("~7 tok");
    expect(fmtApproxTokens(50_763)).toBe("~12.7k tok");
  });

  it("does not report a rate where nothing was measured", () => {
    expect(pctOf(0, 0)).toBe("—");
    expect(pctOf(5, null)).toBe("—");
    expect(pctOf(0, 7)).toBe("0%");
    expect(pctOf(200, 310)).toBe("65%");
  });
});

const model: RequestRecord = {
  id: "s/4",
  seq: 4,
  latencyMs: 2250,
  timing: { totalMs: 2250, ttftMs: 1270, genMs: 980 },
  request: {
    method: "POST",
    url: "/v1/chat/completions",
    body: { model: "nemotron", messages: [] },
  },
  response: { status: 200 },
  parsed: {
    view: { system: [], tools: [], messages: [{ role: "user", type: "text", text: "hi" }] },
    response: { model: "nemotron", stop_reason: "tool_calls", streamed: true },
    estTokens: 45_184,
    usageStats: { input: 945, output: 102, cacheRead: 46_302, cacheWrite: 0, totalInput: 47_247 },
  },
};
const cancelled: RequestRecord = {
  ...model,
  id: "s/5",
  latencyMs: 8850,
  timing: { totalMs: 8850, ttftMs: 8850, genMs: 0 },
  response: { error: "client disconnected" },
  parsed: {
    view: model.parsed!.view,
    response: { error: "client disconnected" },
    estTokens: 42_917,
    usageStats: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalInput: 0,
      cacheHitRate: 0,
    },
  },
};
const dropped: RequestRecord = {
  ...cancelled,
  id: "s/6",
  response: { error: "socket hang up" },
  parsed: { ...cancelled.parsed, response: { error: "socket hang up" } },
};
const probe: RequestRecord = {
  id: "s/1",
  seq: 1,
  latencyMs: 361,
  timing: { totalMs: 361, ttftMs: 361, genMs: 0 },
  request: { method: "GET", url: "/orchestrator/v1/chat/completions/models?limit=5" },
  response: { status: 404, raw: "404 page not found\n" },
  parsed: {
    view: { system: [], tools: [], messages: [] },
    response: { streamed: true, raw: "404 page not found\n" },
    estTokens: 0,
    usageStats: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalInput: 0,
      cacheHitRate: 0,
    },
  },
};

describe("what a request says about itself", () => {
  it("sums a request up in one line that holds on every tab", () => {
    expect(requestFacts(model)).toEqual({
      status: { label: "HTTP 200", tone: "ok" },
      facts: [
        "2.25s, first token 1.27s",
        "47,247 tokens in (98% cached)",
        "102 tokens out",
        "stop: tool_calls",
      ],
    });
    expect(requestTokens(model)).toMatchObject({
      totalInput: 47_247,
      cacheRead: 46_302,
      measured: true,
    });
  });

  it("says what happened to a failed request instead of counting tokens that never came", () => {
    expect(requestFacts(dropped)).toEqual({
      status: { label: "Failed", tone: "error" },
      facts: ["socket hang up", "after 8.85s", "≈ 42,917 tokens in (estimate)"],
    });
    expect(responseSentence(dropped)).toBe("Failed after 8.85s · socket hang up");
    expect(requestTokens(dropped)).toMatchObject({ measured: false, cachedShare: "—" });
    expect(responseSentence(model)).toBe("102 tokens in 2.25s · first token after 1.27s");
    expect(requestFacts({ id: "pending", response: null }).status).toEqual({
      label: "Waiting for a response",
      tone: "pending",
    });
  });

  it("tells a request the client cancelled apart from one that failed", () => {
    expect(recordCancelled(cancelled)).toBe(true);
    expect(recordFailed(cancelled)).toBe(false);
    expect(recordFailed(dropped)).toBe(true);
    expect(requestFacts(cancelled)).toEqual({
      status: { label: "Cancelled", tone: "cancelled" },
      facts: ["client disconnected", "after 8.85s", "≈ 42,917 tokens in (estimate)"],
    });
    expect(responseSentence(cancelled)).toBe(
      "Cancelled after 8.85s · the client closed the connection before the response finished",
    );
    // An error status is a failure whatever else was recorded.
    expect(
      recordFailed({ ...cancelled, response: { status: 502, error: "client disconnected" } }),
    ).toBe(true);
    // No first token or generation is reported for a response that never finished.
    expect(requestDetails(cancelled)[0]).toEqual({
      title: "Timing",
      rows: [{ label: "Total latency", value: "8.85s" }],
    });
  });

  it("keeps the full breakdown in three groups, every number with its unit", () => {
    const [timing, tokens, request] = requestDetails(model);
    expect(timing.rows.map((row) => row.label)).toEqual([
      "Total latency",
      "First token",
      "Generation",
      "Input speed",
      "Output speed",
    ]);
    expect(tokens.rows).toEqual([
      { label: "Input (total)", value: "47,247 tokens", note: "including cached" },
      { label: "of which cached", value: "46,302 tokens", note: "98% of the input" },
      { label: "Cache write", value: "0 tokens" },
      { label: "Output", value: "102 tokens" },
    ]);
    expect(request.rows.find((row) => row.label === "Stop reason")?.value).toBe("tool_calls");
    // A request that is not a call to the model has no tokens to break down.
    expect(requestDetails(probe).map((group) => group.title)).toEqual(["Timing", "Request"]);
  });

  it("treats a request without a model as an HTTP exchange, not an empty conversation", () => {
    expect(isModelRequest(model)).toBe(true);
    expect(isModelRequest(probe)).toBe(false);
    // Nothing known about the request itself: no view is taken away.
    expect(isModelRequest({ id: "bare" })).toBe(true);
    expect(requestTitle(probe)).toBe("GET /orchestrator/v1/chat/completions/models");
    expect(requestTitle(model)).toBe("nemotron");
    expect(requestTabs(probe)).toEqual(["response", "http"]);
    expect(requestFacts(probe)).toEqual({
      status: { label: "HTTP 404", tone: "error" },
      facts: ["361ms"],
    });
    expect(responseSentence(probe)).toBe("The server answered with an error after 361ms");
  });

  it("opens on the tab last used, except for a failure or a tab the request does not have", () => {
    expect(openingTab(model, "messages")).toBe("messages");
    expect(openingTab(dropped, "messages")).toBe("response");
    // A cancelled request is not a failure: it opens like any other.
    expect(openingTab(cancelled, "messages")).toBe("messages");
    expect(openingTab(probe, "http")).toBe("response");
    expect(openingTab({ ...probe, response: { status: 200 } }, "http")).toBe("http");
    expect(openingTab({ ...probe, response: { status: 200 } }, "messages")).toBe("response");
  });

  it("shows a non-model request with its method and path and only the tabs that apply", () => {
    render(<RequestDetail record={probe} />);
    expect(
      screen.getByRole("heading", { name: "GET /orchestrator/v1/chat/completions/models" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["response", "HTTP"]);
    expect(screen.getByRole("tab", { name: "response" })).toHaveAttribute("aria-selected", "true");
    expect(
      within(screen.getByLabelText("Request outcome")).getByText("HTTP 404"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/first token/)).not.toBeInTheDocument();
    expect(screen.queryByText("streamed")).not.toBeInTheDocument();
    expect(screen.queryByText(/0 tokens/)).not.toBeInTheDocument();
  });
});

describe("request list and session numbers", () => {
  const entry = (seq: number, extra: Partial<EntrySummary> = {}): EntrySummary => ({
    id: `s/${seq}`,
    session: "s",
    seq,
    ts: 1_700_000_000_000 + (seq - 1) * 57_000,
    model: "nemotron",
    status: 200,
    latencyMs: 1200,
    nToolUse: 1,
    nTools: 57,
    ...extra,
  });

  it("names its filter for what it matches and counts failures in requests", () => {
    render(
      <RequestList
        entries={[
          entry(1),
          entry(2, { status: null, error: "socket hang up" }),
          entry(3, { status: 404 }),
          entry(4, { status: null, error: "client disconnected" }),
        ]}
        models={["nemotron"]}
        model="all"
        selected={null}
        picks={[]}
        isLive={false}
        onModel={() => {}}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByPlaceholderText("Filter by prompt, tool or model")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Failed requests (2)" })).toHaveTextContent(
      "Failed (2)",
    );
    // A healthy request shows no status; what went wrong is the only pill in the list.
    expect(screen.getByRole("button", { name: /nemotron.*#1/s })).toHaveTextContent(
      /^nemotron#1\+0:00 · 1\.20s$/,
    );
    const second = screen.getByRole("button", { name: /nemotron.*#2/s });
    expect(second).toHaveTextContent(/^nemotron#2error\+0:57 · 1\.20s$/);
    expect(screen.getByRole("button", { name: /nemotron.*#3/s })).toHaveTextContent("#3404");
    // Cancelled by the client: named, and not counted among the failures.
    expect(screen.getByRole("button", { name: /nemotron.*#4/s })).toHaveTextContent("#4cancelled");
    // What is the same on every row moved to the tooltip.
    expect(second.title).toMatch(
      /^nemotron · \w{3} \d+(, \d{4})? · \d\d:\d\d:\d\d · 57 tools, 1 call$/,
    );
  });

  it("uses one vocabulary for input and shows no rate for an empty session", () => {
    const stats = {
      session: "s",
      models: [],
      model: "all",
      completed: 21,
      total: 21,
      totalInput: 1_056_742,
      totalOutput: 4_512,
      cacheHitRate: 0.97,
    };
    const entries = [entry(1), entry(2, { latencyMs: 2800 }), entry(3, { latencyMs: null })];
    const { rerender } = render(<SessionMetrics entries={entries} stats={stats} model="all" />);
    const line = () => within(screen.getByLabelText("Session statistics"));
    // One line; the exact numbers and the full vocabulary are behind each fact.
    expect(screen.getByLabelText("Session statistics")).toHaveTextContent(
      /^3 requests1\.06M tokens in \(97% cached\)4\.51k tokens outavg 2\.00s$/,
    );
    expect(line().getByText("3 requests").title).toBe("2 of 3 requests finished");
    expect(line().getByText("1.06M tokens in (97% cached)").title).toBe(
      "Input (total): 1,056,742 tokens, of which cached: 1,025,040",
    );
    expect(line().getByText("4.51k tokens out").title).toBe(
      "Output: 4,512 tokens from 21 requests",
    );
    expect(line().getByText("avg 2.00s").title).toBe("Average latency 2.00s · slowest 2.80s");
    // A model filter narrows every number, so the line names the model.
    expect(sessionFacts(entries, stats, "nemotron")[0].text).toBe("3 requests to nemotron");
    expect(sessionFacts(entries, stats, "other")[0].text).toBe("0 requests to other");
    rerender(
      <SessionMetrics
        entries={[]}
        stats={{ ...stats, completed: 0, total: 0, totalInput: 0, totalOutput: 0, cacheHitRate: 0 }}
        model="all"
      />,
    );
    // Nothing measured is not "0% cached".
    expect(screen.getByLabelText("Session statistics")).toHaveTextContent(/^0 requests$/);
  });

  it("keeps every line of a failed request under one filter and failed tool calls under another", () => {
    const line = (entry: EntrySummary, item: Partial<ReplayLine["item"]>): ReplayLine => ({
      entry,
      prompt: false,
      where: "",
      item: {
        id: "i",
        zone: "new",
        kind: "user",
        name: "User",
        summary: "",
        text: "",
        chars: 0,
        tags: [],
        ...item,
      },
    });
    const failed = entry(2, { status: null, error: "socket hang up" });
    const stopped = entry(3, { status: null, error: "client disconnected" });
    expect(matchesReplayFilter("failed", line(failed, {}), {})).toBe(true);
    expect(matchesReplayFilter("failed", line(stopped, {}), {})).toBe(false);
    expect(matchesReplayFilter("cancelled", line(stopped, {}), {})).toBe(true);
    expect(matchesReplayFilter("cancelled", line(failed, {}), {})).toBe(false);
    expect(
      matchesReplayFilter("failed", line(entry(1), { kind: "tool", status: "error" }), {}),
    ).toBe(false);
    expect(
      matchesReplayFilter("toolError", line(entry(1), { kind: "tool", status: "error" }), {}),
    ).toBe(true);
    expect(matchesReplayFilter("toolError", line(failed, { kind: "failed" }), {})).toBe(false);
    expect(matchesReplayFilter("prompt", line(entry(1), {}), {})).toBe(true);
  });
});
