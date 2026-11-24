import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  ArrowDown,
  ArrowUp,
  Brain,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Cpu,
  FileText,
  Terminal,
  User,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { RequestRecord } from "../types";
import { approxTokens, matchesFilter, outcome, type FlowFilter, type FlowZone } from "../lib/flow";
import { fmtApproxTokens, fmtChars, oneLine } from "../lib/format";
import { buildMessages, type MessageGroup, type MessagePart, type Segment } from "../lib/messages";
import { TAG_INFO } from "../lib/timeline";
import { FilterBar, Highlight } from "./FlowItems";
import { CodeView, CopyButton } from "./JsonView";

const FILTERS: [FlowFilter, string][] = [
  ["all", "All"],
  ["prompt", "User"],
  ["assistant", "Assistant"],
  ["tool", "Tool calls"],
  ["error", "Errors"],
  ["harness", "Harness"],
];

const ZONES: Partial<Record<FlowZone, [title: string, note: string]>> = {
  carried: ["Earlier turns", "sent again from earlier requests · already answered"],
  new: ["New since the last reply", "what this request adds to the conversation"],
};

const ICONS: Record<MessageGroup["tone"], LucideIcon> = {
  user: User,
  assistant: Cpu,
  tool: Terminal,
  quiet: Zap,
};

const PREVIEW_LINES = 8;
const PREVIEW_CHARS = 600;

const isLong = (text: string) => text.length > 900 || text.split("\n", 16).length > 14;
// Sizes read in tokens, the unit the context is limited in; hover shows characters.
const chars = (count: number) => fmtApproxTokens(count);
const position = (group: number, path?: string) => path ?? `#${group}`;

function partMatches(query: string, part: MessagePart) {
  if (!query) return true;
  const { item } = part;
  return [item.name, item.text, part.toolName ?? ""].some((text) =>
    text.toLowerCase().includes(query),
  );
}

export interface Reading {
  query: string;
  /** Bumped by "Expand all" / "Collapse all" so every fold follows it once. */
  expand: { open: boolean; version: number };
  /** Start with everything unfolded, for a view that shows a single message. */
  open?: boolean;
}

/** A fold that follows the global expand toggle but can be changed on its own. */
function useFold(initial: boolean, reading: Reading, matches: boolean) {
  const [open, setOpen] = useState(initial || !!reading.open);
  const version = useRef(reading.expand.version);
  useEffect(() => {
    if (version.current === reading.expand.version) return;
    version.current = reading.expand.version;
    setOpen(reading.expand.open);
  }, [reading.expand]);
  // A search hit inside folded content would otherwise stay out of sight.
  return [open || (matches && !!reading.query), setOpen] as const;
}

/** Message content: short text in full, long text behind a preview. */
function Body({
  text,
  mono = false,
  quiet = false,
  error = false,
  reading,
}: {
  text: string;
  mono?: boolean;
  quiet?: boolean;
  error?: boolean;
  reading: Reading;
}) {
  // A view that starts unfolded has nothing to clip.
  const long = useMemo(() => !reading.open && isLong(text), [reading.open, text]);
  const matches = !!reading.query && text.toLowerCase().includes(reading.query);
  const [open, setOpen] = useFold(false, reading, matches);
  const shown = long && !open;
  const preview = useMemo(
    () =>
      shown
        ? text
            .split("\n", PREVIEW_LINES + 1)
            .slice(0, PREVIEW_LINES)
            .join("\n")
            .slice(0, PREVIEW_CHARS)
        : "",
    [shown, text],
  );
  const className = `msg-body ${mono ? "msg-mono" : "msg-prose"} ${quiet ? "msg-quiet" : ""} ${error ? "msg-error" : ""}`;
  return (
    <div className="msg-content">
      {shown ? (
        <div className={`${className} msg-clipped`}>{preview.trimEnd()}…</div>
      ) : mono && !matches ? (
        // Tool traffic is often JSON: keep the formatted, colored view for it.
        <div className={error ? "msg-code msg-error" : "msg-code"}>
          <CodeView text={text} compact={!long} />
        </div>
      ) : (
        <div className={className}>
          <Highlight text={text} query={reading.query} />
        </div>
      )}
      {long && (
        <button
          type="button"
          className="msg-more"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <ChevronRight size={12} aria-hidden="true" />
          {open
            ? "Show less"
            : `Show all · ${text.split("\n").length.toLocaleString()} lines · ${chars(text.length)}`}
        </button>
      )}
    </div>
  );
}

