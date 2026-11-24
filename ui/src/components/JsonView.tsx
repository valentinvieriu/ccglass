import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { Check, ChevronRight, Copy, WrapText } from "lucide-react";
import { formatJson, tokenizeJson } from "../lib/json";

export function pretty(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  return JSON.stringify(value, null, 2) ?? String(value);
}

export function CopyButton({
  text,
  label = "Copy",
  displayLabel = label,
  className = "",
}: {
  text: string;
  label?: string;
  displayLabel?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    setCopied(false);
    return () => clearTimeout(timer.current);
  }, [text]);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt(`Copy ${label.toLowerCase()}`, text);
    }
  }
  return (
    <button
      type="button"
      className={`button button-ghost button-sm ${className}`}
      onClick={copy}
      aria-label={copied ? "Copied to clipboard" : label}
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
      <span>{copied ? "Copied" : displayLabel}</span>
    </button>
  );
}

export function CodeView({ text, compact = false }: { text: string; compact?: boolean }) {
  const content = useMemo(() => formatJson(text), [text]);
  const [original, setOriginal] = useState(false);
  const [wrap, setWrap] = useState(true);
  useEffect(() => {
    setOriginal(false);
  }, [text]);
  const displayed = original ? text : content.formatted;
  // Keep large captures readable without creating hundreds of thousands of spans.
  const highlighted = content.json && displayed.length <= 100_000;
  const tokens = useMemo(
    () => (highlighted ? tokenizeJson(displayed) : [{ kind: "plain", text: displayed }]),
    [displayed, highlighted],
  );
  const toolbar = !compact && (content.json || text.length > 800 || text.includes("\n"));
  return (
    <div className="code-view">
      {toolbar && (
        <div className="code-toolbar">
          <span className="code-language">{content.json ? "JSON" : "Text"}</span>
          <span className="code-size">{displayed.split("\n").length.toLocaleString()} lines</span>
          {content.json && content.formatted !== text && (
            <div className="code-modes" aria-label="JSON formatting">
              <button type="button" aria-pressed={!original} onClick={() => setOriginal(false)}>
                Formatted
              </button>
              <button type="button" aria-pressed={original} onClick={() => setOriginal(true)}>
                Original
              </button>
            </div>
          )}
          <button
            type="button"
            className="code-wrap-toggle"
            aria-label="Wrap lines"
            aria-pressed={wrap}
            onClick={() => setWrap(!wrap)}
            title="Toggle line wrapping"
          >
            <WrapText size={14} />
            Wrap
          </button>
        </div>
      )}
      {content.json && !highlighted && (
        <p className="code-notice">
          Large JSON payload: syntax colors are paused; all content is shown.
        </p>
      )}
      <pre
        className={`code-block ${wrap ? "code-wrap" : "code-nowrap"}`}
        aria-label={content.json ? (original ? "Original JSON" : "Formatted JSON") : "Text content"}
        tabIndex={0}
      >
        {tokens.map((token, index) =>
          token.kind === "plain" ? (
            token.text
          ) : (
            <span key={index} className={`json-${token.kind}`}>
              {token.text}
            </span>
          ),
        )}
      </pre>
    </div>
  );
}

export function TextContent({
  text,
  expanded = false,
  compact = false,
}: {
  text: string;
  expanded?: boolean;
  compact?: boolean;
}) {
  const lines = useMemo(() => text.split("\n").length, [text]);
  const [open, setOpen] = useState(expanded);
  const id = useId();
  useEffect(() => setOpen(expanded), [expanded, text]);
  if (text.length <= 800 && lines <= 18) return <CodeView text={text || "—"} compact={compact} />;
  return (
    <details
      className="timeline-fold"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary aria-controls={id}>
        <ChevronRight size={13} />
        <span>{open ? "Collapse content" : "Expand content"}</span>
        <span className="ml-auto mono">
          {lines.toLocaleString()} lines · {text.length.toLocaleString()} characters
        </span>
      </summary>
      {!open && (
        <pre className="content-preview">
          {text.slice(0, 220).replace(/\s+/g, " ").slice(0, 180)}
          {text.length > 180 ? "…" : ""}
        </pre>
      )}
      <div id={id}>{open && <CodeView text={text} compact={compact} />}</div>
    </details>
  );
}

export function ContentBlock({
  title,
  value,
  tags,
  className = "",
  expanded = false,
  style,
}: {
  title: string;
  value: unknown;
  tags?: ReactNode;
  className?: string;
  expanded?: boolean;
  style?: CSSProperties;
}) {
  const text = pretty(value);
  const long = text.length > 800 || text.split("\n").length > 18;
  const [open, setOpen] = useState(expanded || !long);
  const contentId = useId();
  useEffect(() => setOpen(expanded || !long), [expanded, text, long]);
  return (
    <section className={`detail-card ${className}`} style={style}>
      <div className="detail-card-header flex-wrap">
        <h3 className="m-0 mr-auto font-strong">
          {long ? (
            <button
              className="content-title"
              aria-expanded={open}
              aria-controls={contentId}
              title={`${open ? "Collapse" : "Expand"} ${title}`}
              onClick={() => setOpen(!open)}
            >
              <ChevronRight size={13} />
              {title}
            </button>
          ) : (
            title
          )}
        </h3>
        <div className="flex flex-wrap items-center gap-1">
          {long && <span className="code-size">{text.length.toLocaleString()} chars</span>}
          {tags}
          <CopyButton text={text} label={`Copy ${title}`} displayLabel="Copy" />
        </div>
      </div>
      {!open && (
        <pre className="content-preview">
          {text.slice(0, 220).replace(/\s+/g, " ").slice(0, 180)}…
        </pre>
      )}
      <div className="detail-card-body" id={contentId}>
        {open && <CodeView text={text || "—"} />}
      </div>
    </section>
  );
}

export default function JsonView({
  value,
  title = "JSON",
  expanded = false,
}: {
  value: unknown;
  title?: string;
  expanded?: boolean;
}) {
  return <ContentBlock title={title} value={value} expanded={expanded} />;
}
