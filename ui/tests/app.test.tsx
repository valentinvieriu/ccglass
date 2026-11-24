import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import App from "../src/App";
import type { useDashboard } from "../src/useDashboard";
import type { EntrySummary } from "../src/types";

let dashboard: ReturnType<typeof useDashboard>;
vi.mock("../src/useDashboard", () => ({ useDashboard: () => dashboard }));
vi.mock("../src/api", () => ({ api: vi.fn() }));
const entries: EntrySummary[] = [1, 2].map((seq) => ({
  id: `s/${seq}`,
  session: "s",
  seq,
  ts: seq * 100_000,
  model: "test-model",
  status: 200,
}));

/** Puts the dashboard at an address, as a reload or a pasted link would. */
const at = (hash: string) =>
  window.history.replaceState(null, "", hash || window.location.pathname);
/** Moves to an address the way the Back button does. */
const go = (hash: string) =>
  act(() => {
    window.history.pushState(null, "", hash);
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
/** The request that is open, as its own header names it. */
const inspector = () => within(screen.getByRole("region", { name: "Request inspector" }));

beforeEach(() => {
  at("#/s/s");
  dashboard = {
    sessions: ["s"],
    ready: true,
    modelStats: null,
    sessionIndex: {},
    refreshModelStats: vi.fn().mockResolvedValue(undefined),
    refreshSessionIndex: vi.fn().mockResolvedValue(undefined),
    session: "s",
    live: "s",
    controllable: true,
    connection: "connected",
    entries,
    records: {},
    stats: null,
    usage: null,
    loading: false,
    busy: false,
    error: null,
    modelFilter: "all",
    recordLimit: 500,
    sessionVersion: 1,
    setModelFilter: vi.fn(),
    selectSession: vi.fn().mockResolvedValue(undefined),
    changeCapture: vi.fn().mockResolvedValue(undefined),
    exportSession: vi.fn().mockResolvedValue(undefined),
    refreshUsage: vi.fn().mockResolvedValue(undefined),
    loadRecord: vi.fn().mockResolvedValue({
      id: "s/1",
      seq: 1,
      request: { method: "POST", url: "/v1/messages", body: { model: "test-model" } },
    }),
    loadRecords: vi.fn().mockResolvedValue(undefined),
    clearError: vi.fn(),
  };
});

describe("dashboard integration", () => {
  it("hides the request list and navigates adjacent requests without losing the selected inspector tab", async () => {
    vi.mocked(dashboard.loadRecord).mockImplementation(async (id) => ({
      id,
      seq: Number(id.split("/")[1]),
      request: { method: "POST", url: "/v1/messages", body: { model: "test-model" } },
    }));
    at("#/s/s/r/1");
    const { container } = render(<App />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Next request" })).toBeEnabled());
    fireEvent.click(screen.getByRole("tab", { name: "HTTP" }));
    fireEvent.click(screen.getByRole("button", { name: "Hide request list" }));
    expect(container.querySelector(".request-panel")).toBeNull();
    // The top bar stays: it is where the list comes back from.
    expect(screen.getByRole("navigation", { name: "You are here" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "HTTP" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: "Previous request" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Next request" }));
    await waitFor(() => expect(dashboard.loadRecord).toHaveBeenCalledWith("s/2", true));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Previous request" })).toBeEnabled(),
    );
    expect(screen.getByRole("tab", { name: "HTTP" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: "Next request" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Show request list" }));
    expect(container.querySelector(".request-panel")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Back to the replay" }));
    expect(screen.queryByRole("button", { name: "Copy cURL" })).not.toBeInTheDocument();
    // A session is read at full width: the replay is its list of requests.
    expect(container.querySelector(".request-panel")).toBeNull();
    expect(screen.getByRole("region", { name: "Replay" })).toBeInTheDocument();
  });
  it("opens a full request and exposes all export formats", async () => {
    at("#/s/s/r/1");
    render(<App />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Copy cURL" })).toBeInTheDocument(),
    );
    expect(dashboard.loadRecord).toHaveBeenCalledWith("s/1", true);
    for (const format of ["raw", "md", "json", "har"]) {
      expect(document.querySelector(`a[href$="format=${format}"]`)).toHaveAttribute(
        "href",
        `/api/export?id=s%2F1&format=${format}`,
      );
    }
  });

  it("exports the full session without passing a UI filter and confirms reset", () => {
    dashboard.modelFilter = "test-model";
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Export session" }));
    expect(dashboard.exportSession).toHaveBeenCalledWith("s");
    // Clearing is a labelled menu item with its own confirmation, not an icon.
    expect(screen.queryByRole("button", { name: "Reset session" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Session actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Clear requests…/ }));
    const dialog = screen.getByRole("alertdialog", { name: "Clear 2 requests from this session?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(dashboard.changeCapture).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Session actions" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Session actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Clear requests…/ }));
    fireEvent.click(screen.getByRole("button", { name: "Clear requests" }));
    expect(dashboard.changeCapture).toHaveBeenCalledWith("reset", "s");
  });

  it("keeps replay and exports available in read-only mode", () => {
    dashboard.controllable = false;
    dashboard.live = null;
    render(<App />);
    expect(screen.queryByRole("button", { name: "Session actions" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start recording" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Stop recording" })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Recording" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Replay" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export session" })).toBeInTheDocument();
    expect(screen.getByText("Read-only")).toBeInTheDocument();
  });

  it("clears an open inspector after the same session is reset in another tab", async () => {
    at("#/s/s/r/1");
    const { rerender } = render(<App />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Copy cURL" })).toBeInTheDocument(),
    );
    dashboard = { ...dashboard, entries: [], records: {}, sessionVersion: 2 };
    rerender(<App />);
    expect(screen.queryByRole("button", { name: "Copy cURL" })).not.toBeInTheDocument();
    expect(screen.getByText("Recording. Nothing has come through yet")).toBeInTheDocument();
    // The request is gone, so its address is too.
    expect(window.location.hash).toBe("#/s/s");
  });

  it("states whether requests are being saved, apart from the session being read", () => {
    const { rerender } = render(<App />);
    const recording = () => within(screen.getByRole("group", { name: "Recording" }));
    expect(recording().getByRole("status")).toHaveTextContent("Recording");
    fireEvent.click(recording().getByRole("button", { name: "Stop recording" }));
    expect(dashboard.changeCapture).toHaveBeenCalledWith("stop");
    // Stopped: the proxy still forwards traffic, and says that it keeps none of it.
    dashboard = { ...dashboard, live: null };
    rerender(<App />);
    expect(recording().getByRole("status")).toHaveTextContent("Not saving requests");
    fireEvent.click(recording().getByRole("button", { name: "Start recording" }));
    expect(dashboard.changeCapture).toHaveBeenCalledWith("start");
    // A saved session that turned out empty can be deleted from where it is read.
    dashboard = { ...dashboard, entries: [], sessionVersion: 2 };
    rerender(<App />);
    expect(screen.getByText("This saved session is empty")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete session…" }));
    fireEvent.click(
      within(screen.getByRole("alertdialog", { name: "Delete this session?" })).getByRole(
        "button",
        {
          name: "Delete session",
        },
      ),
    );
    expect(dashboard.changeCapture).toHaveBeenCalledWith("delete", "s");
  });

  it("opens a failed request on its response, and remembers a tab picked on it", async () => {
    vi.mocked(dashboard.loadRecord).mockImplementation(async (id) => ({
      id,
      seq: Number(id.split("/")[1]),
      latencyMs: 8850,
      request: { method: "POST", url: "/v1/messages", body: { model: "test-model" } },
      response: id === "s/2" ? { error: "socket hang up" } : { status: 200 },
    }));
    at("#/s/s/r/1");
    render(<App />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Next request" })).toBeEnabled());
    fireEvent.click(screen.getByRole("tab", { name: /messages/ }));
    expect(window.location.hash).toBe("#/s/s/r/1/messages");
    fireEvent.click(screen.getByRole("button", { name: "Next request" }));
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "response" })).toHaveAttribute(
        "aria-selected",
        "true",
      ),
    );
    // The address names the tab the request opened on, so a reload shows it again.
    expect(window.location.hash).toBe("#/s/s/r/2/response");
    // The outcome is on every tab, and the sentence says what happened instead of "0 tokens".
    const outcome = within(screen.getByLabelText("Request outcome"));
    expect(outcome.getByText("Failed")).toBeInTheDocument();
    expect(outcome.getByText("socket hang up")).toBeInTheDocument();
    expect(screen.getByText("Failed after 8.85s · socket hang up")).toBeInTheDocument();
    expect(screen.queryByText(/first token/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "HTTP" }));
    expect(outcome.getByText("Failed")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Previous request" }));
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "HTTP" })).toHaveAttribute("aria-selected", "true"),
    );
  });

  it("keeps the session's totals in the replay header and off a request", async () => {
    dashboard.stats = {
      session: "s",
      models: ["test-model"],
      model: "all",
      completed: 2,
      total: 2,
      totalInput: 1_056_742,
      totalOutput: 4_512,
      cacheHitRate: 0.97,
    };
    render(<App />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/^Session /);
    expect(screen.getByLabelText("Session statistics")).toHaveTextContent(
      "2 requests1.06M tokens in (97% cached)4.51k tokens out",
    );
    go("#/s/s/r/1");
    await waitFor(() => expect(screen.getByLabelText("Request outcome")).toBeInTheDocument());
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Request #1");
    expect(screen.queryByLabelText("Session statistics")).not.toBeInTheDocument();
  });

  it("opens a cancelled request like any other and says it was cancelled on every tab", async () => {
    vi.mocked(dashboard.loadRecord).mockImplementation(async (id) => ({
      id,
      seq: Number(id.split("/")[1]),
      latencyMs: 8850,
      request: { method: "POST", url: "/v1/messages", body: { model: "test-model" } },
      response: id === "s/2" ? { error: "client disconnected" } : { status: 200 },
    }));
    dashboard.entries = [entries[0], { ...entries[1], status: null, error: "client disconnected" }];
    at("#/s/s/r/1");
    render(<App />);
    expect(screen.getByRole("button", { name: "Failed requests (0)" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Next request" })).toBeEnabled());
    fireEvent.click(screen.getByRole("tab", { name: /messages/ }));
    fireEvent.click(screen.getByRole("button", { name: "Next request" }));
    expect(await screen.findByText("Cancelled")).toHaveClass("badge-warning");
    expect(screen.getByRole("tab", { name: /messages/ })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("tab", { name: "response" }));
    expect(
      screen.getByText(
        "Cancelled after 8.85s · the client closed the connection before the response finished",
      ),
    ).toHaveClass("resp-cancelled");
    expect(screen.queryByText("Response error")).not.toBeInTheDocument();
  });

  it("compares a request with the one before it, picks B from the list and goes back", async () => {
    const { api } = await import("../src/api");
    vi.mocked(api).mockImplementation(async (path: string) =>
      path.startsWith("/api/requests")
        ? { entries: dashboard.entries }
        : {
            added: [],
            removed: [],
            common: [],
            counts: { added: 0, removed: 0, common: 0, cachedInB: 0 },
          },
    );
    vi.mocked(dashboard.loadRecord).mockImplementation(async (id) => ({
      id,
      seq: Number(id.split("/")[1]),
      request: { method: "POST", url: "/v1/messages", body: { model: "test-model" } },
    }));
    dashboard.entries = [1, 2, 3].map((seq) => ({
      ...entries[0],
      id: `s/${seq}`,
      seq,
      nMessages: seq,
    }));
    at("#/s/s/r/1");
    render(<App />);
    // The first request has nothing before it.
    expect(
      await screen.findByRole("button", { name: "Compare with the previous request" }),
    ).toBeDisabled();
    fireEvent.keyDown(document.body, { key: "]" });
    fireEvent.keyDown(document.body, { key: "]" });
    fireEvent.click(
      await screen.findByRole("button", { name: "Compare with the previous request, #2" }),
    );
    expect(screen.getByRole("combobox", { name: "A · baseline" })).toHaveValue("s/2");
    expect(screen.getByRole("combobox", { name: "B · comparison" })).toHaveValue("s/3");
    // Compare belongs to the request it is about, and its address says both.
    expect(window.location.hash).toBe("#/s/s/r/3/compare/2");
    expect(screen.getByRole("navigation", { name: "You are here" })).toHaveTextContent(
      /Sessions.*Request #3.*Compare with #2/,
    );
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith("/api/diff?a=s%2F2&b=s%2F3", expect.anything()),
    );
    // A click in the list replaces B; the baseline stays.
    fireEvent.click(screen.getByRole("button", { name: /test-model.*#1/s }));
    expect(screen.getByRole("combobox", { name: "A · baseline" })).toHaveValue("s/2");
    expect(screen.getByRole("combobox", { name: "B · comparison" })).toHaveValue("s/1");
    expect(screen.getByRole("button", { name: /test-model.*#2/s })).toHaveTextContent(/^A/);
    expect(screen.getByRole("button", { name: /test-model.*#1/s })).toHaveTextContent(/^B/);
    expect(window.location.hash).toBe("#/s/s/r/1/compare/2");
    // Escape goes up to the request that is being compared.
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(await screen.findByRole("region", { name: "Request inspector" })).toHaveTextContent(
      "Request #1",
    );
    expect(screen.getByRole("tab", { name: "overview" })).toBeInTheDocument();
  });

  it("steps through requests, goes back and opens the help from the keyboard", async () => {
    vi.mocked(dashboard.loadRecord).mockImplementation(async (id) => ({
      id,
      seq: Number(id.split("/")[1]),
      request: { method: "POST", url: "/v1/messages", body: { model: "test-model" } },
    }));
    render(<App />);
    const open = () =>
      screen.queryByRole("region", { name: "Request inspector" })
        ? inspector().queryByText(/^Request #\d$/)?.textContent
        : undefined;
    // Nothing is open yet, so there is no next request to step to.
    fireEvent.keyDown(document.body, { key: "]" });
    expect(open()).toBeUndefined();
    go("#/s/s/r/1");
    await waitFor(() => expect(open()).toBe("Request #1"));
    fireEvent.keyDown(document.body, { key: "]" });
    await waitFor(() => expect(open()).toBe("Request #2"));
    fireEvent.keyDown(document.body, { key: "]" });
    expect(open()).toBe("Request #2");
    fireEvent.keyDown(document.body, { key: "[" });
    await waitFor(() => expect(open()).toBe("Request #1"));
    // Typing a bracket into a field is not navigation.
    fireEvent.keyDown(screen.getByLabelText(/^Filter requests by/), { key: "]" });
    expect(open()).toBe("Request #1");
    fireEvent.keyDown(document.body, { key: "?" });
    const help = screen.getByRole("dialog", { name: "Keyboard shortcuts" });
    expect(within(help).getByText("Previous and next request")).toBeInTheDocument();
    expect(within(help).getByLabelText("How to read the request strip")).toHaveTextContent(
      "A prompt starts here",
    );
    // Escape closes the help first, then goes back to the replay.
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Keyboard shortcuts" })).not.toBeInTheDocument();
    expect(open()).toBe("Request #1");
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(open()).toBeUndefined();
    expect(screen.getByRole("region", { name: "Replay" })).toBeInTheDocument();
    expect(window.location.hash).toBe("#/s/s");
    // At a session, Escape does not leave it.
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(window.location.hash).toBe("#/s/s");
    // The slash goes to the search of what is being read.
    fireEvent.keyDown(document.body, { key: "/" });
    expect(screen.getByLabelText("Find in this session")).toHaveFocus();
  });

  it("makes every older turn replayable beyond the 500-request cache window", async () => {
    dashboard.entries = Array.from({ length: 501 }, (_, index) => ({
      ...entries[0],
      seq: index + 1,
      id: `s/${index + 1}`,
      ts: (index + 1) * 100_000,
    }));
    render(<App />);
    expect(dashboard.loadRecords).toHaveBeenLastCalledWith(
      dashboard.entries.slice(1).map((entry) => entry.id),
    );
    fireEvent.click(screen.getByText("Earlier turns"));
    await waitFor(() => expect(dashboard.loadRecords).toHaveBeenLastCalledWith(["s/1"]));
    expect(screen.getByText("Later turns")).toBeEnabled();
    fireEvent.click(screen.getByText("Later turns"));
    await waitFor(() =>
      expect(dashboard.loadRecords).toHaveBeenLastCalledWith(
        dashboard.entries.slice(1).map((entry) => entry.id),
      ),
    );
  });

  it("starts on the list of sessions, or on the session being recorded when there is one", async () => {
    at("");
    dashboard = { ...dashboard, sessions: ["s", "older"], live: null, session: null, entries: [] };
    const { unmount } = render(<App />);
    expect(screen.getByRole("region", { name: "Sessions" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Sessions");
    expect(dashboard.refreshUsage).toHaveBeenCalled();
    expect(dashboard.refreshSessionIndex).toHaveBeenCalled();
    // Nothing is loaded until a session is opened.
    expect(dashboard.selectSession).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("link", { name: /^older/ }));
    expect(window.location.hash).toBe("#/s/older");
    expect(dashboard.selectSession).toHaveBeenCalledWith("older");
    unmount();
    at("");
    dashboard = { ...dashboard, live: "s", session: "s", entries };
    render(<App />);
    expect(window.location.hash).toBe("#/s/s");
    expect(screen.getByRole("region", { name: "Replay" })).toBeInTheDocument();
  });

  it("keeps the place across a reload and moves inside the app with Back", async () => {
    vi.mocked(dashboard.loadRecord).mockImplementation(async (id) => ({
      id,
      seq: Number(id.split("/")[1]),
      request: { method: "POST", url: "/v1/messages", body: { model: "test-model" } },
    }));
    at("#/s/s/r/2/http");
    const { unmount } = render(<App />);
    expect(await screen.findByRole("region", { name: "Request inspector" })).toHaveTextContent(
      "Request #2",
    );
    expect(screen.getByRole("tab", { name: "HTTP" })).toHaveAttribute("aria-selected", "true");
    const path = within(screen.getByRole("navigation", { name: "You are here" }));
    expect(path.getByText("Request #2").closest("[aria-current]")).not.toBeNull();
    // A reload starts from the same address.
    unmount();
    render(<App />);
    expect(await screen.findByRole("region", { name: "Request inspector" })).toHaveTextContent(
      "Request #2",
    );
    expect(screen.getByRole("tab", { name: "HTTP" })).toHaveAttribute("aria-selected", "true");
    // Going up adds to the history, so Back returns to the request.
    fireEvent.click(
      within(screen.getByRole("navigation", { name: "You are here" })).getByRole("link", {
        name: "s test-model",
      }),
    );
    expect(window.location.hash).toBe("#/s/s");
    go("#/s/s/r/2/http");
    expect(await screen.findByRole("region", { name: "Request inspector" })).toHaveTextContent(
      "Request #2",
    );
    // The views of a session are links too.
    go("#/s/s");
    fireEvent.click(screen.getByRole("link", { name: "Usage" }));
    expect(window.location.hash).toBe("#/s/s/usage");
    expect(dashboard.refreshModelStats).toHaveBeenCalled();
  });

  it("leads an address that no longer exists to somewhere that does", async () => {
    at("#/s/deleted/r/4/messages");
    const { unmount } = render(<App />);
    expect(window.location.hash).toBe("#/");
    expect(screen.getByRole("region", { name: "Sessions" })).toBeInTheDocument();
    unmount();
    // A request that is not in the session leads to the session.
    at("#/s/s/r/99");
    render(<App />);
    expect(window.location.hash).toBe("#/s/s");
  });

  it("opens the new session when recording starts", async () => {
    const snapshot = { sessions: ["new", "s"], live: "new", controllable: true };
    vi.mocked(dashboard.changeCapture).mockResolvedValue(snapshot);
    dashboard = { ...dashboard, ...snapshot, live: null };
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Start recording" }));
    await waitFor(() => expect(window.location.hash).toBe("#/s/new"));
    expect(dashboard.selectSession).toHaveBeenCalledWith("new");
  });
});
