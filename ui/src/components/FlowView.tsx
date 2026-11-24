import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ChevronRight, FileText } from "lucide-react";
import type { RequestRecord } from "../types";
import {
  approxTokens,
  buildFlow,
  keyTarget,
  matchesFilter,
  matchesQuery,
  type FlowFilter,
  type FlowItem,
  type FlowZone,
} from "../lib/flow";
import { fmtMs } from "../lib/format";
import { FilterBar, ItemPreview, ItemRow } from "./FlowItems";

const FILTERS: [FlowFilter, string][] = [
  ["all", "All"],
  ["prompt", "Prompts"],
  ["assistant", "Assistant"],
  ["tool", "Tool calls"],
  ["error", "Errors"],
  ["harness", "Harness"],
];

const ZONES: { id: FlowZone; title: string; foldable: boolean }[] = [
  { id: "prefix", title: "Sent with every request", foldable: true },
  { id: "carried", title: "Earlier turns", foldable: true },
  { id: "new", title: "New since the last reply", foldable: false },
  { id: "response", title: "Response", foldable: false },
];

const WHERE: Record<FlowZone, [message: string, tool: string]> = {
  prefix: ["Sent with every request of this conversation.", ""],
  carried: [
    "Sent again from an earlier request. The model has already answered it.",
    "Sent again from an earlier request, with its output.",
  ],
  new: [
    "New since the model's last reply.",
    "Asked for in the model's last reply. Its output is new in this request.",
  ],
  response: [
    "Returned by the model for this request.",
    "Asked for in this response. Its output arrives with the next request.",
  ],
};

const tokenText = (tokens: number | null) =>
  tokens == null ? "" : ` · ~${approxTokens(tokens)} tok`;

