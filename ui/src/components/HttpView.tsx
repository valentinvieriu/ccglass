import { useState } from "react";
import { ArrowDownLeft, ArrowUpRight, ChevronRight } from "lucide-react";
import type { RequestRecord } from "../types";
import { fmtMs } from "../lib/format";
import { ContentBlock, CopyButton } from "./JsonView";

type Headers = Record<string, unknown> | undefined;

// Client-library telemetry: sent on every request and rarely what one looks for.
const TELEMETRY = /^x-stainless-/i;

export function rawRequestBody(record: RequestRecord) {
  return record.request?.bodyRaw ?? record.request?.body;
}

const headerValue = (value: unknown) =>
  Array.isArray(value) ? value.join("\n") : String(value ?? "");

function HeaderTable({ title, headers }: { title: string; headers: Headers }) {
  const [all, setAll] = useState(false);
  const entries = Object.entries(headers ?? {}).filter(([, value]) => value != null);
  const telemetry = entries.filter(([name]) => TELEMETRY.test(name)).length;
  const folds = telemetry >= 4;
  const shown = folds && !all ? entries.filter(([name]) => !TELEMETRY.test(name)) : entries;
  return (
    <section className="detail-card http-headers">
      <div className="detail-card-header flex-wrap">
        <h3 className="m-0 mr-auto font-strong">{title}</h3>
        <div className="flex flex-wrap items-center gap-1">
          <span className="code-size">
            {entries.length} {entries.length === 1 ? "header" : "headers"}
          </span>
          {!!entries.length && (
            <CopyButton
              text={entries.map(([name, value]) => `${name}: ${headerValue(value)}`).join("\n")}
              label={`Copy ${title.toLowerCase()}`}
              displayLabel="Copy"
            />
          )}
        </div>
      </div>
      {entries.length ? (
        <table className="http-table">
          <tbody>
            {shown.map(([name, value]) => (
              <tr key={name}>
                <th scope="row">{name}</th>
                <td>{headerValue(value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="http-none">No headers were captured.</p>
      )}
      {folds && (
        <button
          type="button"
          className="http-fold"
          aria-expanded={all}
          onClick={() => setAll(!all)}
        >
          <ChevronRight size={12} aria-hidden="true" />
          {all ? "Hide" : "Show"} {telemetry} client telemetry headers (x-stainless-*)
        </button>
      )}
    </section>
  );
}

/** The exchange as it went over the wire: request line, headers and bodies. */
export default function HttpView({ record }: { record: RequestRecord }) {
  const request = record.request;
  const response = record.response;
  const line = `${request?.method || "GET"} ${request?.url || "/"}`;
  const status = response?.status;
  const latency = record.latencyMs ?? record.timing?.totalMs;
  return (
    <div className="http-view">
      <section aria-label="Request">
        <div className="http-head">
          <div className="section-head flex items-center gap-2">
            <ArrowUpRight size={15} />
            <h3 className="section-title">Request</h3>
          </div>
          <code className="http-line">{line}</code>
          <CopyButton text={line} label="Copy request line" displayLabel="Copy" />
        </div>
        <HeaderTable title="Request headers" headers={request?.headers} />
        <ContentBlock title="Raw request body" value={rawRequestBody(record)} />
      </section>
      <section aria-label="Response">
        <div className="http-head">
          <div className="section-head flex items-center gap-2">
            <ArrowDownLeft size={15} />
            <h3 className="section-title">Response</h3>
          </div>
          {response ? (
            <>
              <span
                className={`badge ${status == null ? "badge-muted" : status >= 400 ? "badge-error" : "badge-muted"}`}
              >
                {status != null ? `HTTP ${status}` : "No status"}
              </span>
              {latency != null && <span className="http-fact">{fmtMs(latency)}</span>}
            </>
          ) : (
            <span className="http-fact">not captured yet</span>
          )}
        </div>
        {response && (
          <>
            <HeaderTable title="Response headers" headers={response.headers} />
            <ContentBlock title="Raw response" value={response.raw ?? response} />
          </>
        )}
      </section>
    </div>
  );
}
