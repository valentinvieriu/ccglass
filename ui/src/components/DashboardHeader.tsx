import { Fragment, useEffect, useState } from "react";
import {
  ChevronRight,
  Circle,
  Download,
  PanelLeftClose,
  PanelLeftOpen,
  Square,
  Terminal,
} from "lucide-react";
import type { CaptureAction } from "../types";
import { fmtElapsed, sessionStart } from "../lib/format";
import { HOME, routeLink, type Navigate, type Route } from "../lib/route";
import type { ThemePreference } from "../lib/theme";
import { MiddleTruncate } from "./MiddleTruncate";
import { SessionMenu } from "./SessionActions";
import { ShortcutHelp } from "./ShortcutHelp";
import { ThemeToggle } from "./ThemeToggle";

export type Connection = "connecting" | "connected" | "reconnecting";

/** One step of the path from every session down to what is on screen. */
export interface Crumb {
  label: string;
  /** What tells this one apart from its siblings, said more quietly. */
  detail?: string;
  /** The detail is a name, such as a model, whose end matters as much as its start. */
  name?: boolean;
  /** Where the step leads. The last step is where you are, and leads nowhere. */
  route?: Route;
  title?: string;
  recording?: boolean;
}

interface Props {
  /** Names the page for assistive tech; the path says it visually. */
  title: string;
  crumbs: Crumb[];
  navigate: Navigate;
  connection: Connection;
  theme: { preference: ThemePreference; choose: (value: ThemePreference) => void };
  help: { open: boolean; onToggle: (open: boolean) => void };
  /** The session being read, with what can be done to it. None on the list of sessions. */
  session?: { id: string; label: string; requests: number };
  live: string | null;
  controllable: boolean;
  busy: boolean;
  onCapture: (action: CaptureAction) => void;
  onExport: () => void;
  /** The request list beside a request, which can be put away. */
  focus?: { active: boolean; onToggle: () => void };
}

function useNow(ticking: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [ticking]);
  return now;
}

/**
 * Whether the proxy is saving what passes through it. This is about the
 * capture as a whole, not the session being read, so it stands apart from the
 * session's own actions. While stopped the proxy still forwards traffic and
 * keeps none of it, which is the state most worth noticing.
 */
function RecordingControl({
  live,
  busy,
  onCapture,
}: {
  live: string | null;
  busy: boolean;
  onCapture: (action: CaptureAction) => void;
}) {
  const started = live ? sessionStart(live) : null;
  const now = useNow(started != null);
  return (
    <div
      className={`recording ${live ? "recording-on" : "recording-off"}`}
      role="group"
      aria-label="Recording"
    >
      <span
        className="recording-state"
        role="status"
        title={
          live
            ? "Requests passing through the proxy are being saved"
            : "Recording is stopped. The proxy still forwards requests, but none of them are saved."
        }
      >
        <i className="recording-dot" aria-hidden="true" />
        {/* Stopped is named by its consequence: it is the state that loses data. */}
        {live ? "Recording" : "Not saving requests"}
      </span>
      {started != null && (
        <time className="recording-time mono" aria-label="Recording for">
          {fmtElapsed(now - started)}
        </time>
      )}
      <button
        type="button"
        className={live ? "button button-stop" : "button button-primary"}
        disabled={busy}
        aria-label={live ? "Stop recording" : "Start recording"}
        title={
          live
            ? "Stop saving requests. The proxy keeps forwarding them."
            : "Start saving requests into a new session"
        }
        onClick={() => onCapture(live ? "stop" : "start")}
      >
        {live ? <Square size={11} /> : <Circle size={11} />}
        {live ? "Stop" : "Record"}
      </button>
    </div>
  );
}

const CONNECTION: Record<Connection, string> = {
  connected: "Connected to the proxy",
  connecting: "Connecting…",
  reconnecting: "Reconnecting…",
};

/**
 * The one bar above the content: where you are, what can be done to the
 * session being read, and whether anything is being recorded.
 */
export function DashboardHeader({
  title,
  crumbs,
  navigate,
  connection,
  theme,
  help,
  session,
  live,
  controllable,
  busy,
  onCapture,
  onExport,
  focus,
}: Props) {
  const connected = connection === "connected";
  return (
    <header className="topbar">
      <div className="topbar-brand">
        <a
          className="brand-link"
          {...routeLink(HOME, navigate)}
          aria-label="ccglass, all sessions"
          title="All sessions"
        >
          <span className="brand-icon" aria-hidden="true">
            <Terminal size={16} />
          </span>
          <span className="brand-name">ccglass</span>
        </a>
        <span
          className="topbar-connection"
          role="status"
          title={`${CONNECTION[connection]}. Captures stay on this machine.`}
        >
          <i
            className={`status-dot ${connected ? "status-ok" : "status-wait"}`}
            aria-hidden="true"
          />
          <span className={connected ? "sr-only" : ""}>{CONNECTION[connection]}</span>
        </span>
      </div>
      <h1 className="sr-only">{title}</h1>
      <nav className="breadcrumb" aria-label="You are here">
        <ol>
          {crumbs.map((crumb, index) => {
            const body = (
              <>
                <span className="crumb-label">{crumb.label}</span>{" "}
                {crumb.detail &&
                  (crumb.name ? (
                    <MiddleTruncate className="crumb-detail" text={crumb.detail} />
                  ) : (
                    <span className="crumb-detail">{crumb.detail}</span>
                  ))}
              </>
            );
            return (
              <Fragment key={index}>
                {index > 0 && (
                  <li className="crumb-separator" aria-hidden="true">
                    <ChevronRight size={13} />
                  </li>
                )}
                <li className="crumb">
                  {crumb.route ? (
                    <a
                      className="crumb-link"
                      title={crumb.title}
                      {...routeLink(crumb.route, navigate)}
                    >
                      {body}
                    </a>
                  ) : (
                    <span className="crumb-here" aria-current="page" title={crumb.title}>
                      {body}
                    </span>
                  )}
                  {crumb.recording && <span className="badge badge-recording">Recording</span>}
                </li>
              </Fragment>
            );
          })}
        </ol>
      </nav>
      <div className="topbar-actions">
        {!controllable && connected && (
          <span
            className="badge badge-muted"
            title="This dashboard reads saved captures. Recording controls are unavailable."
          >
            Read-only
          </span>
        )}
        {focus && (
          <button
            type="button"
            className="button button-ghost icon-button"
            aria-pressed={focus.active}
            aria-label={focus.active ? "Show request list" : "Hide request list"}
            title={
              focus.active
                ? "Show the request list"
                : "Hide the request list to give the content the whole width"
            }
            onClick={focus.onToggle}
          >
            {focus.active ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
          </button>
        )}
        {session && (
          <button
            className="button"
            onClick={onExport}
            aria-label="Export session"
            title="Download the entire session, including sensitive captured payloads"
          >
            <Download size={13} />
            Export session
          </button>
        )}
        {controllable && session && (
          <SessionMenu
            session={session.id}
            label={session.label}
            requests={session.requests}
            recording={session.id === live}
            busy={busy}
            triggerLabel="Session actions"
            onReset={() => onCapture("reset")}
            onDelete={() => onCapture("delete")}
          />
        )}
        <ShortcutHelp open={help.open} onToggle={help.onToggle} />
        <ThemeToggle value={theme.preference} onChange={theme.choose} />
        {controllable && <RecordingControl live={live} busy={busy} onCapture={onCapture} />}
      </div>
    </header>
  );
}
