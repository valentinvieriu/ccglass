import { Fragment, memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpRight,
  Brain,
  ChevronRight,
  Cpu,
  FileText,
  LoaderCircle,
  MessageSquare,
  Square,
  Terminal,
  Wrench,
} from "lucide-react";
import type { EntrySummary, RequestRecord, TimelineRow } from "../types";
import { callColor, fmtCost, fmtMs } from "../lib/format";
import { buildTimeline, detectPatterns, smartSummary, TAG_INFO } from "../lib/timeline";
import { CodeView } from "./JsonView";

export interface TimelineViewProps {
  entries: EntrySummary[];
  records: Record<string, RequestRecord>;
  modelFilter: string;
  onOpen: (id: string) => void;
  onExport: () => void;
  loading: boolean;
  isLive: boolean;
  recordLimit: number;
}

const eventKey = (row: TimelineRow) => row.key;
const isTool = (row: TimelineRow) => row.kind === "tool_use" || row.kind === "skill";
const initiallyOpen = (row: TimelineRow) =>
  (row.kind === "user" || row.kind === "assistant") && row.text.length <= 800;

function Tag({
  name,
  label = name,
  error = false,
}: {
  name: string;
  label?: string;
  error?: boolean;
}) {
  const info = TAG_INFO[name];
  return (
    <span
      className={error ? "badge badge-error" : "tag"}
      title={info ? `${info.headline}: ${info.desc}` : undefined}
    >
      {label}
    </span>
  );
}

function InputFold({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="timeline-fold" open={open}>
      <summary
        onClick={(event) => {
          event.preventDefault();
          setOpen((value) => !value);
        }}
      >
        <ChevronRight size={12} />
        Show input
      </summary>
      {open && <CodeView text={text} compact />}
    </details>
  );
}

function sameRow(a: TimelineRow, b: TimelineRow) {
  return (
    a.key === b.key &&
    a.entryId === b.entryId &&
    a.kind === b.kind &&
    a.text === b.text &&
    a.name === b.name &&
    a.label === b.label &&
    a.callId === b.callId &&
    a.isError === b.isError &&
    a.latest === b.latest &&
    a.count === b.count &&
    a.result?.text === b.result?.text &&
    a.result?.isError === b.result?.isError &&
    !!a.result === !!b.result
  );
}

const TimelineEvent = memo(
  function TimelineEvent({
    row,
    open,
    latest,
    onToggle,
  }: {
    row: TimelineRow;
    open: boolean;
    latest: boolean;
    onToggle: (key: string, open: boolean) => void;
  }) {
    const tool = isTool(row);
    const error =
      row.result?.isError ||
      row.isError ||
      (row.kind === "stop" && /^error(?:\s|$)/.test(row.text));
    const Icon =
      row.kind === "thinking"
        ? Brain
        : tool || row.kind === "tools"
          ? Wrench
          : row.kind === "tool_result"
            ? Terminal
            : row.kind === "assistant"
              ? Cpu
              : row.kind === "stop"
                ? Square
                : row.kind === "system"
                  ? FileText
                  : MessageSquare;
    const title =
      row.kind === "tool_use"
        ? row.name || "Tool call"
        : row.kind === "skill"
          ? `/${row.name || "skill"}`
          : row.kind === "tool_result"
            ? "Tool result"
            : row.kind === "stop"
              ? "Stop reason"
              : row.kind === "system"
                ? row.label || "System"
                : row.kind[0].toUpperCase() + row.kind.slice(1);
    const summary = smartSummary(row);
    const hasBody = row.kind !== "stop" && (!!row.text || !!row.result || !!row.tools?.length);
    const pairedStyle = row.callId ? { borderColor: callColor(row.callId) } : undefined;
    return (
      <div className="timeline-row" data-event-key={eventKey(row)} data-kind={row.kind}>
        <span
          className={`timeline-marker ${error ? "error" : tool || row.kind === "tool_result" ? "tool" : row.kind === "assistant" ? "assistant" : row.kind === "user" ? "user" : ""}`}
          style={pairedStyle}
        >
          <Icon size={13} aria-hidden="true" />
        </span>
        <div className="timeline-content">
          <div className="timeline-heading">
            <strong>{title}</strong>
            {row.kind === "tools" && <span>{row.count} available</span>}
          </div>
          <div className="timeline-tags">
            {detectPatterns(row).map((tag) => (
              <Tag key={tag} name={tag} />
            ))}
            {row.callId && (
              <span className="tag" title={`Call ID: ${row.callId}`}>
                {row.callId.slice(-8)}
              </span>
            )}
            {latest && row.latest && <Tag name="latest" label="this turn" />}
            {tool && (
              <Tag
                name={row.result ? (row.result.isError ? "err" : "ok") : "pending"}
                label={row.result ? (row.result.isError ? "error" : "ok") : "pending…"}
                error={!!row.result?.isError}
              />
            )}
            {row.kind === "tool_result" && (
              <Tag
                name={row.isError ? "err" : "ok"}
                label={row.isError ? "error" : "ok"}
                error={!!row.isError}
              />
            )}
          </div>
          {summary && <p className={`timeline-summary ${error ? "text-danger" : ""}`}>{summary}</p>}
          {hasBody && (
            <details className="timeline-fold" open={open}>
              <summary
                aria-label={`${open ? "Collapse" : "Expand"} ${title} content`}
                onClick={(event) => {
                  event.preventDefault();
                  onToggle(eventKey(row), !open);
                }}
              >
                <ChevronRight size={12} />
                <span>
                  {row.result
                    ? "Tool output"
                    : row.kind === "tools"
                      ? "Tool definitions"
                      : tool
                        ? "Tool input"
                        : "Full content"}
                </span>
                <span className="ml-auto mono">
                  {(row.result?.text ?? row.text).length.toLocaleString()} characters
                </span>
              </summary>
              {open &&
                (row.kind === "tools" && row.tools ? (
                  <div className="p-3 space-y-3">
                    {row.tools.map((definition, index) => (
                      <div key={`${definition.name}-${index}`}>
                        <strong className="mono text-[10px]">{definition.name}</strong>
                        <CodeView text={definition.description || "No description"} compact />
                      </div>
                    ))}
                  </div>
                ) : (
                  <CodeView text={row.result?.text ?? row.text} compact />
                ))}
              {open && row.result && !!row.text && row.text.trim() !== "{}" && (
                <InputFold text={row.text} />
              )}
            </details>
          )}
        </div>
      </div>
    );
  },
  (a, b) =>
    a.open === b.open &&
    a.latest === b.latest &&
    a.onToggle === b.onToggle &&
    sameRow(a.row, b.row),
);

