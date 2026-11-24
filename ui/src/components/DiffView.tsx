import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowLeftRight, ArrowRight, Columns2, Minus, Plus } from "lucide-react";
import { api } from "../api";
import type { ContentBlock as Block, DiffResult, EntrySummary, RequestRecord } from "../types";
import { previousRequest } from "../lib/entries";
import { plural } from "../lib/format";
import { requestLabel } from "../lib/requestRow";
import { ContentBlock } from "./JsonView";

export interface DiffViewProps {
  picks: string[];
  records: Record<string, RequestRecord>;
  entries?: EntrySummary[];
  session?: string | null;
  selected?: string | null;
  onPicksChange?: (picks: string[]) => void;
  /** The request Compare was opened from, to return to it. */
  back?: { seq: number; open: () => void };
}

type RequestOption = Pick<EntrySummary, "id"> & Partial<EntrySummary>;
const emptyEntries: EntrySummary[] = [];

/** B and the request before it to the same model: what B added. */
function adjacentPair(options: RequestOption[], selected?: string | null): string[] {
  if (!options.length) return [];
  if (options.length === 1) return [options[0].id];
  const index = options.findIndex((option) => option.id === selected);
  const end = index > 0 ? index : index === 0 ? 1 : options.length - 1;
  const before = previousRequest(options as EntrySummary[], options[end].id);
  return [(before ?? options[end - 1]).id, options[end].id];
}

function Blocks({ side, blocks }: { side: "added" | "removed"; blocks: Block[] }) {
  const added = side === "added";
  return (
    <section className="min-w-0" aria-label={added ? "Added in B" : "Removed from A"}>
      <h3 className={`diff-side-title ${added ? "text-success" : "text-danger"}`}>
        {added ? <Plus size={15} /> : <Minus size={15} />}
        {added ? "Added in B" : "Removed from A"} <span className="badge">{blocks.length}</span>
      </h3>
      {blocks.map((block, index) => (
        <ContentBlock
          key={`${block.label}-${index}`}
          title={block.label || block.kind || "Content block"}
          value={block.text}
          tags={block.cache ? <span className="badge">cached</span> : undefined}
          className={`${added ? "diff-add" : "diff-remove"} mb-3`}
        />
      ))}
    </section>
  );
}

