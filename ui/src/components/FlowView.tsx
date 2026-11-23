import { useId, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowDownLeft,
  ArrowUpRight,
  Brain,
  ChevronRight,
  Cpu,
  FileText,
  Info,
  MessageSquare,
  Square,
  Terminal,
  Wrench,
} from "lucide-react";
import type { RequestRecord, TimelineStep } from "../types";
import { flowSteps, smartSummary } from "../lib/timeline";
import { CodeView, CopyButton } from "./JsonView";

const isCall = (step: TimelineStep) => step.kind === "tool_use" || step.kind === "skill";

export default function FlowView({ record }: { record: RequestRecord }) {
  const steps = useMemo(() => flowSteps(record), [record]);
  const context = steps.filter((step) => !step.latest);
  const response = steps.filter((step) => step.latest);
  const tools = record.parsed?.view?.tools ?? [];
  const requestFailed = record.parsed?.response?.error != null || record.response?.error != null ||
    record.error != null || (record.response?.status ?? 0) >= 400;
  const [contextOpen, setContextOpen] = useState(!response.length);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const responseHeading = useRef<HTMLHeadingElement>(null);
  const id = useId();
  const calls = new Map<string, { step: TimelineStep; number: number; index: number }>();
  const results = new Map<string, number>();
  let callNumber = 0;
  steps.forEach((step, index) => {
    if (isCall(step)) {
      callNumber++;
      if (step.callId) calls.set(step.callId, { step, number: callNumber, index });
    } else if (step.kind === "tool_result" && step.callId) results.set(step.callId, index);
  });
  const rowId = (index: number) => `${id}-step-${index}`;
  const reveal = (index: number) => {
    if (!steps[index].latest) setContextOpen(true);
    // The context disclosure must commit before its newly visible target can be focused.
    requestAnimationFrame(() => {
      const target = document.getElementById(rowId(index));
      target?.scrollIntoView({ block: "center" });
      target?.focus({ preventScroll: true });
    });
  };
  const toggle = (index: number) =>
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });

  function renderStep(step: TimelineStep) {
    const index = steps.indexOf(step);
    const call = step.callId ? calls.get(step.callId) : undefined;
    const resultIndex = step.callId ? results.get(step.callId) : undefined;
    const tool = isCall(step);
    const result = step.kind === "tool_result";
    const thinking = step.kind === "thinking" || (step.kind === "assistant" && step.label === "reasoning");
    const failed = !!step.isError ||
      (step.kind === "stop" && (requestFailed || /^error(?:\s|$)/.test(step.text)));
    const title = tool
      ? step.name || "Unnamed tool"
      : result
        ? call?.step.name || "Unmatched tool result"
        : step.kind === "stop"
          ? failed ? "Request failed" : "Turn completed"
          : thinking
            ? "Thinking"
            : step.kind === "assistant"
              ? step.label ? `Assistant · ${step.label}` : "Assistant"
              : "User";
    const label = tool
      ? step.kind === "skill" ? "Skill call" : "Tool call"
      : result
        ? "Tool output"
        : thinking
          ? "Reasoning"
          : step.kind === "stop" ? "Stop reason" : "Message";
    const Icon = tool
      ? Wrench
      : result
        ? Terminal
        : thinking
          ? Brain
          : step.kind === "assistant"
            ? Cpu
            : step.kind === "stop" ? Square : MessageSquare;
    const preview = tool && step.text.trim() === "{}"
      ? "No arguments"
      : smartSummary(step) || "Empty content";
    const open = expanded.has(index);
    const counterpart = result ? call?.index : resultIndex;
    const status = failed
      ? "Error"
      : result
        ? "Returned"
        : tool
          ? resultIndex != null
            ? "Result captured"
            : step.latest ? "Requested" : "No result captured"
          : undefined;
    const definition = tools.find(
      (definition) => definition.name === (tool ? step.name : call?.step.name),
    );
    return (
      <li
        key={index}
        className={`flow-event ${step.latest ? "flow-event-new" : ""}`}
        data-kind={step.kind}
        data-source={step.latest ? "response" : "context"}
      >
        <details className={`flow-card ${failed ? "flow-card-error" : ""}`} open={open}>
          <summary
            id={rowId(index)}
            aria-label={`${open ? "Collapse" : "Expand"} ${label.toLowerCase()} ${title} content`}
            aria-controls={`${rowId(index)}-body`}
            onClick={(event) => {
              event.preventDefault();
              toggle(index);
            }}
          >
            <span className={`flow-icon ${failed ? "flow-icon-error" : result ? "flow-icon-result" : tool ? "flow-icon-tool" : step.latest ? "flow-icon-new" : ""}`}>
              <Icon size={15} aria-hidden="true" />
            </span>
            <span className="flow-event-main">
              <span className="flow-event-heading">
                <span className="flow-kind">{label}</span>
                <strong title={definition?.description}>{title}</strong>
              </span>
              <span className={`flow-preview ${tool ? "mono" : ""}`}>{preview}</span>
            </span>
            <span className="flow-event-meta">
              {status && (
                <span className={`badge ${failed ? "badge-error" : result ? "badge-success" : "badge-muted"}`}>
                  {status}
                </span>
              )}
              <span className="flow-size">{step.text.length.toLocaleString()} chars</span>
            </span>
            <ChevronRight size={14} className="flow-chevron" aria-hidden="true" />
          </summary>
          <div id={`${rowId(index)}-body`}>
            {open && (
              <div className="flow-body">
                <div className="flow-body-heading">
                  <span>{tool ? "Captured arguments" : result ? "Captured output" : "Full content"}</span>
                  <CopyButton text={step.text} label={`Copy ${label.toLowerCase()} ${title}`} displayLabel="Copy" />
                </div>
                <CodeView text={step.text} />
              </div>
            )}
          </div>
        </details>
        {step.callId && step.kind !== "stop" && (
          <div className="flow-call-link">
            <span className="mono" title={`Call ID: ${step.callId}`}>
              {call ? `Call ${call.number}` : "Call ID"} · {step.callId.slice(-8)}
            </span>
            {counterpart != null && (
              <button type="button" className="flow-link" onClick={() => reveal(counterpart)}>
                <ArrowUpRight size={11} aria-hidden="true" />
                {result ? "View call" : "View output"}
              </button>
            )}
            {result && call && <span className="flow-call-preview">{smartSummary(call.step)}</span>}
          </div>
        )}
      </li>
    );
  }

  if (!steps.length && !tools.length)
    return (
      <div className="empty-state">
        <FileText size={24} />
        <p>No conversation steps in this request.</p>
      </div>
    );
  const messages = context.filter(
    (step) => step.kind === "user" || step.kind === "assistant" || step.kind === "thinking",
  ).length;
  const contextCalls = context.filter(isCall).length;
  const outputs = context.filter((step) => step.kind === "tool_result").length;
  return (
    <div className="flow-view">
      <div className="flow-toolbar">
        <p>What went in. What came back.</p>
        <div>
          <button
            type="button"
            className="button button-ghost button-sm"
            onClick={() => {
              setContextOpen(true);
              setToolsOpen(true);
              setExpanded(new Set(steps.map((_, index) => index)));
            }}
          >Expand all</button>
          <button
            type="button"
            className="button button-ghost button-sm"
            onClick={() => {
              setContextOpen(false);
              setToolsOpen(false);
              setExpanded(new Set());
            }}
          >Collapse all</button>
          <button
            type="button"
            className="button button-sm"
            disabled={!response.length}
            onClick={() => {
              responseHeading.current?.scrollIntoView({ block: "start" });
              responseHeading.current?.focus({ preventScroll: true });
            }}
          ><ArrowDown size={12} />Jump to new</button>
        </div>
      </div>
      <div className="flow-legend" aria-label="Flow color key">
        <span><i className="flow-dot-context" />Sent context</span>
        <span><i className="flow-dot-new" />New response</span>
        <span><i className="flow-dot-tool" />Tool call</span>
        <span><i className="flow-dot-result" />Returned output</span>
        <span><i className="flow-dot-error" />Error</span>
      </div>
      <details className="flow-context" open={contextOpen}>
        <summary
          aria-controls={`${id}-context`}
          onClick={(event) => {
            event.preventDefault();
            setContextOpen(!contextOpen);
          }}
        >
          <ChevronRight size={15} className="flow-chevron" />
          <ArrowUpRight size={16} />
          <span>
            <strong>Request context</strong>
            <span className="flow-group-subtitle">
              {[
                `${messages} messages`,
                contextCalls ? `${contextCalls} tool calls` : "",
                outputs ? `${outputs} outputs` : "",
                tools.length ? `${tools.length} available tools` : "",
              ].filter(Boolean).join(" · ")}
            </span>
          </span>
          <span className="badge badge-muted">Sent to model</span>
        </summary>
        <p className="flow-context-note">Input, not new model output: earlier conversation, the current prompt, and any tool results sent with this request.</p>
        <div id={`${id}-context`}>
          {contextOpen && (
            <>
              {!!tools.length && (
                <details className="flow-tools" open={toolsOpen}>
                  <summary onClick={(event) => {
                    event.preventDefault();
                    setToolsOpen(!toolsOpen);
                  }}>
                    <ChevronRight size={13} className="flow-chevron" />
                    <Wrench size={14} />
                    <span>
                      <strong>Available tools</strong>
                      <span className="flow-tools-preview">{tools.map((tool) => tool.name).join(" · ")}</span>
                    </span>
                    <span className="badge badge-muted">{tools.length}</span>
                  </summary>
                  {toolsOpen && (
                    <ul>
                      {tools.map((tool, index) => (
                        <li key={`${tool.name}-${index}`}>
                          <strong className="mono">{tool.name}</strong>
                          <p>{tool.description || "No description captured."}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </details>
              )}
              <ol className="flow-events">{context.map(renderStep)}</ol>
            </>
          )}
        </div>
      </details>
      <section className="flow-response" aria-label="New response">
        <div className="flow-group-heading">
          <ArrowDownLeft size={17} />
          <div>
            <h3 ref={responseHeading} tabIndex={-1}>New response</h3>
            <p>Only what the model returned for this request.</p>
          </div>
          <span className="badge tag-orange">{response.length} {response.length === 1 ? "event" : "events"}</span>
        </div>
        <ol className="flow-events">{response.map(renderStep)}</ol>
        {!response.length && (
          <p className="flow-context-note">
            {record.response
              ? "No parsed response steps. See Response or Raw for the captured payload."
              : "Waiting for the model response…"}
          </p>
        )}
        {response.some(isCall) && (
          <p className="flow-response-note">
            <Info size={13} />
            “Requested” means the model asked for a tool; its output usually arrives in a later request.
          </p>
        )}
      </section>
    </div>
  );
}
