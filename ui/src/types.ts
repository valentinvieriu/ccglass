/** Captured provider payloads are intentionally extensible. Core UI fields are typed. */
export type JsonObject = Record<string, any>;
export type CaptureAction = "start" | "stop" | "reset" | "delete";
export interface EntrySummary {
  id: string;
  session: string;
  seq: number;
  ts: number;
  startedAt?: number | null;
  method?: string;
  url?: string;
  model?: string | null;
  format?: string | null;
  status?: number | null;
  latencyMs?: number | null;
  pending?: boolean;
  /** The reply is arriving now; the record holds what came so far. */
  streaming?: boolean;
  error?: unknown;
  nMessages?: number;
  nTools?: number;
  nToolUse?: number;
}
export interface SessionsSnapshot {
  sessions: string[];
  live: string | null;
  controllable: boolean;
  reset?: string | null;
}
export interface ContentBlock {
  label?: string;
  text?: string;
  role?: string;
  type?: string;
  kind?: string;
  cache?: boolean;
  name?: string;
  callId?: string;
  isError?: boolean;
  id?: string;
  thinking?: string;
  input?: JsonObject;
  [key: string]: any;
}
export interface ToolDefinition {
  name: string;
  description?: string;
  schema?: JsonObject;
}
export interface ParsedView {
  model?: string;
  system: ContentBlock[];
  messages: ContentBlock[];
  tools: ToolDefinition[];
}
export interface RequestTiming {
  totalMs?: number;
  ttftMs?: number;
  genMs?: number;
  inTps?: number | null;
  outTps?: number | null;
}
export interface Cost {
  usd?: number;
  input?: number;
  totalInput?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  cacheHitRate?: number;
}
export interface CapturedRequest {
  method?: string;
  url?: string;
  headers?: Record<string, string | string[] | undefined>;
  body?: any;
  bodyRaw?: string;
}
export interface ParsedResponse {
  model?: string;
  usage?: JsonObject;
  content?: ContentBlock[];
  stop_reason?: string;
  streamed?: boolean;
  error?: any;
  [key: string]: any;
}
export interface RequestRecord {
  id: string;
  session?: string;
  seq?: number;
  ts?: number;
  startedAt?: number;
  model?: string;
  format?: string;
  request?: CapturedRequest;
  response?: {
    status?: number;
    error?: any;
    raw?: string;
    headers?: JsonObject;
    firstByteAt?: number;
    finishedAt?: number;
    [key: string]: any;
  } | null;
  latencyMs?: number | null;
  timing?: RequestTiming | null;
  parsed?: {
    format?: string;
    view?: ParsedView;
    response?: ParsedResponse | null;
    estTokens?: number;
    cost?: Cost;
    usageStats?: Cost;
  };
  error?: any;
  [key: string]: any;
}
export interface SessionStats {
  session: string;
  models: string[];
  model: string;
  completed: number;
  total: number;
  totalInput: number;
  totalOutput: number;
  cacheHitRate: number;
  totalUsd?: number;
  error?: string;
}
export interface UsageBucket {
  requests: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalInput: number;
  usd?: number;
  cacheHitRate: number;
}
export interface UsageModel extends UsageBucket {
  model: string;
}
export interface UsageSession extends UsageBucket {
  session: string;
  name?: string | null;
  entries?: number;
  from?: string | null;
  to?: string | null;
}
export interface UsageSummary {
  sessionCount: number;
  requestCount: number;
  unmeasured: number;
  range: { from: string | null; to: string | null };
  totals: UsageBucket;
  byModel: UsageModel[];
  bySession: UsageSession[];
  error?: string;
}
export interface DiffResult {
  added: ContentBlock[];
  removed: ContentBlock[];
  common: ContentBlock[];
  counts: { added: number; removed: number; common: number; cachedInB: number };
  error?: string;
}
export type StepKind =
  | "system"
  | "tools"
  | "user"
  | "assistant"
  | "thinking"
  | "tool_use"
  | "skill"
  | "tool_result"
  | "stop";
export interface TimelineStep {
  kind: StepKind;
  text: string;
  label?: string;
  name?: string;
  /**
   * The wire role of a sent message that is neither the person nor the model,
   * such as "developer" or "system" in an OpenAI Responses input.
   */
  role?: string;
  callId?: string;
  isError?: boolean;
  latest?: boolean;
  /** On a closing "stop" step: the client hung up before the response finished. */
  cancelled?: boolean;
  count?: number;
  tools?: { name: string; description: string }[];
}
export interface TimelineRow extends TimelineStep {
  key: string;
  entryId: string;
  seq?: number;
  ts?: number;
  model?: string;
  status?: number;
  latencyMs?: number | null;
  result?: TimelineStep & { entryId?: string; seq?: number };
}
