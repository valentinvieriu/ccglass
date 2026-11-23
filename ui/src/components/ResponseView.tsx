import { useId, useMemo } from "react";
import { FileText } from "lucide-react";
import type { RequestRecord } from "../types";
import { fmtMs } from "../lib/format";
import { buildReply } from "../lib/messages";
import { ContentBlock } from "./JsonView";
import { MessageEntry, type Reading } from "./MessagesView";

export function responseError(record: RequestRecord) {
  return record.parsed?.response?.error ?? record.response?.error ?? record.error;
}

// One message, read in full: nothing to search and nothing to fold away.
const READING: Reading = { query: "", expand: { open: true, version: 0 }, open: true };

/** What the model sent back, in the same form as the messages it was given. */
export default function ResponseView({
  record,
  onOpenTool,
  onOpenHttp,
}: {
  record: RequestRecord;
  onOpenTool?: (name: string) => void;
  onOpenHttp?: () => void;
}) {
  const id = useId();
  const reply = useMemo(() => buildReply(record), [record]);
  const defined = useMemo(
    () => new Set((record.parsed?.view?.tools ?? []).map((tool) => tool.name)),
    [record],
  );
  const response = record.parsed?.response;
  const error = responseError(record);
  if (!response && !record.response && error == null)
    return (
      <div className="empty-state">
        <div className="empty-icon">
          <FileText size={24} />
        </div>
        <p>No response captured yet.</p>
      </div>
    );

  const status = record.response?.status;
  const stats = record.parsed?.usageStats ?? record.parsed?.cost;
  const output = stats?.output ?? response?.usage?.output_tokens;
  const latency = record.latencyMs ?? record.timing?.totalMs;
  const awaiting = reply?.parts.filter((part) => part.item.kind === "tool").length ?? 0;
  const raw = record.response?.raw ?? response ?? record.response;
  return (
    <div className="resp-view">
      <div className="insp-summary">
        <span className="resp-facts">
          <span
            className={`badge ${status == null ? "badge-muted" : status >= 400 ? "badge-error" : "badge-success"}`}
          >
            {status != null ? `HTTP ${status}` : "No status"}
          </span>
          {response?.stop_reason && (
            <span>
              Stopped: <strong>{response.stop_reason}</strong>
            </span>
          )}
          {response?.streamed && <span>streamed</span>}
        </span>
        <span>
          {output != null && (
            <>
              <strong>{Number(output).toLocaleString()}</strong> tokens
            </>
          )}
          {latency != null && `${output != null ? " in " : ""}${fmtMs(latency)}`}
          {record.timing?.ttftMs != null && ` · first token after ${fmtMs(record.timing.ttftMs)}`}
        </span>
      </div>

      {error != null && (
        <ContentBlock
          title="Response error"
          value={error}
          className="border-danger-border!"
          expanded
        />
      )}

      {reply ? (
        <div className="msg-frame">
          <MessageEntry
            group={reply}
            reading={READING}
            dom={(part) => `${id}-${part}`}
            defined={defined}
            where="reply"
            onJump={() => undefined}
            onOpenTool={onOpenTool}
          />
          {awaiting > 0 && (
            <p className="msg-end">
              The model asked for {awaiting === 1 ? "a tool" : `${awaiting} tools`}. The agent runs{" "}
              {awaiting === 1 ? "it" : "them"} and sends the output with the next request.
            </p>
          )}
        </div>
      ) : (
        raw != null && (
          <>
            {error == null && (
              <p className="resp-note">
                This response could not be read as a model reply. It is shown as received.
              </p>
            )}
            <ContentBlock title="Raw response" value={raw} />
          </>
        )
      )}

      {reply && onOpenHttp && (
        <p className="resp-note">
          Headers and the response exactly as received are under{" "}
          <button type="button" className="flow-link" onClick={onOpenHttp}>
            HTTP
          </button>
          .
        </p>
      )}
    </div>
  );
}
