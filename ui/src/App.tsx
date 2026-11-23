import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowLeftRight,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  LockKeyhole,
  Terminal,
  X,
} from "lucide-react";
import { useDashboard } from "./useDashboard";
import { DashboardHeader } from "./components/DashboardHeader";
import { RequestList } from "./components/RequestList";
import { SessionMetrics } from "./components/SessionMetrics";
import RequestDetail, { type RequestTab } from "./components/RequestDetail";
import TimelineView from "./components/TimelineView";
import DiffView from "./components/DiffView";
import SummaryView from "./components/SummaryView";
import type { RequestRecord } from "./types";
import { visibleEntries } from "./lib/entries";
import { useTheme } from "./lib/theme";
import { ThemeToggle } from "./components/ThemeToggle";

type View = "requests" | "diff" | "summary";

export default function App() {
  const dashboard = useDashboard();
  const theme = useTheme();
  const [view, setView] = useState<View>("requests");
  const [selected, setSelected] = useState<string | null>(null);
  const [pickedRecord, setPickedRecord] = useState<RequestRecord | null>(null);
  const [picks, setPicks] = useState<string[]>([]);
  const [pageEnd, setPageEnd] = useState<number | null>(null);
  const [focused, setFocused] = useState(false);
  const [requestTab, setRequestTab] = useState<RequestTab>("overview");
  const models = useMemo(
    () =>
      [
        ...new Set([
          ...dashboard.entries
            .map((entry) => entry.model)
            .filter((model): model is string => !!model),
          ...(dashboard.stats?.models || []),
        ]),
      ].sort(),
    [dashboard.entries, dashboard.stats?.models],
  );
  const isLive = !!dashboard.live && dashboard.live === dashboard.session;
  const selectedEntry = dashboard.entries.find(
    (entry) => entry.id === selected,
  );
  const navigableEntries = useMemo(
    () => visibleEntries(dashboard.entries, dashboard.modelFilter),
    [dashboard.entries, dashboard.modelFilter],
  );
  const selectedIndex = navigableEntries.findIndex(
    (entry) => entry.id === selected,
  );
  const end =
    pageEnd == null
      ? dashboard.entries.length
      : Math.min(pageEnd, dashboard.entries.length);
  const start = Math.max(0, end - dashboard.recordLimit);
  const pageEntries = useMemo(
    () => dashboard.entries.slice(start, end),
    [dashboard.entries, start, end],
  );
  const pageIds = pageEntries.map((entry) => entry.id).join("|");

  useEffect(() => {
    setSelected(null);
    setPickedRecord(null);
    setPicks([]);
    setPageEnd(null);
  }, [dashboard.session, dashboard.sessionVersion]);

  useEffect(() => {
    if (
      selected &&
      (!selectedEntry ||
        (dashboard.modelFilter !== "all" &&
          selectedEntry.model !== dashboard.modelFilter))
    ) {
      setSelected(null);
      setPickedRecord(null);
    }
  }, [selected, selectedEntry, dashboard.modelFilter]);

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

  useEffect(() => {
    if (view === "requests" && selected == null && pageIds)
      void dashboard.loadRecords(pageIds.split("|"));
  }, [view, selected, pageIds, dashboard.loadRecords]);

  const navigate = useCallback(
    (next: View) => {
      setView(next);
      if (next === "summary") void dashboard.refreshUsage();
      if (next === "requests") setSelected(null);
    },
    [dashboard.refreshUsage],
  );

  const openRequest = useCallback(
    (id: string | null) => {
      if (view === "diff" && id) {
        setPicks((previous) =>
          previous.includes(id)
            ? previous.filter((item) => item !== id)
            : [...previous, id].slice(-2),
        );
      } else {
        setView("requests");
        setSelected(id);
      }
    },
    [view],
  );

  const focusMode = focused && view !== "summary";
  const title =
    view === "summary"
      ? "Usage summary"
      : view === "diff"
        ? "Compare requests"
        : dashboard.modelFilter === "all"
          ? "Requests"
          : dashboard.modelFilter;
  const record = selected
    ? dashboard.records[selected] ||
      (pickedRecord?.id === selected ? pickedRecord : null)
    : null;
  return (
    <div className={`shell ${focusMode ? "shell-focused" : ""}`}>
      {/* Focus mode is for reading one payload: navigation steps aside too. */}
      {!focusMode && (
        <aside className="sidebar">
          <div className="sidebar-brand">
            <span className="brand-icon">
              <Terminal size={20} />
            </span>
            <span>ccglass</span>
          </div>
          <p className="brand-subtitle">Agent observability</p>
          <nav aria-label="Dashboard views">
            <button
              className="nav-item"
              aria-label="Request inspector"
              aria-current={view === "requests" ? "page" : undefined}
              onClick={() => navigate("requests")}
            >
              <Activity size={16} />
              <span>Requests</span>
              <span className="nav-count">{dashboard.entries.length}</span>
            </button>
            <button
              className="nav-item"
              aria-label="Compare requests"
              aria-current={view === "diff" ? "page" : undefined}
              onClick={() => navigate("diff")}
            >
              <ArrowLeftRight size={16} />
              <span>Compare</span>
            </button>
            <button
              className="nav-item"
              aria-label="Usage summary"
              aria-current={view === "summary" ? "page" : undefined}
              onClick={() => navigate("summary")}
            >
              <BarChart3 size={16} />
              <span>Summary</span>
            </button>
          </nav>
          <div className="sidebar-divider" />
          <div className="sidebar-note">
            <LockKeyhole size={14} />
            <span>Captures stay on this machine.</span>
          </div>
          <div className="sidebar-footer">
            <ThemeToggle value={theme.preference} onChange={theme.choose} />
            <strong className="flex items-center gap-2">
              <span
                className={`status-dot ${dashboard.connection === "connected" ? "status-ok" : "status-wait"}`}
              />
              {dashboard.connection === "connected"
                ? "Connected to proxy"
                : dashboard.connection === "connecting"
                  ? "Connecting…"
                  : "Reconnecting…"}
            </strong>
          </div>
        </aside>
      )}
      <main className="workspace">
        <DashboardHeader
          title={title}
          sessions={dashboard.sessions}
          session={dashboard.session}
          live={dashboard.live}
          controllable={dashboard.controllable}
          busy={dashboard.busy}
          onSelect={(session) => void dashboard.selectSession(session)}
          onCapture={(action) => void dashboard.changeCapture(action)}
          onExport={() => void dashboard.exportSession()}
          status={{
            live: isLive,
            label: dashboard.loading
              ? "Loading session"
              : isLive
                ? "Recording"
                : !dashboard.controllable
                  ? "Read-only"
                  : dashboard.live
                    ? "Saved session"
                    : "Capture stopped",
          }}
          focus={
            view !== "summary"
              ? { active: focused, onToggle: () => setFocused(!focused) }
              : undefined
          }
        />
        <div className="workspace-content">
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
          {view !== "summary" && !focused && (
            <SessionMetrics
              entries={dashboard.entries}
              stats={dashboard.stats}
              model={dashboard.modelFilter}
            />
          )}
          {view === "summary" ? (
            <SummaryView
              usage={dashboard.usage}
              loading={!dashboard.usage && !dashboard.error}
              live={dashboard.live}
              controllable={dashboard.controllable}
              busy={dashboard.busy}
              onOpenSession={(session) => {
                setView("requests");
                setSelected(null);
                void dashboard.selectSession(session);
              }}
              onExportSession={(session) =>
                void dashboard.exportSession(session)
              }
              onResetSession={(session) =>
                void dashboard.changeCapture("reset", session)
              }
              onDeleteSession={(session) =>
                void dashboard.changeCapture("delete", session)
              }
            />
          ) : (
            <div
              className={`inspector-grid ${focused ? "inspector-focused" : ""}`}
            >
              {!focused && (
                <RequestList
                  key={`${dashboard.session}|${dashboard.sessionVersion}`}
                  entries={dashboard.entries}
                  models={models}
                  model={dashboard.modelFilter}
                  selected={selected}
                  picks={view === "diff" ? picks : []}
                  isLive={isLive}
                  onModel={dashboard.setModelFilter}
                  onSelect={openRequest}
                />
              )}
              <section
                className="detail-panel"
                aria-label={
                  view === "diff" ? "Request comparison" : "Request detail"
                }
              >
                {view === "diff" ? (
                  <DiffView
                    key={`${dashboard.session}|${dashboard.sessionVersion}`}
                    entries={dashboard.entries}
                    records={dashboard.records}
                    session={dashboard.session}
                    selected={selected}
                    picks={picks}
                    onPicksChange={setPicks}
                  />
                ) : selected ? (
                  record ? (
                    <RequestDetail
                      record={record}
                      activeTab={requestTab}
                      onTabChange={setRequestTab}
                      navigation={{
                        onReplay: () => setSelected(null),
                        previous:
                          selectedIndex > 0
                            ? () =>
                                setSelected(
                                  navigableEntries[selectedIndex - 1].id,
                                )
                            : undefined,
                        next:
                          selectedIndex >= 0 &&
                          selectedIndex < navigableEntries.length - 1
                            ? () =>
                                setSelected(
                                  navigableEntries[selectedIndex + 1].id,
                                )
                            : undefined,
                        position: selectedIndex + 1,
                        total: navigableEntries.length,
                      }}
                    />
                  ) : (
                    <div className="empty-state">
                      <p>
                        {dashboard.error
                          ? "This request could not be loaded."
                          : "Loading request…"}
                      </p>
                      {dashboard.error && (
                        <button
                          className="button"
                          onClick={() => {
                            dashboard.clearError();
                            void dashboard
                              .loadRecord(selected, true)
                              .then(setPickedRecord);
                          }}
                        >
                          Retry
                        </button>
                      )}
                    </div>
                  )
                ) : (
                  <>
                    {dashboard.entries.length > dashboard.recordLimit && (
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
                          Requests {start + 1}–{end} of{" "}
                          {dashboard.entries.length}
                        </span>
                        <button
                          className="button button-sm"
                          disabled={end === dashboard.entries.length}
                          onClick={() => {
                            const next = Math.min(
                              end + dashboard.recordLimit,
                              dashboard.entries.length,
                            );
                            setPageEnd(
                              next === dashboard.entries.length ? null : next,
                            );
                          }}
                        >
                          Later turns
                          <ChevronRight size={12} />
                        </button>
                      </div>
                    )}
                    <TimelineView
                      key={`${dashboard.session}|${dashboard.sessionVersion}|${start}`}
                      entries={pageEntries}
                      records={dashboard.records}
                      modelFilter={dashboard.modelFilter}
                      isLive={isLive && pageEnd == null}
                      loading={dashboard.loading}
                      recordLimit={dashboard.recordLimit}
                      onOpen={(id) => {
                        setSelected(id);
                      }}
                      onExport={() => void dashboard.exportSession()}
                    />
                  </>
                )}
              </section>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
