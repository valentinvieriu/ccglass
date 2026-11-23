import { useId, useState, type ReactNode } from "react";
import {
  ArrowDownToLine,
  Brain,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Code2,
  Cpu,
  FileText,
  Gauge,
  MessageSquare,
  List,
  Terminal,
  Wrench,
} from "lucide-react";
import type { RequestRecord } from "../types";
import { callColor, fmt, fmtMs, fmtTps } from "../lib/format";
import { buildCurl } from "../lib/curl";
import { flowSteps, toolCategory } from "../lib/timeline";
import { ContentBlock, CopyButton, TextContent } from "./JsonView";

const tabs = [
  "overview",
  "flow",
  "system",
  "messages",
  "tools",
  "response",
  "headers",
  "raw",
] as const;
export type RequestTab = (typeof tabs)[number];
type Tab = RequestTab;

function rawRequestBody(record: RequestRecord) {
  return record.request?.bodyRaw ?? record.request?.body;
}

function responseError(record: RequestRecord) {
  return record.parsed?.response?.error ?? record.response?.error ?? record.error;
}

export function MetricCard({
  label,
  value,
  note,
  tone = "",
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  tone?: string;
}) {
  return (
    <div
      className={`detail-stat ${tone === "accent" ? "border-accent-border! bg-accent-soft!" : ""}`}
    >
      <div className="detail-stat-label">{label}</div>
      <div className="detail-stat-value">{value}</div>
      {note != null && <div className="detail-stat-sub">{note}</div>}
    </div>
  );
}

function EmptyContent({ children }: { children: ReactNode }) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <FileText size={24} />
      </div>
      <p>{children}</p>
    </div>
  );
}

function Badge({
  children,
  tone = "",
  title,
}: {
  children: ReactNode;
  tone?: string;
  title?: string;
}) {
  const variant =
    tone === "danger"
      ? "badge-error"
      : tone === "success" || tone === "cache"
        ? "badge-success"
        : tone === "accent"
          ? "tag-orange"
          : "badge-muted";
  return (
    <span className={`badge ${variant}`} title={title}>
      {children}
    </span>
  );
}

function FlowBody({ text }: { text: string }) {
  return <TextContent text={text} compact />;
}

