import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import RequestDetail from "../src/components/RequestDetail";
import { ContentBlock } from "../src/components/JsonView";
import SummaryView from "../src/components/SummaryView";
import DiffView from "../src/components/DiffView";
import { api } from "../src/api";
import type { DiffResult, RequestRecord, UsageSummary } from "../src/types";

vi.mock("../src/api", () => ({ api: vi.fn() }));

const record: RequestRecord = {
  id: "saved/1",
  seq: 1,
  ts: 1_700_000_000_000,
  model: "test-model",
  request: {
    method: "POST",
    url: "/v1/responses",
    headers: { host: "localhost:6656", authorization: "[REDACTED]" },
    body: { model: "test-model", input: "hello" },
  },
  response: {
    status: 200,
    headers: { "content-type": "application/json" },
    raw: '{"output":"ok"}',
  },
  parsed: {
    view: {
      system: [],
      messages: [
        {
          label: "tool output",
          type: "tool_result",
          callId: "call-one",
          text: "<img src=x onerror=alert(1)>",
          role: "tool",
        },
      ],
      tools: [
        {
          name: "read_file",
          description: "Read a local file",
          schema: { type: "object", properties: { path: { type: "string" } } },
        },
      ],
    },
    response: {
      model: "test-model",
      usage: { input_tokens: 5, output_tokens: 3 },
      content: [{ type: "text", text: "ok" }],
    },
  },
};
const bucket = {
  requests: 1,
  input: 5,
  output: 3,
  cacheRead: 2,
  cacheWrite: 0,
  totalInput: 7,
  usd: 0.001,
  cacheHitRate: 2 / 7,
};
const usage: UsageSummary = {
  sessionCount: 2,
  requestCount: 2,
  unmeasured: 1,
  range: { from: null, to: null },
  totals: bucket,
  byModel: [{ ...bucket, model: "test-model" }],
  bySession: [
    { ...bucket, session: "recording", entries: 2 },
    { ...bucket, session: "saved", name: "Capture title", entries: 1 },
  ],
};
const actions = () => ({
  onOpenSession: vi.fn(),
  onExportSession: vi.fn(),
  onResetSession: vi.fn(),
  onDeleteSession: vi.fn(),
});

beforeEach(() => {
  vi.mocked(api).mockReset();
  vi.unstubAllGlobals();
});

