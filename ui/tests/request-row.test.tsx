import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { RequestList } from "../src/components/RequestList";
import {
  endpointLabel,
  requestLabel,
  requestLead,
  rowFacts,
  rowStatus,
} from "../src/lib/requestRow";
import type { ContentBlock, EntrySummary, RequestRecord } from "../src/types";

const entry = (seq: number, extra: Partial<EntrySummary> = {}): EntrySummary => ({
  id: `s/${seq}`,
  session: "s",
  seq,
  ts: 1_700_000_000_000 + (seq - 1) * 57_000,
  model: "nemotron",
  status: 200,
  latencyMs: 1200,
  // A growing conversation: rows with the same count would fold as retries.
  nMessages: seq * 2,
  ...extra,
});
const record = (
  seq: number,
  messages: ContentBlock[],
  extra: Partial<RequestRecord> = {},
): RequestRecord => ({
  id: `s/${seq}`,
  seq,
  model: "nemotron",
  request: { method: "POST", url: "/v1/chat/completions", body: { model: "nemotron" } },
  response: { status: 200 },
  parsed: {
    view: { system: [], tools: [], messages },
    usageStats: { totalInput: 900, output: 102 },
  },
  ...extra,
});
const user = (text: string): ContentBlock => ({ role: "user", type: "text", text });
const assistant = (text: string): ContentBlock => ({ role: "assistant", type: "text", text });
const call = (name: string, callId: string): ContentBlock => ({
  type: "tool_use",
  name,
  callId,
  text: "{}",
});
const output = (callId: string): ContentBlock => ({ type: "tool_result", callId, text: "done" });

const asked = record(1, [
  user("<system-reminder>Be brief.</system-reminder>"),
  user("open the browser"),
]);
const returned = record(2, [
  user("open the browser"),
  assistant(""),
  call("list_canvas_capabilities", "a"),
  call("open_canvas", "b"),
  output("a"),
  output("b"),
]);
const followUp = record(3, [
  user("open the browser"),
  assistant(""),
  call("open_canvas", "b"),
  output("b"),
  assistant("The browser is open."),
  user("<current_datetime>2026-11-23</current_datetime>\n\nwhat time is it?"),
]);

describe("what a request was for", () => {
  it("leads with the prompt that was typed, or the tools whose output goes back", () => {
    expect(requestLead(asked)).toEqual({ kind: "prompt", text: "open the browser" });
    expect(requestLead(returned)).toEqual({
      kind: "tools",
      text: "list_canvas_capabilities, open_canvas",
    });
    // Only what was added after the model's last reply counts, without its envelopes.
    expect(requestLead(followUp)).toEqual({ kind: "prompt", text: "what time is it?" });
    expect(
      requestLead(record(4, [user("<system-reminder>Be brief.</system-reminder>")]))?.kind,
    ).toBe("harness");
    expect(requestLead(record(5, [output("unknown")]))).toEqual({
      kind: "tools",
      text: "tool output",
    });
  });

  it("has nothing to say about a request that carries no conversation", () => {
    const listing: RequestRecord = {
      id: "s/9",
      request: { method: "GET", url: "/v1/models" },
      response: { status: 200 },
    };
    expect(requestLead(listing)).toBeNull();
    expect(endpointLabel(entry(9, { model: null, method: "GET", url: "/v1/models?limit=5" }))).toBe(
      "GET /v1/models",
    );
  });

  it("shows a status only for what is not a plain success", () => {
    expect(rowStatus(entry(1))).toBeNull();
    expect(rowStatus(entry(1, { status: 404 }))).toEqual({ label: "404", tone: "error" });
    expect(rowStatus(entry(1, { status: null, error: "socket hang up" }))).toEqual({
      label: "error",
      tone: "error",
    });
    // The client hanging up is not the API failing.
    expect(rowStatus(entry(1, { status: null, error: "client disconnected" }))).toEqual({
      label: "cancelled",
      tone: "cancelled",
    });
    expect(rowStatus(entry(1, { status: null, pending: true }))).toEqual({
      label: "pending",
      tone: "pending",
    });
    expect(rowStatus(entry(1, { status: null, pending: true, streaming: true }))).toEqual({
      label: "streaming",
      tone: "pending",
    });
  });

  it("names a request in one line for a dropdown, the way its row names it", () => {
    expect(requestLabel(entry(1), asked)).toBe("#1 · open the browser");
    expect(requestLabel(entry(2), returned)).toBe("#2 · → list_canvas_capabilities, open_canvas");
    expect(requestLabel(entry(1), asked, true)).toBe("#1 · open the browser · nemotron");
    // Not loaded yet, or no conversation: the model or the endpoint.
    expect(requestLabel(entry(3), undefined, true)).toBe("#3 · nemotron");
    expect(
      requestLabel(entry(9, { model: null, method: "GET", url: "/v1/models?limit=5" }), undefined),
    ).toBe("#9 · GET /v1/models");
    // A capture outside the session is only known by its id.
    expect(requestLabel({ id: "other/0007" }, undefined)).toBe("other/0007");
  });

  it("gives the offset, the latency and the output tokens, with their units", () => {
    expect(rowFacts(entry(2), returned, entry(1).ts)).toEqual(["+0:57", "1.20s", "102 tok out"]);
    expect(rowFacts(entry(2, { latencyMs: null }), undefined, entry(1).ts)).toEqual(["+0:57"]);
  });
});

