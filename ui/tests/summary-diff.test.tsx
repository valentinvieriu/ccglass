import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import SessionsView, { type SessionsViewProps } from "../src/components/SessionsView";
import { SessionUsage } from "../src/components/UsageView";
import DiffView from "../src/components/DiffView";
import { api } from "../src/api";
import type { DiffResult, EntrySummary, UsageSummary } from "../src/types";

vi.mock("../src/api", () => ({ api: vi.fn() }));

const bucket = {
  requests: 2,
  input: 100,
  output: 20,
  cacheRead: 300,
  cacheWrite: 100,
  totalInput: 500,
  cacheHitRate: 0.6,
};
// The capture API may omit monetary fields entirely.
const usage: UsageSummary = {
  sessionCount: 2,
  requestCount: 2,
  unmeasured: 1,
  range: { from: null, to: null },
  totals: bucket,
  byModel: [{ ...bucket, model: "local-model" }],
  bySession: [
    { ...bucket, session: "saved", name: "Saved title", entries: 3 },
    { ...bucket, session: "live", entries: 2 },
  ],
};
const callbacks = () => ({
  navigate: vi.fn(),
  onExportSession: vi.fn(),
  onResetSession: vi.fn(),
  onDeleteSession: vi.fn(),
});
const home = (overrides: Partial<SessionsViewProps> = {}) => (
  <SessionsView
    tab="sessions"
    sessions={["saved", "live"]}
    usage={usage}
    index={{}}
    controllable={false}
    live="live"
    {...callbacks()}
    {...overrides}
  />
);
const entries: EntrySummary[] = [1, 2, 3].map((seq) => ({
  id: `saved/${seq}`,
  session: "saved",
  seq,
  ts: seq * 1000,
  model: "local-model",
}));
const diff: DiffResult = {
  added: [{ label: "new", text: "<script>captured text</script>", cache: true }],
  removed: [{ label: "old", text: "removed content" }],
  common: [{ label: "shared", text: "shared content", cache: true }],
  counts: { added: 1, removed: 1, common: 1, cachedInB: 2 },
};

beforeEach(() => {
  vi.mocked(api).mockReset();
  vi.restoreAllMocks();
});

