import { memo, type ReactNode, type Ref } from "react";
import {
  ArrowLeftRight,
  Brain,
  Cpu,
  FileText,
  Layers,
  Search,
  Square,
  Terminal,
  TriangleAlert,
  User,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { outcome, type FlowFilter, type FlowItem } from "../lib/flow";
import { TAG_INFO } from "../lib/timeline";
import { CodeView, CopyButton } from "./JsonView";

const ICONS: Record<FlowItem["kind"], LucideIcon> = {
  system: FileText,
  tools: Layers,
  user: User,
  assistant: Cpu,
  thinking: Brain,
  tool: Wrench,
  output: Terminal,
  failed: TriangleAlert,
  stop: Square,
  request: ArrowLeftRight,
};

export const KIND_LABEL: Record<FlowItem["kind"], string> = {
  system: "System prompt",
  tools: "Tool definitions",
  user: "User prompt",
  assistant: "Assistant message",
  thinking: "Reasoning",
  tool: "Tool call",
  output: "Tool output without a matching call",
  failed: "Failed request",
  stop: "Response stopped early",
  request: "Request without conversation steps",
};

const isError = (item: FlowItem) =>
  item.status === "error" || item.kind === "failed" || item.kind === "stop";
const isCode = (item: FlowItem) => item.kind === "tool" || item.kind === "request";

function tone(item: FlowItem) {
  if (isError(item)) return "error";
  if (item.kind === "user") return item.injected ? "quiet" : "user";
  if (item.kind === "assistant") return "assistant";
  if (item.kind === "tool" || item.kind === "output") return "tool";
  return "quiet";
}

function Tile({ item, large = false }: { item: FlowItem; large?: boolean }) {
  const Icon = item.injected ? Zap : ICONS[item.kind];
  return (
    <span className={`flow-tile flow-tile-${tone(item)} ${large ? "flow-tile-lg" : ""}`}>
      <Icon size={large ? 16 : 13} aria-hidden="true" />
    </span>
  );
}

/** Marks every occurrence of the (lower-cased) query in a text. */
export function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const lower = text.toLowerCase();
  const parts: ReactNode[] = [];
  let position = 0;
  for (
    let at = lower.indexOf(query);
    at >= 0 && parts.length < 600;
    at = lower.indexOf(query, position)
  ) {
    if (at > position) parts.push(text.slice(position, at));
    parts.push(<mark key={at}>{text.slice(at, at + query.length)}</mark>);
    position = at + query.length;
  }
  if (!parts.length) return <>{text}</>;
  parts.push(text.slice(position));
  return <>{parts}</>;
}

export const ItemRow = memo(function ItemRow({
  item,
  selected,
  query = "",
  domId,
  outcomeText,
  onSelect,
}: {
  item: FlowItem;
  selected: boolean;
  query?: string;
  domId?: string;
  /** Shown instead of the item's own outcome, e.g. a prompt's request count. */
  outcomeText?: string;
  onSelect: (id: string) => void;
}) {
  const result = outcomeText != null ? { text: outcomeText, tone: "quiet" as const } : outcome(item);
  const quiet = item.kind !== "user" && item.kind !== "assistant";
  const tags = item.tags.map((tag) => TAG_INFO[tag]?.headline ?? tag);
  const size = result.size != null ? `${result.size.toLocaleString()} chars` : "";
  return (
    <button
      type="button"
      id={domId}
      aria-label={[item.name, ...tags, item.summary, result.text + size].join(" · ")}
      className={`flow-row ${isError(item) && item.kind !== "request" ? "flow-row-error" : ""}`}
      aria-pressed={selected}
      data-kind={item.kind}
      data-item={item.id}
      onClick={() => onSelect(item.id)}
    >
      <Tile item={item} />
      <span className={`flow-name ${isCode(item) ? "mono" : ""}`}>
        <Highlight text={item.name} query={query} />
      </span>
      <span className="flow-what">
        {item.tags.map((tag) => (
          <span className="flow-tag" key={tag} title={TAG_INFO[tag]?.desc}>
            {TAG_INFO[tag]?.headline ?? tag}
          </span>
        ))}
        <span
          className={`flow-summary ${isCode(item) ? "mono" : ""} ${quiet || item.injected ? "flow-quiet" : ""} ${item.kind === "user" && !item.injected ? "flow-strong" : ""}`}
        >
          <Highlight text={item.summary} query={query} />
        </span>
      </span>
      <span className={`flow-outcome flow-outcome-${result.tone}`}>
        {result.text}
        {result.size != null && (
          <>
            {result.size.toLocaleString()}
            <span className="flow-unit"> chars</span>
          </>
        )}
      </span>
    </button>
  );
});

export const KEY_HINT = (
  <>
    <kbd>↑</kbd> <kbd>↓</kbd> move · <kbd>e</kbd> next error · <kbd>/</kbd> find
  </>
);

