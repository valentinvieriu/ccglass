import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeftRight, ArrowRight, Columns2, GitCompareArrows, Minus, Plus } from "lucide-react";
import { api } from "../api";
import type { DiffResult, EntrySummary, RequestRecord } from "../types";
import { ContentBlock } from "./JsonView";
import { MetricCard } from "./RequestDetail";

export interface DiffViewProps {
  picks: string[];
  records: Record<string, RequestRecord>;
  entries?: EntrySummary[];
  session?: string | null;
  selected?: string | null;
  onPicksChange?: (picks: string[]) => void;
}

type RequestOption = { id: string; seq?: number; ts?: number; model?: string | null };
const emptyEntries: EntrySummary[] = [];

function adjacentPair(options: RequestOption[], selected?: string | null): string[] {
  if (!options.length) return [];
  if (options.length === 1) return [options[0].id];
  const index = options.findIndex((option) => option.id === selected);
  const end = index > 0 ? index : index === 0 ? 1 : options.length - 1;
  return [options[end - 1].id, options[end].id];
}

export default function DiffView({
  picks,
  records,
  entries = emptyEntries,
  session,
  selected,
  onPicksChange,
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
  function label(id: string) {
    const record = optionsById.get(id) || records[id];
    return record?.seq != null
      ? `Request ${String(record.seq).padStart(3, "0")}${record.model ? ` · ${record.model}` : ""}`
      : id;
  }

  const diff =
    comparison && comparison.a === a && comparison.b === b ? comparison.result : undefined;
  const error =
    comparison && comparison.a === a && comparison.b === b ? comparison.error : undefined;
  const selectable = [...options];
  for (const id of [a, b])
    if (id && !selectable.some((option) => option.id === id)) selectable.push({ id });

  return (
    <section
      className="diff-view flex min-h-0 flex-1 flex-col overflow-auto"
      aria-label="Compare requests"
    >
      <div className="detail-header">
        <div>
          <span className="eyebrow">CONTEXT CHANGES</span>
          <h2 className="flex items-center gap-2">
            <GitCompareArrows size={22} />
            Compare requests
          </h2>
          <p>Compare any two requests, including older captures not loaded in the inspector.</p>
        </div>
      </div>
      <div className="p-5">
        <div className="diff-picker">
          {(["A · baseline", "B · comparison"] as const).map((title, index) => (
            <div key={title} className="flex min-w-0 flex-1 flex-col gap-2">
              <label htmlFor={`diff-request-${index}`} className="font-medium text-ink">
                {title}
              </label>
              <select
                id={`diff-request-${index}`}
                className="filter-select w-full flex-none!"
                value={(index === 0 ? a : b) || ""}
                onChange={(event) =>
                  changePicks(
                    index === 0 ? [event.target.value, b || ""] : [a || "", event.target.value],
                  )
                }
              >
                <option value="">Select {index === 0 ? "baseline" : "comparison"} request</option>
                {selectable.map((option) => (
                  <option key={option.id} value={option.id}>
                    {label(option.id)} · {option.id}
                  </option>
                ))}
              </select>
              <small className="mono break-all muted">
                {(index === 0 ? a : b) || "No request selected"}
              </small>
            </div>
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
            disabled={!options.length || indexLoading}
            onClick={() => changePicks(adjacentPair(options, b || selected))}
          >
            Adjacent requests
          </button>
        </div>
        <details className="mb-4 text-xs muted">
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
          <p role="status" className="mb-3 text-xs muted">
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
            <h3>{a ? "Choose a second request" : "A closer look at every change"}</h3>
            <p>Select a baseline and comparison above or pick requests in the sidebar.</p>
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
            <div className="inspector-metrics grid grid-cols-2 gap-3 lg:grid-cols-4 mb-5">
              <MetricCard label="Added in B" value={`+${diff.counts.added}`} tone="success" />
              <MetricCard label="Removed from A" value={`−${diff.counts.removed}`} tone="danger" />
              <MetricCard label="Unchanged" value={diff.counts.common} />
              <MetricCard label="Cached in B" value={diff.counts.cachedInB} />
            </div>
            <div className="diff-grid">
              <section className="min-w-0">
                <h3 className="mb-3 flex items-center gap-2 text-sm text-danger">
                  <Minus size={16} />
                  Removed from A <span className="badge">{diff.counts.removed}</span>
                </h3>
                {diff.removed.length ? (
                  diff.removed.map((block, index) => (
                    <ContentBlock
                      key={`${block.label}-${index}`}
                      title={block.label || block.kind || "Content block"}
                      value={block.text}
                      tags={
                        block.cache ? (
                          <span className="badge badge-success">cached</span>
                        ) : undefined
                      }
                      className="diff-remove mb-3"
                    />
                  ))
                ) : (
                  <p className="text-xs muted">No content was removed.</p>
                )}
              </section>
              <section className="min-w-0">
                <h3 className="mb-3 flex items-center gap-2 text-sm text-success">
                  <Plus size={16} />
                  Added in B <span className="badge">{diff.counts.added}</span>
                </h3>
                {diff.added.length ? (
                  diff.added.map((block, index) => (
                    <ContentBlock
                      key={`${block.label}-${index}`}
                      title={block.label || block.kind || "Content block"}
                      value={block.text}
                      tags={
                        block.cache ? (
                          <span className="badge badge-success">cached</span>
                        ) : undefined
                      }
                      className="diff-add mb-3"
                    />
                  ))
                ) : (
                  <p className="text-xs muted">No content was added.</p>
                )}
              </section>
            </div>
            {!!diff.common.length && (
              <details className="mt-5 rounded-md border border-border p-3">
                <summary className="text-xs text-muted">
                  {diff.common.length} unchanged context blocks
                </summary>
                <div className="mt-3 space-y-3">
                  {diff.common.map((block, index) => (
                    <ContentBlock
                      key={`${block.label}-${index}`}
                      title={block.label || block.kind || "Unchanged block"}
                      value={block.text}
                      tags={
                        block.cache ? (
                          <span className="badge badge-success">cached</span>
                        ) : undefined
                      }
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
