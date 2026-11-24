import type { EntrySummary } from "../types";
export function mergeEntries(
  snapshot: EntrySummary[],
  liveUpdates: Iterable<EntrySummary>,
): EntrySummary[] {
  const byId = new Map(snapshot.map((entry) => [entry.id, entry]));
  for (const entry of liveUpdates) byId.set(entry.id, entry);
  return [...byId.values()].sort((a, b) => (a.seq || 0) - (b.seq || 0));
}
/**
 * The proxy's note that the client closed the connection before the response
 * finished (src/proxy.js). That is nearly always a person or the agent
 * stopping a stream, so it is told apart from the API failing.
 */
export const isCancelError = (error: unknown) => error === "client disconnected";
/** Said wherever a cancelled request is explained, so it reads the same everywhere. */
export const CANCELLED_NOTE = "the client closed the connection before the response finished";
export const isCancelled = (entry: EntrySummary) =>
  (entry.status ?? 0) < 400 && isCancelError(entry.error);
/** A request that came back with an error status, or never got a response. */
export const isFailed = (entry: EntrySummary) =>
  (entry.status ?? 0) >= 400 || (entry.error != null && !isCancelError(entry.error));
/** How a request ended, in the three ways the dashboard tells apart. */
export type Outcome = "ok" | "error" | "cancelled" | "pending";

/**
 * The request to compare one with to see what it added: the one before it to
 * the same model. A session can interleave models (a small one for titles, say),
 * and those conversations do not build on each other.
 */
export function previousRequest(entries: EntrySummary[], id: string) {
  const at = entries.findIndex((entry) => entry.id === id);
  if (at < 0) return undefined;
  const model = entries[at].model ?? null;
  for (let index = at - 1; index >= 0; index--) {
    const entry = entries[index];
    if ((entry.model ?? null) === model && (entry.model || entry.nMessages)) return entry;
  }
  return undefined;
}
export function visibleEntries(entries: EntrySummary[], model = "all", errorsOnly = false) {
  return entries.filter(
    (entry) => (model === "all" || entry.model === model) && (!errorsOnly || isFailed(entry)),
  );
}
/**
 * A click in the request list while comparing. The clicked request becomes B,
 * the comparison: A is the baseline the reader chose and stays put. Clicking A
 * itself swaps the two, and with no baseline yet A is the request before B.
 */
export function comparePick(entries: EntrySummary[], picks: string[], id: string): string[] {
  const [a = "", b = ""] = picks;
  if (id === b) return [a, b];
  if (id === a) return [b, a];
  return [a || previousRequest(entries, id)?.id || "", id];
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