/** A harness envelope such as <system-reminder>: one line until opened. */
function Envelope({ segment, reading }: { segment: Segment; reading: Reading }) {
  const matches = !!reading.query && segment.text.toLowerCase().includes(reading.query);
  const [open, setOpen] = useFold(false, reading, matches);
  const inner = segment.text.replace(/<\/?[a-zA-Z][\w-]*>/g, " ");
  return (
    <div className="msg-envelope" data-open={open}>
      <button
        type="button"
        className="msg-envelope-head"
        aria-expanded={open}
        title="Wrapped around the message by the harness"
        onClick={() => setOpen(!open)}
      >
        <ChevronRight size={12} aria-hidden="true" />
        <span className="msg-envelope-name mono">{segment.name}</span>
        {!open && <span className="msg-envelope-preview">{oneLine(inner, 160)}</span>}
        <span className="msg-size" title={fmtChars(segment.text.length)}>
          {chars(segment.text.length)}
        </span>
      </button>
      {open && (
        <div className="msg-body msg-mono msg-quiet">
          <Highlight text={segment.text} query={reading.query} />
        </div>
      )}
    </div>
  );
}

function Part({
  part,
  alone,
  reading,
  domId,
  flash,
  defined,
  onJump,
  onOpenTool,
}: {
  part: MessagePart;
  /** The only block of its message: the message header already describes it. */
  alone: boolean;
  reading: Reading;
  domId: string;
  flash: boolean;
  defined: boolean;
  onJump: (id: string) => void;
  onOpenTool?: (name: string) => void;
}) {
  const { item } = part;
  const noInput = item.kind === "tool" && (!item.text.trim() || item.text.trim() === "{}");
  const matches = partMatches(reading.query, part);
  const [open, setOpen] = useFold(item.kind === "tool" && !isLong(item.text), reading, matches);
  const frame = `msg-part ${flash ? "msg-flash" : ""}`;

  if (item.kind === "tool") {
    const result = outcome(item);
    return (
      <div className={`${frame} msg-call`} id={domId} data-status={item.status}>
        <div className="msg-call-head">
          <button
            type="button"
            className="msg-call-toggle"
            aria-expanded={open}
            aria-label={`Tool call ${item.name}`}
            onClick={() => setOpen(!open)}
          >
            <ChevronRight size={12} aria-hidden="true" />
            <Wrench size={13} aria-hidden="true" />
            <span className="msg-call-name mono">
              <Highlight text={item.name} query={reading.query} />
            </span>
            {!open && <span className="msg-call-args mono">{item.summary}</span>}
          </button>
          <span className={`flow-outcome flow-outcome-${result.tone}`}>
            {result.text}
            {result.size != null && chars(result.size)}
          </span>
          {part.pair && (
            <button type="button" className="msg-jump" onClick={() => onJump(part.pair!.id)}>
              Output <ArrowDown size={12} aria-hidden="true" />
            </button>
          )}
        </div>
        {open && (
          <>
            {noInput ? (
              <p className="msg-note">Called without arguments.</p>
            ) : (
              <Body text={item.text} mono reading={reading} />
            )}
            <div className="msg-call-meta">
              {item.callId && (
                <span className="mono" title={item.callId}>
                  id {item.callId.slice(-8)}
                </span>
              )}
              {!defined ? (
                <span className="msg-warning">Not among the tools defined in this request</span>
              ) : (
                onOpenTool &&
                item.tool && (
                  <button
                    type="button"
                    className="flow-link"
                    onClick={() => onOpenTool(item.tool!)}
                  >
                    Definition
                  </button>
                )
              )}
              <CopyButton
                text={item.text}
                label={`Copy input of ${item.name}`}
                displayLabel="Copy input"
              />
            </div>
          </>
        )}
      </div>
    );
  }

  if (item.kind === "output") {
    const failed = item.status === "error";
    return (
      <div className={`${frame} msg-output`} id={domId} data-status={item.status}>
        <div className="msg-part-head">
          <span className="msg-part-title">
            {part.toolName ? (
              <>
                Output of{" "}
                <strong className="mono">
                  <Highlight text={part.toolName} query={reading.query} />
                </strong>
              </>
            ) : (
              "Output without a matching call"
            )}
          </span>
          {failed && <span className="badge badge-error">error</span>}
          {item.callId && (
            <span className="msg-id mono" title={item.callId}>
              id {item.callId.slice(-8)}
            </span>
          )}
          {part.pair && (
            <button type="button" className="msg-jump" onClick={() => onJump(part.pair!.id)}>
              Call <ArrowUp size={12} aria-hidden="true" />
            </button>
          )}
          {!alone && (
            <CopyButton
              text={item.text}
              label={`Copy output of ${part.toolName ?? "tool"}`}
              displayLabel="Copy"
            />
          )}
        </div>
        {item.text ? (
          <Body text={item.text} mono error={failed} reading={reading} />
        ) : (
          <p className="msg-note">The tool returned nothing.</p>
        )}
      </div>
    );
  }

  if (item.kind === "thinking")
    return (
      <div className={`${frame} msg-thinking`} id={domId}>
        <div className="msg-part-head">
          <span className="msg-part-title">
            <Brain size={13} aria-hidden="true" /> Reasoning
          </span>
        </div>
        <Body text={item.text} quiet reading={reading} />
      </div>
    );

  if (item.kind === "assistant" && item.name.startsWith("Assistant · "))
    return (
      <div className={frame} id={domId}>
        <div className="msg-part-head">
          <span className="msg-part-title mono">{item.name.slice("Assistant · ".length)}</span>
        </div>
        <Body text={item.text} mono reading={reading} />
      </div>
    );

  if (!item.text.trim())
    return (
      <p className={`${frame} msg-note`} id={domId}>
        Empty text block
        {item.text.length ? ` · ${fmtChars(item.text.length)} of whitespace` : ""}
      </p>
    );

  // Only the user role is wrapped by harnesses; everything else is read as is.
  const segments: Segment[] = part.segments?.length
    ? part.segments
    : [{ kind: "text", text: item.text, human: true }];
  return (
    <div className={frame} id={domId}>
      {segments.map((segment, index) =>
        segment.kind === "envelope" ? (
          <Envelope key={index} segment={segment} reading={reading} />
        ) : (
          <Body
            key={index}
            text={segment.text}
            mono={!!item.injected}
            quiet={item.kind === "user" && !item.injected && !segment.human}
            reading={reading}
          />
        ),
      )}
    </div>
  );
}

