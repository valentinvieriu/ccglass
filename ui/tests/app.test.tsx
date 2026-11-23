import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";
import type { useDashboard } from "../src/useDashboard";
import type { EntrySummary } from "../src/types";

let dashboard: ReturnType<typeof useDashboard>;
vi.mock("../src/useDashboard", () => ({ useDashboard: () => dashboard }));
const entries: EntrySummary[] = [1, 2].map((seq) => ({
  id: `s/${seq}`,
  session: "s",
  seq,
  ts: seq * 100_000,
  model: "test-model",
  status: 200,
}));

beforeEach(() => {
  dashboard = {
    sessions: ["s"],
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
  it("focuses the payload and navigates adjacent requests without losing the selected inspector tab", async () => {
    vi.mocked(dashboard.loadRecord).mockImplementation(async (id) => ({
      id,
      seq: Number(id.split("/")[1]),
      request: { method: "POST", url: "/v1/messages", body: { model: "test-model" } },
    }));
    const { container } = render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /test-model.*#1/s }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Next request" })).toBeEnabled());
    fireEvent.click(screen.getByRole("tab", { name: "HTTP" }));
    fireEvent.click(screen.getByRole("button", { name: "Focus payload" }));
    expect(container.querySelector(".metrics-grid")).toBeNull();
    expect(container.querySelector(".request-panel")).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Dashboard views" })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "HTTP" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: "Previous request" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Next request" }));
    await waitFor(() => expect(dashboard.loadRecord).toHaveBeenCalledWith("s/2", true));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Previous request" })).toBeEnabled(),
    );
    expect(screen.getByRole("tab", { name: "HTTP" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: "Next request" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Show panels" }));
    expect(container.querySelector(".metrics-grid")).not.toBeNull();
    expect(container.querySelector(".request-panel")).not.toBeNull();
    expect(screen.getByRole("navigation", { name: "Dashboard views" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back to session replay" }));
    expect(screen.queryByRole("button", { name: "Copy cURL" })).not.toBeInTheDocument();
  });
  it("opens a full request and exposes all export formats", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /test-model.*#1/s }));
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
    fireEvent.click(screen.getAllByRole("button", { name: "Export session" })[0]);
    expect(dashboard.exportSession).toHaveBeenCalledWith();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(screen.getByRole("button", { name: "Reset session" }));
    expect(dashboard.changeCapture).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Reset session" }));
    expect(dashboard.changeCapture).toHaveBeenCalledWith("reset");
  });

  it("keeps replay and exports available in read-only mode", () => {
    dashboard.controllable = false;
    dashboard.live = null;
    render(<App />);
    expect(screen.queryByRole("button", { name: "Reset session" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start session" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Stop session" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Session replay" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Export session" })).toHaveLength(2);
  });

  it("clears an open inspector after the same session is reset in another tab", async () => {
    const { rerender } = render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /test-model.*#1/s }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Copy cURL" })).toBeInTheDocument(),
    );
    dashboard = { ...dashboard, entries: [], records: {}, sessionVersion: 2 };
    rerender(<App />);
    expect(screen.queryByRole("button", { name: "Copy cURL" })).not.toBeInTheDocument();
    expect(screen.getByText("No requests yet")).toBeInTheDocument();
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
});
