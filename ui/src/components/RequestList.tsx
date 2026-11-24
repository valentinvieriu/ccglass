import { AlertCircle, Search, User, Zap } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { groupRetries, isFailed, visibleEntries } from "../lib/entries";
import { keyTarget } from "../lib/flow";
import { fmtDateTime, plural } from "../lib/format";
import { endpointLabel, requestLead, rowFacts, rowStatus } from "../lib/requestRow";
import type { EntrySummary, RequestRecord } from "../types";
import { MiddleTruncate } from "./MiddleTruncate";

interface Props {
  entries: EntrySummary[];
  /** Loaded requests. A row says what its request was for once its record is here. */
  records?: Record<string, RequestRecord>;
  models: string[];
  model: string;
  selected: string | null;
  /** The two requests being compared, baseline first. */
  picks: string[];
  /** Compare is open: rows are marked A and B, and a click picks B. */
  comparing?: boolean;
  isLive: boolean;
  onModel: (model: string) => void;
  onSelect: (id: string) => void;
}

const NO_RECORDS: Record<string, RequestRecord> = {};

export const RequestList = memo(function RequestList({
  entries,
  records = NO_RECORDS,
  models,
  model,
  selected,
  picks,
  comparing = false,
  isLive,
  onModel,
  onSelect,
}: Props) {
  const [search, setSearch] = useState("");
  const [errorsOnly, setErrorsOnly] = useState(false);
  const filterInput = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  // The marks are no use off screen: bring the compared requests into view.
  const compared = comparing ? picks.join("|") : "";
  useEffect(() => {
    if (!compared) return;
    for (const mark of list.current?.querySelectorAll(".request-pick") ?? [])
      mark.closest(".request-row")?.scrollIntoView?.({ block: "nearest" });
  }, [compared]);
  const scoped = useMemo(() => visibleEntries(entries, model), [entries, model]);
  const failed = scoped.filter(isFailed).length;
  // Times in a session read as "how far in": the first request is the zero.
  const origin = entries[0] ? (entries[0].startedAt ?? entries[0].ts) : null;
  const filtered = useMemo(() => {
    const query = search.toLowerCase();
    return visibleEntries(entries, model, errorsOnly).filter((entry) => {
      const record = records[entry.id];
      const lead = record ? requestLead(record)?.text : "";
      return `${lead || ""} ${entry.model || ""} ${entry.seq} ${entry.url || ""} ${entry.status || ""}`
        .toLowerCase()
        .includes(query);
    });
  }, [entries, records, model, errorsOnly, search]);
  const rows = useMemo(() => groupRetries(filtered), [filtered]);
  // One model in the whole session says nothing on every row.
  const showModel = models.length > 1;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === "/") {
      event.preventDefault();
      filterInput.current?.focus();
      return;
    }
    const listed = [...event.currentTarget.querySelectorAll<HTMLElement>(".request-row")].filter(
      (element) => !element.closest("details:not([open])"),
    );
    const target = keyTarget(event.key, listed, document.activeElement as HTMLElement);
    if (!target) return;
    event.preventDefault();
    target.focus();
    target.scrollIntoView?.({ block: "nearest" });
  };
  const row = (entry: EntrySummary) => (
    <RequestRow
      key={entry.id}
      entry={entry}
      record={records[entry.id]}
      origin={origin}
      showModel={showModel}
      // While comparing, the two picks are what is on screen, not the open request.
      selected={comparing ? picks.includes(entry.id) : selected === entry.id}
      pick={
        !comparing
          ? undefined
          : picks[0] === entry.id
            ? "A"
            : picks[1] === entry.id
              ? "B"
              : undefined
      }
      onSelect={onSelect}
    />
  );
  return (
    <aside className="request-panel" aria-label="Captured requests">
      <div className="request-toolbar">
        <div className="search-wrap">
          <Search size={12} />
          <input
            ref={filterInput}
            className="search-input"
            aria-label="Filter requests by prompt, tool, model, status or URL"
            placeholder="Filter by prompt, tool or model"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              setSearch("");
              event.currentTarget.blur();
            }}
          />
          <span className="panel-count" aria-label="Requests shown">
            {filtered.length} / {entries.length}
          </span>
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
            aria-label={`Failed requests (${failed})`}
            title="Show only requests that returned an error or got no response"
            onClick={() => setErrorsOnly(!errorsOnly)}
          >
            <AlertCircle size={11} />
            Failed ({failed})
          </button>
        </div>
      </div>
      {/* Arrow keys move between rows, so the list is one stop for the Tab key. */}
      <div className="request-list" ref={list} onKeyDown={onKeyDown}>
        {rows.map((entry) => (
          <div key={entry.id}>
            {row(entry)}
            {!!entry.retries.length && (
              <details
                className="retry-group"
                // An open or compared request must not sit folded out of sight.
                open={
                  entry.retries.some((retry) =>
                    comparing ? picks.includes(retry.id) : retry.id === selected,
                  ) || undefined
                }
              >
                <summary>{plural(entry.retries.length, "similar request")}</summary>
                {entry.retries.map(row)}
              </details>
            )}
          </div>
        ))}
        {!rows.length && (
          <div className="empty-state">
            <p>
              {entries.length
                ? "No requests match these filters."
                : isLive
                  ? "Requests will appear here as they are captured."
                  : "This saved session has no requests."}
            </p>
          </div>
        )}
      </div>
    </aside>
  );
});

