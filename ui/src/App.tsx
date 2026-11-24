import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useDashboard } from "./useDashboard";
import { DashboardHeader, type Crumb } from "./components/DashboardHeader";
import { RequestList } from "./components/RequestList";
import { SessionMetrics } from "./components/SessionMetrics";
import RequestDetail, { type RequestTab } from "./components/RequestDetail";
import TimelineView from "./components/TimelineView";
import DiffView from "./components/DiffView";
import SessionsView from "./components/SessionsView";
import { SessionUsage } from "./components/UsageView";
import { ViewTabs } from "./components/ViewTabs";
import type { CaptureAction, EntrySummary, RequestRecord } from "./types";
import { comparePick, previousRequest, visibleEntries } from "./lib/entries";
import { useTheme } from "./lib/theme";
import { SessionConfirm } from "./components/SessionActions";
import { sessionLabel } from "./lib/format";
import { openingTab, requestTabs } from "./lib/request";
import { requestLead } from "./lib/requestRow";
import { HOME, formatRoute, parentRoute, routeSession, useRoute, type Route } from "./lib/route";
import { modelsLabel } from "./lib/session";

/** Somewhere typing is expected, or a menu or dialog that owns the keyboard. */
const OWNS_KEYS = "input, textarea, select, [contenteditable], [role='menu'], [role='alertdialog']";
const NO_ENTRIES: EntrySummary[] = [];
const NO_RECORDS: Record<string, RequestRecord> = {};

