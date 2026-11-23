import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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
    onExport: vi.fn(),
    loading: false,
    isLive: true,
    recordLimit: 500,
    ...overrides,
  };
}

describe("conversation timeline", () => {
  it("pairs a later Codex tool result without duplicating context or losing the expanded row", () => {
    const first = record(1, "gpt-codex");
    first.parsed!.view!.system = [{ text: "Hidden Codex prompt" }];
    first.parsed!.response!.content = [
      { type: "tool_use", id: "call-shell", name: "Bash", input: { command: "printf hello" } },
    ];
    const initial = props({ entries: [entry(1, "gpt-codex")], records: { [first.id]: first } });
    const { container, rerender } = render(<TimelineView {...initial} />);
    expect(screen.queryByText("Hidden Codex prompt")).not.toBeInTheDocument();
    expect(screen.getByText("pending…")).toBeInTheDocument();
    expect(screen.getByText("Response #1")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Expand Bash content"));
    const toolRow = container.querySelector('[data-kind="tool_use"]');
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
    expect(container.querySelector('[data-kind="tool_use"]')).toBe(toolRow);
    expect(within(toolRow as HTMLElement).getByText("Response #1")).toBeInTheDocument();
    expect(within(toolRow as HTMLElement).getByText("Request #2 · tool output")).toBeInTheDocument();
    expect(toolRow?.querySelector(".timeline-marker")).toHaveClass("error");
    expect(toolRow?.querySelector(".timeline-marker")).not.toHaveAttribute("style");
    expect(container.querySelector('[data-kind="tool_result"]')).toBeNull();
    expect(screen.queryByText("pending…")).not.toBeInTheDocument();
    expect(screen.getByText("error")).toBeInTheDocument();
    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
    expect(screen.queryByText(/"command"/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Show input"));
    expect(screen.getByLabelText("Formatted JSON")).toHaveTextContent('"command": "printf hello"');
  });

  it("labels HTTP direction independently of message role and the newest turn", () => {
    const first = record(1);
    first.parsed!.view!.messages = [
      { role: "assistant", type: "text", text: "Earlier assistant context" },
      { role: "user", type: "text", text: "Current user prompt" },
    ];
    const second = record(2);
    second.parsed!.view!.messages = [...first.parsed!.view!.messages];
    const { container } = render(<TimelineView {...props({
      entries: [entry(1), entry(2)],
      records: { [first.id]: first, [second.id]: second },
      isLive: false,
    })} />);
    const requestRows = container.querySelectorAll('.timeline-row[data-source="request"]');
    expect(requestRows).toHaveLength(2);
    for (const row of requestRows) {
      expect(within(row as HTMLElement).getByText("Request #1")).toBeInTheDocument();
      expect(row.querySelector(".timeline-marker")).toHaveClass("request");
    }
    expect(requestRows[0]).toHaveAttribute("data-kind", "assistant");
    expect(screen.getByText("Response #1")).toBeInTheDocument();
    expect(screen.getByText("Response #2")).toBeInTheDocument();
    expect(container.querySelectorAll(".timeline-marker.response")).toHaveLength(2);
    expect(container.querySelector(".timeline-marker.error")).toBeNull();
    expect(screen.getByLabelText("Request and response key")).toBeInTheDocument();
  });

  it("keeps standalone tool outputs labeled as request input and previews paired outputs while collapsed", () => {
    const first = record(1, "gpt-codex");
    first.parsed!.response!.content = [
      { type: "tool_use", id: "paired", name: "Bash", input: { command: "pwd" } },
    ];
    const second = record(2, "gpt-codex");
    second.parsed!.view!.messages = [
      { type: "tool_result", callId: "paired", text: "Working directory: /project" },
      { type: "tool_result", callId: "unknown", text: "Unmatched output" },
    ];
    const { container } = render(<TimelineView {...props({
      entries: [entry(1, "gpt-codex"), entry(2, "gpt-codex")],
      records: { [first.id]: first, [second.id]: second },
    })} />);
    const orphan = container.querySelector('[data-kind="tool_result"]')!;
    expect(orphan).toHaveAttribute("data-source", "request");
    expect(within(orphan as HTMLElement).getByText("Request #2")).toBeInTheDocument();
    expect(screen.getByText("Working directory: /project")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Expand Bash content"));
    expect(screen.getByText("Working directory: /project")).toBeInTheDocument();
    expect(container.querySelector(".timeline-output-preview")).toBeNull();
  });

  it("renders large payloads lazily and preserves disclosure state through unrelated updates", () => {
    const captured = record(1);
    const payload = "Large thinking payload ".repeat(1000);
    captured.parsed!.response!.content = [{ type: "thinking", thinking: payload }];
    const initial = props({ entries: [entry(1)], records: { [captured.id]: captured } });
    const { container, rerender } = render(<TimelineView {...initial} />);
    expect(container.querySelector("pre")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Expand all" }));
    expect(container.querySelector("pre")?.textContent).toBe(payload);
    const disclosure = container.querySelector("details");
    rerender(<TimelineView {...initial} records={{ ...initial.records }} loading />);
    expect(container.querySelector("details")).toBe(disclosure);
    expect(screen.getByLabelText("Collapse Thinking content")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Collapse all" }));
    expect(container.querySelector("pre")).toBeNull();
    fireEvent.click(screen.getByLabelText("Expand Thinking content"));
    expect(container.querySelector("pre")?.textContent).toBe(payload);
  });

  it("uses only the provided replay page, filters models, and retains whole-session export and turn inspection", () => {
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
    expect(screen.getByRole("region", { name: "Session replay" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Inspect turn 1" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Inspect turn 2" })).not.toBeInTheDocument();
    expect(screen.getByText(/Session exports include every request/)).toBeInTheDocument();
    expect(screen.getByText("$0.0123")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Inspect turn 3" }));
    fireEvent.click(screen.getByRole("button", { name: "Export session" }));
    expect(initial.onOpen).toHaveBeenCalledWith("session/3");
    expect(initial.onExport).toHaveBeenCalledOnce();
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
    expect(screen.getByRole("button", { name: "Inspect turn 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Inspect turn 3" })).toBeInTheDocument();
  });

  it("follows appended content only while pinned, not on disclosure or unrelated parent updates", () => {
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
    fireEvent.click(screen.getByRole("button", { name: "Collapse all" }));
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
    expect(screen.getByText("error 502: upstream unavailable")).toBeInTheDocument();
    expect(screen.getByText("Waiting for the response…")).toBeInTheDocument();
    expect(screen.getByText("$0.0040")).toBeInTheDocument();
  });

  it("exports empty saved captures and distinguishes an empty capture from a model mismatch", () => {
    const initial = props({ isLive: false });
    const { rerender } = render(<TimelineView {...initial} />);
    expect(screen.getByText("This saved capture has no requests.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Export session" }));
    expect(initial.onExport).toHaveBeenCalledOnce();
    rerender(<TimelineView {...initial} entries={[entry(1)]} modelFilter="other" />);
    expect(screen.getByText("No requests for this model")).toBeInTheDocument();
  });
});