export default function FlowView({ record }: { record: RequestRecord }) {
  const flow = useMemo(() => buildFlow(record), [record]);
  const { items } = flow;
  const id = useId();
  const [filter, setFilter] = useState<FlowFilter>("all");
  const [search, setSearch] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [open, setOpen] = useState<Partial<Record<FlowZone, boolean>>>({});
  const firstOf = (zone: FlowZone) => items.find((item) => item.zone === zone)?.id;
  const [picked, setPicked] = useState<string | undefined>(
    () => firstOf("response") ?? firstOf("new") ?? items[0]?.id,
  );
  const focusPicked = useRef(false);
  const searchInput = useRef<HTMLInputElement>(null);

  const query = search.trim().toLowerCase();
  const searching = filter !== "all" || query !== "";
  const byZone = (zone: FlowZone) => items.filter((item) => item.zone === zone);
  const zones = ZONES.map((zone) => {
    const all = byZone(zone.id);
    const isOpen = !zone.foldable || searching || !!open[zone.id];
    const shown = isOpen
      ? all.filter((item) => matchesFilter(filter, item) && matchesQuery(query, item))
      : [];
    return { ...zone, all, isOpen, shown };
  }).filter((zone) => zone.all.length || zone.id === "response");
  const visible = zones.flatMap((zone) => zone.shown);
  // A filter or a fold may hide the picked row; the preview follows what is listed.
  const selected = visible.find((item) => item.id === picked) ?? visible[0];
  const rowId = (item: FlowItem) => `${id}-${item.id}`;

  useEffect(() => {
    if (!focusPicked.current || !selected) return;
    focusPicked.current = false;
    const row = document.getElementById(rowId(selected));
    row?.focus({ preventScroll: true });
    row?.scrollIntoView?.({ block: "nearest" });
  });

  const select = (itemId: string | undefined, focus = false) => {
    if (!itemId) return;
    focusPicked.current = focus;
    setPicked(itemId);
  };
  // A click asks to read the item: where the pane covers the list, that opens it.
  const pick = (itemId: string) => {
    select(itemId);
    setPreviewOpen(true);
  };
  const reveal = (itemId: string | undefined) => {
    const item = items.find((candidate) => candidate.id === itemId);
    if (!item) return;
    setFilter("all");
    setSearch("");
    setOpen((previous) => ({ ...previous, [item.zone]: true }));
    select(item.id, true);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const key = event.key;
    const target = keyTarget(key, visible, selected);
    if (target) {
      event.preventDefault();
      select(target.id, true);
    } else if (key === "e") {
      const errors = items.filter((item) => matchesFilter("error", item));
      if (!errors.length) return;
      event.preventDefault();
      const at = selected ? errors.indexOf(selected) : -1;
      reveal(errors[(at + 1) % errors.length].id);
    } else if (key === "/") {
      event.preventDefault();
      searchInput.current?.focus();
    }
  };

  if (!items.length && !flow.waiting)
    return (
      <div className="empty-state">
        <FileText size={24} />
        <p>No conversation steps in this request.</p>
      </div>
    );

  const sectionTokens = (zone: FlowZone) => {
    const ids = zone === "prefix" ? ["system", "tools"] : [zone];
    const parts = flow.sections.filter((section) => ids.includes(section.id));
    return parts.length && parts.every((section) => section.tokens != null)
      ? parts.reduce((total, section) => total + (section.tokens ?? 0), 0)
      : null;
  };
  const subtitle = (zone: (typeof zones)[number]) => {
    const count = `${zone.all.length} ${zone.all.length === 1 ? "item" : "items"}`;
    if (searching) return `${zone.shown.length} of ${zone.all.length} match`;
    if (zone.id === "prefix") {
      const tools = items.find((item) => item.kind === "tools")?.tools?.length ?? 0;
      const system = zone.all.some((item) => item.kind === "system");
      return (
        [system && "System prompt", tools && `${tools} ${tools === 1 ? "tool" : "tools"}`]
          .filter(Boolean)
          .join(" + ") + tokenText(sectionTokens("prefix"))
      );
    }
    if (zone.id === "carried")
      return `${count}${tokenText(sectionTokens("carried"))} · already answered`;
    if (zone.id === "new") return `${count}${tokenText(sectionTokens("new"))} · added by the agent`;
    return [
      count,
      flow.outputTokens != null && `${flow.outputTokens.toLocaleString()} tok`,
      record.latencyMs != null && fmtMs(record.latencyMs),
      flow.stopReason && `stop: ${flow.stopReason}`,
    ]
      .filter(Boolean)
      .join(" · ");
  };
  const awaiting = items.some((item) => item.zone === "response" && item.status === "awaiting");

  return (
    <div className="flow-view">
      {!!flow.sections.length && (
        <div className="flow-weight">
          <div className="flow-weight-totals">
            <span>
              {flow.inputTokens != null ? (
                <>
                  <strong>
                    {flow.estimated ? "~" : ""}
                    {flow.inputTokens.toLocaleString()}
                  </strong>{" "}
                  {flow.estimated ? "estimated tokens sent" : "tokens sent to the model"}
                  {!!flow.cacheRead && ` · ${flow.cacheRead.toLocaleString()} read from cache`}
                </>
              ) : (
                "What this request is made of"
              )}
            </span>
            {flow.outputTokens != null && (
              <span>
                <strong>{flow.outputTokens.toLocaleString()}</strong> tokens came back
                {record.latencyMs != null ? ` in ${fmtMs(record.latencyMs)}` : ""}
              </span>
            )}
          </div>
          <div className="flow-weight-bar" aria-hidden="true">
            {flow.sections.map((section) => (
              <i key={section.id} data-section={section.id} style={{ flexGrow: section.chars }} />
            ))}
          </div>
          <div className="flow-weight-key">
            {flow.sections.map((section) => (
              <button
                type="button"
                key={section.id}
                data-section={section.id}
                title="Share of the request by characters. Token counts per part are estimates."
                onClick={() => reveal(section.target)}
              >
                <i />
                <strong>{section.label}</strong>
                {section.tokens != null && <span>~{approxTokens(section.tokens)} tok</span>}
                <span>{section.share < 0.005 ? "<1" : Math.round(section.share * 100)}%</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <FilterBar
        filters={FILTERS.map(([value, label]) => ({
          value,
          label,
          count: items.filter((item) => matchesFilter(value, item)).length,
        }))}
        filter={filter}
        onFilter={setFilter}
        search={search}
        onSearch={setSearch}
        searchLabel="Find in this request"
        searchRef={searchInput}
      />

      <div className="flow-split" data-preview={previewOpen ? "open" : "closed"}>
        <div className="flow-list" onKeyDown={onKeyDown}>
          {zones.map((zone) => {
            const heading = (
              <>
                <i className="flow-zone-dot" />
                <strong>{zone.title}</strong>
                <span className="flow-zone-sub">{subtitle(zone)}</span>
              </>
            );
            return (
              <section
                key={zone.id}
                className="flow-zone"
                data-zone={zone.id}
                aria-label={zone.title}
              >
                {zone.foldable ? (
                  <button
                    type="button"
                    className="flow-zone-head"
                    aria-expanded={zone.isOpen}
                    onClick={() =>
                      setOpen((previous) => ({ ...previous, [zone.id]: !zone.isOpen }))
                    }
                  >
                    <ChevronRight size={13} className="flow-chevron" aria-hidden="true" />
                    {heading}
                    {!searching && (
                      <span className="flow-zone-action">{zone.isOpen ? "Hide" : "Show"}</span>
                    )}
                  </button>
                ) : (
                  <div className="flow-zone-head">{heading}</div>
                )}
                {zone.shown.map((item) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    domId={rowId(item)}
                    query={query}
                    selected={selected?.id === item.id}
                    onSelect={pick}
                  />
                ))}
                {zone.id === "response" && !zone.all.length && (
                  <p className="flow-zone-note">
                    {flow.waiting
                      ? "Waiting for the model response…"
                      : "No parsed response steps. See Response or HTTP for the captured payload."}
                  </p>
                )}
                {zone.id === "response" && awaiting && !searching && (
                  <p className="flow-zone-note">
                    The model asked for tools. Their outputs arrive with the next request.
                  </p>
                )}
              </section>
            );
          })}
          {searching && !visible.length && (
            <p className="flow-zone-note flow-no-match">
              Nothing in this request matches.{" "}
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
        <ItemPreview
          item={selected}
          where={
            !selected
              ? undefined
              : selected.kind === "failed" || selected.kind === "cancelled"
                ? "How this request ended. No reply came back."
                : WHERE[selected.zone][selected.kind === "tool" ? 1 : 0]
          }
          onClose={() => setPreviewOpen(false)}
        />
      </div>
    </div>
  );
}
