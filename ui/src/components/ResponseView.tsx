import { useId, useMemo } from "react";
import { FileText } from "lucide-react";
import type { RequestRecord } from "../types";
import { buildReply } from "../lib/messages";
import { recordCancelled, recordError, recordFailed, responseSentence } from "../lib/request";
import { ContentBlock } from "./JsonView";
import { MessageEntry, type Reading } from "./MessagesView";

export const responseError = recordError;

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

  // The client hanging up is told apart from the API failing.
  const cancelled = recordCancelled(record);
  const failed = recordFailed(record);
  const awaiting = reply?.parts.filter((part) => part.item.kind === "tool").length ?? 0;
  const raw = record.response?.raw ?? response ?? record.response;
  const sentence = responseSentence(record);
  // A stream that failed or carried no reply is not worth calling one.
  const streamed = !!response?.streamed && !failed && !cancelled && !!reply;
  return (
    <div className="resp-view">
      {(response?.stop_reason || streamed || sentence) && (
        <div className="insp-summary">
          <span className="resp-facts">
            {response?.stop_reason && (
              <span>
                Stopped: <strong>{response.stop_reason}</strong>
              </span>
            )}
            {streamed && <span>streamed</span>}
          </span>
          {sentence && (
            <span className={failed ? "resp-failed" : cancelled ? "resp-cancelled" : undefined}>
              {sentence}
            </span>
          )}
        </div>
      )}

      {cancelled && !reply && (
        <p className="resp-note">
          No part of the response was saved: the proxy keeps a response once it has finished.
        </p>
      )}
      {error != null && !cancelled && (
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
        raw != null &&
        !cancelled && (
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
