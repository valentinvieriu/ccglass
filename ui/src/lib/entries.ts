import type { EntrySummary } from "../types";
export function mergeEntries(
  snapshot: EntrySummary[],
  liveUpdates: Iterable<EntrySummary>,
): EntrySummary[] {
  const byId = new Map(snapshot.map((entry) => [entry.id, entry]));
  for (const entry of liveUpdates) byId.set(entry.id, entry);
  return [...byId.values()].sort((a, b) => (a.seq || 0) - (b.seq || 0));
}
export function visibleEntries(entries: EntrySummary[], model = "all", errorsOnly = false) {
  return entries.filter(
    (entry) =>
      (model === "all" || entry.model === model) &&
      (!errorsOnly || (entry.status ?? 0) >= 400 || entry.error != null),
  );
}
export function groupRetries(entries: EntrySummary[], windowMs = 60_000) {
  const groups: (EntrySummary & { retries: EntrySummary[] })[] = [];
  for (const entry of entries) {
    const group = groups.at(-1);
    const lastTs = group?.retries.at(-1)?.ts ?? group?.ts;
    if (
      group &&
      group.url === entry.url &&
      group.model === entry.model &&
      group.nMessages === entry.nMessages &&
      entry.ts - (lastTs || 0) < windowMs
    )
      group.retries.push(entry);
    else groups.push({ ...entry, retries: [] });
  }
  return groups;
}