/** One message: who wrote it, where it sits in the request, and its content blocks. */
export function MessageEntry({
  group,
  reading,
  dom,
  flash,
  defined,
  where,
  onJump,
  onOpenTool,
}: {
  group: MessageGroup;
  reading: Reading;
  dom: (id: string) => string;
  /** Id of the block to highlight after a jump. */
  flash?: string;
  /** Names of the tools the request defines. */
  defined: Set<string>;
  /** Replaces the position in the request body, e.g. for the model's reply. */
  where?: string;
  onJump: (id: string) => void;
  onOpenTool?: (name: string) => void;
}) {
  const Icon = ICONS[group.tone];
  const tags = [
    ...new Set(group.parts.flatMap((part) => (part.item.kind === "user" ? part.item.tags : []))),
  ].filter((tag) => TAG_INFO[tag] && tag !== "reminder");
  const wire = !where && group.role && group.role !== group.label.toLowerCase();
  const text = group.parts.map((part) => part.item.text).join("\n\n");
  const place = where ?? position(group.number, group.path);
  return (
    <article className="msg" data-tone={group.tone} aria-label={`${group.label} · ${place}`}>
      <span className={`flow-tile flow-tile-${group.tone}`}>
        <Icon size={13} aria-hidden="true" />
      </span>
      <div className="msg-main">
        <header className="msg-head">
          <strong>{group.label}</strong>
          {tags.map((tag) => (
            <span className="flow-tag" key={tag} title={TAG_INFO[tag].desc}>
              {TAG_INFO[tag].headline}
            </span>
          ))}
          <span
            className="msg-path mono"
            title={
              !where && group.path
                ? `${group.path} in the request body${wire ? `, sent in the ${group.role} role` : ""}`
                : undefined
            }
          >
            {place}
            {wire ? ` · role ${group.role}` : ""}
          </span>
          <span className="msg-size" title={fmtChars(group.chars)}>
            {chars(group.chars)}
          </span>
          <CopyButton
            text={text}
            label={`Copy ${group.label.toLowerCase()} ${place}`}
            displayLabel="Copy"
            className="msg-copy"
          />
        </header>
        {group.parts.map((part) => (
          <div key={part.id} className="msg-slot">
            <Part
              part={part}
              alone={group.parts.length === 1}
              reading={reading}
              domId={dom(part.id)}
              flash={flash === part.id}
              defined={!part.item.tool || defined.has(part.item.tool)}
              onJump={onJump}
              onOpenTool={onOpenTool}
            />
            {part.cache && (
              <p
                className="msg-cache"
                title="This block carries a cache breakpoint: the provider can reuse the request up to here instead of reading it again."
              >
                Cache breakpoint · everything up to here can be read from cache
              </p>
            )}
          </div>
        ))}
      </div>
    </article>
  );
}

