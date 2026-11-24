import { useCallback, useEffect, useRef, useState } from "react";
import { api, downloadSession } from "./api";
import { mergeEntries } from "./lib/entries";
import { firstConversation, sessionIdentity, type SessionIdentity } from "./lib/session";
import type {
  CaptureAction,
  EntrySummary,
  RequestRecord,
  SessionsSnapshot,
  SessionStats,
  UsageSummary,
} from "./types";

export const RECORD_LIMIT = 500;
type Connection = "connecting" | "connected" | "reconnecting";
interface DashboardData {
  sessions: string[];
  live: string | null;
  controllable: boolean;
  connection: Connection;
  /** The list of sessions has arrived, so an address can be checked against it. */
  ready: boolean;
  session: string | null;
  entries: EntrySummary[];
  records: Record<string, RequestRecord>;
  stats: SessionStats | null;
  /** The selected session's totals, overall first and then one row per model. */
  modelStats: SessionStats[] | null;
  usage: UsageSummary | null;
  /** What tells sessions apart in a list: models, failures, the first prompt. */
  sessionIndex: Record<string, SessionIdentity>;
  loading: boolean;
  busy: boolean;
  error: string | null;
}
const INITIAL: DashboardData = {
  sessions: [],
  live: null,
  controllable: false,
  connection: "connecting",
  ready: false,
  session: null,
  entries: [],
  records: {},
  stats: null,
  modelStats: null,
  usage: null,
  sessionIndex: {},
  loading: true,
  busy: false,
  error: null,
};
const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function useDashboard() {
  const [data, setData] = useState<DashboardData>(INITIAL);
  const [modelFilter, setModel] = useState("all");
  const mounted = useRef(false);
  const current = useRef(data);
  current.current = data;
  const epoch = useRef(0);
  const sessionRef = useRef<string | null>(null);
  const modelRef = useRef("all");
  const overlay = useRef(new Map<string, EntrySummary>());
  const entriesRef = useRef<EntrySummary[]>([]);
  const cache = useRef(new Map<string, RequestRecord>());
  const pinned = useRef(new Set<string>());
  const recordsTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const revisions = useRef(new Map<string, number>());
  const inflight = useRef(new Map<string, Promise<RequestRecord | null>>());
  const controllers = useRef(new Set<AbortController>());
  const statsVersion = useRef(0);
  const usageVersion = useRef(0);
  const usageRequested = useRef(false);
  const usageNames = useRef(false);
  const known = useRef<{ sessions: string[]; live: string | null }>({ sessions: [], live: null });
  const indexCache = useRef(new Map<string, SessionIdentity>());
  const indexRequested = useRef(false);
  const indexRun = useRef(0);
  const modelStatsRequested = useRef(false);
  const modelStatsVersion = useRef(0);
  const mutationBusy = useRef(false);
  const patch = useCallback((value: Partial<DashboardData>) => {
    if (mounted.current) setData((prev) => ({ ...prev, ...value }));
  }, []);
  const report = useCallback(
    (error: unknown) => {
      if (!(error instanceof Error && error.name === "AbortError"))
        patch({ error: errorMessage(error) });
    },
    [patch],
  );

  const refreshStats = useCallback(async () => {
    const session = sessionRef.current;
    if (!session) return;
    const generation = epoch.current;
    const version = ++statsVersion.current;
    const query = new URLSearchParams({ session, model: modelRef.current });
    const controller = new AbortController();
    controllers.current.add(controller);
    try {
      const stats = await api<SessionStats>(`/api/session-stats?${query}`, {
        signal: controller.signal,
      });
      if (mounted.current && generation === epoch.current && version === statsVersion.current)
        patch({ stats });
    } catch (error) {
      if (generation === epoch.current) report(error);
    } finally {
      controllers.current.delete(controller);
    }
  }, [patch, report]);

  const refreshUsage = useCallback(
    async (names = usageNames.current) => {
      usageRequested.current = true;
      usageNames.current = names;
      const version = ++usageVersion.current;
      try {
        const usage = await api<UsageSummary>(`/api/usage${names ? "?names=1" : ""}`);
        if (mounted.current && version === usageVersion.current) patch({ usage });
      } catch (error) {
        if (version === usageVersion.current) report(error);
      }
    },
    [patch, report],
  );

  // The Usage tab of a session: its totals, then each model on its own.
  const refreshModelStats = useCallback(async () => {
    const session = sessionRef.current;
    if (!session) return;
    modelStatsRequested.current = true;
    const generation = epoch.current;
    const version = ++modelStatsVersion.current;
    const stats = (model: string) =>
      api<SessionStats>(`/api/session-stats?${new URLSearchParams({ session, model })}`);
    try {
      const all = await stats("all");
      const rows = [all, ...(await Promise.all((all.models || []).map(stats)))];
      if (mounted.current && generation === epoch.current && version === modelStatsVersion.current)
        patch({ modelStats: rows });
    } catch (error) {
      if (generation === epoch.current) report(error);
    }
  }, [patch, report]);

  // Describes each session for the list of them. A saved session does not
  // change, so it is read once; the one being recorded is read again.
  const refreshSessionIndex = useCallback(async () => {
    indexRequested.current = true;
    const run = ++indexRun.current;
    const { sessions, live } = known.current;
    for (const id of [...indexCache.current.keys()])
      if (!sessions.includes(id)) indexCache.current.delete(id);
    const wanted = sessions.filter((id) => id === live || !indexCache.current.has(id));
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(4, wanted.length) }, async () => {
        while (next < wanted.length && run === indexRun.current && mounted.current) {
          const session = wanted[next++];
          try {
            const { entries } = await api<{ entries: EntrySummary[] }>(
              `/api/requests?${new URLSearchParams({ session })}`,
            );
            const first = firstConversation(entries);
            const record = first
              ? await api<RequestRecord>(`/api/request/${encodeURIComponent(first.id)}`)
              : null;
            if (!mounted.current || !known.current.sessions.includes(session)) continue;
            indexCache.current.set(session, sessionIdentity(entries, record));
            patch({ sessionIndex: Object.fromEntries(indexCache.current) });
          } catch {
            /* A session without its description is still listed and still opens. */
          }
        }
      }),
    );
  }, [patch]);

  const loadRecord = useCallback(
    async (id: string, force = false): Promise<RequestRecord | null> => {
      const generation = epoch.current;
      if (!force && cache.current.has(id)) return cache.current.get(id)!;
      if (force) revisions.current.set(id, (revisions.current.get(id) || 0) + 1);
      const revision = revisions.current.get(id) || 0;
      const key = `${generation}|${id}|${revision}`;
      const existing = inflight.current.get(key);
      if (existing) return existing;
      const controller = new AbortController();
      controllers.current.add(controller);
      const request = (async () => {
        try {
          const record = await api<RequestRecord>(`/api/request/${encodeURIComponent(id)}`, {
            signal: controller.signal,
          });
          if (
            !mounted.current ||
            generation !== epoch.current ||
            revision !== (revisions.current.get(id) || 0)
          )
            return null;
          cache.current.delete(id);
          cache.current.set(id, record);
          while (cache.current.size > RECORD_LIMIT) {
            const evict =
              [...cache.current.keys()].find((key) => !pinned.current.has(key)) ||
              cache.current.keys().next().value!;
            cache.current.delete(evict);
          }
          if (recordsTimer.current == null)
            recordsTimer.current = setTimeout(() => {
              recordsTimer.current = undefined;
              patch({ records: Object.fromEntries(cache.current) });
            }, 16);
          return record;
        } catch (error) {
          if (generation === epoch.current) report(error);
          return null;
        } finally {
          controllers.current.delete(controller);
          inflight.current.delete(key);
        }
      })();
      inflight.current.set(key, request);
      return request;
    },
    [patch, report],
  );

  const loadRecords = useCallback(
    async (ids: string[]) => {
      const generation = epoch.current;
      pinned.current = new Set(ids.slice(-RECORD_LIMIT));
      let index = 0;
      await Promise.all(
        Array.from({ length: Math.min(4, ids.length) }, async () => {
          while (index < ids.length && generation === epoch.current) await loadRecord(ids[index++]);
        }),
      );
    },
    [loadRecord],
  );

  const selectSession = useCallback(
    async (session: string | null) => {
      const generation = ++epoch.current;
      for (const controller of controllers.current) controller.abort();
      controllers.current.clear();
      cache.current.clear();
      pinned.current.clear();
      clearTimeout(recordsTimer.current);
      recordsTimer.current = undefined;
      revisions.current.clear();
      overlay.current.clear();
      entriesRef.current = [];
      sessionRef.current = session;
      modelRef.current = "all";
      setModel("all");
      modelStatsRequested.current = false;
      modelStatsVersion.current++;
      patch({
        session,
        entries: [],
        records: {},
        stats: null,
        modelStats: null,
        loading: !!session,
        error: null,
      });
      if (!session) return;
      const controller = new AbortController();
      controllers.current.add(controller);
      try {
        const [snapshot] = await Promise.all([
          api<{ entries: EntrySummary[] }>(`/api/requests?${new URLSearchParams({ session })}`, {
            signal: controller.signal,
          }),
          refreshStats(),
        ]);
        if (!mounted.current || generation !== epoch.current) return;
        const entries = mergeEntries(snapshot.entries, overlay.current.values());
        entriesRef.current = entries;
        patch({ entries, loading: false });
        // Inspect the latest records immediately; older requests remain selectable.
        await loadRecords(entries.slice(-RECORD_LIMIT).map((entry) => entry.id));
      } catch (error) {
        if (generation === epoch.current) report(error);
      } finally {
        controllers.current.delete(controller);
        if (generation === epoch.current) patch({ loading: false });
      }
    },
    [loadRecords, patch, refreshStats, report],
  );

  const applySessions = useCallback(
    (snapshot: SessionsSnapshot) => {
      // Which session is read is decided by the address, not here: a session
      // stays selected while it exists and nothing takes its place when it goes.
      const previous = sessionRef.current;
      const session = previous && snapshot.sessions.includes(previous) ? previous : null;
      known.current = { sessions: snapshot.sessions, live: snapshot.live };
      if (snapshot.reset) indexCache.current.delete(snapshot.reset);
      patch({
        sessions: snapshot.sessions,
        live: snapshot.live,
        controllable: snapshot.controllable,
        ready: true,
        loading: session ? current.current.loading : false,
      });
      if (previous !== session || (snapshot.reset && snapshot.reset === session))
        void selectSession(session);
    },
    [patch, selectSession],
  );

  useEffect(() => {
    mounted.current = true;
    let eventSnapshot = false;
    let snapshotVersion = 0;
    let previouslyConnected = false;
    let disposed = false;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const initial = new AbortController();
    const stream = new EventSource("/api/stream");
    stream.onopen = () => {
      patch({ connection: "connected" });
      if (previouslyConnected) {
        const version = snapshotVersion;
        void api<SessionsSnapshot>("/api/sessions", { signal: initial.signal })
          .then((snapshot) => {
            if (disposed || version !== snapshotVersion) return;
            applySessions(snapshot);
            if (sessionRef.current && snapshot.sessions.includes(sessionRef.current))
              void selectSession(sessionRef.current);
          })
          .catch(report);
      }
      previouslyConnected = true;
    };
    stream.onerror = () => patch({ connection: "reconnecting" });
    stream.addEventListener("sessions", (event) => {
      try {
        eventSnapshot = true;
        snapshotVersion++;
        applySessions(JSON.parse((event as MessageEvent).data));
        if (usageRequested.current) void refreshUsage();
        if (indexRequested.current) void refreshSessionIndex();
      } catch (error) {
        report(error);
      }
    });
    stream.onmessage = (event) => {
      try {
        const entry: EntrySummary = JSON.parse(event.data);
        if (entry.session === sessionRef.current) {
          overlay.current.set(entry.id, entry);
          entriesRef.current = mergeEntries(entriesRef.current, [entry]);
          patch({ entries: entriesRef.current });
          void loadRecord(entry.id, true);
        }
        if (!entry.pending) {
          clearTimeout(refreshTimer);
          clearTimeout(recordsTimer.current);
          recordsTimer.current = undefined;
          refreshTimer = setTimeout(() => {
            void refreshStats();
            if (usageRequested.current) void refreshUsage();
            if (modelStatsRequested.current) void refreshModelStats();
            if (indexRequested.current) void refreshSessionIndex();
          }, 180);
        }
      } catch (error) {
        report(error);
      }
    };
    void api<SessionsSnapshot>("/api/sessions", { signal: initial.signal })
      .then((snapshot) => {
        if (!disposed && !eventSnapshot) applySessions(snapshot);
      })
      .catch(report);
    return () => {
      disposed = true;
      mounted.current = false;
      epoch.current++;
      usageVersion.current++;
      initial.abort();
      stream.close();
      clearTimeout(refreshTimer);
      for (const controller of controllers.current) controller.abort();
      controllers.current.clear();
      sessionRef.current = null;
    };
  }, [
    applySessions,
    loadRecord,
    patch,
    refreshModelStats,
    refreshSessionIndex,
    refreshStats,
    refreshUsage,
    report,
    selectSession,
  ]);

  const setModelFilter = useCallback(
    (model: string) => {
      modelRef.current = model;
      setModel(model);
      void refreshStats();
    },
    [refreshStats],
  );
  const changeCapture = useCallback(
    async (
      action: CaptureAction,
      session = sessionRef.current,
    ): Promise<SessionsSnapshot | undefined> => {
      if (mutationBusy.current) return undefined;
      if (!current.current.controllable) {
        patch({ error: "Capture controls are unavailable in read-only mode." });
        return undefined;
      }
      if (action === "delete" && session === current.current.live) {
        patch({ error: "Stop this session before deleting it." });
        return undefined;
      }
      if (["reset", "delete"].includes(action) && !session) {
        patch({ error: "Select a session first." });
        return undefined;
      }
      mutationBusy.current = true;
      patch({ busy: true, error: null });
      try {
        const query = ["reset", "delete"].includes(action)
          ? `?${new URLSearchParams({ session: session! })}`
          : "";
        const snapshot = await api<SessionsSnapshot>(`/api/sessions/${action}${query}`, {
          method: "POST",
        });
        if (!mounted.current) return undefined;
        if (action === "reset") indexCache.current.delete(session!);
        applySessions(snapshot);
        if (action === "reset" && session === sessionRef.current) await selectSession(session);
        if (indexRequested.current) void refreshSessionIndex();
        if (usageRequested.current) await refreshUsage();
        // The caller decides where to go: a new recording is opened by its address.
        return snapshot;
      } catch (error) {
        report(error);
        return undefined;
      } finally {
        mutationBusy.current = false;
        patch({ busy: false });
      }
    },
    [applySessions, patch, refreshSessionIndex, refreshUsage, report, selectSession],
  );
  const exportSession = useCallback(
    async (session = sessionRef.current) => {
      patch({ error: null });
      try {
        if (!session) throw new Error("Select a session to export.");
        await downloadSession(session);
      } catch (error) {
        report(error);
      }
    },
    [patch, report],
  );
  const clearError = useCallback(() => patch({ error: null }), [patch]);
  return {
    ...data,
    modelFilter,
    setModelFilter,
    selectSession,
    changeCapture,
    exportSession,
    refreshUsage,
    refreshModelStats,
    refreshSessionIndex,
    loadRecord,
    loadRecords,
    clearError,
    recordLimit: RECORD_LIMIT,
    sessionVersion: epoch.current,
  };
}