function FlowView({ record }: { record: RequestRecord }) {
  const steps = flowSteps(record);
  const tools = record.parsed?.view?.tools ?? [];
  if (!steps.length) return <EmptyContent>No conversation steps in this request.</EmptyContent>;
  return (
    <div>
      {!!tools.length && (
        <ContentBlock
          title={`${tools.length} tools available to the model`}
          value={tools.map((tool) => tool.name).join("\n")}
        />
      )}
      <ol className="timeline m-0 list-none p-0">
        {steps.map((step, index) => {
          const Icon =
            step.kind === "thinking"
              ? Brain
              : step.kind === "tool_use" || step.kind === "skill"
                ? Wrench
                : step.kind === "tool_result"
                  ? Terminal
                  : step.kind === "assistant"
                    ? Cpu
                    : MessageSquare;
          const title =
            step.kind === "tool_use"
              ? step.name || "Tool call"
              : step.kind === "skill"
                ? `Skill · ${step.name || "skill"}`
                : step.kind === "tool_result"
                  ? "Tool result"
                  : step.kind === "stop"
                    ? "Turn completed"
                    : step.kind;
          const failed =
            step.kind === "stop" &&
            (responseError(record) != null || (record.response?.status ?? 0) >= 400);
          return (
            <li key={`${step.callId || step.kind}-${index}`} className="timeline-row">
              <div
                className={`timeline-marker ${failed || step.isError ? "error" : step.kind === "assistant" || step.kind === "thinking" ? "assistant" : step.callId ? "tool" : ""}`}
                style={step.callId ? { borderColor: callColor(step.callId) } : undefined}
              >
                <Icon size={16} />
              </div>
              <div className="timeline-content">
                <div className="timeline-heading flex-wrap">
                  <strong>{title}</strong>
                  <div className="flex flex-wrap gap-1">
                    {step.latest && <Badge tone="accent">this turn</Badge>}
                    {step.callId && <Badge title={step.callId}>{step.callId.slice(-8)}</Badge>}
                    {step.kind === "tool_result" && (
                      <Badge tone={step.isError ? "danger" : "success"}>
                        {step.isError ? "error" : "result"}
                      </Badge>
                    )}
                    {failed && <Badge tone="danger">error</Badge>}
                  </div>
                </div>
                {step.kind === "stop" ? (
                  <p className="timeline-summary">{step.text}</p>
                ) : (
                  <FlowBody text={step.text || ""} />
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Overview({ record }: { record: RequestRecord }) {
  const parsed = record.parsed;
  const cost = parsed?.cost;
  const usage = parsed?.response?.usage;
  const stats = parsed?.usageStats ?? cost;
  const cacheRead = stats?.cacheRead ?? cost?.cacheRead ?? usage?.cache_read_input_tokens;
  const cacheWrite = stats?.cacheWrite ?? cost?.cacheWrite ?? usage?.cache_creation_input_tokens;
  const totalInput = stats?.totalInput ?? cost?.totalInput;
  const hitRate =
    stats?.cacheHitRate ??
    cost?.cacheHitRate ??
    (totalInput != null && cacheRead != null
      ? totalInput > 0
        ? cacheRead / totalInput
        : 0
      : undefined);
  const timing = record.timing;
  const body = record.request?.body;
  const model =
    typeof body === "object" && body !== null
      ? String(body.model || parsed?.response?.model || record.model || "Unknown model")
      : String(parsed?.response?.model || record.model || "Unknown model");
  const status = record.response?.status;
  const error = responseError(record);
  const view = parsed?.view;
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Clock3 size={15} />
        <h3 className="section-title">Performance</h3>
      </div>
      <div className="detail-grid lg:grid-cols-3!">
        <MetricCard label="Total latency" value={fmtMs(record.latencyMs ?? timing?.totalMs)} />
        <MetricCard label="First token" value={fmtMs(timing?.ttftMs)} note="Time to first byte" />
        <MetricCard label="Generation" value={fmtMs(timing?.genMs)} note="Stream duration" />
        <MetricCard label="Input speed" value={fmtTps(timing?.inTps)} note="Before first byte" />
        <MetricCard label="Output speed" value={fmtTps(timing?.outTps)} note="After first byte" />
      </div>
      <div className="flex items-center gap-2 mb-3">
        <Gauge size={15} />
        <h3 className="section-title">{cost?.usd != null ? "Tokens & cost" : "Token usage"}</h3>
      </div>
      <div className="detail-grid lg:grid-cols-3!">
        <MetricCard
          label="Estimated input"
          value={parsed?.estTokens == null ? "—" : `≈ ${fmt(parsed.estTokens)}`}
          note="tokens"
        />
        <MetricCard
          label="Actual input"
          value={fmt(usage?.input_tokens ?? stats?.input ?? cost?.input)}
          note="tokens"
        />
        <MetricCard
          label="Output"
          value={fmt(usage?.output_tokens ?? stats?.output ?? cost?.output)}
          note="tokens"
        />
        <MetricCard
          label="Cache read"
          value={fmt(cacheRead)}
          note={hitRate != null ? `${Math.round(hitRate * 100)}% hit rate` : "tokens"}
        />
        <MetricCard label="Cache write" value={fmt(cacheWrite)} note="tokens" />
        {totalInput != null && (
          <MetricCard label="Total input" value={fmt(totalInput)} note="Including cached tokens" />
        )}
        {cost?.usd != null && (
          <MetricCard
            label="Estimated cost"
            value={`$${Number(cost.usd).toFixed(5)}`}
            tone="accent"
          />
        )}
      </div>
      <div className="flex items-center gap-2 mb-3">
        <Code2 size={15} />
        <h3 className="section-title">Request details</h3>
      </div>
      <dl className="grid grid-cols-1 gap-3 mb-5 sm:grid-cols-2 [&_dt]:text-[10px] [&_dt]:text-muted [&_dd]:mt-1 [&_dd]:break-words">
        <div>
          <dt>Model</dt>
          <dd>{model}</dd>
        </div>
        <div>
          <dt>Format</dt>
          <dd>{parsed?.format || record.format || "—"}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>
            <Badge
              tone={
                status != null && status >= 400 ? "danger" : status == null ? "muted" : "success"
              }
            >
              {status != null ? `HTTP ${status}` : "Pending response"}
            </Badge>
          </dd>
        </div>
        <div>
          <dt>Stop reason</dt>
          <dd>{parsed?.response?.stop_reason || "—"}</dd>
        </div>
        <div>
          <dt>Captured</dt>
          <dd>{record.ts != null ? new Date(record.ts).toLocaleString() : "—"}</dd>
        </div>
        <div>
          <dt>Context</dt>
          <dd>
            {view?.system?.length || 0} system blocks · {view?.messages?.length || 0} messages ·{" "}
            {view?.tools?.length || 0} tools
          </dd>
        </div>
      </dl>
      {error != null && (
        <ContentBlock
          title="Response error"
          value={error}
          className="border-danger-border!"
          expanded
        />
      )}
      <ContentBlock
        title="Request line"
        value={`${record.request?.method || "GET"} ${record.request?.url || "/"}`}
        expanded
      />
      <ContentBlock title="Raw request body" value={rawRequestBody(record)} />
    </div>
  );
}

function MessagesView({ record }: { record: RequestRecord }) {
  const messages = record.parsed?.view?.messages ?? [];
  if (!messages.length) return <EmptyContent>No messages were sent.</EmptyContent>;
  return (
    <>
      {messages.map((message, index) => {
        const paired = message.type === "tool_use" || message.type === "tool_result";
        return (
          <ContentBlock
            key={`${message.callId || message.label}-${index}`}
            title={message.label || `Message ${index + 1}`}
            value={message.text ?? message.thinking ?? message.input ?? message}
            className={message.isError ? "border-danger-border!" : ""}
            style={
              paired && message.callId ? { borderColor: callColor(message.callId) } : undefined
            }
            tags={
              <>
                <Badge>{message.role || "message"}</Badge>
                {message.type === "tool_use" && (
                  <Badge tone="accent">{message.name || "tool call"}</Badge>
                )}
                {message.type === "tool_result" && (
                  <Badge tone={message.isError ? "danger" : "success"}>
                    {message.isError ? "error" : "result"}
                  </Badge>
                )}
                {message.type &&
                  !["text", "message", "tool_use", "tool_result"].includes(message.type) && (
                    <Badge>{message.type}</Badge>
                  )}
                {message.callId && <Badge title={message.callId}>{message.callId.slice(-8)}</Badge>}
                {message.cache && <Badge tone="cache">cached</Badge>}
              </>
            }
          />
        );
      })}
    </>
  );
}

function ToolsView({ record }: { record: RequestRecord }) {
  const tools = record.parsed?.view?.tools ?? [];
  if (!tools.length) return <EmptyContent>No tools were offered to the model.</EmptyContent>;
  return (
    <>
      {tools.map((tool, index) => {
        const category = toolCategory(tool.name);
        return (
          <section key={`${tool.name}-${index}`} className="mb-6">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <Wrench size={17} />
              <h3 className="section-title">{tool.name}</h3>
              {category && <Badge>{category}</Badge>}
            </div>
            <ContentBlock
              title="Description"
              value={tool.description || "No description provided."}
            />
            <ContentBlock title="Input schema" value={tool.schema ?? {}} />
          </section>
        );
      })}
    </>
  );
}

function ResponseView({ record }: { record: RequestRecord }) {
  const response = record.parsed?.response;
  const error = responseError(record);
  if (!response && !record.response && error == null)
    return <EmptyContent>No response captured yet.</EmptyContent>;
  const raw = record.response?.raw ?? response ?? record.response;
  return (
    <>
      {response && (
        <ContentBlock
          title="Response usage"
          value={response.usage ?? {}}
          tags={response.streamed ? <Badge tone="accent">streamed</Badge> : undefined}
        />
      )}
      {response?.content?.map((block, index) => (
        <ContentBlock
          key={`${block.type}-${index}`}
          title={
            block.type === "tool_use"
              ? `Tool call · ${block.name || "tool"}`
              : block.type || `Content ${index + 1}`
          }
          value={
            block.type === "tool_use"
              ? (block.input ?? block)
              : (block.text ?? block.thinking ?? block)
          }
          tags={
            block.id || block.callId ? (
              <Badge title={block.id || block.callId}>
                {(block.id || block.callId || "").slice(-8)}
              </Badge>
            ) : undefined
          }
        />
      ))}
      {error != null && (
        <ContentBlock
          title="Response error"
          value={error}
          className="border-danger-border!"
          expanded
        />
      )}
      {raw != null && <ContentBlock title="Raw response" value={raw} />}
    </>
  );
}

export default function RequestDetail({
  record,
  onExport,
  navigation,
  activeTab,
  onTabChange,
}: {
  record: RequestRecord;
  onExport?: (format: string) => void;
  navigation?: {
    onReplay: () => void;
    previous?: () => void;
    next?: () => void;
    position: number;
    total: number;
  };
  activeTab?: RequestTab;
  onTabChange?: (tab: RequestTab) => void;
}) {
  const [localTab, setLocalTab] = useState<Tab>("overview");
  const tab = activeTab ?? localTab;
  const setTab = (next: Tab) => {
    setLocalTab(next);
    onTabChange?.(next);
  };
  const id = useId();
  const view = record.parsed?.view;
  const response = record.parsed?.response;
  const model =
    response?.model ||
    record.model ||
    (typeof record.request?.body === "object" && record.request.body !== null
      ? record.request.body.model
      : null) ||
    "Request inspector";
  const counts: Partial<Record<Tab, number>> = {
    system: view?.system?.length,
    messages: view?.messages?.length,
    tools: view?.tools?.length,
  };
  return (
    <section className="detail-panel flex-1" aria-label="Request inspector">
      <div className="detail-header flex-wrap">
        <div className="detail-header-main">
          <span className="eyebrow">
            REQUEST {record.seq != null ? String(record.seq).padStart(3, "0") : ""}
          </span>
          <h2 className="mt-1 truncate" title={String(model)}>
            {String(model)}
          </h2>
          <p className="truncate" title={record.request?.url}>
            {record.request?.method || "GET"} <span>{record.request?.url || "/"}</span>
          </p>
        </div>
        <div className="detail-header-actions">
          {navigation && (
            <div className="request-navigation" aria-label="Request navigation">
              <button
                className="button button-ghost icon-button"
                aria-label="Back to session replay"
                title="Back to session replay"
                onClick={navigation.onReplay}
              >
                <List size={15} />
              </button>
              <button
                className="button button-ghost icon-button"
                aria-label="Previous request"
                title="Previous request"
                disabled={!navigation.previous}
                onClick={navigation.previous}
              >
                <ChevronLeft size={15} />
              </button>
              <span className="request-position">
                {navigation.position}/{navigation.total}
              </span>
              <button
                className="button button-ghost icon-button"
                aria-label="Next request"
                title="Next request"
                disabled={!navigation.next}
                onClick={navigation.next}
              >
                <ChevronRight size={15} />
              </button>
            </div>
          )}
          <CopyButton text={buildCurl(record)} label="Copy cURL" />
          <details className="relative">
            <summary className="button button-sm">
              <ArrowDownToLine size={14} /> Export
            </summary>
            <div className="absolute right-0 top-full z-20 mt-1 grid min-w-40 gap-1 rounded-md border border-border bg-surface p-2 shadow-lg">
              {["raw", "md", "json", "har"].map((format) => (
                <a
                  className="button button-ghost button-sm justify-start"
                  key={format}
                  href={`/api/export?id=${encodeURIComponent(record.id)}&format=${format}`}
                  onClick={() => onExport?.(format)}
                  download
                >
                  <FileText size={13} />
                  {format === "raw"
                    ? "HTTP transcript"
                    : format === "md"
                      ? "Markdown"
                      : format.toUpperCase()}
                </a>
              ))}
            </div>
          </details>
        </div>
      </div>
      <div
        className="tabs"
        role="tablist"
        aria-label="Request sections"
        onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const current = tabs.indexOf(tab);
          const index =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? tabs.length - 1
                : (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
          setTab(tabs[index]);
          event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[index]?.focus();
        }}
      >
        {tabs.map((name) => (
          <button
            key={name}
            id={`${id}-tab-${name}`}
            type="button"
            role="tab"
            aria-selected={tab === name}
            aria-controls={`${id}-panel`}
            tabIndex={tab === name ? 0 : -1}
            className={`tab ${tab === name ? "tab-active" : ""}`}
            onClick={() => setTab(name)}
          >
            {name}
            {counts[name] != null && <span className="ml-1 mono">{counts[name]}</span>}
          </button>
        ))}
      </div>
      <div
        key={record.id}
        id={`${id}-panel`}
        role="tabpanel"
        aria-labelledby={`${id}-tab-${tab}`}
        tabIndex={0}
        className="panel-body"
      >
        {tab === "overview" && <Overview record={record} />}
        {tab === "flow" && <FlowView record={record} />}
        {tab === "system" &&
          (view?.system?.length ? (
            view.system.map((block, index) => (
              <ContentBlock
                key={`${block.label}-${index}`}
                title={block.label || `System block ${index + 1}`}
                value={block.text ?? block}
                tags={block.cache ? <Badge tone="cache">cached</Badge> : undefined}
              />
            ))
          ) : (
            <EmptyContent>No system blocks were sent.</EmptyContent>
          ))}
        {tab === "messages" && <MessagesView record={record} />}
        {tab === "tools" && <ToolsView record={record} />}
        {tab === "response" && <ResponseView record={record} />}
        {tab === "headers" && (
          <>
            <ContentBlock title="Request headers" value={record.request?.headers || {}} expanded />
            <ContentBlock
              title="Response headers"
              value={record.response?.headers || {}}
              expanded
            />
          </>
        )}
        {tab === "raw" && (
          <>
            <ContentBlock title="Raw request body" value={rawRequestBody(record)} />
            <ContentBlock title="Raw response" value={record.response?.raw ?? record.response} />
            <ContentBlock title="Captured record" value={record} />
          </>
        )}
      </div>
    </section>
  );
}
