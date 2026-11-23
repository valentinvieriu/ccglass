import { ArrowDownToLine, ArrowUpFromLine, Clock3, Layers } from "lucide-react";
import { fmt, fmtMs, pct } from "../lib/format";
import type { EntrySummary, SessionStats } from "../types";

export function SessionMetrics({
  entries,
  stats,
  model,
}: {
  entries: EntrySummary[];
  stats: SessionStats | null;
  model: string;
}) {
  const scoped = entries.filter((entry) => model === "all" || entry.model === model);
  const complete = scoped.filter((entry) => entry.latencyMs != null);
  const avg = complete.length
    ? complete.reduce((total, entry) => total + entry.latencyMs!, 0) / complete.length
    : null;
  const max = complete.reduce((value, entry) => Math.max(value, entry.latencyMs!), 1);
  return (
    <section aria-label="Session statistics" className="metrics-grid">
      <article className="metric-card">
        <div className="metric-label">
          <ArrowDownToLine size={13} />
          Input tokens
        </div>
        <div className="metric-value">{fmt(stats?.totalInput)}</div>
        <div className="metric-trend">Including cached input</div>
      </article>
      <article className="metric-card">
        <div className="metric-label">
          <ArrowUpFromLine size={13} />
          Output tokens
        </div>
        <div className="metric-value">{fmt(stats?.totalOutput)}</div>
        <div className="metric-trend">Across {fmt(stats?.completed)} completed requests</div>
      </article>
      <article className="metric-card">
        <div className="metric-label">
          <Layers size={13} />
          Cache hit rate
        </div>
        <div className="metric-value">{stats ? pct(stats.cacheHitRate) : "—"}</div>
        <div className="metric-trend">
          {stats?.totalUsd != null
            ? `$${stats.totalUsd.toFixed(4)} estimated usage`
            : "Reused input tokens"}
        </div>
      </article>
      <article className="metric-card">
        <div className="metric-label">
          <Clock3 size={13} />
          Average latency
        </div>
        <div className="metric-value">{fmtMs(avg)}</div>
        <div className="metric-trend">
          Max {complete.length ? fmtMs(max) : "—"} · {complete.length}/{scoped.length} done
        </div>
        <div className="metric-chart" aria-label="Latency trend">
          {scoped.slice(-30).map((entry) => (
            <span
              key={entry.id}
              style={{
                height: `${entry.latencyMs == null ? 12 : Math.max(8, (entry.latencyMs / max) * 100)}%`,
              }}
              title={`#${entry.seq} ${entry.model || ""} · ${entry.latencyMs == null ? "pending" : fmtMs(entry.latencyMs)}`}
            />
          ))}
        </div>
      </article>
    </section>
  );
}
