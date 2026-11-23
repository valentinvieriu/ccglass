import { Activity, AlertCircle, Search, ChevronRight } from "lucide-react";
import { memo, useMemo, useState } from "react";
import { groupRetries, visibleEntries } from "../lib/entries";
import { fmtMs } from "../lib/format";
import type { EntrySummary } from "../types";

interface Props {
  entries: EntrySummary[];
  models: string[];
  model: string;
  selected: string | null;
  picks: string[];
  isLive: boolean;
  onModel: (model: string) => void;
  onSelect: (id: string | null) => void;
}

export const RequestList = memo(function RequestList({
  entries,
  models,
  model,
  selected,
  picks,
  isLive,
  onModel,
  onSelect,
}: Props) {
  const [search, setSearch] = useState("");
  const [errorsOnly, setErrorsOnly] = useState(false);
  const scoped = useMemo(() => visibleEntries(entries, model), [entries, model]);
  const errors = scoped.filter((entry) => (entry.status ?? 0) >= 400 || entry.error != null).length;
  const filtered = useMemo(
    () =>
      visibleEntries(entries, model, errorsOnly).filter((entry) =>
        `${entry.model || ""} ${entry.seq} ${entry.url || ""} ${entry.status || ""}`
          .toLowerCase()
          .includes(search.toLowerCase()),
      ),
    [entries, model, errorsOnly, search],
  );
  const rows = useMemo(() => groupRetries(filtered), [filtered]);
  return (
    <aside className="request-panel" aria-label="Captured requests">
      <div className="panel-header">
        <h2>Requests</h2>
        <span className="panel-count">
          {filtered.length} / {entries.length}
        </span>
      </div>
      <div className="request-toolbar">
        <div className="search-wrap">
          <Search size={12} />
          <input
            className="search-input"
            aria-label="Search requests"
            placeholder="Search requests…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div className="filter-row">
          <select
            className="filter-select"
            aria-label="Filter by model"
            value={model}
            onChange={(event) => onModel(event.target.value)}
          >
            <option value="all">All models</option>
            {models.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
          <button
            className={`button button-sm ${errorsOnly ? "button-danger" : ""}`}
            aria-pressed={errorsOnly}
            onClick={() => setErrorsOnly(!errorsOnly)}
          >
            <AlertCircle size={11} />
            Errors ({errors})
          </button>
        </div>
      </div>
      <div className="request-list">
        <button
          className={`request-live-row ${selected == null ? "active" : ""}`}
          aria-pressed={selected == null}
          onClick={() => onSelect(null)}
        >
          <Activity size={13} />
          {isLive ? "Live stream" : "Session replay"}
          <ChevronRight size={12} className="ml-auto" />
        </button>
        {rows.map((entry) => (
          <div key={entry.id}>
            <RequestRow
              entry={entry}
              selected={selected === entry.id || picks.includes(entry.id)}
              retries={entry.retries.length}
              onSelect={onSelect}
            />
            {!!entry.retries.length && (
              <details className="retry-group">
                <summary>{entry.retries.length} similar requests</summary>
                {entry.retries.map((retry) => (
                  <RequestRow
                    key={retry.id}
                    entry={retry}
                    selected={selected === retry.id || picks.includes(retry.id)}
                    onSelect={onSelect}
                  />
                ))}
              </details>
            )}
          </div>
        ))}
        {!rows.length && (
          <div className="empty-state">
            <p>
              {entries.length
                ? "No requests match these filters."
                : "Requests will appear here as they are captured."}
            </p>
          </div>
        )}
      </div>
    </aside>
  );
});

const RequestRow = memo(function RequestRow({
  entry,
  selected,
  retries = 0,
  onSelect,
}: {
  entry: EntrySummary;
  selected: boolean;
  retries?: number;
  onSelect: (id: string) => void;
}) {
  const failed = (entry.status ?? 0) >= 400 || entry.error != null;
  return (
    <button
      className={`request-row ${selected ? "request-row-selected" : ""}`}
      aria-pressed={selected}
      onClick={() => onSelect(entry.id)}
    >
      <div className="request-title">
        <span className={`status-dot ${failed ? "status-error" : entry.status != null ? "status-ok" : ""}`} />
        <span className="model-name">{entry.model || "Unknown model"}</span>
        <span className="request-seq">#{entry.seq}</span>
      </div>
      <div className="request-time">
        {entry.ts ? new Date(entry.ts).toLocaleTimeString() : "—"} · {fmtMs(entry.latencyMs)}
      </div>
      <div className="request-meta">
        <span>{entry.format || "request"}</span>
        <span>
          {entry.nMessages || 0} msg · {entry.nTools || 0} tools
          {entry.nToolUse ? ` · ${entry.nToolUse} calls` : ""}
        </span>
        <span className={`request-status ${failed ? "error" : ""}`}>
          {entry.error != null ? "error" : entry.pending ? "pending" : (entry.status ?? "—")}
        </span>
      </div>
      {!!retries && <div className="request-time">+{retries} similar requests</div>}
    </button>
  );
});