describe("request inspector", () => {
  it("preserves tool output, input schemas, response headers, and request exports while displaying captured markup as text", () => {
    const { container } = render(<RequestDetail record={record} />);
    fireEvent.click(screen.getByRole("tab", { name: /^messages/i }));
    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: /^tools/i }));
    expect(screen.getByText("Read a local file")).toBeInTheDocument();
    expect(screen.getByText(/"path"/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /^headers/i }));
    expect(
      within(
        screen.getByRole("heading", { name: "Response headers" }).closest("section")!,
      ).getByLabelText("Formatted JSON"),
    ).toHaveTextContent('"content-type": "application/json"');
    expect(screen.getByText(/\[REDACTED\]/)).toBeInTheDocument();
    const links = [...container.querySelectorAll("a")].map((link) => link.getAttribute("href"));
    for (const format of ["raw", "md", "json", "har"])
      expect(links).toContain("/api/export?id=saved%2F1&format=" + format);
  });

  it("prefers normalized usageStats while retaining optional legacy billing and all timing metrics", () => {
    const parsed = {
      ...record.parsed,
      cost: { usd: 0.25, cacheRead: 2 },
      usageStats: {
        input: 100,
        output: 20,
        cacheRead: 200,
        cacheWrite: 10,
        totalInput: 310,
        cacheHitRate: 200 / 310,
      },
    };
    render(
      <RequestDetail
        record={{
          ...record,
          parsed,
          latencyMs: null,
          timing: { totalMs: 1250, ttftMs: 50, genMs: 1200, inTps: 30, outTps: 20 },
        }}
      />,
    );
    const cache = within(screen.getByText("Cache read").parentElement!);
    expect(cache.getByText("200")).toBeInTheDocument();
    expect(cache.getByText("65% hit rate")).toBeInTheDocument();
    expect(screen.getByText("$0.25000")).toBeInTheDocument();
    expect(screen.getByText("310")).toBeInTheDocument();
    for (const metric of ["1.25s", "50ms", "1.20s", "30.0 tok/s", "20.0 tok/s"])
      expect(screen.getByText(metric)).toBeInTheDocument();
  });

  it("shows normalized token counts without fabricating costs when billing is unavailable", () => {
    const parsed = {
      usageStats: {
        input: 7,
        output: 9,
        cacheRead: 0,
        cacheWrite: 0,
        totalInput: 7,
        cacheHitRate: 0,
      },
    };
    const { rerender } = render(<RequestDetail record={{ id: "usage-only", parsed }} />);
    expect(
      within(screen.getByText("Actual input").parentElement!).getByText("7"),
    ).toBeInTheDocument();
    expect(within(screen.getByText("Output").parentElement!).getByText("9")).toBeInTheDocument();
    expect(screen.queryByText("Estimated cost")).not.toBeInTheDocument();
    expect(screen.getByText("0% hit rate")).toBeInTheDocument();
    rerender(
      <RequestDetail
        record={{
          id: "legacy-usage",
          parsed: {
            cost: {
              input: 12,
              output: 4,
              cacheRead: 8,
              cacheWrite: 0,
              totalInput: 20,
              cacheHitRate: 0.4,
              usd: 0,
            },
          },
        }}
      />,
    );
    expect(
      within(screen.getByText("Actual input").parentElement!).getByText("12"),
    ).toBeInTheDocument();
    expect(screen.getByText("40% hit rate")).toBeInTheDocument();
    expect(screen.getByText("$0.00000")).toBeInTheDocument();
  });

  it("keeps raw responses and upstream errors inspectable when a provider response was not parsed", () => {
    const errorRecord = {
      ...record,
      response: {
        status: 502,
        error: "upstream disconnected",
        raw: "data: provider-specific payload",
      },
      parsed: undefined,
    };
    render(<RequestDetail record={errorRecord} />);
    expect(screen.getByText("HTTP 502")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "response" }));
    expect(screen.getByText("upstream disconnected")).toBeInTheDocument();
    expect(screen.getByText("data: provider-specific payload")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "raw" }));
    expect(screen.getByText("data: provider-specific payload")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Captured record" })).toBeInTheDocument();
  });

  it("preserves thinking, unknown content, cache annotations, tool inputs and tool-result pairing", async () => {
    const parsed = {
      ...record.parsed,
      view: {
        system: [{ label: "Policy", text: "Local-only policy", cache: true }],
        tools: [],
        messages: [
          {
            label: "Call",
            type: "tool_use",
            name: "Bash",
            callId: "paired-call",
            text: '{"command":"pwd"}',
          },
          {
            label: "Result",
            type: "tool_result",
            callId: "paired-call",
            text: "permission denied",
            isError: true,
          },
          { label: "Thought", type: "thinking", text: "Earlier thought" },
        ],
      },
      response: {
        streamed: true,
        stop_reason: "tool_use",
        usage: {},
        content: [
          { type: "thinking", thinking: "New thought" },
          { type: "tool_use", name: "Bash", id: "next-call", input: { command: "ls" } },
          { type: "provider-extension", payload: "opaque value" },
        ],
      },
    };
    render(<RequestDetail record={{ ...record, parsed }} />);
    fireEvent.click(screen.getByRole("tab", { name: /^system/i }));
    expect(screen.getByText("Local-only policy")).toBeInTheDocument();
    expect(screen.getByText("cached")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /^messages/i }));
    expect(screen.getByText("permission denied")).toBeInTheDocument();
    expect(screen.getAllByTitle("paired-call")).toHaveLength(2);
    expect(screen.getByText("Earlier thought")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "response" }));
    expect(screen.getByText("streamed")).toBeInTheDocument();
    expect(screen.getByText("New thought")).toBeInTheDocument();
    const responseJson = screen
      .getAllByLabelText("Formatted JSON")
      .map((element) => element.textContent)
      .join("\n");
    expect(responseJson).toContain('"command": "ls"');
    expect(responseJson).toContain('"payload": "opaque value"');
    fireEvent.click(screen.getByRole("tab", { name: "flow" }));
    expect(screen.getByText("tool_use", { selector: "p" })).toBeInTheDocument();
    expect(screen.getByText("New thought", { selector: "pre" })).toBeInTheDocument();
  });

  it("supports keyboard tab navigation with unique panel relationships for multiple inspectors", () => {
    const { container } = render(
      <>
        <RequestDetail record={record} />
        <RequestDetail record={{ ...record, id: "other" }} />
      </>,
    );
    const sections = screen.getAllByRole("region", { name: "Request inspector" });
    const first = within(sections[0]);
    fireEvent.keyDown(first.getByRole("tab", { name: "overview" }), { key: "End" });
    expect(first.getByRole("tab", { name: "raw" })).toHaveFocus();
    expect(first.getByRole("tab", { name: "raw" })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(first.getByRole("tab", { name: "raw" }), { key: "ArrowRight" });
    expect(first.getByRole("tab", { name: "overview" })).toHaveFocus();
    const ids = [...container.querySelectorAll("[id]")].map((element) => element.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("copies a reusable cURL command and retains all request export callbacks", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const onExport = vi.fn();
    render(<RequestDetail record={record} onExport={onExport} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy cURL" }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        expect.stringContaining("'http://localhost:6656/v1/responses'"),
      ),
    );
    expect(writeText.mock.calls[0][0]).toContain("-H 'authorization: [REDACTED]'");
    expect(writeText.mock.calls[0][0]).toContain("-d");
    expect(await screen.findByRole("button", { name: "Copied to clipboard" })).toBeInTheDocument();
    fireEvent.click(screen.getByText("Export", { selector: "summary" }));
    for (const [label, format] of [
      ["HTTP transcript", "raw"],
      ["Markdown", "md"],
      ["JSON", "json"],
      ["HAR", "har"],
    ]) {
      const link = screen.getByRole("link", { name: label });
      link.addEventListener("click", (event) => event.preventDefault(), { once: true });
      fireEvent.click(link);
      expect(onExport).toHaveBeenCalledWith(format);
    }
    vi.unstubAllGlobals();
  });
});