const RequestRow = memo(function RequestRow({
  entry,
  record,
  origin,
  showModel,
  selected,
  pick,
  onSelect,
}: {
  entry: EntrySummary;
  record: RequestRecord | undefined;
  /** When the session's first request started; rows show the time since then. */
  origin: number | null;
  showModel: boolean;
  selected: boolean;
  /** Which side of the comparison this request is. */
  pick?: "A" | "B";
  onSelect: (id: string) => void;
}) {
  // Requests without a model (model listings, health probes) are identified by
  // what they called instead of a generic placeholder.
  const endpoint = entry.model ? null : endpointLabel(entry);
  const lead = record ? requestLead(record) : null;
  const status = rowStatus(entry);
  const started = entry.startedAt ?? entry.ts;
  const facts = rowFacts(entry, record, origin);
  const title = [
    pick === "A" ? "A, the baseline of the comparison" : pick === "B" ? "B, compared with A" : null,
    lead?.kind === "tools" ? `Sends back the output of ${lead.text}` : lead?.text,
    entry.model || endpoint,
    started ? fmtDateTime(started) : null,
    [
      entry.nMessages ? `${entry.nMessages} msg` : null,
      entry.nTools ? plural(entry.nTools, "tool") : null,
      entry.nToolUse ? plural(entry.nToolUse, "call") : null,
    ]
      .filter(Boolean)
      .join(", "),
    entry.format ? `${entry.format} format` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <button
      className={`request-row ${selected ? "request-row-selected" : ""} ${lead || entry.model ? "" : "request-row-minor"}`}
      aria-pressed={selected}
      // The open request is the list's tab stop; the arrow keys reach the rest.
      tabIndex={selected ? 0 : -1}
      title={title || undefined}
      onClick={() => onSelect(entry.id)}
    >
      <div className="request-title">
        {pick && <b className="request-pick">{pick}</b>}
        {lead?.kind === "prompt" && <User size={12} aria-hidden="true" />}
        {lead?.kind === "harness" && <Zap size={12} aria-hidden="true" />}
        {lead?.kind === "tools" && <span aria-hidden="true">→</span>}
        {lead ? (
          <span className={`request-lead request-lead-${lead.kind}`}>{lead.text}</span>
        ) : (
          <span className={`request-lead request-lead-model ${endpoint ? "mono" : ""}`}>
            {entry.model || endpoint || "Unknown model"}
          </span>
        )}
        <span className="request-seq">#{entry.seq}</span>
        {status && <span className={`request-status ${status.tone}`}>{status.label}</span>}
      </div>
      <div className="request-time">
        <span>{facts.length ? facts.join(" · ") : "—"}</span>
        {showModel && lead && entry.model && (
          <MiddleTruncate className="request-model" text={entry.model} />
        )}
      </div>
    </button>
  );
});