export default function MessagesView({
  record,
  focus,
  onOpenTool,
  onOpenResponse,
}: {
  record: RequestRecord;
  /** A block to bring into view, e.g. when arriving from the Tools tab. */
  focus?: { target: string; nonce: number };
  onOpenTool?: (name: string) => void;
  onOpenResponse?: () => void;
}) {
  const model = useMemo(() => buildMessages(record), [record]);
  const defined = useMemo(
    () => new Set((record.parsed?.view?.tools ?? []).map((tool) => tool.name)),
    [record],
  );
  const id = useId();
  const [filter, setFilter] = useState<FlowFilter>("all");
  const [search, setSearch] = useState("");
  const [expand, setExpand] = useState({ open: false, version: 0 });
  const [flash, setFlash] = useState<{ id: string; nonce: number } | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);

  const query = search.trim().toLowerCase();
  const reading = useMemo(() => ({ query, expand }), [query, expand]);
  const groupMatches = (value: FlowFilter, group: MessageGroup) =>
    group.parts.some((part) => matchesFilter(value, part.item));
  const visible = model.groups.filter(
    (group) => groupMatches(filter, group) && group.parts.some((part) => partMatches(query, part)),
  );
  const narrowed = filter !== "all" || query !== "";
  const dom = (target: string) => `${id}-${target}`;

  const jump = (target: string | undefined) => {
    if (!target) return;
    const shown = visible.some((group) => group.parts.some((part) => part.id === target));
    if (!shown) {
      setFilter("all");
      setSearch("");
    }
    setFlash((previous) => ({ id: target, nonce: (previous?.nonce ?? 0) + 1 }));
  };
  useEffect(() => {
    if (focus) jump(focus.target);
    // Only a new jump request moves the view, not every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.nonce]);
  useEffect(() => {
    if (!flash) return;
    document.getElementById(dom(flash.id))?.scrollIntoView?.({ block: "center" });
    const timer = setTimeout(() => setFlash(null), 1800);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flash]);

  if (!model.groups.length)
    return (
      <div className="empty-state">
        <div className="empty-icon">
          <FileText size={24} />
        </div>
        <p>No messages were sent.</p>
      </div>
    );

  const errors = model.parts.filter((part) => matchesFilter("error", part.item));
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if ((event.target as HTMLElement).closest("input, textarea, select")) return;
    if (event.key === "/") {
      event.preventDefault();
      searchInput.current?.focus();
    } else if (event.key === "e" && errors.length) {
      event.preventDefault();
      const at = errors.findIndex((part) => part.id === flash?.id);
      jump(errors[(at + 1) % errors.length].id);
    }
  };

  const hasNew = model.newFrom > 0 && model.newFrom < model.groups.length;
  const largest = model.largest;
  const largestGroup = largest && model.groups.find((group) => group.parts.includes(largest));
  let zone: FlowZone | undefined;

  return (
    <div className="flow-view msg-view" onKeyDown={onKeyDown}>
      <div className="insp-summary">
        <span>
          <strong>{model.groups.length.toLocaleString()}</strong>{" "}
          {model.groups.length === 1 ? "message" : "messages"}
          {model.parts.length !== model.groups.length &&
            ` · ${model.parts.length.toLocaleString()} content blocks`}
          {` · ${model.tokens != null ? `~${approxTokens(model.tokens)} tok` : chars(model.chars)}`}
        </span>
        {largest && largestGroup && model.parts.length > 3 && (
          <span>
            Largest:{" "}
            <button type="button" className="flow-link" onClick={() => jump(largest.id)}>
              {largest.item.kind === "output" && largest.toolName
                ? `output of ${largest.toolName}`
                : `${largestGroup.label.toLowerCase()} ${position(largestGroup.number, largestGroup.path)}`}
            </button>{" "}
            · {chars(largest.item.text.length)}
            {model.chars > 0 && ` · ${Math.round((largest.item.text.length / model.chars) * 100)}%`}
          </span>
        )}
      </div>

      <FilterBar
        filters={FILTERS.map(([value, label]) => ({
          value,
          label,
          count: model.groups.filter((group) => groupMatches(value, group)).length,
        }))}
        filter={filter}
        onFilter={setFilter}
        search={search}
        onSearch={setSearch}
        searchLabel="Find in messages"
        searchRef={searchInput}
        actions={
          <>
            {hasNew && !narrowed && (
              <button
                type="button"
                className="button button-ghost button-sm"
                onClick={() =>
                  document.getElementById(dom("zone-new"))?.scrollIntoView?.({ block: "start" })
                }
              >
                <ArrowDown size={13} /> Jump to new
              </button>
            )}
            <button
              type="button"
              className="button button-ghost button-sm"
              aria-pressed={expand.open}
              onClick={() => setExpand({ open: !expand.open, version: expand.version + 1 })}
            >
              {expand.open ? <ChevronsDownUp size={13} /> : <ChevronsUpDown size={13} />}
              {expand.open ? "Collapse all" : "Expand all"}
            </button>
          </>
        }
      />

      <div className="msg-scroll" tabIndex={0} role="group" aria-label="Messages sent to the model">
        <ol className="msg-list">
          {visible.map((group) => {
            const divider = group.zone !== zone ? ZONES[group.zone] : undefined;
            zone = group.zone;
            return (
              <li key={group.key} className="msg-item">
                {divider && (
                  <div className="msg-zone" data-zone={group.zone} id={dom(`zone-${group.zone}`)}>
                    <i className="flow-zone-dot" />
                    <strong>{divider[0]}</strong>
                    <span>{divider[1]}</span>
                  </div>
                )}
                <MessageEntry
                  group={group}
                  reading={reading}
                  dom={dom}
                  flash={flash?.id}
                  defined={defined}
                  onJump={jump}
                  onOpenTool={onOpenTool}
                />
              </li>
            );
          })}
        </ol>
        {narrowed && !visible.length ? (
          <p className="flow-zone-note flow-no-match">
            No message matches.{" "}
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
        ) : (
          !narrowed && (
            <p className="msg-end">
              End of the messages sent with this request.
              {onOpenResponse && (
                <>
                  {" "}
                  <button type="button" className="flow-link" onClick={onOpenResponse}>
                    See what the model replied
                  </button>
                </>
              )}
            </p>
          )
        )}
      </div>
    </div>
  );
}
