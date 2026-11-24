import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import TimelineView, { type TimelineViewProps } from "../src/components/TimelineView";
import type { EntrySummary, RequestRecord } from "../src/types";

function entry(seq: number, model = "claude"): EntrySummary {
  return {
    id: `session/${seq}`,
    session: "session",
    seq,
    ts: 1_700_000_000_000 + seq,
    model,
    status: 200,
  };
}
function record(seq: number, model = "claude"): RequestRecord {
  return {
    id: `session/${seq}`,
    seq,
    ts: 1_700_000_000_000 + seq,
    model,
    request: { body: { model } },
    response: { status: 200 },
    parsed: {
      view: { system: [], tools: [], messages: [] },
      response: { model, content: [{ type: "text", text: `Reply ${seq}` }] },
    },
  };
}
function props(overrides: Partial<TimelineViewProps> = {}): TimelineViewProps {
  return {
    entries: [],
    records: {},
    modelFilter: "all",
    onOpen: vi.fn(),
    loading: false,
    isLive: true,
    recordLimit: 500,
    ...overrides,
  };
}

const row = (name: RegExp) => screen.getByRole("button", { name });
const preview = () => screen.getByRole("complementary", { name: "Preview" });

describe("conversation timeline", () => {
  it("pairs a later Codex tool result on the row that asked for it, without duplicating context", () => {
    const first = record(1, "gpt-codex");
    first.parsed!.view!.system = [{ text: "Hidden Codex prompt" }];
    first.parsed!.response!.content = [
      { type: "tool_use", id: "call-shell", name: "Bash", input: { command: "printf hello" } },
    ];
    const initial = props({ entries: [entry(1, "gpt-codex")], records: { [first.id]: first } });
    const { container, rerender } = render(<TimelineView {...initial} />);
    expect(screen.queryByText("Hidden Codex prompt")).not.toBeInTheDocument();
    expect(row(/^Bash · printf hello · awaiting output/)).toHaveAttribute("aria-pressed", "true");
    expect(
      within(preview()).getByText("Asked for in response #1. No output captured yet."),
    ).toBeInTheDocument();
    const toolRow = container.querySelector('[data-kind="tool"]');
    const second = record(2, "gpt-codex");
    second.parsed!.view!.messages = [
      {
        type: "tool_result",
        callId: "call-shell",
        text: "<img src=x onerror=alert(1)>",
        isError: true,
      },
    ];
    rerender(
      <TimelineView
        {...initial}
        entries={[entry(1, "gpt-codex"), entry(2, "gpt-codex")]}
        records={{ [first.id]: first, [second.id]: second }}
      />,
    );
    expect(container.querySelector('[data-kind="tool"]')).toBe(toolRow);
    expect(container.querySelectorAll('[data-kind="tool"]')).toHaveLength(1);
    expect(container.querySelector('[data-kind="output"]')).toBeNull();
    expect(toolRow).toHaveAccessibleName("Bash · printf hello · error · ~7 tok");
    expect(toolRow).toHaveClass("flow-row-error");
    fireEvent.click(toolRow!);
    expect(
      within(preview()).getByText("Asked for in response #1. Output sent back in request #2."),
    ).toBeInTheDocument();
    expect(within(preview()).getByText("<img src=x onerror=alert(1)>")).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
    expect(within(preview()).getByLabelText("Formatted JSON")).toHaveTextContent(
      '"command": "printf hello"',
    );
  });

  it("says where each item first appeared, independently of message role and the newest turn", () => {
    const first = record(1);
    first.parsed!.view!.messages = [
      { role: "assistant", type: "text", text: "Earlier assistant context" },
      { role: "user", type: "text", text: "Current user prompt" },
    ];
    const second = record(2);
    second.parsed!.view!.messages = [...first.parsed!.view!.messages];
    const { container } = render(
      <TimelineView
        {...props({
          entries: [entry(1), entry(2)],
          records: { [first.id]: first, [second.id]: second },
          isLive: false,
        })}
      />,
    );
    expect(screen.getByRole("button", { name: "Prompts 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Everything 4" })).toBeInTheDocument();
    // Every request is loaded, so there is no progress to report.
    expect(screen.queryByText(/requests loaded/)).not.toBeInTheDocument();
    expect(container.querySelectorAll(".flow-row")).toHaveLength(4);
    expect(row(/^User · Current user prompt · 2 requests/)).toHaveAttribute("aria-pressed", "true");
    expect(within(preview()).getByText("First sent in request #1.")).toBeInTheDocument();
    fireEvent.click(row(/^Assistant · Earlier assistant context/));
    expect(within(preview()).getByText("First seen as history in request #1.")).toBeInTheDocument();
    fireEvent.click(row(/^Assistant · Reply 1/));
    expect(within(preview()).getByText("Returned in response #1.")).toBeInTheDocument();
    fireEvent.click(row(/^Assistant · Reply 2/));
    expect(within(preview()).getByText("Returned in response #2.")).toBeInTheDocument();
    expect(container.querySelectorAll(".replay-open")).toHaveLength(2);
    // The strip has no key of its own: each mark says what it is on hover.
    expect(screen.getByRole("button", { name: "Go to request 1" }).title).toMatch(
      /^Request #1 · .* · a prompt starts here$/,
    );
    expect(screen.getByRole("button", { name: "Go to request 2" }).title).not.toMatch(/prompt/);
  });

  it("keeps unmatched tool outputs as their own row and shows a paired output on its call", () => {
    const first = record(1, "gpt-codex");
    first.parsed!.response!.content = [
      { type: "tool_use", id: "paired", name: "Bash", input: { command: "pwd" } },
    ];
    const second = record(2, "gpt-codex");
    second.parsed!.view!.messages = [
      { type: "tool_result", callId: "paired", text: "Working directory: /project" },
      { type: "tool_result", callId: "unknown", text: "Unmatched output" },
    ];
    const { container } = render(
      <TimelineView
        {...props({
          entries: [entry(1, "gpt-codex"), entry(2, "gpt-codex")],
          records: { [first.id]: first, [second.id]: second },
        })}
      />,
    );
    const orphan = container.querySelector('[data-kind="output"]')!;
    expect(orphan).toHaveAccessibleName("Tool output · Unmatched output · ~4 tok");
    expect(orphan.closest(".replay-line")).toHaveAttribute("data-entry", "session/2");
    expect(screen.queryByText("Working directory: /project")).not.toBeInTheDocument();
    fireEvent.click(row(/^Bash · pwd · ok · ~7 tok/));
    expect(within(preview()).getByText("Working directory: /project")).toBeInTheDocument();
  });

  it("mounts only the selected payload and keeps the selection through unrelated updates", () => {
    const captured = record(1);
    const payload = "Large thinking payload ".repeat(1000);
    captured.parsed!.response!.content = [
      { type: "thinking", thinking: payload },
      { type: "text", text: "Short answer" },
    ];
    const initial = props({ entries: [entry(1)], records: { [captured.id]: captured } });
    const { container, rerender } = render(<TimelineView {...initial} />);
    expect(container.querySelectorAll("pre")).toHaveLength(1);
    expect(container.querySelector("pre")?.textContent).toBe("Short answer");
    const thinking = row(/^Thinking/);
    fireEvent.click(thinking);
    expect(container.querySelectorAll("pre")).toHaveLength(1);
    expect(container.querySelector("pre")?.textContent).toBe(payload);
    rerender(<TimelineView {...initial} records={{ ...initial.records }} loading />);
    expect(row(/^Thinking/)).toBe(thinking);
    expect(thinking).toHaveAttribute("aria-pressed", "true");
    expect(container.querySelector("pre")?.textContent).toBe(payload);
    fireEvent.keyDown(thinking, { key: "ArrowDown" });
    expect(row(/^Assistant · Short answer/)).toHaveFocus();
    expect(container.querySelector("pre")?.textContent).toBe("Short answer");
  });

  it("uses only the provided replay page, filters models, and opens the request of a turn", () => {
    const records = [record(1), record(2, "other"), record(3)];
    records[2].parsed!.cost = { usd: 0.0123 };
    const initial = props({
      entries: [entry(3), entry(2, "other")],
      records: Object.fromEntries(records.map((value) => [value.id, value])),
      modelFilter: "claude",
      recordLimit: 2,
      isLive: false,
    });
    render(<TimelineView {...initial} />);
    expect(screen.getByRole("region", { name: "Replay" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open request 1" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open request 2" })).not.toBeInTheDocument();
    expect(screen.getByText(/Session exports include every request/)).toBeInTheDocument();
    expect(
      within(preview()).getByText(/Request #3 · claude · .* · HTTP 200 · \$0\.0123/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open request 3" }));
    fireEvent.click(screen.getByRole("button", { name: /Open request #3/ }));
    expect(initial.onOpen).toHaveBeenCalledTimes(2);
    expect(initial.onOpen).toHaveBeenLastCalledWith("session/3");
    // One model in the session: there is nothing to choose between.
    expect(screen.queryByRole("combobox", { name: "Show requests to one model" })).toBeNull();
  });

  it("opens a request from the whole gutter cell, with Enter and with a double click", () => {
    const first = record(1);
    first.latencyMs = 2250;
    const second = record(2);
    const view = props({
      entries: [entry(1), entry(2)],
      records: { [first.id]: first, [second.id]: second },
      isLive: false,
      facts: <p aria-label="Session statistics">2 requests</p>,
    });
    render(<TimelineView {...view} />);
    // The session's totals sit beside the title instead of in a band above it.
    expect(
      within(screen.getByRole("heading", { name: "Replay" }).parentElement!).getByLabelText(
        "Session statistics",
      ),
    ).toHaveTextContent("2 requests");
    // The number and the latency are one target, as wide as the gutter.
    expect(screen.getByRole("button", { name: "Open request 1" })).toHaveTextContent("#12.25s");
    const reply = row(/^Assistant · Reply 2/);
    fireEvent.keyDown(reply, { key: "Enter" });
    expect(view.onOpen).toHaveBeenLastCalledWith("session/2");
    fireEvent.doubleClick(row(/^Assistant · Reply 1/));
    expect(view.onOpen).toHaveBeenLastCalledWith("session/1");
    expect(view.onOpen).toHaveBeenCalledTimes(2);
    // Enter on the filter chips is not a request to open anything.
    fireEvent.keyDown(screen.getByRole("button", { name: "Everything 2" }), { key: "Enter" });
    expect(view.onOpen).toHaveBeenCalledTimes(2);
  });

  it("says how many requests are loaded only while some are missing", () => {
    render(
      <TimelineView
        {...props({
          entries: [entry(1), entry(2)],
          records: { "session/1": record(1) },
          loading: true,
        })}
      />,
    );
    expect(screen.getByText("1 / 2 requests loaded")).toBeInTheDocument();
  });

  it("does not truncate entries supplied by the parent based on the informational record limit", () => {
    const records = [record(1), record(2), record(3)];
    render(
      <TimelineView
        {...props({
          entries: [entry(1), entry(2), entry(3)],
          records: Object.fromEntries(records.map((value) => [value.id, value])),
          recordLimit: 2,
        })}
      />,
    );
    expect(screen.getByRole("button", { name: "Open request 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open request 3" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Go to request/ })).toHaveLength(3);
  });

  it("follows appended content only while pinned, not on selection or unrelated parent updates", () => {
    const first = record(1);
    const initial = props({ entries: [entry(1)], records: { [first.id]: first } });
    const { rerender } = render(<TimelineView {...initial} />);
    const viewport = screen.getByTestId("timeline-scroll");
    Object.defineProperties(viewport, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 200 },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "Auto-scroll" }));
    viewport.scrollTop = 200;
    fireEvent.scroll(viewport);
    const second = record(2);
    const updated = {
      ...initial,
      entries: [entry(1), entry(2)],
      records: { [first.id]: first, [second.id]: second },
    };
    rerender(<TimelineView {...updated} />);
    expect(viewport.scrollTop).toBe(200);
    expect(screen.getByRole("checkbox", { name: "Auto-scroll" })).not.toBeChecked();
    fireEvent.click(screen.getByRole("checkbox", { name: "Auto-scroll" }));
    expect(viewport.scrollTop).toBe(800);
    viewport.scrollTop = 700;
    fireEvent.click(row(/^Assistant · Reply 1/));
    rerender(<TimelineView {...updated} loading />);
    expect(viewport.scrollTop).toBe(700);
    Object.defineProperty(viewport, "scrollHeight", { configurable: true, value: 1200 });
    const third = record(3);
    rerender(
      <TimelineView
        {...updated}
        entries={[...updated.entries, entry(3)]}
        records={{ ...updated.records, [third.id]: third }}
      />,
    );
    expect(viewport.scrollTop).toBe(1000);
    fireEvent.scroll(viewport);
    expect(screen.getByRole("checkbox", { name: "Auto-scroll" })).toBeChecked();
    expect(row(/^Assistant · Reply 1/)).toHaveAttribute("aria-pressed", "true");
  });

  it("previews the newest item of a live stream until a row is picked, and jumps from the request strip", () => {
    const first = record(1);
    const second = record(2);
    const initial = props({
      entries: [entry(1), entry(2)],
      records: { [first.id]: first, [second.id]: second },
    });
    const { rerender } = render(<TimelineView {...initial} />);
    expect(row(/^Assistant · Reply 2/)).toHaveAttribute("aria-pressed", "true");
    const third = record(3);
    rerender(
      <TimelineView
        {...initial}
        entries={[...initial.entries, entry(3)]}
        records={{ ...initial.records, [third.id]: third }}
      />,
    );
    expect(row(/^Assistant · Reply 3/)).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Go to request 1" }));
    expect(row(/^Assistant · Reply 1/)).toHaveAttribute("aria-pressed", "true");
    expect(row(/^Assistant · Reply 1/)).toHaveFocus();
    expect(screen.getByRole("button", { name: "Go to request 1" })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(screen.getByRole("checkbox", { name: "Auto-scroll" })).not.toBeChecked();
    fireEvent.click(screen.getByRole("checkbox", { name: "Auto-scroll" }));
    expect(row(/^Assistant · Reply 3/)).toHaveAttribute("aria-pressed", "true");
  });

  it("groups by prompt, folds setup requests, and filters down to errors", () => {
    const probe = (seq: number, status: number): EntrySummary => ({
      id: `session/${seq}`,
      session: "session",
      seq,
      ts: 1_700_000_000_000 + seq,
      method: "GET",
      url: "/v1/models",
      status,
    });
    const prompt = {
      role: "user",
      type: "text",
      text: "<current_datetime>now</current_datetime>\n\nFix the login test",
    };
    const first = record(3);
    first.latencyMs = 2000;
    first.parsed!.view!.messages = [prompt];
    first.parsed!.response!.content = [
      { type: "tool_use", name: "Bash", input: { command: "npm test" } },
    ];
    const second = record(4);
    second.parsed!.view!.messages = [
      prompt,
      {
        role: "assistant",
        type: "tool_use",
        name: "Bash",
        callId: "client-1",
        text: '{"command":"npm test"}',
      },
      { role: "tool", type: "tool_result", callId: "client-1", text: "1 failed", isError: true },
    ];
    render(
      <TimelineView
        {...props({
          entries: [probe(1, 404), probe(2, 200), entry(3), entry(4)],
          records: { [first.id]: first, [second.id]: second },
          isLive: false,
        })}
      />,
    );
    const fold = screen.getByRole("button", { name: /2 setup requests/ });
    expect(fold).toHaveAttribute("aria-expanded", "false");
    expect(fold).toHaveTextContent("GET /v1/models · 1 failed");
    expect(screen.queryByRole("button", { name: /^GET/ })).not.toBeInTheDocument();
    expect(row(/^User · Fix the login test · 2 requests · 1 tool · 2\.00s/)).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(within(preview()).getByText("What the user typed")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Bash/ })).toHaveLength(1);
    expect(row(/^Bash · npm test · error · ~2 tok/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Go to request 1" }));
    expect(fold).toHaveAttribute("aria-expanded", "true");
    expect(row(/^GET · \/v1\/models · HTTP 404/)).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Prompts 1" })).toBeInTheDocument();
    // A failed request and a failed tool call are counted and filtered apart:
    // the first in requests, like the request list, the second in events.
    fireEvent.click(screen.getByRole("button", { name: "Failed 1" }));
    expect(document.querySelectorAll(".flow-row")).toHaveLength(1);
    expect(row(/^GET · \/v1\/models · HTTP 404/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tool errors 1" }));
    expect(document.querySelectorAll(".flow-row")).toHaveLength(1);
    expect(row(/^Bash/)).toHaveAttribute("aria-pressed", "true");
    fireEvent.change(screen.getByLabelText("Find in this session"), {
      target: { value: "nothing like this" },
    });
    expect(screen.getByText(/Nothing in this session matches/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear the filter" }));
    expect(document.querySelectorAll(".flow-row").length).toBeGreaterThan(3);
  });

  it("keeps failed and pending turns visible and supports optional usage statistics", () => {
    const failed = record(1, "gpt-codex");
    failed.response = { status: 502 };
    failed.parsed!.response = { error: { message: "upstream unavailable" } };
    failed.usageStats = { usd: 0.004 };
    const pending = record(2, "gpt-codex");
    pending.response = null;
    pending.parsed!.response = null;
    render(
      <TimelineView
        {...props({
          entries: [entry(1, "gpt-codex"), { ...entry(2, "gpt-codex"), pending: true }],
          records: { [failed.id]: failed, [pending.id]: pending },
        })}
      />,
    );
    expect(screen.getByText("Waiting for the response…")).toBeInTheDocument();
    fireEvent.click(row(/^Request failed · error 502: upstream unavailable/));
    expect(within(preview()).getByText(/\$0\.0040/)).toBeInTheDocument();
    expect(within(preview()).getByText("Request #1 ended with an error.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Go to request 1" })).toHaveClass("replay-bar-error");
  });

  it("shows a request the client cancelled in amber, apart from the failures", () => {
    const cancelled = record(1);
    cancelled.response = { error: "client disconnected" };
    cancelled.parsed!.response = { error: "client disconnected" };
    const failed = record(2);
    failed.response = { error: "socket hang up" };
    failed.parsed!.response = { error: "socket hang up" };
    render(
      <TimelineView
        {...props({
          isLive: false,
          entries: [
            { ...entry(1), status: null, error: "client disconnected" },
            { ...entry(2), status: null, error: "socket hang up" },
          ],
          records: { [cancelled.id]: cancelled, [failed.id]: failed },
        })}
      />,
    );
    const bar = screen.getByRole("button", { name: "Go to request 1" });
    expect(bar).toHaveClass("replay-bar-cancelled");
    expect(bar).not.toHaveClass("replay-bar-error");
    expect(bar.title).toContain("cancelled by the client");
    expect(screen.getByRole("button", { name: "Go to request 2" })).toHaveClass("replay-bar-error");
    // One of each, counted in requests.
    expect(screen.getByRole("button", { name: "Failed 1" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancelled 1" }));
    const line = row(
      /^Cancelled · The client closed the connection before the response finished · cancelled/,
    );
    expect(line).not.toHaveClass("flow-row-error");
    expect(screen.queryByRole("button", { name: /^Request failed/ })).not.toBeInTheDocument();
    fireEvent.click(line);
    expect(
      within(preview()).getByRole("heading", { name: "Request cancelled" }),
    ).toBeInTheDocument();
    expect(within(preview()).getByText("Request #1 was cancelled.")).toBeInTheDocument();
    expect(within(preview()).getByText("client disconnected")).toBeInTheDocument();
  });

  it("offers to delete an empty saved capture and tells it apart from a model mismatch", () => {
    const initial = props({ isLive: false, onDelete: vi.fn() });
    const { rerender } = render(<TimelineView {...initial} />);
    expect(screen.getByText("This saved session is empty")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete session…" }));
    expect(initial.onDelete).toHaveBeenCalledOnce();
    const onModel = vi.fn();
    rerender(
      <TimelineView
        {...initial}
        entries={[entry(1)]}
        modelFilter="other"
        models={["claude", "other"]}
        onModel={onModel}
        heading={<nav aria-label="Views of this session">Replay Usage</nav>}
      />,
    );
    expect(screen.getByText("No requests for this model")).toBeInTheDocument();
    // A session that called several models offers the choice where the replay is read.
    fireEvent.change(screen.getByRole("combobox", { name: "Show requests to one model" }), {
      target: { value: "claude" },
    });
    expect(onModel).toHaveBeenCalledWith("claude");
    // The session's views take the place of the title.
    expect(screen.getByRole("navigation", { name: "Views of this session" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Replay" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete session…" })).not.toBeInTheDocument();
  });

  it("tells a new user what to do while recording is on and nothing has arrived", () => {
    render(<TimelineView {...props({ isLive: true, onDelete: vi.fn() })} />);
    expect(screen.getByText("Recording. Nothing has come through yet")).toBeInTheDocument();
    expect(
      screen.getByText(/Point your agent's API base URL at the ccglass proxy/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete session…" })).not.toBeInTheDocument();
  });

  it("offers auto-scroll only while recording, and never starts following a saved session", () => {
    const first = record(1);
    const saved = props({ entries: [entry(1)], records: { [first.id]: first }, isLive: false });
    const { rerender } = render(<TimelineView {...saved} />);
    expect(screen.queryByRole("checkbox", { name: "Auto-scroll" })).not.toBeInTheDocument();
    const viewport = screen.getByTestId("timeline-scroll");
    Object.defineProperties(viewport, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 200 },
    });
    // Reading to the end of a saved session is not a request to follow it.
    viewport.scrollTop = 800;
    fireEvent.scroll(viewport);
    viewport.scrollTop = 300;
    rerender(<TimelineView {...saved} records={{ ...saved.records }} />);
    expect(viewport.scrollTop).toBe(300);
  });
});
