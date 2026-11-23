import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SummaryView from "../src/components/SummaryView";
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
  onOpenSession: vi.fn(),
  onExportSession: vi.fn(),
  onResetSession: vi.fn(),
  onDeleteSession: vi.fn(),
});
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

describe("summary token rollups and session controls", () => {
  it("shows cache and model totals without inventing monetary data, and preserves optional cost when present", () => {
    const { rerender } = render(
      <SummaryView usage={usage} controllable={false} live={null} {...callbacks()} />,
    );
    expect(screen.getByText("Total input tokens")).toBeInTheDocument();
    expect(screen.getByText("500")).toBeInTheDocument();
    expect(screen.getByRole("meter", { name: "Cache hit rate for local-model" })).toHaveValue(0.6);
    expect(screen.queryByText(/estimated cost/i)).not.toBeInTheDocument();
    rerender(
      <SummaryView
        usage={{
          ...usage,
          totals: { ...bucket, usd: 0.125 },
          byModel: [{ ...bucket, usd: 0.125, model: "local-model" }],
        }}
        controllable={false}
        live={null}
        {...callbacks()}
      />,
    );
    expect(screen.getByText("Total estimated cost")).toBeInTheDocument();
    expect(screen.getAllByText("$0.1250")).toHaveLength(2);
  });

  it("confirms saved-session mutations, allows cancellation, and blocks deletion while recording", () => {
    const actions = callbacks();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<SummaryView usage={usage} controllable live="live" {...actions} />);
    fireEvent.click(screen.getByRole("tab", { name: "By timestamp" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset session saved" }));
    expect(confirm).toHaveBeenLastCalledWith(
      expect.stringContaining("Clear all requests in session saved"),
    );
    expect(actions.onResetSession).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Reset session saved" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete session saved" }));
    expect(actions.onResetSession).toHaveBeenCalledWith("saved");
    expect(actions.onDeleteSession).toHaveBeenCalledWith("saved");
    expect(confirm).toHaveBeenLastCalledWith(
      expect.stringContaining("Permanently delete session saved"),
    );
    expect(screen.getByRole("button", { name: "Delete session live" })).toBeDisabled();
    expect(api).not.toHaveBeenCalled();
  });

  it("fetches names only when visible and leaves inspection/export available in read-only mode", async () => {
    vi.mocked(api).mockResolvedValue(usage);
    const actions = callbacks();
    render(<SummaryView usage={usage} controllable={false} live={null} {...actions} />);
    expect(api).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("tab", { name: "By session" }));
    await waitFor(() => expect(api).toHaveBeenCalledWith("/api/usage?names=1", expect.anything()));
    expect(screen.getByText("Saved title")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Show session names" }));
    expect(screen.queryByRole("columnheader", { name: "Session name" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Reset session/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Delete session/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open session saved" }));
    fireEvent.click(screen.getByRole("button", { name: "Export session saved" }));
    expect(actions.onOpenSession).toHaveBeenCalledWith("saved");
    expect(actions.onExportSession).toHaveBeenCalledWith("saved");
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
    expect(within(baseline).getByRole("option", { name: /saved\/1/ })).toBeInTheDocument();
    expect(screen.getByText("removed content")).toBeInTheDocument();
    fireEvent.click(screen.getByText("1 unchanged context blocks"));
    expect(screen.getByText("shared content")).toBeVisible();
    expect(screen.getByText("Cached in B").parentElement).toHaveTextContent("2");
    expect(container.querySelector("script")).toBeNull();
    fireEvent.change(baseline, { target: { value: "saved/1" } });
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith("/api/diff?a=saved%2F1&b=saved%2F3", expect.anything()),
    );
    fireEvent.click(screen.getByRole("button", { name: "Swap baseline and comparison" }));
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith("/api/diff?a=saved%2F3&b=saved%2F1", expect.anything()),
    );
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
