import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
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

/** Starts the hook and opens a session, as the address of the page does. */
async function opened(id = "s") {
  const hook = renderHook(useDashboard);
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  // Knowing the sessions is not reading one: that waits for an address.
  expect(hook.result.current.session).toBeNull();
  act(() => void hook.result.current.selectSession(id));
  await waitFor(() => expect(hook.result.current.session).toBe(id));
  return hook;
}

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
    const { result, unmount } = await opened();
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
    const { result } = await opened();
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
    const { result } = await opened();
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
    const { result } = await opened();
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
    const { result } = await opened();
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
    const { result } = await opened();
    await act(async () => {
      await result.current.changeCapture("stop");
    });
    expect(result.current.error).toBe("Capture failed");
    expect(result.current.busy).toBe(false);
    expect(result.current.live).toBe("s");
  });
  it("returns the new session when recording starts and leaves opening it to the caller", async () => {
    const started: SessionsSnapshot = { sessions: ["new", "s"], live: "new", controllable: true };
    mockApi((path) =>
      path === "/api/sessions"
        ? { ...session, live: null }
        : path.startsWith("/api/sessions/start")
          ? started
          : path.startsWith("/api/requests?")
            ? { entries: [entry] }
            : stats,
    );
    const { result } = await opened();
    let snapshot: SessionsSnapshot | undefined;
    await act(async () => {
      snapshot = await result.current.changeCapture("start");
    });
    expect(snapshot).toEqual(started);
    expect(result.current.live).toBe("new");
    expect(result.current.session).toBe("s");
  });
  it("describes each session once, and the one being recorded again", async () => {
    const calls: string[] = [];
    const listed = (id: string): EntrySummary[] => [
      { id: `${id}/1`, session: id, seq: 1, ts: 1, method: "GET", url: "/v1/models" },
      { id: `${id}/2`, session: id, seq: 2, ts: 2, model: "big", nMessages: 1, status: 500 },
    ];
    mockApi((path) => {
      calls.push(path);
      if (path === "/api/sessions")
        return { sessions: ["live", "old"], live: "live", controllable: true };
      if (path.startsWith("/api/requests?session=")) return { entries: listed(path.split("=")[1]) };
      if (path.startsWith("/api/request/"))
        return {
          id: decodeURIComponent(path.slice("/api/request/".length)),
          model: "big",
          request: { body: { model: "big" } },
          parsed: {
            view: {
              system: [],
              tools: [],
              messages: [{ role: "user", type: "text", text: "first words" }],
            },
          },
        };
      return stats;
    });
    const { result } = renderHook(useDashboard);
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => {
      await result.current.refreshSessionIndex();
    });
    expect(result.current.sessionIndex.old).toEqual({
      requests: 2,
      models: ["big"],
      failed: 1,
      cancelled: 0,
      prompt: "first words",
    });
    // The first request that carries a conversation is the one that is read.
    expect(calls).toContain("/api/request/old%2F2");
    calls.length = 0;
    await act(async () => {
      await result.current.refreshSessionIndex();
    });
    expect(calls.filter((path) => path.startsWith("/api/requests?"))).toEqual([
      "/api/requests?session=live",
    ]);
    // A session that is gone is no longer described.
    act(() => FakeStream.latest.sessions({ sessions: ["live"], live: "live", controllable: true }));
    await waitFor(() => expect(Object.keys(result.current.sessionIndex)).toEqual(["live"]));
  });
  it("loads a session's usage overall and for each model", async () => {
    mockApi((path) => {
      if (path === "/api/sessions") return session;
      if (path.startsWith("/api/requests?")) return { entries: [entry] };
      const model = new URLSearchParams(path.split("?")[1]).get("model") ?? "all";
      return { ...stats, models: ["big", "small"], model, total: model === "all" ? 5 : 2 };
    });
    const { result } = await opened();
    expect(result.current.modelStats).toBeNull();
    await act(async () => {
      await result.current.refreshModelStats();
    });
    expect(result.current.modelStats?.map((row) => [row.model, row.total])).toEqual([
      ["all", 5],
      ["big", 2],
      ["small", 2],
    ]);
    // Another session starts without the previous one's numbers.
    act(() => void result.current.selectSession(null));
    expect(result.current.modelStats).toBeNull();
  });
});
