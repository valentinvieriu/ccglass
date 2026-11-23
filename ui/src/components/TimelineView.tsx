import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { ArrowDownToLine, ArrowUpRight, ChevronRight, LoaderCircle, MessageSquare } from "lucide-react";
import type { EntrySummary, RequestRecord } from "../types";
import { keyTarget, matchesFilter, matchesQuery, type FlowFilter } from "../lib/flow";
import { fmtMs } from "../lib/format";
import { buildReplay, entryFacts, entryFailed, isSetup, type ReplayLine } from "../lib/replay";
import { buildTimeline } from "../lib/timeline";
import { FilterBar, ItemPreview, ItemRow, KEY_HINT } from "./FlowItems";

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

const FILTERS: [FlowFilter, string][] = [
  ["all", "Everything"],
  ["prompt", "Prompts"],
  ["assistant", "Assistant"],
  ["tool", "Tool calls"],
  ["error", "Errors"],
];

const clock = (ts: number | undefined) =>
  ts ? new Date(ts).toLocaleTimeString([], { hour12: false }) : "";

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
  const replay = useMemo(
    () => buildReplay(windowEntries, records, rows, loading),
    [windowEntries, records, rows, loading],
  );

  const firstLine = useMemo(() => {
    const first = new Map<string, ReplayLine>();
    for (const line of replay.lines) if (!first.has(line.entry.id)) first.set(line.entry.id, line);
    return first;
  }, [replay]);

  const id = useId();
  const [filter, setFilter] = useState<FlowFilter>("all");
  const [search, setSearch] = useState("");
  const [openFolds, setOpenFolds] = useState<Set<string>>(new Set());
  const [picked, setPicked] = useState<string | null>(null);
  const focusPicked = useRef(false);
  const searchInput = useRef<HTMLInputElement>(null);

  // A live stream follows its end; a saved capture is read from the start.
  const [autoScroll, setAutoScroll] = useState(isLive);
  const pinned = useRef(isLive);
  const viewport = useRef<HTMLDivElement>(null);
  const scrollTarget = useRef<number | null>(null);
  const scrollToEnd = useCallback(() => {
    const element = viewport.current;
    if (!element) return;
    scrollTarget.current = Math.max(0, element.scrollHeight - element.clientHeight);
    element.scrollTop = scrollTarget.current;
  }, []);

  // Selection and unrelated parent updates must not pull a reader back to the end.
  useLayoutEffect(() => {
    if (pinned.current) scrollToEnd();
  }, [rows, windowEntries, scrollToEnd]);

  const query = search.trim().toLowerCase();
  const searching = filter !== "all" || query !== "";
  // What is listed right now: folds closed unless opened, filters applied.
  const blocks: ({ fold: string } | { line: ReplayLine; first: boolean })[] = [];
  const visible: ReplayLine[] = [];
  let lastFold: string | undefined;
  let lastEntry: string | undefined;
  for (const line of replay.lines) {
    if (searching) {
      if (!matchesFilter(filter, line.item) || !matchesQuery(query, line.item)) continue;
    } else if (line.fold) {
      if (line.fold !== lastFold) {
        blocks.push({ fold: line.fold });
        lastEntry = undefined;
      }
      lastFold = line.fold;
      if (!openFolds.has(line.fold)) continue;
    } else lastFold = undefined;
    blocks.push({ line, first: line.entry.id !== lastEntry });
    lastEntry = line.entry.id;
    visible.push(line);
  }

  // Nothing picked yet: a live stream follows the newest item, a saved capture
  // opens on the first thing the person asked.
  const selected =
    visible.find((line) => line.item.id === picked) ??
    (isLive ? visible.at(-1) : (visible.find((line) => line.prompt) ?? visible[0]));
  const rowId = (line: ReplayLine) => `${id}-${line.item.id}`;

  useEffect(() => {
    if (!focusPicked.current || !selected) return;
    focusPicked.current = false;
    const row = document.getElementById(rowId(selected));
    row?.focus({ preventScroll: true });
    row?.scrollIntoView?.({ block: "nearest" });
  });

  const select = useCallback((itemId: string) => setPicked(itemId), []);
  const reveal = (line: ReplayLine | undefined) => {
    if (!line) return;
    setFilter("all");
    setSearch("");
    if (line.fold) setOpenFolds((previous) => new Set(previous).add(line.fold!));
    // Jumping somewhere is a decision to stop following the end of the stream.
    pinned.current = false;
    setAutoScroll(false);
    focusPicked.current = true;
    setPicked(line.item.id);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const target = keyTarget(event.key, visible, selected);
    if (target) {
      event.preventDefault();
      focusPicked.current = true;
      setPicked(target.item.id);
    } else if (event.key === "e") {
      const errors = replay.lines.filter((line) => matchesFilter("error", line.item));
      if (!errors.length) return;
      event.preventDefault();
      const at = selected ? errors.indexOf(selected) : -1;
      reveal(errors[(at + 1) % errors.length]);
    } else if (event.key === "/") {
      event.preventDefault();
      searchInput.current?.focus();
    }
  };

  const conversation = replay.lines.filter((line) => line.item.kind !== "request");
  const latencyOf = (entry: EntrySummary) => records[entry.id]?.latencyMs ?? entry.latencyMs;
  const slowest = Math.max(1, ...windowEntries.map((entry) => latencyOf(entry) ?? 0));
  const hasContent = !!windowEntries.length;
  const listed = blocks.map((block) => {
    if ("fold" in block) {
      const fold = replay.folds.get(block.fold)!;
      const open = openFolds.has(fold.id);
      return (
        <button
          type="button"
          key={fold.id}
          className="flow-fold"
          aria-expanded={open}
          onClick={() =>
            setOpenFolds((previous) => {
              const next = new Set(previous);
              if (open) next.delete(fold.id);
              else next.add(fold.id);
              return next;
            })
          }
        >
          <ChevronRight size={13} className="flow-chevron" aria-hidden="true" />
          <strong>{fold.label}</strong>
          <span className="flow-zone-sub">{fold.sub}</span>
          <span className="flow-zone-action">{open ? "Hide" : "Show"}</span>
        </button>
      );
    }
    const { line, first } = block;
    const latency = latencyOf(line.entry);
    return (
      <div
        key={line.item.id}
        className={`replay-line ${first ? "replay-line-first" : ""} ${line.prompt ? "replay-line-prompt" : ""}`}
        data-entry={line.entry.id}
      >
        <span className="replay-gutter">
          {first && (
            <>
              <button
                type="button"
                className="replay-open"
                aria-label={`Inspect turn ${line.entry.seq}`}
                title={`Open ${entryFacts(line.entry, records[line.entry.id]).join(" · ")}`}
                onClick={() => onOpen(line.entry.id)}
              >
                #{line.entry.seq}
              </button>
              {latency != null && <span>{fmtMs(latency)}</span>}
            </>
          )}
        </span>
        <ItemRow
          item={line.item}
          domId={rowId(line)}
          query={query}
          outcomeText={line.meta}
          selected={selected?.item.id === line.item.id}
          onSelect={select}
        />
      </div>
    );
  });

  return (
    <section
      className="detail-panel h-full"
      aria-label={isLive ? "Live timeline" : "Session replay"}
    >
      <header className="detail-header timeline-header">
        <div>
          <h2>{isLive ? "Live stream" : "Session replay"}</h2>
          <p>
            {replay.promptEntries.size.toLocaleString()}{" "}
            {replay.promptEntries.size === 1 ? "prompt" : "prompts"} ·{" "}
            {conversation.length.toLocaleString()} events · {windowRecords.length.toLocaleString()} /{" "}
            {windowEntries.length.toLocaleString()} requests loaded
            {modelFilter && modelFilter !== "all" ? ` · ${modelFilter}` : ""}
          </p>
        </div>
        <div className="timeline-toolbar timeline-toolbar-inline">
          <label>
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(event) => {
                pinned.current = event.target.checked;
                setAutoScroll(event.target.checked);
                if (event.target.checked) {
                  // Following the stream again also lets the preview follow it.
                  if (isLive) setPicked(null);
                  scrollToEnd();
                }
              }}
            />
            Auto-scroll
          </label>
          <button
            type="button"
            className="button button-ghost button-sm icon-button"
            onClick={onExport}
            aria-label="Export session"
            title="Export session"
          >
            <ArrowDownToLine size={13} />
          </button>
        </div>
      </header>
      <div className="panel-body">
        <div className="flow-view replay-view">
          {hasContent && (
            <div className="replay-strip">
              <div
                className={`replay-bars ${windowEntries.length > 80 ? "replay-bars-dense" : ""}`}
                role="group"
                aria-label="Requests in this session"
              >
                {windowEntries.map((entry) => {
                  const record = records[entry.id];
                  const latency = latencyOf(entry);
                  return (
                    <button
                      type="button"
                      key={entry.id}
                      className={`replay-bar ${isSetup(entry) ? "replay-bar-setup" : ""} ${entryFailed(entry, record) ? "replay-bar-error" : ""} ${replay.promptEntries.has(entry.id) ? "replay-bar-prompt" : ""}`}
                      aria-label={`Go to request ${entry.seq}`}
                      aria-current={selected?.entry.id === entry.id ? "true" : undefined}
                      title={entryFacts(entry, record).join(" · ")}
                      onClick={() => reveal(firstLine.get(entry.id))}
                    >
                      <i />
                      <i
                        style={{
                          height: `${3 + Math.round(34 * Math.sqrt((latency ?? 0) / slowest))}px`,
                        }}
                      />
                    </button>
                  );
                })}
              </div>
              <div className="replay-strip-key">
                <span className="mono">{clock(windowEntries[0]?.ts)}</span>
                <div aria-label="How to read the request strip">
                  <span>
                    <i className="replay-key-prompt" />A prompt starts here
                  </span>
                  <span>
                    <i className="replay-key-request" />
                    Model request, taller is slower
                  </span>
                  <span>
                    <i className="replay-key-setup" />
                    Setup request
                  </span>
                  <span>
                    <i className="replay-key-error" />
                    Failed
                  </span>
                </div>
                <span className="mono">{clock(windowEntries.at(-1)?.ts)}</span>
              </div>
              {entries.length >= limit && (
                <p className="timeline-legend-note">
                  Showing up to {limit.toLocaleString()} requests per page. Session exports include
                  every request.
                </p>
              )}
            </div>
          )}
          {hasContent && (
            <FilterBar
              filters={FILTERS.map(([value, label]) => ({
                value,
                label,
                count: (value === "all" ? conversation : replay.lines).filter((line) =>
                  matchesFilter(value, line.item),
                ).length,
              }))}
              filter={filter}
              onFilter={setFilter}
              search={search}
              onSearch={setSearch}
              searchLabel="Find in this session"
              searchRef={searchInput}
              hint={KEY_HINT}
            />
          )}
          <div className={hasContent ? "flow-split" : "replay-empty"}>
            <div
              ref={viewport}
              className={hasContent ? "flow-list replay-list" : "replay-list"}
              data-testid="timeline-scroll"
              onKeyDown={onKeyDown}
              onScroll={(event) => {
                const element = event.currentTarget;
                if (
                  scrollTarget.current !== null &&
                  Math.abs(element.scrollTop - scrollTarget.current) < 1
                )
                  return;
                scrollTarget.current = null;
                const nearBottom =
                  element.scrollHeight - element.clientHeight - element.scrollTop < 40;
                pinned.current = nearBottom;
                setAutoScroll(nearBottom);
              }}
              aria-busy={loading}
            >
              {loading && (
                <p className="flow-zone-note replay-status" role="status">
                  <LoaderCircle size={13} className="loading-spinner" />
                  Loading captured requests…
                </p>
              )}
              {!hasContent && !loading && (
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
              {listed}
              {searching && hasContent && !visible.length && (
                <p className="flow-zone-note flow-no-match">
                  Nothing in this session matches.{" "}
                  <button
                    type="button"
                    className="flow-link"
                    onClick={() => {
                      setFilter("all");
                      setSearch("");
                    }}
                  >
                    Clear the filter
                  </button>
                </p>
              )}
            </div>
            {hasContent && (
              <ItemPreview
                item={selected?.item}
                where={selected?.where}
                facts={selected ? entryFacts(selected.entry, records[selected.entry.id]) : undefined}
                actions={
                  selected && (
                    <button
                      type="button"
                      className="flow-link"
                      onClick={() => onOpen(selected.entry.id)}
                    >
                      Open request #{selected.entry.seq}
                      <ArrowUpRight size={11} aria-hidden="true" />
                    </button>
                  )
                }
              />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