/** Filter chips with counts plus a text search, shared by every list in the inspector. */
export function FilterBar<T extends string = FlowFilter>({
  filters,
  filter,
  onFilter,
  search,
  onSearch,
  searchLabel,
  searchRef,
  hint,
  actions,
}: {
  filters: { value: T; label: string; count: number }[];
  filter: T;
  onFilter: (value: T) => void;
  search: string;
  onSearch: (value: string) => void;
  searchLabel: string;
  searchRef?: Ref<HTMLInputElement>;
  hint?: ReactNode;
  /** Controls specific to one view, e.g. a sort order. */
  actions?: ReactNode;
}) {
  return (
    <div className="flow-toolbar">
      <div className="flow-chips" role="group" aria-label="Filter items">
        {filters.map(({ value, label, count }) =>
          !count && value !== "all" ? null : (
            <button
              type="button"
              key={value}
              className="flow-chip"
              aria-pressed={filter === value}
              onClick={() => onFilter(value)}
            >
              {label} <span>{count}</span>
            </button>
          ),
        )}
      </div>
      <div className="flow-tools">
        {hint && <span className="flow-keys">{hint}</span>}
        {actions}
        <label className="flow-search">
          <Search size={13} aria-hidden="true" />
          <input
            ref={searchRef}
            type="search"
            value={search}
            placeholder={searchLabel}
            aria-label={searchLabel}
            onChange={(event) => onSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                onSearch("");
                event.currentTarget.blur();
              }
            }}
          />
        </label>
      </div>
    </div>
  );
}

function Block({
  title,
  copyLabel,
  text,
  error = false,
}: {
  title: string;
  copyLabel: string;
  text: string;
  error?: boolean;
}) {
  return (
    <section className={`flow-block ${error ? "flow-block-error" : ""}`}>
      <div className="flow-block-heading">
        <h4>{title}</h4>
        <CopyButton text={text} label={copyLabel} displayLabel="Copy" />
      </div>
      <CodeView text={text} />
    </section>
  );
}

/** The right-hand pane: full content of the one selected item. */
export function ItemPreview({
  item,
  where,
  facts,
  actions,
}: {
  item: FlowItem | undefined;
  where?: string;
  /** Short facts about the request the item belongs to: model, time, latency. */
  facts?: string[];
  actions?: ReactNode;
}) {
  if (!item)
    return (
      <aside className="flow-pane flow-pane-empty" aria-label="Preview">
        <p>Select an item to read it in full.</p>
      </aside>
    );
  const tool = item.kind === "tool";
  const noInput = tool && (item.text.trim() === "{}" || !item.text.trim());
  const status =
    item.status === "error"
      ? "error"
      : item.status === "awaiting"
        ? "awaiting output"
        : item.status === "missing"
          ? "no output captured"
          : item.status;
  const kind = item.injected ? "User-role message written by the harness" : KIND_LABEL[item.kind];
  // Failure rows carry a synthetic id for de-duplication; only real calls show one.
  const callId = tool || item.kind === "output" ? item.callId : undefined;
  return (
    <aside className="flow-pane" aria-label="Preview" data-item={item.id}>
      <header className="flow-pane-header">
        <Tile item={item} large />
        <div className="flow-pane-title">
          <span>
            {kind}
            {item.tags.length ? ` · ${item.tags.map((tag) => TAG_INFO[tag]?.headline ?? tag).join(" · ")}` : ""}
          </span>
          <h3 className={tool ? "mono" : ""}>{item.name}</h3>
          {tool && !noInput && <p className="mono">{item.summary}</p>}
        </div>
        {tool && (
          <span
            className={`badge ${item.status === "error" ? "badge-error" : item.status === "ok" ? "badge-success" : "badge-muted"}`}
          >
            {status}
          </span>
        )}
      </header>
      {!!facts?.length && <p className="flow-pane-facts">{facts.join(" · ")}</p>}
      {(where || actions || callId) && (
        <div className="flow-pane-meta">
          <span>
            {item.callNumber != null && `Call ${item.callNumber} · `}
            {where}
          </span>
          {callId && (
            <span className="mono" title={`Call ID: ${callId}`}>
              {callId.slice(-8)}
            </span>
          )}
          {actions}
        </div>
      )}
      <div className="flow-pane-body">
        {item.description && (
          <p className="flow-pane-about" title={item.description.trim()}>
            {item.description.trim().split("\n")[0]}
          </p>
        )}
        {item.kind === "tools" ? (
          <ul className="flow-definitions">
            {(item.tools ?? []).map((definition, index) => (
              <li key={`${definition.name}-${index}`}>
                <strong className="mono">{definition.name}</strong>
                <p>{String(definition.description || "No description captured.").trim()}</p>
              </li>
            ))}
          </ul>
        ) : tool ? (
          <>
            {noInput ? (
              <p className="flow-pane-note">Called without arguments.</p>
            ) : (
              <Block title="Input" copyLabel={`Copy input of ${item.name}`} text={item.text} />
            )}
            {item.output != null ? (
              <Block
                title={`Output · ${item.status === "error" ? "failed · " : ""}${item.output.length.toLocaleString()} chars`}
                copyLabel={`Copy output of ${item.name}`}
                text={item.output || "(empty)"}
                error={item.status === "error"}
              />
            ) : (
              <p className="flow-pane-note">
                {item.status === "awaiting"
                  ? "No output yet. The tool runs on the agent's side, and its result is sent with the next request."
                  : "No output was captured for this call in this request."}
              </p>
            )}
          </>
        ) : item.human ? (
          <>
            <Block title="What the user typed" copyLabel="Copy what the user typed" text={item.human} />
            <Block
              title={`Full message as sent · ${item.text.length.toLocaleString()} chars`}
              copyLabel="Copy full message"
              text={item.text}
            />
          </>
        ) : (
          <Block
            title={`${item.kind === "failed" ? "Error" : item.kind === "output" ? "Output" : "Content"} · ${item.text.length.toLocaleString()} chars`}
            copyLabel={`Copy ${item.name}`}
            text={item.text || "(empty)"}
            error={isError(item)}
          />
        )}
      </div>
    </aside>
  );
}
