import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import { ChevronRight, FileText, Wrench } from "lucide-react";
import type { RequestRecord } from "../types";
import { approxTokens, keyTarget, outcome, type FlowItem } from "../lib/flow";
import {
  buildTools,
  matchesTool,
  sortTools,
  type ToolEntry,
  type ToolFilter,
  type ToolParam,
  type ToolSort,
} from "../lib/tools";
import { TAG_INFO } from "../lib/timeline";
import { FilterBar, Highlight } from "./FlowItems";
import { CodeView, CopyButton } from "./JsonView";

const SORTS: [ToolSort, string][] = [
  ["sent", "Order sent"],
  ["size", "Largest first"],
  ["calls", "Most called"],
  ["name", "Name"],
];

const VALUE_LIMIT = 24;

const plural = (count: number, word: string) =>
  `${count.toLocaleString()} ${word}${count === 1 ? "" : "s"}`;
const share = (value: number) => (value < 0.005 ? "<1%" : `${Math.round(value * 100)}%`);
const literal = (value: unknown) => (typeof value === "string" ? value : JSON.stringify(value));

function callsText(tool: ToolEntry) {
  if (!tool.calls.length) return "";
  return plural(tool.calls.length, "call") + (tool.failed ? ` · ${tool.failed} failed` : "");
}

function ToolRow({
  tool,
  selected,
  query,
  largest,
  domId,
  onSelect,
}: {
  tool: ToolEntry;
  selected: boolean;
  query: string;
  largest: number;
  domId: string;
  onSelect: (id: string) => void;
}) {
  const calls = callsText(tool);
  return (
    <button
      type="button"
      id={domId}
      className="flow-row tool-row"
      aria-pressed={selected}
      aria-label={[
        tool.name,
        tool.summary || "No description",
        calls || "not called",
        `${tool.chars.toLocaleString()} chars`,
      ].join(" · ")}
      data-item={tool.id}
      onClick={() => onSelect(tool.id)}
    >
      <span className={`flow-tile ${tool.calls.length ? "flow-tile-tool" : ""}`}>
        <Wrench size={13} aria-hidden="true" />
      </span>
      <span className="flow-name mono">
        <Highlight text={tool.name} query={query} />
      </span>
      <span className="flow-what">
        <span className="flow-summary flow-quiet">
          <Highlight text={tool.summary || "No description"} query={query} />
        </span>
      </span>
      <span className={`tool-calls ${tool.failed ? "flow-outcome-error" : ""}`}>{calls}</span>
      <span className="tool-size">
        <i aria-hidden="true">
          <b style={{ width: `${Math.max(4, (tool.chars / largest) * 100)}%` }} />
        </i>
        {tool.chars.toLocaleString()}
        <span className="flow-unit"> chars</span>
      </span>
    </button>
  );
}

function Param({ param }: { param: ToolParam }) {
  const values = param.values ?? [];
  return (
    <li className="tool-param" style={{ "--depth": param.depth } as CSSProperties}>
      <div className="tool-param-head">
        <code title={param.path}>{param.name}</code>
        <span className="tool-param-type mono">{param.type}</span>
        {param.required && <span className="tool-param-required">required</span>}
      </div>
      {param.description && <p>{param.description}</p>}
      {!!values.length && (
        <p className="tool-param-values">
          One of{" "}
          {values.slice(0, VALUE_LIMIT).map((value, index) => (
            <code key={index}>{literal(value)}</code>
          ))}
          {values.length > VALUE_LIMIT && ` and ${values.length - VALUE_LIMIT} more`}
        </p>
      )}
      {param.fallback !== undefined && (
        <p className="tool-param-values">
          Default <code>{literal(param.fallback)}</code>
        </p>
      )}
    </li>
  );
}

