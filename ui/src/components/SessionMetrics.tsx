import { sessionFacts } from "../lib/session";
import type { EntrySummary, SessionStats } from "../types";

/** The session's totals as one line of its header, not a band of cards above it. */
export function SessionMetrics({
  entries,
  stats,
  model,
}: {
  entries: EntrySummary[];
  stats: SessionStats | null;
  model: string;
}) {
  const facts = sessionFacts(entries, stats, model);
  return (
    <p className="session-facts" aria-label="Session statistics">
      {facts.map((fact) => (
        <span key={fact.text} title={fact.title}>
          {fact.text}
        </span>
      ))}
    </p>
  );
}
