import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, BarChart3, Download, Layers3 } from "lucide-react";
import { api } from "../api";
import type { UsageSession, UsageSummary } from "../types";
import { fmt, fmtCompact, fmtDateTime, pct, plural, sessionLabel, sessionStart } from "../lib/format";
import { routeLink, type Navigate, type Route } from "../lib/route";
import { modelsLabel, type SessionIdentity } from "../lib/session";
import { SessionMenu } from "./SessionActions";
import { AllUsage, TOKEN_COLUMNS, TokenCells, totalInput } from "./UsageView";
import { MiddleTruncate } from "./MiddleTruncate";
import { ViewTabs } from "./ViewTabs";

export interface SessionsViewProps {
  tab: "sessions" | "usage";
  navigate: Navigate;
  /** Every session, newest first. Listed at once; the numbers arrive after. */
  sessions: string[];
  usage: UsageSummary | null;
  index: Record<string, SessionIdentity>;
  loading?: boolean;
  controllable: boolean;
  live: string | null;
  busy?: boolean;
  onExportSession: (session: string) => void;
  onResetSession: (session: string) => void;
  onDeleteSession: (session: string) => void;
}

interface Row {
  session: string;
  started: number;
  usage?: UsageSession;
  identity?: SessionIdentity;
  requests: number | null;
}

type SortKey = "started" | "requests" | "input" | "cached" | "share" | "output";
const SORTS: Record<SortKey, (row: Row) => number> = {
  started: (row) => row.started,
  requests: (row) => row.requests ?? -1,
  input: (row) => (row.usage ? totalInput(row.usage) : -1),
  cached: (row) => row.usage?.cacheRead ?? -1,
  share: (row) => (row.usage && totalInput(row.usage) ? row.usage.cacheRead / totalInput(row.usage) : -1),
  output: (row) => row.usage?.output ?? -1,
};
const COLUMNS: [SortKey, string][] = [
  ["requests", "Requests"],
  ...TOKEN_COLUMNS.map(
    (name, index) => [(["input", "cached", "share", "output"] as const)[index], name] as [SortKey, string],
  ),
];

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

