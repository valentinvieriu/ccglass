import { Download, Square, Play, RotateCcw } from "lucide-react";
import type { CaptureAction } from "../types";

interface Props {
  title: string;
  sessions: string[];
  session: string | null;
  live: string | null;
  controllable: boolean;
  busy: boolean;
  onSelect: (session: string) => void;
  onCapture: (action: CaptureAction) => void;
  onExport: () => void;
}

export function DashboardHeader({
  title,
  sessions,
  session,
  live,
  controllable,
  busy,
  onSelect,
  onCapture,
  onExport,
}: Props) {
  return (
    <header className="topbar">
      <div className="topbar-title">
        <h1>{title}</h1>
      </div>
      <div className="topbar-actions">
        <select
          className="session-select"
          aria-label="Captured session"
          value={session || ""}
          onChange={(event) => onSelect(event.target.value)}
          disabled={!sessions.length || busy}
        >
          {!sessions.length && <option value="">No sessions yet</option>}
          {sessions.map((id) => (
            <option key={id} value={id}>
              {id}
              {id === live ? " · recording" : " · saved"}
            </option>
          ))}
        </select>
        <button
          className="button"
          disabled={!session}
          onClick={onExport}
          title="Download the entire session, including sensitive captured payloads"
        >
          <Download size={13} />
          Export session
        </button>
        {controllable && (
          <>
            <button
              className="button icon-button"
              disabled={busy || !session}
              aria-label="Reset session"
              title="Clear only the selected session"
              onClick={() => {
                if (window.confirm("Clear all requests in this session? This cannot be undone."))
                  onCapture("reset");
              }}
            >
              <RotateCcw size={13} />
            </button>
            <button
              className={live ? "button" : "button button-primary"}
              disabled={busy}
              onClick={() => onCapture(live ? "stop" : "start")}
            >
              {live ? <Square size={11} /> : <Play size={12} />}
              {live ? "Stop session" : "Start session"}
            </button>
          </>
        )}
      </div>
    </header>
  );
}
