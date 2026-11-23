import { useEffect, useState } from "react";
import {
  BarChart3,
  Download,
  Layers3,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { api } from "../api";
import type { UsageBucket, UsageSession, UsageSummary } from "../types";
import { fmt, fmtCost, pct } from "../lib/format";
import { MetricCard } from "./RequestDetail";

type SummaryTab = "model" | "session";
export interface SummaryViewProps {
  usage: UsageSummary | null;
  loading?: boolean;
  controllable: boolean;
  live: string | null;
  busy?: boolean;
  /** Set false only when the action callbacks already ask for confirmation. */
  confirmDestructiveActions?: boolean;
  onOpenSession: (session: string) => void;
  onExportSession: (session: string) => void;
  onResetSession: (session: string) => void;
  onDeleteSession: (session: string) => void;
}

function dateLabel(timestamp: string | null | undefined) {
  if (!timestamp) return "—";
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? timestamp : date.toLocaleString();
}

function cacheHitRate(bucket: UsageBucket) {
  const total =
    bucket.totalInput ?? (bucket.input || 0) + (bucket.cacheRead || 0) + (bucket.cacheWrite || 0);
  const rate = bucket.cacheHitRate ?? (total > 0 ? (bucket.cacheRead || 0) / total : 0);
  return Number.isFinite(rate) ? Math.max(0, Math.min(1, rate)) : 0;
}

const hasCost = (bucket: UsageBucket) =>
  typeof bucket.usd === "number" && Number.isFinite(bucket.usd);
const costLabel = (bucket: UsageBucket) => (hasCost(bucket) ? fmtCost(bucket.usd) : "—");

function SessionTable({
  rows,
  showNames,
  showCost,
  live,
  controllable,
  busy,
  confirmDestructiveActions = true,
  onOpenSession,
  onExportSession,
  onResetSession,
  onDeleteSession,
}: Omit<SummaryViewProps, "usage" | "loading"> & {
  rows: UsageSession[];
  showNames: boolean;
  showCost: boolean;
}) {
  function mutate(action: "reset" | "delete", session: string) {
    if (!controllable || busy || (action === "delete" && session === live)) return;
    const message =
      action === "reset"
        ? `Clear all requests in session ${session}? Other sessions will be kept. This cannot be undone.`
        : `Permanently delete session ${session} and all its requests? Other sessions will be kept. This cannot be undone.`;
    if (confirmDestructiveActions && !window.confirm(message)) return;
    (action === "reset" ? onResetSession : onDeleteSession)(session);
  }

  if (!rows.length) return <div className="empty-state">No sessions available.</div>;
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">Session</th>
            <th scope="col" className="text-right!">
              Requests
            </th>
            <th scope="col" className="text-right!">
              Input
            </th>
            <th scope="col" className="text-right!">
              Output
            </th>
            <th scope="col" className="text-right!">
              Cache read
            </th>
            <th scope="col" className="text-right!">
              Cache write
            </th>
            <th scope="col" className="text-right!">
              Cache hit
            </th>
            {showCost && (
              <th scope="col" className="text-right!">
                Estimated cost
              </th>
            )}
            <th scope="col" className="text-right!">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const recording = row.session === live;
            // The id already encodes the capture time, so one readable label
            // plus the id identifies a session; a name replaces the date.
            const label = (showNames && row.name) || (row.from && dateLabel(row.from)) || row.session;
            return (
              <tr key={row.session}>
                <td>
                  <button
                    type="button"
                    className="session-cell"
                    onClick={() => onOpenSession(row.session)}
                    aria-label={`Open session ${row.session}`}
                    title="Open this session in the request inspector"
                  >
                    <span className="session-cell-title">
                      <span>{label}</span>
                      {recording && <span className="badge badge-success">Recording</span>}
                    </span>
                    {label !== row.session && (
                      <span className="session-cell-id mono">{row.session}</span>
                    )}
                  </button>
                </td>
                <td className="text-right tabular-nums">{fmt(row.entries ?? row.requests)}</td>
                <td className="text-right tabular-nums">{fmt(row.input)}</td>
                <td className="text-right tabular-nums">{fmt(row.output)}</td>
                <td className="text-right tabular-nums">{fmt(row.cacheRead)}</td>
                <td className="text-right tabular-nums">{fmt(row.cacheWrite)}</td>
                <td className="tabular-nums">
                  <div className="flex justify-end items-center gap-2">
                    <meter
                      className="w-10"
                      min={0}
                      max={1}
                      value={cacheHitRate(row)}
                      aria-label={`Cache hit rate for session ${row.session}`}
                    />
                    {pct(cacheHitRate(row))}
                  </div>
                </td>
                {showCost && <td className="text-right tabular-nums">{costLabel(row)}</td>}
                <td>
                  <div className="row-actions">
                    <button
                      type="button"
                      className="button button-ghost button-sm icon-button"
                      onClick={() => onExportSession(row.session)}
                      disabled={busy}
                      aria-label={`Export session ${row.session}`}
                      title="Export this session"
                    >
                      <Download size={13} />
                    </button>
                    {controllable && (
                      <>
                        <button
                          type="button"
                          className="button button-ghost button-sm icon-button"
                          onClick={() => mutate("reset", row.session)}
                          disabled={busy}
                          aria-label={`Reset session ${row.session}`}
                          title="Clear this session's requests"
                        >
                          <RotateCcw size={13} />
                        </button>
                        <button
                          type="button"
                          className="button button-ghost button-sm icon-button row-action-danger"
                          onClick={() => mutate("delete", row.session)}
                          disabled={busy || recording}
                          aria-label={`Delete session ${row.session}`}
                          title={
                            recording
                              ? "Stop this session before deleting it"
                              : "Delete this saved session"
                          }
                        >
                          <Trash2 size={13} />
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Resolving names scans local agent transcripts, so the choice is remembered:
// turning it off once keeps the session table from ever triggering the lookup.
const NAMES_KEY = "ccglass-session-names";
function storedShowNames() {
  try {
    return localStorage.getItem(NAMES_KEY) !== "0";
  } catch {
    return true;
  }
}

export default function SummaryView(props: SummaryViewProps) {
  const { usage, loading, controllable } = props;
  const [tab, setTab] = useState<SummaryTab>("model");
  const [showNames, setShowNamesState] = useState(storedShowNames);
  const setShowNames = (value: boolean) => {
    setShowNamesState(value);
    try {
      localStorage.setItem(NAMES_KEY, value ? "1" : "0");
    } catch {
      /* storage unavailable: the choice lasts for this page only */
    }
  };
  const [names, setNames] = useState<Record<string, string>>({});
  const [namesError, setNamesError] = useState<string | null>(null);
  const [namesLoading, setNamesLoading] = useState(false);

  useEffect(() => {
    if (tab !== "session" || !showNames || !usage?.sessionCount) {
      setNamesLoading(false);
      return;
    }
    const controller = new AbortController();
    setNamesError(null);
    setNamesLoading(true);
    api<UsageSummary>("/api/usage?names=1", { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted)
          setNames(
            Object.fromEntries(
              result.bySession
                .filter((row) => row.name)
                .map((row) => [row.session, row.name as string]),
            ),
          );
      })
      .catch((reason) => {
        if (!controller.signal.aborted)
          setNamesError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (!controller.signal.aborted) setNamesLoading(false);
      });
    return () => controller.abort();
  }, [tab, showNames, usage]);

  const summaryTabs: [SummaryTab, string][] = [
    ["model", "By model"],
    ["session", "By session"],
  ];
  const modelCost = usage?.byModel.some(hasCost) ?? false;
  const sessionCost = usage?.bySession.some(hasCost) ?? false;
  return (
    <section className="summary-view" aria-label="Usage summary" aria-busy={loading || undefined}>
      <div className="summary-header">
        <p>
          Tokens and cache efficiency across every captured session
          {usage?.range?.from
            ? ` · ${dateLabel(usage.range.from)} — ${dateLabel(usage.range.to)}`
            : "."}
        </p>
        {usage && (
          <span className="badge">
            <Layers3 size={13} />
            {fmt(usage.sessionCount)} sessions
          </span>
        )}
      </div>
      {loading && !usage ? (
        <div role="status" className="empty-state">
          Loading usage summary…
        </div>
      ) : !usage ? (
        <div className="empty-state">
          <BarChart3 size={32} />
          <h3>No usage summary available</h3>
        </div>
      ) : usage.error ? (
        <div role="alert" className="alert m-5">
          Could not load usage: {usage.error}
        </div>
      ) : !usage.sessionCount ? (
        <div className="empty-state">
          <Layers3 size={32} />
          <h3>Your sessions will appear here</h3>
          <p>Start recording to see aggregate token usage.</p>
        </div>
      ) : (
        <div className="p-5">
          <div className="inspector-metrics grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
            <MetricCard
              label="Measured requests"
              value={fmt(usage.requestCount)}
              note={
                usage.unmeasured
                  ? `${fmt(usage.unmeasured)} without measured usage`
                  : "Across all sessions"
              }
            />
            <MetricCard
              label="Input tokens"
              value={fmt(usage.totals.input)}
              note="Uncached input"
            />
            <MetricCard label="Output tokens" value={fmt(usage.totals.output)} />
            <MetricCard
              label="Cache read"
              value={fmt(usage.totals.cacheRead)}
              note={`${pct(cacheHitRate(usage.totals))} hit rate`}
            />
            <MetricCard label="Cache write" value={fmt(usage.totals.cacheWrite)} />
            {hasCost(usage.totals) ? (
              <MetricCard
                label="Total estimated cost"
                value={costLabel(usage.totals)}
                tone="accent"
              />
            ) : (
              <MetricCard
                label="Total input tokens"
                value={fmt(
                  usage.totals.totalInput ??
                    usage.totals.input + usage.totals.cacheRead + usage.totals.cacheWrite,
                )}
                note="Including cached input"
              />
            )}
          </div>
          <div className="summary-tabs">
            <div className="tabs" role="tablist" aria-label="Summary grouping">
              {summaryTabs.map(([id, label]) => (
                <button
                  type="button"
                  key={id}
                  role="tab"
                  id={`summary-tab-${id}`}
                  aria-selected={tab === id}
                  aria-controls="summary-panel"
                  className="tab"
                  onClick={() => setTab(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            {tab === "session" && (
              <label className="summary-controls text-xs muted">
                <input
                  type="checkbox"
                  className="accent-accent"
                  checked={showNames}
                  onChange={(event) => setShowNames(event.target.checked)}
                />
                Show session names
              </label>
            )}
          </div>
          <div id="summary-panel" role="tabpanel" aria-labelledby={`summary-tab-${tab}`}>
            {tab === "session" && showNames && namesLoading && (
              <p role="status" className="mb-3 text-xs muted">
                Loading session names…
              </p>
            )}
            {tab === "session" && showNames && namesError && (
              <p role="status" className="alert mb-3">
                Session names could not be loaded: {namesError}. Usage is still available.
              </p>
            )}
            {tab === "model" ? (
              usage.byModel.length ? (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th scope="col">Model</th>
                        <th scope="col" className="text-right!">
                          Requests
                        </th>
                        <th scope="col" className="text-right!">
                          Input
                        </th>
                        <th scope="col" className="text-right!">
                          Output
                        </th>
                        <th scope="col" className="text-right!">
                          Cache read
                        </th>
                        <th scope="col" className="text-right!">
                          Cache write
                        </th>
                        <th scope="col" className="text-right!">
                          Cache hit
                        </th>
                        {modelCost && (
                          <th scope="col" className="text-right!">
                            Estimated cost
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {usage.byModel.map((row) => (
                        <tr key={row.model}>
                          <td className="text-ink">{row.model}</td>
                          <td className="text-right tabular-nums">{fmt(row.requests)}</td>
                          <td className="text-right tabular-nums">{fmt(row.input)}</td>
                          <td className="text-right tabular-nums">{fmt(row.output)}</td>
                          <td className="text-right tabular-nums">{fmt(row.cacheRead)}</td>
                          <td className="text-right tabular-nums">{fmt(row.cacheWrite)}</td>
                          <td>
                            <div className="flex justify-end items-center gap-2">
                              <meter
                                className="w-14"
                                min={0}
                                max={1}
                                value={cacheHitRate(row)}
                                aria-label={`Cache hit rate for ${row.model}`}
                              />
                              {pct(cacheHitRate(row))}
                            </div>
                          </td>
                          {modelCost && (
                            <td className="text-right tabular-nums">{costLabel(row)}</td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="empty-state">No measured requests yet.</div>
              )
            ) : (
              <SessionTable
                {...props}
                rows={usage.bySession.map((row) => ({
                  ...row,
                  name: names[row.session] || row.name,
                }))}
                showNames={showNames}
                showCost={sessionCost}
              />
            )}
            {!controllable && tab !== "model" && (
              <p className="mt-3 text-xs muted">
                Read-only capture. Sessions can be opened and exported; reset and delete are
                unavailable.
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