function SessionTable({
  rows,
  names,
  totals,
  navigate,
  live,
  controllable,
  busy,
  onExportSession,
  onResetSession,
  onDeleteSession,
}: Omit<SessionsViewProps, "tab" | "sessions" | "usage" | "index" | "loading"> & {
  rows: Row[];
  /** Titles the agent gave its own sessions, by capture id. */
  names: Record<string, string>;
  totals: UsageSummary | null;
}) {
  const [sort, setSort] = useState<{ key: SortKey; down: boolean }>({ key: "started", down: true });
  const sorted = useMemo(() => {
    const value = SORTS[sort.key];
    return [...rows].sort(
      (a, b) => (sort.down ? value(b) - value(a) : value(a) - value(b)) || b.started - a.started,
    );
  }, [rows, sort]);
  const header = (key: SortKey, label: string, numeric = true) => {
    const active = sort.key === key;
    return (
      <th
        scope="col"
        key={key}
        className={numeric ? "numeric" : undefined}
        aria-sort={active ? (sort.down ? "descending" : "ascending") : undefined}
      >
        <button
          type="button"
          className="sort-button"
          title={`Sort by ${label.toLowerCase()}`}
          onClick={() => setSort({ key, down: active ? !sort.down : true })}
        >
          {label}
          {active && (sort.down ? <ArrowDown size={11} /> : <ArrowUp size={11} />)}
        </button>
      </th>
    );
  };
  const requestTotal = rows.reduce((sum, row) => sum + (row.requests ?? 0), 0);
  return (
    <div className="table-wrap">
      <table className="data-table sessions-table">
        <thead>
          <tr>
            {header("started", "Session", false)}
            <th scope="col">Model</th>
            {COLUMNS.map(([key, label]) => header(key, label))}
            <th scope="col" className="numeric">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => {
            const { session, identity, usage } = row;
            const recording = session === live;
            const label = sessionLabel(session);
            const route: Route = { view: "session", session, tab: "replay" };
            const link = routeLink(route, navigate);
            const empty = row.requests === 0;
            const about = names[session] || identity?.prompt;
            const models = identity?.models ?? [];
            return (
              <tr
                key={session}
                className={`session-row ${empty ? "session-row-empty" : ""}`}
                // The whole row opens the session; the link inside is what a
                // keyboard and a screen reader use.
                onClick={(event) => {
                  if (!(event.target as Element).closest("a, button, [role='menu']")) link.onClick(event);
                }}
              >
                <td>
                  {/* The capture id is what the CLI takes (ccglass export, ccglass rm). */}
                  <a className="session-cell" {...link} title={`Session ${session}`}>
                    <span className="session-cell-title">
                      <span>{label}</span>
                      {recording && <span className="badge badge-recording">Recording</span>}
                    </span>{" "}
                    <span className="session-cell-about">
                      {about || (empty ? "No requests" : identity ? "No prompt in the first request" : " ")}
                    </span>
                  </a>
                </td>
                <td className="model-cell" title={models.join("\n") || undefined}>
                  {models.length === 1 ? (
                    <MiddleTruncate text={models[0]} />
                  ) : (
                    modelsLabel(models) || "—"
                  )}
                </td>
                <td className="numeric">
                  {/* The marks come first so the counts stay in one column. */}
                  {!!identity?.failed && (
                    <span className="session-mark session-mark-failed">
                      {identity.failed} failed
                    </span>
                  )}
                  {!!identity?.cancelled && (
                    <span className="session-mark session-mark-cancelled">
                      {identity.cancelled} cancelled
                    </span>
                  )}
                  <span className="session-count">{fmt(row.requests)}</span>
                </td>
                {usage && !empty ? (
                  <TokenCells bucket={usage} meterLabel={`Cache hit rate for session ${session}`} />
                ) : (
                  TOKEN_COLUMNS.map((name) => (
                    <td className="numeric" key={name}>
                      —
                    </td>
                  ))
                )}
                <td>
                  <div className="row-actions">
                    <button
                      type="button"
                      className="button button-ghost button-sm icon-button"
                      onClick={() => onExportSession(session)}
                      disabled={busy}
                      aria-label={`Export session ${session}`}
                      title="Export this session"
                    >
                      <Download size={13} />
                    </button>
                    {controllable && (
                      <SessionMenu
                        session={session}
                        label={label}
                        requests={row.requests}
                        recording={recording}
                        busy={busy}
                        small
                        triggerLabel={`More actions for session ${session}`}
                        onReset={onResetSession}
                        onDelete={onDeleteSession}
                      />
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
        {totals && rows.length > 1 && (
          <tfoot>
            <tr>
              <th scope="row">{plural(rows.length, "session")}</th>
              <td />
              <td className="numeric">{fmt(requestTotal)}</td>
              <TokenCells bucket={totals.totals} meterLabel="Cache hit rate across every session" />
              <td />
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

/**
 * Home: every captured session, and the usage across them. A session is the
 * thing a person comes back for, so the list of them is where the app starts.
 */
export default function SessionsView(props: SessionsViewProps) {
  const { tab, navigate, sessions, usage, index, loading, controllable } = props;
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
  const count = sessions.length;

  useEffect(() => {
    if (tab !== "sessions" || !showNames || !count) {
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
  }, [tab, showNames, count]);

  const rows = useMemo<Row[]>(() => {
    const bySession = new Map(usage?.bySession.map((row) => [row.session, row]));
    return sessions.map((session) => {
      const row = bySession.get(session);
      const identity = index[session];
      return {
        session,
        started: sessionStart(session) ?? 0,
        usage: row,
        identity,
        requests: identity?.requests ?? row?.entries ?? null,
      };
    });
  }, [sessions, usage, index]);

  const total = usage ? totalInput(usage.totals) : 0;
  const facts = usage
    ? [
        {
          text: plural(usage.sessionCount, "session"),
          title: usage.range?.from
            ? `${fmtDateTime(usage.range.from)} to ${fmtDateTime(usage.range.to)}`
            : undefined,
        },
        ...(total
          ? [
              {
                text: `${fmtCompact(total)} tokens in (${pct(usage.totals.cacheRead / total)} cached)`,
                title: `Input (total): ${fmt(total)} tokens, of which cached: ${fmt(usage.totals.cacheRead)}`,
              },
            ]
          : []),
        ...(usage.totals.output
          ? [
              {
                text: `${fmtCompact(usage.totals.output)} tokens out`,
                title: `Output: ${fmt(usage.totals.output)} tokens`,
              },
            ]
          : []),
      ]
    : [];

  return (
    <section
      className="summary-view"
      aria-label={tab === "usage" ? "Usage across every session" : "Sessions"}
      aria-busy={loading || undefined}
    >
      <header className="detail-header view-header">
        <ViewTabs
          label="Sessions and usage"
          tabs={[
            [{ view: "sessions", tab: "sessions" }, "Sessions"],
            [{ view: "sessions", tab: "usage" }, "Usage"],
          ]}
          current={{ view: "sessions", tab }}
          navigate={navigate}
        />
        {!!facts.length && (
          <p className="session-facts" aria-label="Totals across every session">
            {facts.map((fact) => (
              <span key={fact.text} title={fact.title}>
                {fact.text}
              </span>
            ))}
          </p>
        )}
        {tab === "sessions" && !!count && (
          <label
            className="summary-controls"
            title="Show the title the agent gave each session, read from its own transcripts on this machine"
          >
            <input
              type="checkbox"
              checked={showNames}
              onChange={(event) => setShowNames(event.target.checked)}
            />
            Show session names
          </label>
        )}
      </header>
      {usage?.error && (
        <div role="alert" className="alert summary-alert">
          Could not load usage: {usage.error}
        </div>
      )}
      {tab === "sessions" ? (
        !count ? (
          <div className="empty-state" role={loading ? "status" : undefined}>
            {loading ? (
              "Loading sessions…"
            ) : (
              <>
                <Layers3 size={32} />
                <h3>Your sessions will appear here</h3>
                <p>
                  {controllable
                    ? "Press Record, then point your agent's API base URL at the ccglass proxy. Its address is printed in the terminal where ccglass started."
                    : "Nothing has been captured yet."}
                </p>
              </>
            )}
          </div>
        ) : (
          <div className="summary-body">
            {showNames && namesLoading && (
              <p role="status" className="sr-only">
                Loading session names…
              </p>
            )}
            {showNames && namesError && (
              <p role="status" className="alert summary-alert">
                Session names could not be loaded: {namesError}. Sessions are still available.
              </p>
            )}
            <SessionTable {...props} rows={rows} names={showNames ? names : {}} totals={usage} />
            {!controllable && (
              <p className="summary-note">
                Read-only capture. Sessions can be opened and exported; clearing and deleting are
                unavailable.
              </p>
            )}
          </div>
        )
      ) : !usage ? (
        <div className="empty-state" role={loading ? "status" : undefined}>
          {loading ? (
            "Loading usage…"
          ) : (
            <>
              <BarChart3 size={32} />
              <h3>No usage available</h3>
            </>
          )}
        </div>
      ) : !usage.sessionCount ? (
        <div className="empty-state">
          <BarChart3 size={32} />
          <h3>No usage yet</h3>
          <p>Token totals appear here once a session has requests.</p>
        </div>
      ) : (
        <AllUsage usage={usage} />
      )}
    </section>
  );
}