describe("sessions home and usage", () => {
  it("lists every session with what tells it apart, before and after the numbers arrive", () => {
    vi.stubGlobal("localStorage", { getItem: () => "0", setItem: () => {} });
    const { rerender } = render(home({ usage: null, loading: true }));
    // The list is there at once; the token numbers follow.
    const saved = () => screen.getByRole("row", { name: /^saved/ });
    expect(within(saved()).getAllByText("—").length).toBeGreaterThan(3);
    rerender(
      home({
        index: {
          saved: {
            requests: 3,
            models: ["local-model"],
            failed: 1,
            cancelled: 2,
            prompt: "what time is it?",
          },
          live: { requests: 0, models: [], failed: 0, cancelled: 0, prompt: null },
        },
      }),
    );
    expect(saved()).toHaveTextContent("what time is it?");
    expect(saved()).toHaveTextContent("local-model");
    expect(saved()).toHaveTextContent("1 failed2 cancelled3");
    expect(within(saved()).getByRole("meter")).toHaveValue(0.6);
    // "Input" always means everything sent; the cached part is named as part of it.
    expect(screen.getByRole("columnheader", { name: "Input (total)" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "of which cached" })).toBeInTheDocument();
    // An empty session is said to be empty instead of showing zeros and a rate.
    const empty = screen.getByRole("row", { name: /^live/ });
    expect(empty).toHaveTextContent("No requests");
    expect(within(empty).queryByRole("meter")).toBeNull();
    expect(within(empty).getByText("Recording")).toBeInTheDocument();
    // The totals of the list close it.
    expect(screen.getByRole("row", { name: /^2 sessions/ })).toHaveTextContent("2 sessions3500300");
    expect(screen.getByLabelText("Totals across every session")).toHaveTextContent(
      "2 sessions500 tokens in (60% cached)20 tokens out",
    );
    vi.unstubAllGlobals();
  });

  it("opens a session from its row and sorts by any column", () => {
    const navigate = vi.fn();
    vi.stubGlobal("localStorage", { getItem: () => "0", setItem: () => {} });
    render(
      home({
        navigate,
        sessions: ["2026-11-23T10-00-00-000", "2026-11-22T10-00-00-000"],
        usage: {
          ...usage,
          bySession: [
            { ...bucket, session: "2026-11-23T10-00-00-000", entries: 2, output: 5 },
            { ...bucket, session: "2026-11-22T10-00-00-000", entries: 9, output: 50 },
          ],
        },
      }),
    );
    const order = () =>
      screen
        .getAllByRole("row")
        .slice(1, 3)
        .map((row) => row.textContent?.slice(0, 6));
    // Newest first, and the column says so.
    expect(order()).toEqual(["Nov 23", "Nov 22"]);
    expect(screen.getByRole("columnheader", { name: /Session/ })).toHaveAttribute(
      "aria-sort",
      "descending",
    );
    fireEvent.click(screen.getByRole("button", { name: /^Requests/ }));
    expect(order()).toEqual(["Nov 22", "Nov 23"]);
    fireEvent.click(screen.getByRole("button", { name: /^Requests/ }));
    expect(order()).toEqual(["Nov 23", "Nov 22"]);
    expect(screen.getByRole("columnheader", { name: /Requests/ })).toHaveAttribute(
      "aria-sort",
      "ascending",
    );
    // The link is what a keyboard uses; a click anywhere on the row does the same.
    const link = screen.getByRole("link", { name: /^Nov 22/ });
    expect(link).toHaveAttribute("href", "#/s/2026-11-22T10-00-00-000");
    fireEvent.click(link);
    fireEvent.click(screen.getAllByRole("row")[1].querySelector("td.model-cell")!);
    expect(navigate.mock.calls.map(([route]) => route.session)).toEqual([
      "2026-11-22T10-00-00-000",
      "2026-11-23T10-00-00-000",
    ]);
    vi.unstubAllGlobals();
  });

  it("shows cache and model totals without inventing monetary data, and preserves optional cost when present", () => {
    const { rerender } = render(home({ tab: "usage" }));
    expect(screen.getAllByText("Input (total)")).toHaveLength(2);
    expect(screen.getAllByText("of which cached")).toHaveLength(2);
    expect(screen.getAllByText("500")).toHaveLength(2);
    expect(screen.queryByText("Uncached input")).not.toBeInTheDocument();
    expect(screen.getByText("1 request returned no usage data")).toBeInTheDocument();
    expect(screen.getByRole("meter", { name: "Cache hit rate for local-model" })).toHaveValue(0.6);
    expect(screen.queryByText(/estimated cost/i)).not.toBeInTheDocument();
    // The list of sessions is the other view, not part of this one.
    expect(screen.queryByRole("link", { name: /^saved/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Usage" })).toHaveAttribute("aria-current", "page");
    rerender(
      home({
        tab: "usage",
        usage: {
          ...usage,
          totals: { ...bucket, usd: 0.125 },
          byModel: [{ ...bucket, usd: 0.125, model: "local-model" }],
        },
      }),
    );
    expect(screen.getByText("Total estimated cost")).toBeInTheDocument();
    expect(screen.getAllByText("$0.1250")).toHaveLength(2);
  });

  it("shows one session's usage: its totals, then each model it called", () => {
    const stats = (model: string, total: number, input: number) => ({
      session: "s",
      models: ["big", "small"],
      model,
      completed: total - 1,
      total,
      totalInput: input,
      totalOutput: 40,
      cacheHitRate: 0.5,
    });
    const { rerender } = render(<SessionUsage stats={null} loading />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading usage…");
    rerender(
      <SessionUsage
        stats={[
          stats("all", 12, 1_200_000),
          stats("big", 8, 1_000_000),
          stats("small", 3, 200_000),
        ]}
        loading={false}
      />,
    );
    // Large totals are short to read, with the exact number one hover away.
    expect(screen.getByText("1.20M")).toHaveAttribute("title", "1,200,000 tokens");
    expect(screen.getByText("600k")).toBeInTheDocument();
    expect(screen.getByText("1 request returned no usage data")).toBeInTheDocument();
    expect(screen.getByRole("row", { name: /^big/ })).toHaveTextContent(
      "big81,000,000500,00050%40",
    );
    expect(screen.getByRole("meter", { name: "Cache hit rate for small" })).toHaveValue(0.5);
    // Cache writes are not known per session, so no column claims them.
    expect(screen.queryByText("Cache write")).not.toBeInTheDocument();
  });

  it("confirms saved-session mutations, allows cancellation, and blocks deletion while recording", () => {
    const actions = callbacks();
    // Names are switched off, so the session table must not trigger the lookup.
    vi.stubGlobal("localStorage", { getItem: () => "0", setItem: () => {} });
    render(home({ controllable: true, ...actions }));
    const menu = () =>
      fireEvent.click(screen.getByRole("button", { name: "More actions for session saved" }));
    menu();
    fireEvent.click(screen.getByRole("menuitem", { name: /Clear requests…/ }));
    // The confirmation names what is about to be cleared and how much of it.
    const dialog = screen.getByRole("alertdialog", { name: "Clear 3 requests from this session?" });
    expect(dialog).toHaveTextContent("stays in the list, empty");
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(actions.onResetSession).not.toHaveBeenCalled();
    menu();
    fireEvent.click(screen.getByRole("menuitem", { name: /Clear requests…/ }));
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    expect(actions.onResetSession).not.toHaveBeenCalled();
    menu();
    fireEvent.click(screen.getByRole("menuitem", { name: /Clear requests…/ }));
    fireEvent.click(screen.getByRole("button", { name: "Clear requests" }));
    expect(actions.onResetSession).toHaveBeenCalledWith("saved");
    menu();
    fireEvent.click(screen.getByRole("menuitem", { name: /Delete session…/ }));
    expect(screen.getByRole("alertdialog", { name: "Delete this session?" })).toHaveTextContent(
      "and its 3 requests are removed from disk",
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete session" }));
    expect(actions.onDeleteSession).toHaveBeenCalledWith("saved");
    fireEvent.click(screen.getByRole("button", { name: "More actions for session live" }));
    expect(screen.getByRole("menuitem", { name: /Delete session…/ })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: /Delete session…/ })).toHaveTextContent(
      "Stop recording before deleting it",
    );
    // Using a row's menu does not open the session.
    expect(actions.navigate).not.toHaveBeenCalled();
    expect(api).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("fetches names only when the list is shown and leaves opening and export available in read-only mode", async () => {
    vi.mocked(api).mockResolvedValue(usage);
    const actions = callbacks();
    const { rerender } = render(home({ tab: "usage", live: null, ...actions }));
    expect(api).not.toHaveBeenCalled();
    rerender(home({ live: null, ...actions }));
    await waitFor(() => expect(api).toHaveBeenCalledWith("/api/usage?names=1", expect.anything()));
    // The agent's own title for the session, where it is known.
    expect(await screen.findByText("Saved title")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Show session names" }));
    expect(screen.queryByText("Saved title")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /More actions for session/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/Read-only capture/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: /^saved/ }));
    fireEvent.click(screen.getByRole("button", { name: "Export session saved" }));
    expect(actions.navigate).toHaveBeenCalledWith({
      view: "session",
      session: "saved",
      tab: "replay",
    });
    expect(actions.onExportSession).toHaveBeenCalledWith("saved");
  });

  it("tells a new user how to get a first session", () => {
    render(
      home({
        sessions: [],
        usage: { ...usage, sessionCount: 0, bySession: [] },
        controllable: true,
      }),
    );
    expect(screen.getByText("Your sessions will appear here")).toBeInTheDocument();
    expect(screen.getByText(/Press Record, then point your agent/)).toBeInTheDocument();
  });
});

describe("complete request comparison", () => {
  it("loads older unloaded choices before selecting an adjacent baseline and renders every block category safely", async () => {
    vi.mocked(api).mockResolvedValueOnce({ entries }).mockResolvedValue(diff);
    const { container } = render(
      <DiffView
        picks={[]}
        records={{ "saved/3": { id: "saved/3", seq: 3, ts: 3000 } }}
        session="saved"
        selected="saved/3"
      />,
    );
    await screen.findByText("<script>captured text</script>");
    expect(api).toHaveBeenCalledWith("/api/diff?a=saved%2F2&b=saved%2F3", expect.anything());
    const baseline = screen.getByRole("combobox", { name: "A · baseline" });
    expect(baseline).toHaveValue("saved/2");
    // Requests are named like their rows in the list, not by capture id; one
    // model in the whole session is left out of every option.
    expect(within(baseline).getByRole("option", { name: "#1 · local-model" })).toHaveValue(
      "saved/1",
    );
    expect(screen.queryByText("saved/2")).not.toBeInTheDocument();
    expect(screen.getByText("What request #3 sent that #2 did not.")).toBeInTheDocument();
    expect(screen.getByText("removed content")).toBeInTheDocument();
    fireEvent.click(screen.getByText("1 unchanged context block"));
    expect(screen.getByText("shared content")).toBeVisible();
    expect(screen.getByLabelText("Comparison result")).toHaveTextContent(
      "+1 added in B−1 removed from A1 unchanged2 cache breakpoints in B",
    );
    // Both sides have content, so they sit side by side.
    expect(container.querySelector(".diff-grid")).not.toBeNull();
    expect(container.querySelector("script")).toBeNull();
    fireEvent.change(baseline, { target: { value: "saved/1" } });
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith("/api/diff?a=saved%2F1&b=saved%2F3", expect.anything()),
    );
    fireEvent.click(screen.getByRole("button", { name: "Swap baseline and comparison" }));
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith("/api/diff?a=saved%2F3&b=saved%2F1", expect.anything()),
    );
    // The later request as the baseline turns what it added into "removed": say so.
    expect(await screen.findByText(/A is the later request/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Swap A and B" }));
    await waitFor(() =>
      expect(screen.queryByText(/A is the later request/)).not.toBeInTheDocument(),
    );
  });

  it("uses one column when a side is empty, which is the usual case for a growing conversation", async () => {
    vi.mocked(api)
      .mockResolvedValueOnce({ entries })
      .mockResolvedValueOnce({
        added: [{ label: "msg[4].tool", text: "tool output" }],
        removed: [],
        common: [{ label: "shared", text: "shared content" }],
        counts: { added: 1, removed: 0, common: 1, cachedInB: 0 },
      })
      .mockResolvedValue({
        added: [],
        removed: [],
        common: [],
        counts: { added: 0, removed: 0, common: 0, cachedInB: 0 },
      });
    const back = { seq: 3, open: vi.fn() };
    const { container, rerender } = render(
      <DiffView picks={["saved/2", "saved/3"]} records={{}} session="saved" back={back} />,
    );
    await screen.findByText("tool output");
    expect(container.querySelector(".diff-grid")).toBeNull();
    expect(screen.queryByRole("region", { name: "Removed from A" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Added in B" })).toBeInTheDocument();
    expect(screen.getByLabelText("Comparison result")).toHaveTextContent(
      "+1 added in Bnothing removed from A1 unchanged",
    );
    expect(screen.queryByText(/cache breakpoint/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back to request #3" }));
    expect(back.open).toHaveBeenCalled();
    rerender(<DiffView picks={["saved/1", "saved/2"]} records={{}} session="saved" />);
    expect(await screen.findByText("A and B send the same context.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Back to request/ })).not.toBeInTheDocument();
  });

  it("accepts IDs outside the loaded session and reports invalid comparisons instead of throwing", async () => {
    vi.mocked(api).mockRejectedValue(new Error("need both a and b"));
    const onPicksChange = vi.fn();
    const { rerender } = render(<DiffView picks={[]} records={{}} onPicksChange={onPicksChange} />);
    fireEvent.click(screen.getByText("Compare by request ID"));
    fireEvent.change(screen.getByRole("textbox", { name: "Baseline request ID" }), {
      target: { value: " older/1 " },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Comparison request ID" }), {
      target: { value: "other/2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Compare IDs" }));
    expect(onPicksChange).toHaveBeenCalledWith(["older/1", "other/2"]);
    rerender(
      <DiffView picks={["older/1", "other/2"]} records={{}} onPicksChange={onPicksChange} />,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("need both a and b");
  });
});
