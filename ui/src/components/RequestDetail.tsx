import { useId, useState, type ReactNode } from "react";
import {
  ArrowDownToLine,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileText,
  GitCompareArrows,
  List,
} from "lucide-react";
import type { RequestRecord } from "../types";
import { buildCurl } from "../lib/curl";
import { countMessages } from "../lib/messages";
import {
  isModelRequest,
  openingTab,
  requestDetails,
  requestFacts,
  requestPath,
  requestTabs,
  requestTitle,
  type RequestTab,
} from "../lib/request";
import { ContentBlock, CopyButton } from "./JsonView";
import { MiddleTruncate } from "./MiddleTruncate";
import FlowView from "./FlowView";
import HttpView from "./HttpView";
import MessagesView from "./MessagesView";
import ResponseView from "./ResponseView";
import ToolsView from "./ToolsView";

export type { RequestTab };
type Tab = RequestTab;
// Tab names are shown capitalized; an acronym needs its own spelling.
const TAB_LABELS: Partial<Record<Tab, string>> = { http: "HTTP" };

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
  // Colour is for what went wrong; "cached" and the like are plain facts.
  const variant = tone === "danger" ? "badge-error" : "badge-muted";
  return (
    <span className={`badge ${variant}`} title={title}>
      {children}
    </span>
  );
}

/**
 * The measurements behind the facts line. They are folded away so that a
 * request opens on what was sent, and one click from every tab.
 */
function Details({ record, id }: { record: RequestRecord; id: string }) {
  return (
    <div className="request-details" id={id}>
      {requestDetails(record).map((group) => (
        <section key={group.title} aria-label={group.title}>
          <h3>{group.title}</h3>
          <dl>
            {group.rows.map((row) => (
              <div key={row.label}>
                <dt>
                  {row.label}
                  {row.note && <small>{row.note}</small>}
                </dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}

const BADGE: Record<string, string> = {
  error: "badge-error",
  cancelled: "badge-warning",
};

export default function RequestDetail({
  record,
  onExport,
  navigation,
  comparePrevious,
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
  /**
   * Opens Compare on this request and the one before it, which shows what this
   * turn added. Null when there is no earlier request to compare with.
   */
  comparePrevious?: { seq: number; open: () => void } | null;
  activeTab?: RequestTab;
  onTabChange?: (tab: RequestTab) => void;
}) {
  const [localTab, setLocalTab] = useState<Tab>("overview");
  const tabs = requestTabs(record);
  // A tab picked while this request is open wins over where it would open.
  const [chosen, setChosen] = useState<{ record: string; tab: Tab }>();
  const wanted =
    activeTab ?? (chosen?.record === record.id ? chosen.tab : openingTab(record, localTab));
  const tab = tabs.includes(wanted) ? wanted : "response";
  const setTab = (next: Tab) => {
    setChosen({ record: record.id, tab: next });
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
  // Stays open from one request to the next, to read the same number across them.
  const [details, setDetails] = useState(false);
  const view = record.parsed?.view;
  const modelRequest = isModelRequest(record);
  const title = requestTitle(record);
  const summary = requestFacts(record);
  const url = record.request?.url || "/";
  const counts: Partial<Record<Tab, number>> = {
    system: view?.system?.length,
    // Entries of the message array, the same unit the request list counts.
    messages: view?.messages ? countMessages(view.messages) : undefined,
    tools: view?.tools?.length,
  };
  return (
    <section className="detail-panel request-inspector flex-1" aria-label="Request inspector">
      <div className="detail-header flex-wrap">
        <div className="detail-header-main">
          <span className="eyebrow">Request {record.seq != null ? `#${record.seq}` : ""}</span>
          <h2 className={`truncate ${modelRequest ? "" : "mono"}`} title={title}>
            {modelRequest ? <MiddleTruncate text={title} /> : title}
          </h2>
          {/* A non-model request is already titled by its method and path. */}
          {(modelRequest || url !== requestPath(url)) && (
            <p className="truncate" title={url}>
              {record.request?.method || "GET"} <span>{url}</span>
            </p>
          )}
        </div>
        <div className="detail-header-actions">
          {navigation && (
            <div className="request-navigation" aria-label="Request navigation">
              <button
                className="button button-ghost button-sm"
                aria-label="Back to the replay"
                title="Back to the replay (Esc)"
                onClick={navigation.onReplay}
              >
                <List size={14} />
                <span>Replay</span>
              </button>
              <button
                className="button button-ghost icon-button"
                aria-label="Previous request"
                title="Previous request ([)"
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
                title="Next request (])"
                disabled={!navigation.next}
                onClick={navigation.next}
              >
                <ChevronRight size={15} />
              </button>
            </div>
          )}
          {comparePrevious !== undefined && (
            <button
              className="button button-ghost button-sm"
              aria-label={
                comparePrevious
                  ? `Compare with the previous request, #${comparePrevious.seq}`
                  : "Compare with the previous request"
              }
              title={
                comparePrevious
                  ? `What this request sent that #${comparePrevious.seq} did not`
                  : "No earlier request to this model in the session"
              }
              disabled={!comparePrevious}
              onClick={comparePrevious?.open}
            >
              <GitCompareArrows size={14} />
              <span>{comparePrevious ? `Compare with #${comparePrevious.seq}` : "Compare"}</span>
            </button>
          )}
          <CopyButton text={buildCurl(record)} label="Copy cURL" />
          <details
            className="relative"
            onKeyDown={(event) => {
              // Escape closes the menu before it means "back to the replay".
              if (event.key !== "Escape" || !event.currentTarget.open) return;
              event.currentTarget.open = false;
              event.stopPropagation();
            }}
          >
            <summary className="button button-sm">
              <ArrowDownToLine size={14} /> Export
            </summary>
            <div className="absolute right-0 top-full z-20 mt-1 grid min-w-40 gap-1 rounded-control border border-border bg-surface p-2 shadow-lg">
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
      <div className="request-facts-bar">
        <p className="request-facts" aria-label="Request outcome">
          <span className={`badge ${BADGE[summary.status.tone] ?? "badge-muted"}`}>
            {summary.status.label}
          </span>
          {summary.facts.map((fact) => (
            <span key={fact}>{fact}</span>
          ))}
        </p>
        <button
          type="button"
          className="request-facts-toggle"
          aria-expanded={details}
          aria-controls={`${id}-details`}
          title="Full timing and token breakdown"
          onClick={() => setDetails(!details)}
        >
          Details
          <ChevronDown size={13} aria-hidden="true" />
        </button>
      </div>
      {details && <Details record={record} id={`${id}-details`} />}
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
        {tab === "overview" && <FlowView key={record.id} record={record} />}
        {tab === "system" &&
          (view?.system?.length ? (
            view.system.map((block, index) => (
              <ContentBlock
                key={`${block.label}-${index}`}
                title={block.label || `System block ${index + 1}`}
                value={block.text ?? block}
                tags={block.cache ? <Badge tone="cache">cached</Badge> : undefined}
                // The whole system prompt is what this tab is opened for.
                expanded={view.system.length === 1}
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