export default function DiffView({
  picks,
  records,
  entries = emptyEntries,
  session,
  selected,
  onPicksChange,
  back,
}: DiffViewProps) {
  const [localPicks, setLocalPicks] = useState<string[]>(picks);
  const [sessionEntries, setSessionEntries] = useState<EntrySummary[]>([]);
  const [indexError, setIndexError] = useState<string | null>(null);
  const [indexLoading, setIndexLoading] = useState(false);
  const [indexReady, setIndexReady] = useState<string | null>(null);
  const [comparison, setComparison] = useState<{
    a: string;
    b: string;
    result?: DiffResult;
    error?: string;
  } | null>(null);
  const initialized = useRef(false);
  const [externalA, externalB] = picks;
  const [a, b] = onPicksChange ? picks : localPicks;

  useEffect(() => {
    if (!onPicksChange) setLocalPicks([externalA || "", externalB || ""]);
  }, [externalA, externalB, onPicksChange]);

  useEffect(() => {
    initialized.current = false;
    setSessionEntries([]);
    setIndexError(null);
    setIndexReady(null);
    if (!session) {
      setIndexLoading(false);
      return;
    }
    const controller = new AbortController();
    setIndexLoading(true);
    api<{ entries: EntrySummary[] }>(`/api/requests?${new URLSearchParams({ session })}`, {
      signal: controller.signal,
    })
      .then((result) => {
        if (!controller.signal.aborted) setSessionEntries(result.entries);
      })
      .catch((reason) => {
        if (!controller.signal.aborted)
          setIndexError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIndexLoading(false);
          setIndexReady(session);
        }
      });
    return () => controller.abort();
  }, [session]);

  const options = useMemo(() => {
    const all = new Map<string, RequestOption>();
    for (const entry of [...sessionEntries, ...entries]) all.set(entry.id, entry);
    for (const record of Object.values(records)) {
      if (!session || record.session === session || record.id.startsWith(`${session}/`)) {
        const summary = all.get(record.id);
        all.set(record.id, {
          ...summary,
          id: record.id,
          seq: record.seq ?? summary?.seq,
          ts: record.ts ?? summary?.ts,
          model: record.model ?? summary?.model,
        });
      }
    }
    return [...all.values()].sort(
      (left, right) =>
        (left.ts ?? 0) - (right.ts ?? 0) ||
        (left.seq ?? 0) - (right.seq ?? 0) ||
        left.id.localeCompare(right.id),
    );
  }, [sessionEntries, entries, records, session]);

  useEffect(() => {
    if (initialized.current) return;
    if (a || b) {
      initialized.current = true;
      return;
    }
    // Wait for the complete index so the baseline can be an unloaded request.
    if ((session && indexReady !== session) || indexLoading || !options.length) return;
    initialized.current = true;
    const next = adjacentPair(options, selected);
    if (onPicksChange) onPicksChange(next);
    else setLocalPicks(next);
  }, [a, b, session, indexReady, indexLoading, options, selected, onPicksChange]);

  useEffect(() => {
    setComparison(null);
    if (!a || !b) return;
    const controller = new AbortController();
    api<DiffResult>(`/api/diff?${new URLSearchParams({ a, b })}`, { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) setComparison({ a, b, result });
      })
      .catch((reason) => {
        if (!controller.signal.aborted)
          setComparison({ a, b, error: reason instanceof Error ? reason.message : String(reason) });
      });
    return () => controller.abort();
  }, [a, b]);

  function changePicks(next: string[]) {
    initialized.current = true;
    if (onPicksChange) onPicksChange(next);
    else setLocalPicks(next);
  }

  const optionsById = useMemo(
    () => new Map(options.map((option) => [option.id, option])),
    [options],
  );
  // One model in the whole session says nothing in every option.
  const showModel = new Set(options.map((option) => option.model).filter(Boolean)).size > 1;
  const label = (id: string) => {
    const option = optionsById.get(id);
    return option || records[id] ? requestLabel(option ?? { id }, records[id], showModel) : id;
  };
  const seqOf = (id: string | undefined) =>
    id ? (optionsById.get(id)?.seq ?? records[id]?.seq) : undefined;
  const name = (id: string | undefined) => (seqOf(id) != null ? `#${seqOf(id)}` : id || "");

  const diff =
    comparison && comparison.a === a && comparison.b === b ? comparison.result : undefined;
  const error =
    comparison && comparison.a === a && comparison.b === b ? comparison.error : undefined;
  const selectable = [...options];
  for (const id of [a, b])
    if (id && !selectable.some((option) => option.id === id)) selectable.push({ id });
  // Requests only grow, so a later baseline shows up as everything "removed".
  const backwards = (seqOf(a) ?? 0) > (seqOf(b) ?? Infinity);

  return (
    <section
      className="diff-view flex min-h-0 flex-1 flex-col overflow-auto"
      aria-label="Compare requests"
    >
      <div className="detail-header">
        <div className="detail-header-main">
          <h2>Compare requests</h2>
          <p className="truncate">
            {a && b
              ? `What request ${name(b)} sent that ${name(a)} did not.`
              : "What one request sent that another did not."}
          </p>
        </div>
        {back && (
          <div className="detail-header-actions">
            <button
              type="button"
              className="button button-ghost button-sm"
              title="Back to the request (Esc)"
              onClick={back.open}
            >
              <ArrowLeft size={14} />
              Back to request #{back.seq}
            </button>
          </div>
        )}
      </div>
      <div className="diff-body">
        <div className="diff-picker">
          {(["A · baseline", "B · comparison"] as const).map((title, index) => (
            <label key={title} className="diff-pick">
              <span aria-hidden="true">
                <b className="request-pick">{index ? "B" : "A"}</b>
                {index ? "Comparison" : "Baseline"}
              </span>
              <select
                className="filter-select"
                aria-label={title}
                value={(index === 0 ? a : b) || ""}
                onChange={(event) =>
                  changePicks(
                    index === 0 ? [event.target.value, b || ""] : [a || "", event.target.value],
                  )
                }
              >
                <option value="">Select {index === 0 ? "baseline" : "comparison"} request</option>
                {selectable.map((option) => (
                  <option key={option.id} value={option.id} title={option.id}>
                    {label(option.id)}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <button
            type="button"
            className="button button-sm"
            aria-label="Swap baseline and comparison"
            disabled={!a && !b}
            onClick={() => changePicks([b || "", a || ""])}
          >
            <ArrowLeftRight size={14} />
            Swap
          </button>
          <button
            type="button"
            className="button button-sm"
            title="Set A to the request before B, to see what B added"
            disabled={!options.length || indexLoading}
            onClick={() => changePicks(adjacentPair(options, b || selected))}
          >
            Previous as A
          </button>
          <p className="diff-hint">Click a request in the list to make it B.</p>
        </div>
        <details className="mb-4 text-meta muted">
          <summary>Compare by request ID</summary>
          <p className="my-2">
            Enter a capture ID directly to compare requests outside the current list or session.
          </p>
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              changePicks([String(data.get("a") || "").trim(), String(data.get("b") || "").trim()]);
            }}
            key={`${a || ""}:${b || ""}`}
          >
            <label className="flex min-w-0 flex-1 flex-col gap-1">
              Baseline request ID
              <input
                className="search-input pl-2!"
                name="a"
                required
                defaultValue={a || ""}
                placeholder="session/request-id"
              />
            </label>
            <ArrowRight size={14} />
            <label className="flex min-w-0 flex-1 flex-col gap-1">
              Comparison request ID
              <input
                className="search-input pl-2!"
                name="b"
                required
                defaultValue={b || ""}
                placeholder="session/request-id"
              />
            </label>
            <button type="submit" className="button button-sm">
              Compare IDs
            </button>
          </form>
        </details>
        {indexLoading && (
          <p role="status" className="mb-3 text-meta muted">
            Loading all requests in this session…
          </p>
        )}
        {indexError && (
          <p role="status" className="alert mb-3">
            Request choices could not be loaded: {indexError}. You can still compare by request ID.
          </p>
        )}
        {!a || !b ? (
          <div className="empty-state">
            <Columns2 size={34} />
            <h3>{a || b ? "Choose a second request" : "Choose two requests"}</h3>
            <p>Select a baseline and a comparison above, or click a request in the list.</p>
          </div>
        ) : error || diff?.error ? (
          <div role="alert" className="alert">
            Could not compare requests: {error || diff?.error}
          </div>
        ) : !diff ? (
          <div className="empty-state" role="status">
            Comparing request context…
          </div>
        ) : (
          <div>
            {/* One line of counts; a count of nothing is said in words. */}
            <p className="request-facts diff-summary" aria-label="Comparison result">
              <span className={diff.counts.added ? "text-success" : undefined}>
                {diff.counts.added ? `+${diff.counts.added} added in B` : "nothing added in B"}
              </span>
              <span className={diff.counts.removed ? "text-danger" : undefined}>
                {diff.counts.removed
                  ? `−${diff.counts.removed} removed from A`
                  : "nothing removed from A"}
              </span>
              <span>{diff.counts.common} unchanged</span>
              {diff.counts.cachedInB > 0 && (
                <span title="Blocks of B that end a cacheable prefix">
                  {plural(diff.counts.cachedInB, "cache breakpoint")} in B
                </span>
              )}
            </p>
            {backwards && !!diff.removed.length && (
              <p className="diff-note">
                A is the later request, so what it added reads as removed.{" "}
                <button type="button" className="flow-link" onClick={() => changePicks([b, a])}>
                  Swap A and B
                </button>
              </p>
            )}
            {!diff.added.length && !diff.removed.length ? (
              <p className="diff-note">A and B send the same context.</p>
            ) : (
              // A conversation only grows, so one side is usually empty: it then
              // gets a line above instead of half the width.
              <div className={diff.added.length && diff.removed.length ? "diff-grid" : undefined}>
                {!!diff.removed.length && <Blocks side="removed" blocks={diff.removed} />}
                {!!diff.added.length && <Blocks side="added" blocks={diff.added} />}
              </div>
            )}
            {!!diff.common.length && (
              <details className="mt-5 rounded-control border border-border p-3">
                <summary className="text-meta text-muted">
                  {plural(diff.common.length, "unchanged context block")}
                </summary>
                <div className="mt-3 space-y-3">
                  {diff.common.map((block, index) => (
                    <ContentBlock
                      key={`${block.label}-${index}`}
                      title={block.label || block.kind || "Unchanged block"}
                      value={block.text}
                      tags={block.cache ? <span className="badge">cached</span> : undefined}
                    />
                  ))}
                </div>
              </details>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