export default function TimelineView({
  entries,
  records,
  modelFilter,
  onOpen,
  onExport,
  loading,
  isLive,
  recordLimit,
}: TimelineViewProps) {
  const limit = Math.max(1, Math.floor(recordLimit));
  const windowEntries = useMemo(
    () =>
      [...entries]
        .sort((a, b) => a.seq - b.seq)
        .filter((entry) => !modelFilter || modelFilter === "all" || entry.model === modelFilter),
    [entries, modelFilter],
  );
  const windowRecords = useMemo(
    () => windowEntries.flatMap((entry) => (records[entry.id] ? [records[entry.id]] : [])),
    [windowEntries, records],
  );
  const rows = useMemo(() => buildTimeline(windowRecords), [windowRecords]);
  const groupedRows = useMemo(() => {
    const groups = new Map<string, TimelineRow[]>();
    for (const row of rows) {
      const group = groups.get(row.entryId) || [];
      group.push(row);
      groups.set(row.entryId, group);
    }
    return groups;
  }, [rows]);
  const [folds, setFolds] = useState<{ all: boolean | null; overrides: Map<string, boolean> }>({
    all: null,
    overrides: new Map(),
  });
  const onToggle = useCallback(
    (key: string, open: boolean) =>
      setFolds((previous) => ({
        ...previous,
        overrides: new Map(previous.overrides).set(key, open),
      })),
    [],
  );
  const [autoScroll, setAutoScroll] = useState(true);
  const pinned = useRef(true);
  const viewport = useRef<HTMLDivElement>(null);
  const scrollTarget = useRef<number | null>(null);
  const scrollToEnd = useCallback(() => {
    const element = viewport.current;
    if (!element) return;
    scrollTarget.current = Math.max(0, element.scrollHeight - element.clientHeight);
    element.scrollTop = scrollTarget.current;
  }, []);

  // Expansion and unrelated parent updates must not pull a reader back to the end.
  useLayoutEffect(() => {
    if (pinned.current) scrollToEnd();
  }, [rows, windowEntries, scrollToEnd]);

  const latestEntryId = windowEntries.at(-1)?.id;
  return (
    <section
      className="detail-panel h-full"
      aria-label={isLive ? "Live timeline" : "Session replay"}
    >
      <header className="detail-header">
        <div>
          <h2>{isLive ? "Live stream" : "Session replay"}</h2>
          <p>
            {rows.length.toLocaleString()} events · {windowRecords.length.toLocaleString()} /{" "}
            {windowEntries.length.toLocaleString()} requests loaded
            {modelFilter && modelFilter !== "all" ? ` · ${modelFilter}` : ""}
          </p>
        </div>
        <span className={`badge ${isLive ? "badge-success" : "badge-muted"}`}>
          <span className="status-dot" />
          {isLive ? "Live" : "Saved capture"}
        </span>
      </header>
      <div className="timeline-toolbar">
        <label>
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(event) => {
              pinned.current = event.target.checked;
              setAutoScroll(event.target.checked);
              if (event.target.checked) scrollToEnd();
            }}
          />
          Auto-scroll
        </label>
        <button
          type="button"
          className="button button-ghost button-sm"
          disabled={!rows.length}
          onClick={() => setFolds({ all: true, overrides: new Map() })}
        >
          Expand all
        </button>
        <button
          type="button"
          className="button button-ghost button-sm"
          disabled={!rows.length}
          onClick={() => setFolds({ all: false, overrides: new Map() })}
        >
          Collapse all
        </button>
        <button type="button" className="button button-sm" onClick={onExport}>
          <ArrowDownToLine size={12} />
          Export session
        </button>
      </div>
      <div className="border-b border-border px-5 py-2 text-[11px] text-muted">
        {isLive ? "Turns append as requests arrive." : "Saved session replay."} Click a turn or a
        request on the left to inspect the full HTTP call.
        {entries.length >= limit && (
          <p className="mt-1">
            Showing up to {limit.toLocaleString()} requests per page. Session exports include every
            request.
          </p>
        )}
      </div>
      <div
        ref={viewport}
        className="panel-body"
        data-testid="timeline-scroll"
        onScroll={(event) => {
          const element = event.currentTarget;
          if (
            scrollTarget.current !== null &&
            Math.abs(element.scrollTop - scrollTarget.current) < 1
          )
            return;
          scrollTarget.current = null;
          const nearBottom = element.scrollHeight - element.clientHeight - element.scrollTop < 40;
          pinned.current = nearBottom;
          setAutoScroll(nearBottom);
        }}
        aria-busy={loading}
      >
        {loading && (
          <p className="flex items-center gap-2 text-[11px] text-muted" role="status">
            <LoaderCircle size={13} className="loading-spinner" />
            Loading captured requests…
          </p>
        )}
        {!windowEntries.length && !loading && (
          <div className="empty-state">
            <span className="empty-icon">
              <MessageSquare size={23} />
            </span>
            <h3>{entries.length ? "No requests for this model" : "No requests yet"}</h3>
            <p>
              {entries.length
                ? "Choose another model to view its conversation timeline."
                : isLive
                  ? "Captured requests will appear here as your agent works."
                  : "This saved capture has no requests."}
            </p>
          </div>
        )}
        <div className="timeline">
          {windowEntries.map((entry) => {
            const record = records[entry.id];
            const turnRows = groupedRows.get(entry.id) || [];
            const status = record?.response?.status ?? entry.status;
            const model = record?.parsed?.response?.model || entry.model || record?.model;
            const usageStats =
              (record?.parsed as { usageStats?: { usd?: number } } | undefined)?.usageStats ??
              record?.usageStats;
            const cost = record?.parsed?.cost?.usd ?? usageStats?.usd;
            return (
              <Fragment key={entry.id}>
                <div className="timeline-turn">
                  <button
                    type="button"
                    className="button button-ghost button-sm"
                    onClick={() => onOpen(entry.id)}
                    aria-label={`Inspect turn ${entry.seq}`}
                  >
                    <strong>Turn {entry.seq}</strong>
                    <ArrowUpRight size={11} />
                  </button>
                  {model && (
                    <span className="max-w-48 truncate" title={model}>
                      {model}
                    </span>
                  )}
                  {entry.ts && (
                    <time dateTime={new Date(entry.ts).toISOString()}>
                      {new Date(entry.ts).toLocaleTimeString([], { hour12: false })}
                    </time>
                  )}
                  {(record?.latencyMs ?? entry.latencyMs) != null && (
                    <span>{fmtMs(record?.latencyMs ?? entry.latencyMs)}</span>
                  )}
                  {status != null && (
                    <span className={status >= 400 ? "text-danger" : ""}>HTTP {status}</span>
                  )}
                  {typeof cost === "number" && <span>{fmtCost(cost)}</span>}
                </div>
                {turnRows.map((row) => (
                  <TimelineEvent
                    key={eventKey(row)}
                    row={row}
                    latest={row.entryId === latestEntryId}
                    open={folds.overrides.get(eventKey(row)) ?? folds.all ?? initiallyOpen(row)}
                    onToggle={onToggle}
                  />
                ))}
                {!turnRows.length && (
                  <p className="timeline-summary mb-5">
                    {!record
                      ? loading
                        ? "Loading request…"
                        : "Request details are unavailable. Click this turn to retry."
                      : entry.pending || !record.response
                        ? "Waiting for the response…"
                        : "No new conversation steps in this turn."}
                  </p>
                )}
              </Fragment>
            );
          })}
        </div>
      </div>
    </section>
  );
}
