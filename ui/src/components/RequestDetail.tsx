import { useId, useState, type ReactNode } from "react";
import {
  ArrowDownToLine,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Code2,
  FileText,
  Gauge,
  List,
} from "lucide-react";
import type { RequestRecord } from "../types";
import { fmt, fmtMs, fmtTps } from "../lib/format";
import { buildCurl } from "../lib/curl";
import { countMessages } from "../lib/messages";
import { ContentBlock, CopyButton } from "./JsonView";
import FlowView from "./FlowView";
import HttpView from "./HttpView";
import MessagesView from "./MessagesView";
import ResponseView, { responseError } from "./ResponseView";
import ToolsView from "./ToolsView";

const tabs = [
  "overview",
  "flow",
  "system",
  "messages",
  "tools",
  "response",
  "http",
] as const;
export type RequestTab = (typeof tabs)[number];
type Tab = RequestTab;
// Tab names are shown capitalized; an acronym needs its own spelling.
const TAB_LABELS: Partial<Record<Tab, string>> = { http: "HTTP" };

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
      <div className="section-head flex items-center gap-2 mb-3">
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
      <div className="section-head flex items-center gap-2 mb-3">
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
      <div className="section-head flex items-center gap-2 mb-3">
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
            {view?.system?.length || 0} system blocks · {countMessages(view?.messages)} messages ·{" "}
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
    </div>
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
  // A cross-tab jump: a call in Messages opens its definition in Tools, and back.
  const [jump, setJump] = useState<{ record: string; tab: Tab; target: string; nonce: number }>();
  const open = (next: Tab, target: string) => {
    setJump((previous) => ({
      record: record.id,
      tab: next,
      target,
      nonce: (previous?.nonce ?? 0) + 1,
    }));
    setTab(next);
  };
  const focusFor = (name: Tab) =>
    jump && jump.record === record.id && jump.tab === name ? jump : undefined;
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
    // Entries of the message array, the same unit the request list counts.
    messages: view?.messages ? countMessages(view.messages) : undefined,
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
                className="button button-ghost button-sm"
                aria-label="Back to session replay"
                title="Back to session replay"
                onClick={navigation.onReplay}
              >
                <List size={14} />
                <span>Timeline</span>
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
            {TAB_LABELS[name] ?? name}
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
        {tab === "flow" && <FlowView key={record.id} record={record} />}
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
        {tab === "messages" && (
          <MessagesView
            record={record}
            focus={focusFor("messages")}
            onOpenTool={view?.tools?.length ? (name) => open("tools", name) : undefined}
            onOpenResponse={() => setTab("response")}
          />
        )}
        {tab === "tools" && (
          <ToolsView
            record={record}
            focus={focusFor("tools")}
            onOpenCall={(item) =>
              item.zone === "response" ? setTab("response") : open("messages", item.id)
            }
          />
        )}
        {tab === "response" && (
          <ResponseView
            record={record}
            onOpenTool={view?.tools?.length ? (name) => open("tools", name) : undefined}
            onOpenHttp={() => setTab("http")}
          />
        )}
        {tab === "http" && <HttpView record={record} />}
      </div>
    </section>
  );
}
