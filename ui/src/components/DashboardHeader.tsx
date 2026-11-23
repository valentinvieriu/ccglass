import {
  Download,
  Square,
  Play,
  RotateCcw,
  Radio,
  Maximize2,
  Minimize2,
} from "lucide-react";
import type { CaptureAction } from "../types";
import { sessionLabel } from "../lib/format";

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
  status?: { label: string; live: boolean };
  focus?: { active: boolean; onToggle: () => void };
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
  status,
  focus,
}: Props) {
  return (
    <header className="topbar">
      <div className="topbar-title">
        <h1>{title}</h1>
        {status && (
          <span
            className={`badge ${status.live ? "badge-success" : "badge-muted"}`}
            role="status"
          >
            {status.live ? (
              <span className="status-dot" />
            ) : (
              <Radio size={10} />
            )}
            {status.label}
          </span>
        )}
      </div>
      <div className="topbar-actions">
        <select
          className="session-select"
          title={session || undefined}
          aria-label="Captured session"
          value={session || ""}
          onChange={(event) => onSelect(event.target.value)}
          disabled={!sessions.length || busy}
        >
          {!sessions.length && <option value="">No sessions yet</option>}
          {sessions.map((id) => (
            <option key={id} value={id}>
              {sessionLabel(id)}
              {id === live ? " · recording" : " · saved"}
            </option>
          ))}
        </select>
        {focus && (
          <button
            className="button button-ghost"
            aria-pressed={focus.active}
            onClick={focus.onToggle}
            title="Hide the sidebar panels and metrics to give the payload more room"
          >
            {focus.active ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
            {focus.active ? "Show panels" : "Focus payload"}
          </button>
        )}
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
                if (
                  window.confirm(
                    "Clear all requests in this session? This cannot be undone.",
                  )
                )
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
