import type { ReactNode } from "react";
import { BarChart3 } from "lucide-react";
import type { SessionStats, UsageBucket, UsageModel, UsageSummary } from "../types";
import { fmt, fmtCompact, fmtCost, pctOf, plural } from "../lib/format";
import { MiddleTruncate } from "./MiddleTruncate";

/** The token numbers every usage row has; cache writes are not known everywhere. */
export type TokenBucket = Pick<UsageBucket, "requests" | "output" | "cacheRead" | "totalInput"> &
  Partial<Pick<UsageBucket, "input" | "cacheWrite" | "cacheHitRate" | "usd">>;

// Everything sent to the model, cached or not: the one meaning of "input" in the dashboard.
export const totalInput = (bucket: TokenBucket) =>
  bucket.totalInput ?? (bucket.input || 0) + (bucket.cacheRead || 0) + (bucket.cacheWrite || 0);

function cacheHitRate(bucket: TokenBucket) {
  const total = totalInput(bucket);
  const rate = bucket.cacheHitRate ?? (total > 0 ? (bucket.cacheRead || 0) / total : 0);
  return Number.isFinite(rate) ? Math.max(0, Math.min(1, rate)) : 0;
}

export const hasCost = (bucket: TokenBucket) =>
  typeof bucket.usd === "number" && Number.isFinite(bucket.usd);
export const costLabel = (bucket: TokenBucket) => (hasCost(bucket) ? fmtCost(bucket.usd) : "—");

/** A session's stats in the shape the usage tables read. */
export function statsBucket(stats: SessionStats): TokenBucket {
  return {
    requests: stats.total,
    totalInput: stats.totalInput,
    cacheRead: Math.round(stats.totalInput * stats.cacheHitRate),
    cacheHitRate: stats.cacheHitRate,
    output: stats.totalOutput,
  };
}

/** A count short enough to scan, with the exact number one hover away. */
function Compact({ value }: { value: number | null | undefined }) {
  return <span title={value == null ? undefined : `${fmt(value)} tokens`}>{fmtCompact(value)}</span>;
}

export function StatCard({
  label,
  value,
  note,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
}) {
  return (
    <div className="detail-stat">
      <div className="detail-stat-label">{label}</div>
      <div className="detail-stat-value">{value}</div>
      {note != null && <div className="detail-stat-sub">{note}</div>}
    </div>
  );
}

/** The totals of whatever is being looked at: every session, or one. */
export function UsageTotals({
  bucket,
  requests,
}: {
  bucket: TokenBucket;
  /** The first card: how many requests the totals are about. */
  requests: { label: string; value: number; note: ReactNode };
}) {
  const total = totalInput(bucket);
  return (
    <div className="usage-totals">
      <StatCard label={requests.label} value={fmt(requests.value)} note={requests.note} />
      <StatCard
        label="Input (total)"
        value={<Compact value={total} />}
        note="tokens, including cached"
      />
      <StatCard
        label="of which cached"
        value={<Compact value={bucket.cacheRead} />}
        note={`${pctOf(bucket.cacheRead, total)} of input`}
      />
      {bucket.cacheWrite != null && (
        <StatCard label="Cache write" value={<Compact value={bucket.cacheWrite} />} note="tokens" />
      )}
      <StatCard label="Output" value={<Compact value={bucket.output} />} note="tokens" />
      {hasCost(bucket) && <StatCard label="Total estimated cost" value={costLabel(bucket)} />}
    </div>
  );
}

export const TOKEN_COLUMNS = ["Input (total)", "of which cached", "Cached share", "Output"];

/** The token columns shared by every usage table, in the order a context is read. */
export function TokenCells({ bucket, meterLabel }: { bucket: TokenBucket; meterLabel: string }) {
  const total = totalInput(bucket);
  return (
    <>
      <td className="numeric">{fmt(total)}</td>
      <td className="numeric">{fmt(bucket.cacheRead)}</td>
      <td className="numeric">
        <div className="cache-share">
          <meter min={0} max={1} value={cacheHitRate(bucket)} aria-label={meterLabel} />
          {pctOf(bucket.cacheRead, total)}
        </div>
      </td>
      <td className="numeric">{fmt(bucket.output)}</td>
    </>
  );
}

export function ModelTable({
  rows,
  cacheWrite = false,
}: {
  rows: (TokenBucket & { model: string })[];
  /** Whether the rows know how much was written to the cache. */
  cacheWrite?: boolean;
}) {
  if (!rows.length) return <div className="empty-state">No measured requests yet.</div>;
  const showCost = rows.some(hasCost);
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">Model</th>
            <th scope="col" className="numeric">
              Requests
            </th>
            {TOKEN_COLUMNS.map((name) => (
              <th scope="col" className="numeric" key={name}>
                {name}
              </th>
            ))}
            {cacheWrite && (
              <th scope="col" className="numeric">
                Cache write
              </th>
            )}
            {showCost && (
              <th scope="col" className="numeric">
                Estimated cost
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.model}>
              <td className="model-cell">
                <MiddleTruncate text={row.model} />
              </td>
              <td className="numeric">{fmt(row.requests)}</td>
              <TokenCells bucket={row} meterLabel={`Cache hit rate for ${row.model}`} />
              {cacheWrite && <td className="numeric">{fmt(row.cacheWrite)}</td>}
              {showCost && <td className="numeric">{costLabel(row)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Usage across every captured session: the totals, then each model. */
export function AllUsage({ usage }: { usage: UsageSummary }) {
  return (
    <div className="usage-body">
      <UsageTotals
        bucket={usage.totals}
        requests={{
          label: "Requests with usage",
          value: usage.requestCount,
          note: usage.unmeasured ? (
            <span title="Failed, cancelled and non-model requests come back without token counts, so the totals here leave them out.">
              {plural(usage.unmeasured, "request")} returned no usage data
            </span>
          ) : (
            "Across all sessions"
          ),
        }}
      />
      <h3 className="usage-heading">By model</h3>
      <ModelTable rows={usage.byModel as UsageModel[]} cacheWrite />
    </div>
  );
}

/** One session's usage: its totals, then each model it called. */
export function SessionUsage({
  stats,
  loading,
}: {
  /** The session overall, followed by one entry per model. */
  stats: SessionStats[] | null;
  loading: boolean;
}) {
  if (!stats)
    return (
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
    );
  const [all, ...models] = stats;
  if (!all.total)
    return (
      <div className="empty-state">
        <BarChart3 size={32} />
        <h3>No requests in this session</h3>
        <p>Usage appears here once a request has come through.</p>
      </div>
    );
  const unfinished = all.total - all.completed;
  return (
    <div className="usage-body">
      <UsageTotals
        bucket={statsBucket(all)}
        requests={{
          label: "Requests",
          value: all.total,
          note: unfinished ? (
            <span title="Failed, cancelled and pending requests report no token counts, so the totals here leave them out.">
              {plural(unfinished, "request")} returned no usage data
            </span>
          ) : (
            "all returned usage data"
          ),
        }}
      />
      <h3 className="usage-heading">By model</h3>
      <ModelTable rows={models.map((row) => ({ model: row.model, ...statsBucket(row) }))} />
    </div>
  );
}