export default function App() {
  const dashboard = useDashboard();
  const theme = useTheme();
  const [route, navigate] = useRoute();
  const [pickedRecord, setPickedRecord] = useState<RequestRecord | null>(null);
  // A pair that the address cannot name: a request of another session, or none yet.
  const [picksOverride, setPicksOverride] = useState<string[] | null>(null);
  const [pageEnd, setPageEnd] = useState<number | null>(null);
  const [focused, setFocused] = useState(false);
  // The tab the reader last chose. A request opens on it unless its address or
  // its outcome says otherwise.
  const [requestTab, setRequestTab] = useState<RequestTab>(
    route.view === "request" && route.tab ? route.tab : "overview",
  );
  const [deleting, setDeleting] = useState<string | null>(null);
  const [help, setHelp] = useState(false);

  const session = routeSession(route);
  const address = formatRoute(route);
  // What is loaded belongs to the session in the address only once it is selected.
  const current = !!session && dashboard.session === session;
  const entries = current ? dashboard.entries : NO_ENTRIES;
  const records = current ? dashboard.records : NO_RECORDS;
  const stats = current ? dashboard.stats : null;
  const loading = !!session && (!current || dashboard.loading);
  const sessionRoute = useCallback(
    (id: string): Route => ({ view: "session", session: id, tab: "replay" }),
    [],
  );

  // With no address, the place to be is the session being recorded, if there is one.
  const undecided = useRef(window.location.hash === "");
  useEffect(() => {
    if (!dashboard.ready || !undecided.current) return;
    undecided.current = false;
    if (dashboard.live && window.location.hash === "")
      navigate(sessionRoute(dashboard.live), { replace: true });
  }, [dashboard.ready, dashboard.live, navigate, sessionRoute]);

  // The address decides which session is read. One that no longer exists leads home.
  useEffect(() => {
    if (!dashboard.ready || !session) return;
    if (!dashboard.sessions.includes(session)) navigate(HOME, { replace: true });
    else if (dashboard.session !== session) void dashboard.selectSession(session);
  }, [
    dashboard.ready,
    dashboard.sessions,
    dashboard.session,
    dashboard.selectSession,
    session,
    navigate,
  ]);

  const models = useMemo(
    () =>
      [
        ...new Set([
          ...entries.map((entry) => entry.model).filter((model): model is string => !!model),
          ...(stats?.models || []),
        ]),
      ].sort(),
    [entries, stats?.models],
  );
  const isLive = !!session && dashboard.live === session;
  const seq = route.view === "request" || route.view === "compare" ? route.seq : null;
  const selectedEntry = seq == null ? undefined : entries.find((entry) => entry.seq === seq);
  const selected = selectedEntry?.id ?? null;
  const navigableEntries = useMemo(
    () => visibleEntries(entries, dashboard.modelFilter),
    [entries, dashboard.modelFilter],
  );
  const selectedIndex = navigableEntries.findIndex((entry) => entry.id === selected);
  const end = pageEnd == null ? entries.length : Math.min(pageEnd, entries.length);
  const start = Math.max(0, end - dashboard.recordLimit);
  const pageEntries = useMemo(() => entries.slice(start, end), [entries, start, end]);
  const pageIds = pageEntries.map((entry) => entry.id).join("|");

  useEffect(() => {
    setPickedRecord(null);
    setPageEnd(null);
  }, [dashboard.session, dashboard.sessionVersion]);
  useEffect(() => setPicksOverride(null), [address]);

  // A request that is not in the session (cleared, or never there) or that the
  // model filter hides has nothing to show: go up to the replay.
  const modelFilter = dashboard.modelFilter;
  useEffect(() => {
    if (seq == null || !session || loading) return;
    if (
      !selectedEntry ||
      (route.view === "request" && modelFilter !== "all" && selectedEntry.model !== modelFilter)
    )
      navigate(sessionRoute(session), { replace: true });
  }, [seq, session, loading, selectedEntry, route.view, modelFilter, navigate, sessionRoute]);

  useEffect(() => {
    if (!selected || !selectedEntry) return;
    let cancelled = false;
    setPickedRecord(null);
    void dashboard.loadRecord(selected, true).then((record) => {
      if (!cancelled) setPickedRecord(record);
    });
    return () => {
      cancelled = true;
    };
  }, [selected, selectedEntry, dashboard.loadRecord]);

  const replaying = route.view === "session" && route.tab === "replay";
  useEffect(() => {
    if (replaying && pageIds) void dashboard.loadRecords(pageIds.split("|"));
  }, [replaying, pageIds, dashboard.loadRecords]);

  // Each level loads its own numbers when it is opened.
  const home = route.view === "sessions";
  useEffect(() => {
    if (!home || !dashboard.ready) return;
    void dashboard.refreshUsage();
    void dashboard.refreshSessionIndex();
  }, [home, dashboard.ready, dashboard.refreshUsage, dashboard.refreshSessionIndex]);
  const sessionUsage = route.view === "session" && route.tab === "usage" && current;
  useEffect(() => {
    if (sessionUsage) void dashboard.refreshModelStats();
  }, [sessionUsage, dashboard.refreshModelStats]);

  const record = selected
    ? records[selected] || (pickedRecord?.id === selected ? pickedRecord : null)
    : null;

  const openRequest = useCallback(
    (id: string) => {
      const entry = entries.find((item) => item.id === id);
      if (entry && session) navigate({ view: "request", session, seq: entry.seq });
    },
    [entries, session, navigate],
  );

  // A request opens on the tab last used, or on its response when it failed.
  // Once it is open the address names the tab, so a reload shows the same one.
  const shownTab =
    route.view !== "request"
      ? undefined
      : (route.tab ??
        (record
          ? (() => {
              const wanted = openingTab(record, requestTab);
              return requestTabs(record).includes(wanted) ? wanted : "response";
            })()
          : undefined));
  useEffect(() => {
    if (route.view === "request" && !route.tab && shownTab)
      navigate({ ...route, tab: shownTab }, { replace: true });
  }, [route, shownTab, navigate]);

  // Compare is about the open request, B, and a baseline, A.
  const idOf = (wanted: number | undefined) =>
    wanted == null ? "" : (entries.find((entry) => entry.seq === wanted)?.id ?? "");
  const picks =
    route.view === "compare" ? (picksOverride ?? [idOf(route.base), selected ?? ""]) : [];
  const setPicks = (next: string[]) => {
    const [a, b] = next.map((id) => entries.find((entry) => entry.id === id));
    if (session && b && (a || !next[0])) {
      setPicksOverride(null);
      navigate({ view: "compare", session, seq: b.seq, base: a?.seq }, { replace: true });
    } else setPicksOverride(next);
  };
  // Comparing a request means comparing it with the one before: what it added.
  const compareWithPrevious = (id: string) => {
    const entry = entries.find((item) => item.id === id);
    if (!entry || !session) return;
    navigate({
      view: "compare",
      session,
      seq: entry.seq,
      base: previousRequest(entries, id)?.seq,
    });
  };
  const previousEntry = selected ? previousRequest(entries, selected) : undefined;
  const step = (offset: number) => {
    const next = navigableEntries[selectedIndex + offset];
    if (selectedIndex >= 0 && next && session)
      navigate({ view: "request", session, seq: next.seq });
  };
  const up = parentRoute(route);

  const capture = async (action: CaptureAction, target = session ?? undefined) => {
    const snapshot = await (action === "reset" || action === "delete"
      ? dashboard.changeCapture(action, target)
      : dashboard.changeCapture(action));
    // A new recording is the place to watch requests arrive.
    if (action === "start" && snapshot?.live) navigate(sessionRoute(snapshot.live));
  };

  // Keys that work wherever the focus is, as long as nothing is being typed.
  const onKey = useRef<(event: KeyboardEvent) => void>(() => {});
  onKey.current = (event) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    if ((event.target as Element | null)?.closest?.(OWNS_KEYS)) return;
    const open = route.view === "request";
    if (event.key === "?") setHelp(!help);
    else if (event.key === "Escape" && help) setHelp(false);
    // One level up: from Compare to its request, from a request to the replay.
    else if (event.key === "Escape" && up && route.view !== "session") navigate(up);
    else if (event.key === "[" && open) step(-1);
    else if (event.key === "]" && open) step(1);
    else if (event.key === "/") {
      // The search of what is being read, else the filter of the request list.
      const search =
        document.querySelector<HTMLInputElement>(".flow-search input") ??
        document.querySelector<HTMLInputElement>(".search-input");
      if (!search) return;
      search.focus();
    } else return;
    event.preventDefault();
  };
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKey.current(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  // The path from every session down to what is on screen.
  const crumbs: Crumb[] = [{ label: "Sessions", route: home ? undefined : HOME }];
  if (session) {
    crumbs.push({
      label: sessionLabel(session),
      detail: modelsLabel(models),
      name: models.length === 1,
      title: models.length > 1 ? `${session}\n${models.join("\n")}` : session,
      recording: isLive,
      route: route.view === "session" ? undefined : sessionRoute(session),
    });
    if (seq != null) {
      const lead = record ? requestLead(record) : null;
      crumbs.push({
        label: `Request #${seq}`,
        detail: lead ? (lead.kind === "tools" ? `→ ${lead.text}` : lead.text) : undefined,
        route: route.view === "compare" ? { view: "request", session, seq } : undefined,
      });
    }
    if (route.view === "compare")
      crumbs.push({ label: route.base != null ? `Compare with #${route.base}` : "Compare" });
  }
  const title =
    route.view === "sessions"
      ? route.tab === "usage"
        ? "Usage across every session"
        : "Sessions"
      : route.view === "session"
        ? `${route.tab === "usage" ? "Usage of session" : "Session"} ${sessionLabel(route.session)}`
        : route.view === "compare"
          ? `Compare request #${route.seq}`
          : `Request #${route.seq}`;
  useEffect(() => {
    document.title = `${title} · ccglass`;
  }, [title]);

  const sessionTabs = session && (
    <ViewTabs
      label="Views of this session"
      tabs={[
        [sessionRoute(session), "Replay"],
        [{ view: "session", session, tab: "usage" }, "Usage"],
      ]}
      current={route}
      navigate={navigate}
    />
  );

  return (
    <div className="shell">
      <a
        className="skip-link"
        href="#content"
        onClick={(event) => {
          // The hash is the place in the app, so the jump is made by hand.
          event.preventDefault();
          document.getElementById("content")?.focus();
        }}
      >
        Skip to the content
      </a>
      <main className="workspace">
        <DashboardHeader
          title={title}
          crumbs={crumbs}
          navigate={navigate}
          connection={dashboard.connection}
          theme={theme}
          help={{ open: help, onToggle: setHelp }}
          session={
            session && current
              ? { id: session, label: sessionLabel(session), requests: entries.length }
              : undefined
          }
          live={dashboard.live}
          controllable={dashboard.controllable}
          busy={dashboard.busy}
          onCapture={(action) => void capture(action)}
          onExport={() => void dashboard.exportSession(session)}
          focus={
            seq != null ? { active: focused, onToggle: () => setFocused(!focused) } : undefined
          }
        />
        <div className="workspace-content" id="content" tabIndex={-1}>
          {dashboard.error && (
            <div className="alert" role="alert">
              <span>{dashboard.error}</span>
              <button
                className="button button-ghost icon-button"
                aria-label="Dismiss error"
                onClick={dashboard.clearError}
              >
                <X size={12} />
              </button>
            </div>
          )}
          {route.view === "sessions" ? (
            <SessionsView
              tab={route.tab}
              navigate={navigate}
              sessions={dashboard.sessions}
              usage={dashboard.usage}
              index={dashboard.sessionIndex}
              loading={!dashboard.ready || (!dashboard.usage && !dashboard.error)}
              live={dashboard.live}
              controllable={dashboard.controllable}
              busy={dashboard.busy}
              onExportSession={(id) => void dashboard.exportSession(id)}
              onResetSession={(id) => void capture("reset", id)}
              onDeleteSession={(id) => void capture("delete", id)}
            />
          ) : route.view === "session" ? (
            // A session is read at full width: the replay is its list of requests.
            <div className="inspector-grid inspector-focused">
              <section className="detail-panel" aria-label="Session">
                {route.tab === "usage" ? (
                  <>
                    <header className="detail-header timeline-header view-header">
                      {sessionTabs}
                    </header>
                    <div className="panel-body">
                      <SessionUsage
                        stats={current ? dashboard.modelStats : null}
                        loading={!dashboard.error}
                      />
                    </div>
                  </>
                ) : (
                  <>
                    {entries.length > dashboard.recordLimit && (
                      <div className="timeline-toolbar">
                        <button
                          className="button button-sm"
                          disabled={start === 0}
                          onClick={() => setPageEnd(start)}
                        >
                          <ChevronLeft size={12} />
                          Earlier turns
                        </button>
                        <span>
                          Requests {start + 1}–{end} of {entries.length}
                        </span>
                        <button
                          className="button button-sm"
                          disabled={end === entries.length}
                          onClick={() => {
                            const next = Math.min(end + dashboard.recordLimit, entries.length);
                            setPageEnd(next === entries.length ? null : next);
                          }}
                        >
                          Later turns
                          <ChevronRight size={12} />
                        </button>
                      </div>
                    )}
                    <TimelineView
                      key={`${session}|${dashboard.sessionVersion}|${start}`}
                      entries={pageEntries}
                      records={records}
                      modelFilter={dashboard.modelFilter}
                      models={models}
                      onModel={dashboard.setModelFilter}
                      isLive={isLive && pageEnd == null}
                      loading={loading}
                      recordLimit={dashboard.recordLimit}
                      heading={sessionTabs}
                      facts={
                        <SessionMetrics
                          entries={entries}
                          stats={stats}
                          model={dashboard.modelFilter}
                        />
                      }
                      onOpen={openRequest}
                      onDelete={
                        dashboard.controllable && current && !isLive
                          ? () => setDeleting(session)
                          : undefined
                      }
                    />
                  </>
                )}
              </section>
            </div>
          ) : (
            <div className={`inspector-grid ${focused ? "inspector-focused" : ""}`}>
              {!focused && (
                <RequestList
                  key={`${session}|${dashboard.sessionVersion}`}
                  entries={entries}
                  records={records}
                  models={models}
                  model={dashboard.modelFilter}
                  selected={selected}
                  picks={picks}
                  comparing={route.view === "compare"}
                  isLive={isLive}
                  onModel={dashboard.setModelFilter}
                  onSelect={(id) =>
                    route.view === "compare"
                      ? setPicks(comparePick(entries, picks, id))
                      : openRequest(id)
                  }
                />
              )}
              <section
                className="detail-panel"
                aria-label={route.view === "compare" ? "Request comparison" : "Request detail"}
              >
                {route.view === "compare" ? (
                  <DiffView
                    key={`${session}|${dashboard.sessionVersion}`}
                    entries={entries}
                    records={records}
                    session={session}
                    selected={selected}
                    picks={picks}
                    onPicksChange={setPicks}
                    back={up ? { seq: route.seq, open: () => navigate(up) } : undefined}
                  />
                ) : record ? (
                  <RequestDetail
                    record={record}
                    activeTab={shownTab}
                    onTabChange={(tab) => {
                      setRequestTab(tab);
                      navigate({ ...route, tab }, { replace: true });
                    }}
                    comparePrevious={
                      previousEntry
                        ? { seq: previousEntry.seq, open: () => compareWithPrevious(record.id) }
                        : null
                    }
                    navigation={{
                      onReplay: () => up && navigate(up),
                      previous: selectedIndex > 0 ? () => step(-1) : undefined,
                      next:
                        selectedIndex >= 0 && selectedIndex < navigableEntries.length - 1
                          ? () => step(1)
                          : undefined,
                      position: selectedIndex + 1,
                      total: navigableEntries.length,
                    }}
                  />
                ) : (
                  <div className="empty-state">
                    <p>
                      {dashboard.error && selected
                        ? "This request could not be loaded."
                        : "Loading request…"}
                    </p>
                    {dashboard.error && selected && (
                      <button
                        className="button"
                        onClick={() => {
                          dashboard.clearError();
                          void dashboard.loadRecord(selected, true).then(setPickedRecord);
                        }}
                      >
                        Retry
                      </button>
                    )}
                  </div>
                )}
              </section>
            </div>
          )}
        </div>
      </main>
      {deleting && (
        <SessionConfirm
          action="delete"
          label={sessionLabel(deleting)}
          requests={deleting === dashboard.session ? dashboard.entries.length : null}
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            setDeleting(null);
            void capture("delete", deleting);
          }}
        />
      )}
    </div>
  );
}
