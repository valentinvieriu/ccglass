import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDashboard } from "../src/useDashboard";
import type { EntrySummary, RequestRecord, SessionsSnapshot } from "../src/types";

class FakeStream {
  static latest: FakeStream;
  onopen?: () => void;
  onerror?: () => void;
  onmessage?: (event: { data: string }) => void;
  listeners = new Map<string, (event: { data: string }) => void>();
  closed = false;
  constructor() {
    FakeStream.latest = this;
  }
  addEventListener(name: string, callback: (event: { data: string }) => void) {
    this.listeners.set(name, callback);
  }
  close() {
    this.closed = true;
  }
  sessions(snapshot: SessionsSnapshot) {
    this.listeners.get("sessions")?.({ data: JSON.stringify(snapshot) });
  }
  entry(entry: EntrySummary) {
    this.onmessage?.({ data: JSON.stringify(entry) });
  }
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const session: SessionsSnapshot = { sessions: ["s"], live: "s", controllable: true };
const entry: EntrySummary = { id: "s/1", session: "s", seq: 1, ts: 1, pending: true };
const stats = {
  session: "s",
  models: [],
  model: "all",
  completed: 0,
  total: 0,
  totalInput: 0,
  totalOutput: 0,
  cacheHitRate: 0,
  totalUsd: 0,
};
function mockApi(handler: (path: string) => unknown | Promise<unknown>) {
  vi.stubGlobal("EventSource", FakeStream);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) => ({ ok: true, json: async () => handler(path) })),
  );
}
afterEach(() => vi.unstubAllGlobals());

describe("dashboard live state", () => {
  it("keeps updates received while the initial snapshot is loading", async () => {
    const snapshot = deferred<{ entries: EntrySummary[] }>();
    mockApi((path) =>
      path === "/api/sessions"
        ? session
        : path.startsWith("/api/requests?")
          ? snapshot.promise
          : path.startsWith("/api/session-stats?")
            ? stats
            : { id: "s/1", seq: 1 },
    );
    const { result, unmount } = renderHook(useDashboard);
    await waitFor(() => expect(result.current.session).toBe("s"));
    const completed = { ...entry, pending: false, status: 200 };
    const second = { ...entry, id: "s/2", seq: 2 };
    act(() => {
      FakeStream.latest.entry(completed);
      FakeStream.latest.entry(second);
    });
    await act(async () => {
      snapshot.resolve({ entries: [entry] });
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.entries).toEqual([completed, second]);
    const stream = FakeStream.latest;
    unmount();
    expect(stream.closed).toBe(true);
  });
  it("drops a late record response after the selected session is reset", async () => {
    const record = deferred<RequestRecord>();
    let lists = 0;
    mockApi((path) => {
      if (path === "/api/sessions") return session;
      if (path.startsWith("/api/requests?")) return { entries: lists++ === 0 ? [entry] : [] };
      if (path.startsWith("/api/session-stats?")) return stats;
      return record.promise;
    });
    const { result } = renderHook(useDashboard);
    await waitFor(() => expect(result.current.entries).toHaveLength(1));
    act(() => FakeStream.latest.sessions({ ...session, reset: "s" }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      record.resolve({ id: "s/1", seq: 1, request: { body: { model: "old" } } });
    });
    expect(result.current.entries).toEqual([]);
    expect(result.current.records).toEqual({});
  });
  it("clears a deleted last session and never restores an old in-flight record", async () => {
    const record = deferred<RequestRecord>();
    mockApi((path) =>
      path === "/api/sessions"
        ? session
        : path.startsWith("/api/requests?")
          ? { entries: [entry] }
          : path.startsWith("/api/session-stats?")
            ? stats
            : record.promise,
    );
    const { result } = renderHook(useDashboard);
    await waitFor(() => expect(result.current.entries).toHaveLength(1));
    act(() => FakeStream.latest.sessions({ sessions: [], live: null, controllable: true }));
    await act(async () => {
      record.resolve({ id: "s/1", seq: 1 });
    });
    expect(result.current.session).toBeNull();
    expect(result.current.entries).toEqual([]);
    expect(result.current.records).toEqual({});
  });
  it("rejects a stale pending fetch after a newer completion has arrived", async () => {
    const pending = deferred<RequestRecord>();
    const completed = deferred<RequestRecord>();
    let records = 0;
    mockApi((path) => {
      if (path === "/api/sessions") return session;
      if (path.startsWith("/api/requests?")) return { entries: [] };
      if (path.startsWith("/api/session-stats?")) return stats;
      return records++ === 0 ? pending.promise : completed.promise;
    });
    const { result } = renderHook(useDashboard);
    await waitFor(() => expect(result.current.session).toBe("s"));
    act(() => FakeStream.latest.entry(entry));
    act(() => FakeStream.latest.entry({ ...entry, pending: false, status: 200 }));
    await act(async () => {
      completed.resolve({ id: "s/1", seq: 1, response: { status: 200 } });
    });
    await act(async () => {
      pending.resolve({ id: "s/1", seq: 1, response: null });
    });
    await waitFor(() => expect(result.current.records["s/1"]?.response?.status).toBe(200));
  });
  it("keeps a replay request selectable when a new capture starts in another tab", async () => {
    mockApi((path) =>
      path === "/api/sessions"
        ? session
        : path.startsWith("/api/requests?")
          ? { entries: [entry] }
          : path.startsWith("/api/session-stats?")
            ? stats
            : { id: "s/1", seq: 1 },
    );
    const { result } = renderHook(useDashboard);
    await waitFor(() => expect(result.current.entries).toHaveLength(1));
    act(() =>
      FakeStream.latest.sessions({ sessions: ["new", "s"], live: "new", controllable: true }),
    );
    expect(result.current.session).toBe("s");
    expect(result.current.live).toBe("new");
    expect(result.current.entries).toHaveLength(1);
  });
  it("surfaces capture errors and restores the controls", async () => {
    mockApi((path) =>
      path === "/api/sessions"
        ? session
        : path.startsWith("/api/sessions/stop")
          ? { error: "Capture failed" }
          : path.startsWith("/api/requests?")
            ? { entries: [] }
            : stats,
    );
    const { result } = renderHook(useDashboard);
    await waitFor(() => expect(result.current.session).toBe("s"));
    await act(async () => {
      await result.current.changeCapture("stop");
    });
    expect(result.current.error).toBe("Capture failed");
    expect(result.current.busy).toBe(false);
    expect(result.current.live).toBe("s");
  });
});