function ToolPane({
  tool,
  total,
  onOpenCall,
}: {
  tool: ToolEntry | undefined;
  total: number;
  onOpenCall?: (item: FlowItem) => void;
}) {
  const [raw, setRaw] = useState(false);
  useEffect(() => setRaw(false), [tool?.id]);
  if (!tool)
    return (
      <aside className="flow-pane flow-pane-empty" aria-label="Tool definition">
        <p>Select a tool to read its definition.</p>
      </aside>
    );
  const top = tool.params.filter((param) => param.depth === 0);
  const required = top.filter((param) => param.required).length;
  const schemaText = JSON.stringify(tool.schema, null, 2);
  const category = tool.category ? TAG_INFO[tool.category]?.headline : undefined;
  return (
    <aside className="flow-pane" aria-label="Tool definition" data-item={tool.id}>
      <header className="flow-pane-header">
        <span className="flow-tile flow-tile-tool flow-tile-lg">
          <Wrench size={16} aria-hidden="true" />
        </span>
        <div className="flow-pane-title">
          <span>Tool definition{category ? ` · ${category}` : ""}</span>
          <h3 className="mono">{tool.name}</h3>
        </div>
        <span
          className={`badge ${tool.failed ? "badge-error" : tool.calls.length ? "badge-success" : "badge-muted"}`}
        >
          {tool.calls.length
            ? `called ${tool.calls.length}×${tool.failed ? ` · ${tool.failed} failed` : ""}`
            : "not called"}
        </span>
      </header>
      <div className="flow-pane-meta">
        <span>
          Tool {tool.index + 1} of {total} · sent with every request of this conversation.
        </span>
        <span>
          {tool.chars.toLocaleString()} chars
          {tool.tokens != null && ` · ~${approxTokens(tool.tokens)} tok`} · {share(tool.share)} of all
          definitions
        </span>
      </div>
      <div className="flow-pane-body">
        <section className="flow-block">
          <div className="flow-block-heading">
            <h4>
              Description
              {tool.description ? ` · ${tool.description.length.toLocaleString()} chars` : ""}
            </h4>
            {tool.description && (
              <CopyButton
                text={tool.description}
                label={`Copy description of ${tool.name}`}
                displayLabel="Copy"
              />
            )}
          </div>
          {tool.description ? (
            <div className="tool-description">{tool.description}</div>
          ) : (
            <p className="flow-pane-note">
              No description was sent. The model only has the name and the parameters to go on.
            </p>
          )}
        </section>

        <section className="flow-block">
          <div className="flow-block-heading">
            <h4>
              Parameters
              {top.length ? ` · ${top.length}${required ? ` · ${required} required` : " · all optional"}` : ""}
            </h4>
          </div>
          {tool.params.length ? (
            <ul className="tool-params">
              {tool.params.map((param) => (
                <Param key={param.path} param={param} />
              ))}
            </ul>
          ) : (
            <p className="flow-pane-note">
              {Object.keys(tool.schema).length > 1 && !tool.schema.properties
                ? "The schema does not list named parameters. Read it in full below."
                : "Takes no arguments."}
            </p>
          )}
          {tool.clipped && (
            <p className="flow-pane-note">
              Deeper or further parameters are left out here. The schema below has all of them.
            </p>
          )}
        </section>

        <section className="flow-block">
          <div className="flow-block-heading">
            <h4>
              Calls in this conversation
              {tool.calls.length ? ` · ${tool.calls.length}` : ""}
            </h4>
          </div>
          {tool.calls.length ? (
            <ul className="tool-call-list">
              {tool.calls.map(({ item, issues }) => {
                const result = outcome(item);
                const where = item.zone === "response" ? "Response" : "Messages";
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      className="tool-call"
                      title={`Open this call in ${where}`}
                      disabled={!onOpenCall}
                      onClick={() => onOpenCall?.(item)}
                    >
                      <span className="tool-call-number">
                        {item.callNumber != null ? `Call ${item.callNumber}` : "Call"}
                      </span>
                      <span className="tool-call-args mono">{item.summary}</span>
                      <span className={`flow-outcome flow-outcome-${result.tone}`}>
                        {item.zone === "response" ? "in this response" : result.text}
                        {item.zone !== "response" &&
                          result.size != null &&
                          `${result.size.toLocaleString()} chars`}
                      </span>
                    </button>
                    {issues.map((issue) => (
                      <p className="tool-call-issue" key={issue}>
                        {issue}
                      </p>
                    ))}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="flow-pane-note">The model has not called this tool so far.</p>
          )}
        </section>

        <section className="flow-block">
          <div className="flow-block-heading">
            <h4>
              <button
                type="button"
                className="content-title"
                aria-expanded={raw}
                onClick={() => setRaw(!raw)}
              >
                <ChevronRight size={13} aria-hidden="true" />
                Input schema as sent · {schemaText.length.toLocaleString()} chars
              </button>
            </h4>
            <CopyButton
              text={schemaText}
              label={`Copy input schema of ${tool.name}`}
              displayLabel="Copy"
            />
          </div>
          {raw && <CodeView text={schemaText} />}
        </section>
      </div>
    </aside>
  );
}

export default function ToolsView({
  record,
  focus,
  onOpenCall,
}: {
  record: RequestRecord;
  /** A tool to select by name, e.g. when arriving from a call in Messages. */
  focus?: { target: string; nonce: number };
  onOpenCall?: (item: FlowItem) => void;
}) {
  const model = useMemo(() => buildTools(record), [record]);
  const id = useId();
  const [filter, setFilter] = useState<ToolFilter>("all");
  const [sort, setSort] = useState<ToolSort>("sent");
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<string | undefined>(
    () => model.tools.find((tool) => tool.name === focus?.target)?.id,
  );
  const focusPicked = useRef(false);
  const searchInput = useRef<HTMLInputElement>(null);

  const query = search.trim().toLowerCase();
  const shown = useMemo(
    () => sortTools(model.tools, sort).filter((tool) => matchesTool(filter, query, tool)),
    [model, sort, filter, query],
  );
  const selected = shown.find((tool) => tool.id === picked) ?? shown[0];
  const rowId = (tool: ToolEntry) => `${id}-${tool.id}`;

  useEffect(() => {
    if (!focusPicked.current || !selected) return;
    focusPicked.current = false;
    const row = document.getElementById(rowId(selected));
    row?.focus({ preventScroll: true });
    row?.scrollIntoView?.({ block: "nearest" });
  });
  useEffect(() => {
    const tool = model.tools.find((candidate) => candidate.name === focus?.target);
    if (!tool) return;
    setFilter("all");
    setSearch("");
    focusPicked.current = true;
    setPicked(tool.id);
    // Only a new jump request changes the selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.nonce]);

  if (!model.tools.length)
    return (
      <div className="empty-state">
        <div className="empty-icon">
          <FileText size={24} />
        </div>
        <p>No tools were offered to the model.</p>
      </div>
    );

  const select = (toolId: string, focusRow = false) => {
    focusPicked.current = focusRow;
    setPicked(toolId);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const target = keyTarget(event.key, shown, selected);
    if (target) {
      event.preventDefault();
      select(target.id, true);
    } else if (event.key === "/") {
      event.preventDefault();
      searchInput.current?.focus();
    }
  };
  const largest = Math.max(...model.tools.map((tool) => tool.chars), 1);
  const unused = model.tools.length - model.called;

  return (
    <div className="flow-view tools-view">
      <div className="insp-summary">
        <span>
          <strong>{model.tools.length.toLocaleString()}</strong>{" "}
          {model.tools.length === 1 ? "tool" : "tools"} offered ·{" "}
          {model.chars.toLocaleString()} chars
          {model.tokens != null && ` · ~${approxTokens(model.tokens)} tok`}
          {model.inputShare != null && ` · ${share(model.inputShare)} of what was sent`}
        </span>
        <span>
          <strong>{model.called.toLocaleString()}</strong> called so far
          {unused > 0 && ` · ${unused.toLocaleString()} never called`}
          {model.settings.map(([name, value]) => (
            <span className="insp-setting mono" key={name}>
              {name}: {value}
            </span>
          ))}
        </span>
        {!!model.undefinedTools.length && (
          <span className="insp-warning">
            Called but not defined in this request: {model.undefinedTools.join(", ")}
          </span>
        )}
      </div>

      <FilterBar<ToolFilter>
        filters={[
          { value: "all", label: "All", count: model.tools.length },
          { value: "called", label: "Called", count: model.called },
          { value: "unused", label: "Never called", count: model.called ? unused : 0 },
        ]}
        filter={filter}
        onFilter={setFilter}
        search={search}
        onSearch={setSearch}
        searchLabel="Find a tool or parameter"
        searchRef={searchInput}
        hint={
          <>
            <kbd>↑</kbd> <kbd>↓</kbd> move · <kbd>/</kbd> find
          </>
        }
        actions={
          <select
            className="filter-select tool-sort"
            aria-label="Sort tools"
            value={sort}
            onChange={(event) => setSort(event.target.value as ToolSort)}
          >
            {SORTS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        }
      />

      <div className="flow-split">
        <div className="flow-list" onKeyDown={onKeyDown} role="group" aria-label="Tools offered">
          {shown.map((tool) => (
            <ToolRow
              key={tool.id}
              tool={tool}
              domId={rowId(tool)}
              query={query}
              largest={largest}
              selected={selected?.id === tool.id}
              onSelect={select}
            />
          ))}
          {!shown.length && (
            <p className="flow-zone-note flow-no-match">
              No tool matches.{" "}
              <button
                type="button"
                className="flow-link"
                onClick={() => {
                  setFilter("all");
                  setSearch("");
                }}
              >
                Clear the filter
              </button>
            </p>
          )}
        </div>
        <ToolPane tool={selected} total={model.tools.length} onOpenCall={onOpenCall} />
      </div>
    </div>
  );
}