describe("inspector content folding", () => {
  it("mounts long content only when expanded, without truncating the copied source", async () => {
    const text = "full captured content\n".repeat(50);
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const { container } = render(<ContentBlock title="Long response" value={text} />);
    expect(container.querySelector("pre.code-block")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Copy Long response" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(text));
    fireEvent.click(screen.getByRole("button", { name: "Long response" }));
    await waitFor(() => expect(container.querySelector("pre.code-block")?.textContent).toBe(text));
    fireEvent.click(screen.getByRole("button", { name: "Long response" }));
    await waitFor(() => expect(container.querySelector("pre.code-block")).toBeNull());
    vi.unstubAllGlobals();
  });
});

describe("session summary", () => {
  it("keeps saved-session inspection and export available in read-only mode while hiding mutations", async () => {
    vi.mocked(api).mockResolvedValue(usage);
    const callbacks = actions();
    render(<SummaryView usage={usage} controllable={false} live={null} {...callbacks} />);
    fireEvent.click(screen.getByRole("tab", { name: "By session" }));
    await waitFor(() => expect(api).toHaveBeenCalledWith("/api/usage?names=1", expect.anything()));
    expect(screen.getByText("Capture title")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reset session saved" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete session saved" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Export session saved" }));
    fireEvent.click(screen.getByRole("button", { name: "Open session saved" }));
    expect(callbacks.onExportSession).toHaveBeenCalledWith("saved");
    expect(callbacks.onOpenSession).toHaveBeenCalledWith("saved");
  });

  it("blocks deletion of recording sessions and delegates saved-session deletion and reset", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const callbacks = actions();
    render(<SummaryView usage={usage} controllable live="recording" {...callbacks} />);
    fireEvent.click(screen.getByRole("tab", { name: "By timestamp" }));
    expect(screen.getByRole("button", { name: "Delete session recording" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Delete session saved" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Delete session saved" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset session saved" }));
    expect(callbacks.onDeleteSession).toHaveBeenCalledWith("saved");
    expect(callbacks.onResetSession).toHaveBeenCalledWith("saved");
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(confirm).toHaveBeenCalledWith(
      expect.stringContaining("Permanently delete session saved"),
    );
    expect(confirm).toHaveBeenCalledWith(
      expect.stringContaining("Clear all requests in session saved"),
    );
    expect(api).not.toHaveBeenCalled();
  });
});

describe("request comparison", () => {
  it("discards an obsolete comparison when the selected pair changes", async () => {
    let resolveOld!: (diff: DiffResult) => void;
    const old = new Promise<DiffResult>((resolve) => {
      resolveOld = resolve;
    });
    const current: DiffResult = {
      added: [{ label: "New context", text: "Current context" }],
      removed: [],
      common: [],
      counts: { added: 1, removed: 0, common: 0, cachedInB: 0 },
    };
    vi.mocked(api).mockReturnValueOnce(old).mockResolvedValueOnce(current);
    const { rerender } = render(<DiffView picks={["a", "b"]} records={{}} />);
    const previousSignal = vi.mocked(api).mock.calls[0][1]?.signal;
    rerender(<DiffView picks={["a", "c"]} records={{}} />);
    expect(previousSignal?.aborted).toBe(true);
    await screen.findByText("Current context");
    resolveOld({ ...current, added: [{ label: "Old context", text: "Obsolete context" }] });
    await waitFor(() => expect(screen.queryByText("Obsolete context")).not.toBeInTheDocument());
    expect(screen.getByText("Current context")).toBeInTheDocument();
  });
});
