import type { EntrySummary, RequestRecord, SessionStats } from "../types";
import { isCancelled, isFailed } from "./entries";
import { fmt, fmtCompact, fmtMs, pct, plural } from "./format";
import { requestLead } from "./requestRow";

export interface SessionFact {
  /** Short enough to sit in one line with the others. */
  text: string;
  /** The exact numbers behind it, in the full vocabulary. */
  title: string;
}

/**
 * A session in one line:
 * "21 requests · 1.06M tokens in (97% cached) · 4.46k tokens out · avg 3.99s".
 * Input always means everything sent, cached or not, as it does on a request.
 */
export function sessionFacts(
  entries: EntrySummary[],
  stats: SessionStats | null,
  model = "all",
): SessionFact[] {
  const scoped = entries.filter((entry) => model === "all" || entry.model === model);
  const finished = scoped.filter((entry) => entry.latencyMs != null);
  const facts: SessionFact[] = [
    {
      // A model filter narrows every number on the line, so the line says so.
      text: plural(scoped.length, "request") + (model === "all" ? "" : ` to ${model}`),
      title: `${finished.length.toLocaleString("en-US")} of ${plural(scoped.length, "request")} finished`,
    },
  ];
  // A rate of nothing is not 0%: an empty session has no cache result to report.
  if (stats?.totalInput) {
    const cached = Math.round(stats.totalInput * stats.cacheHitRate);
    facts.push({
      text: `${fmtCompact(stats.totalInput)} tokens in (${pct(stats.cacheHitRate)} cached)`,
      title: `Input (total): ${fmt(stats.totalInput)} tokens, of which cached: ${fmt(cached)}`,
    });
  }
  if (stats?.totalOutput)
    facts.push({
      text: `${fmtCompact(stats.totalOutput)} tokens out`,
      title: `Output: ${fmt(stats.totalOutput)} tokens from ${plural(stats.completed, "request")}`,
    });
  if (finished.length) {
    const total = finished.reduce((sum, entry) => sum + entry.latencyMs!, 0);
    const slowest = Math.max(...finished.map((entry) => entry.latencyMs!));
    facts.push({
      text: `avg ${fmtMs(total / finished.length)}`,
      title: `Average latency ${fmtMs(total / finished.length)} · slowest ${fmtMs(slowest)}`,
    });
  }
  return facts;
}

/** What tells one session from another in a list of them. */
export interface SessionIdentity {
  requests: number;
  models: string[];
  failed: number;
  cancelled: number;
  /** What the person first asked, when the first request carries a typed prompt. */
  prompt: string | null;
}

/** The first request that carries a conversation: not a model listing or a probe. */
export const firstConversation = (entries: EntrySummary[]) =>
  entries.find((entry) => entry.model || entry.nMessages);

export function sessionIdentity(
  entries: EntrySummary[],
  first?: RequestRecord | null,
): SessionIdentity {
  const lead = first ? requestLead(first) : null;
  return {
    requests: entries.length,
    models: [...new Set(entries.map((entry) => entry.model).filter((model): model is string => !!model))].sort(),
    failed: entries.filter(isFailed).length,
    cancelled: entries.filter(isCancelled).length,
    prompt: lead?.kind === "prompt" ? lead.text : null,
  };
}

/** "nemotron-3.5" for one model, "3 models" for several, nothing for none. */
export const modelsLabel = (models: string[]) =>
  models.length > 1 ? plural(models.length, "model") : (models[0] ?? "");
