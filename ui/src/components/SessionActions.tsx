import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Eraser, MoreHorizontal, Trash2 } from "lucide-react";
import { plural } from "../lib/format";

/** An in-app confirmation for something that cannot be undone. Cancel is the default. */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const id = useId();
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => cancel.current?.focus(), []);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onCancel();
    } else if (event.key === "Tab") {
      // Two controls: keep the focus between them while the dialog is open.
      const buttons = [...event.currentTarget.querySelectorAll("button")];
      const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
      event.preventDefault();
      buttons[(at + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus();
    }
  };
  return createPortal(
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-body`}
        onKeyDown={onKeyDown}
      >
        <h2 id={`${id}-title`}>{title}</h2>
        <div id={`${id}-body`} className="dialog-body">
          {children}
        </div>
        <div className="dialog-actions">
          <button type="button" ref={cancel} className="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="button button-danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

type Destructive = "reset" | "delete";

/** What a confirmation says about the session it is about to change. */
export function SessionConfirm({
  action,
  label,
  requests,
  onConfirm,
  onCancel,
}: {
  action: Destructive;
  /** How the session is named where the person clicked. */
  label: string;
  requests?: number | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const count = requests == null ? "all requests" : plural(requests, "request");
  return (
    <ConfirmDialog
      title={action === "reset" ? `Clear ${count} from this session?` : "Delete this session?"}
      confirmLabel={action === "reset" ? "Clear requests" : "Delete session"}
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      <p>
        <strong>{label}</strong>
        {action === "reset"
          ? " stays in the list, empty."
          : requests == null
            ? " and its requests are removed from disk."
            : ` and its ${count} are removed from disk.`}
      </p>
      <p>Other sessions are kept. This cannot be undone.</p>
    </ConfirmDialog>
  );
}

/**
 * The actions that destroy captured data, behind a labelled menu and a
 * confirmation that names the session, so neither can be taken for a refresh.
 */
export function SessionMenu({
  session,
  label,
  requests,
  recording,
  busy,
  triggerLabel,
  small = false,
  onReset,
  onDelete,
}: {
  session: string;
  label: string;
  requests?: number | null;
  /** The session being recorded cannot be deleted. */
  recording: boolean;
  busy?: boolean;
  triggerLabel: string;
  small?: boolean;
  onReset: (session: string) => void;
  onDelete: (session: string) => void;
}) {
  const [at, setAt] = useState<{ top?: number; bottom?: number; right: number } | null>(null);
  const [confirming, setConfirming] = useState<Destructive | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!at) return;
    menu.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const outside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!menu.current?.contains(target) && !trigger.current?.contains(target)) setAt(null);
    };
    // The menu is placed once; it closes rather than drift when its anchor moves.
    const moved = (event: Event) => {
      const target = event.target as Node;
      if (event.type === "resize" || (trigger.current && target.contains?.(trigger.current)))
        setAt(null);
    };
    document.addEventListener("mousedown", outside);
    window.addEventListener("resize", moved);
    window.addEventListener("scroll", moved, true);
    return () => {
      document.removeEventListener("mousedown", outside);
      window.removeEventListener("resize", moved);
      window.removeEventListener("scroll", moved, true);
    };
  }, [at]);

  const toggle = () => {
    if (at) return setAt(null);
    const rect = trigger.current!.getBoundingClientRect();
    const right = Math.max(8, window.innerWidth - rect.right);
    // Open upward when the row sits at the bottom of the window.
    setAt(
      window.innerHeight - rect.bottom < 130
        ? { bottom: window.innerHeight - rect.top + 4, right }
        : { top: rect.bottom + 4, right },
    );
  };
  const close = () => {
    setAt(null);
    trigger.current?.focus();
  };
  const ask = (action: Destructive) => {
    setAt(null);
    setConfirming(action);
  };
  const settle = (confirmed: boolean) => {
    const action = confirming;
    setConfirming(null);
    trigger.current?.focus();
    if (confirmed && action) (action === "reset" ? onReset : onDelete)(session);
  };
  const onMenuKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      return close();
    }
    const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    if (!step && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const items = [
      ...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
    ];
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : (current + step + items.length) % items.length;
    items[next]?.focus();
  };

  return (
    <>
      <button
        type="button"
        ref={trigger}
        className={`button button-ghost icon-button ${small ? "button-sm" : ""}`}
        aria-haspopup="menu"
        aria-expanded={!!at}
        aria-label={triggerLabel}
        title="Clear or delete this session"
        disabled={busy}
        onClick={toggle}
      >
        <MoreHorizontal size={small ? 14 : 15} />
      </button>
      {at &&
        createPortal(
          <div
            ref={menu}
            className="menu"
            role="menu"
            aria-label={triggerLabel}
            style={at}
            onKeyDown={onMenuKey}
          >
            <button
              type="button"
              role="menuitem"
              className="menu-item"
              onClick={() => ask("reset")}
            >
              <Eraser size={14} aria-hidden="true" />
              <span>
                Clear requests…
                <small>Empties the session and keeps it</small>
              </span>
            </button>
            <button
              type="button"
              role="menuitem"
              className="menu-item menu-item-danger"
              disabled={recording}
              onClick={() => ask("delete")}
            >
              <Trash2 size={14} aria-hidden="true" />
              <span>
                Delete session…
                <small>
                  {recording ? "Stop recording before deleting it" : "Removes it from disk"}
                </small>
              </span>
            </button>
          </div>,
          document.body,
        )}
      {confirming && (
        <SessionConfirm
          action={confirming}
          label={label}
          requests={requests}
          onConfirm={() => settle(true)}
          onCancel={() => settle(false)}
        />
      )}
    </>
  );
}