describe("request list rows", () => {
  const list = (overrides: Partial<Parameters<typeof RequestList>[0]> = {}) => (
    <RequestList
      entries={[entry(1), entry(2), entry(3, { model: "other" })]}
      records={{ "s/1": asked, "s/2": returned }}
      models={["nemotron", "other"]}
      model="all"
      selected={null}
      picks={[]}
      isLive={false}
      onModel={() => {}}
      onSelect={() => {}}
      {...overrides}
    />
  );

  it("say what each request did, and name the model only when a session has several", () => {
    const { rerender } = render(list());
    const first = screen.getByRole("button", { name: /open the browser.*#1/s });
    expect(first).toHaveTextContent(/^open the browser#1\+0:00 · 1\.20s · 102 tok outnemotron$/);
    const second = screen.getByRole("button", { name: /open_canvas.*#2/s });
    expect(second.title).toMatch(
      /^Sends back the output of list_canvas_capabilities, open_canvas · nemotron · .* · 4 msg$/,
    );
    // No record yet: the row falls back to the model it called.
    expect(screen.getByRole("button", { name: /other.*#3/s })).toHaveTextContent(
      /^other#3\+1:54 · 1\.20s$/,
    );
    rerender(list({ models: ["nemotron"] }));
    expect(screen.getByRole("button", { name: /open the browser.*#1/s })).not.toHaveTextContent(
      "nemotron",
    );
  });

  it("filters on what a row says", () => {
    render(list());
    fireEvent.change(screen.getByLabelText(/^Filter requests by/), {
      target: { value: "open_canvas" },
    });
    expect(screen.getAllByRole("button", { name: /#\d/ })).toHaveLength(1);
    expect(screen.getByLabelText("Requests shown")).toHaveTextContent("1 / 3");
  });

  it("moves between rows with the arrow keys and is a single tab stop", () => {
    const onSelect = vi.fn();
    render(list({ selected: "s/2", onSelect }));
    const rows = screen.getAllByRole("button", { name: /#\d/ });
    // The open request is where Tab lands; the other rows are reached with the arrows.
    expect(rows.map((row) => row.tabIndex)).toEqual([-1, 0, -1]);
    rows[1].focus();
    fireEvent.keyDown(rows[1], { key: "ArrowUp" });
    expect(rows[0]).toHaveFocus();
    fireEvent.keyDown(rows[0], { key: "ArrowUp" });
    expect(rows[0]).toHaveFocus();
    fireEvent.keyDown(rows[0], { key: "j" });
    expect(rows[1]).toHaveFocus();
    fireEvent.keyDown(rows[1], { key: "End" });
    expect(rows[2]).toHaveFocus();
    fireEvent.keyDown(rows[2], { key: "ArrowDown" });
    expect(rows[2]).toHaveFocus();
    fireEvent.keyDown(rows[2], { key: "Home" });
    expect(rows[0]).toHaveFocus();
    // Moving is not opening: that takes Enter, which a button already answers to.
    expect(onSelect).not.toHaveBeenCalled();
    // The list holds requests only: the way back to the replay is the path above it.
    expect(screen.queryByRole("button", { name: /replay/i })).not.toBeInTheDocument();
    fireEvent.keyDown(rows[0], { key: "/" });
    expect(screen.getByLabelText(/^Filter requests by/)).toHaveFocus();
  });

  it("marks the two compared requests A and B instead of the open one", () => {
    const onSelect = vi.fn();
    const { rerender } = render(
      list({ selected: "s/3", picks: ["s/1", "s/2"], comparing: true, onSelect }),
    );
    const first = screen.getByRole("button", { name: /open the browser.*#1/s });
    const second = screen.getByRole("button", { name: /open_canvas.*#2/s });
    expect(first).toHaveTextContent(/^Aopen the browser#1/);
    expect(first.title).toMatch(/^A, the baseline of the comparison · /);
    expect(second).toHaveTextContent(/^B→list_canvas_capabilities/);
    expect([first, second].map((row) => row.getAttribute("aria-pressed"))).toEqual([
      "true",
      "true",
    ]);
    // The open request does not read as selected while comparing.
    expect(screen.getByRole("button", { name: /other.*#3/s })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    fireEvent.click(screen.getByRole("button", { name: /other.*#3/s }));
    expect(onSelect).toHaveBeenCalledWith("s/3");
    rerender(list({ selected: "s/3", picks: [] }));
    expect(screen.getByRole("button", { name: /other.*#3/s })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.queryByText("A", { selector: ".request-pick" })).not.toBeInTheDocument();
  });
});
