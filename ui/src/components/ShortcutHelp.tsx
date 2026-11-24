import { useEffect, useRef } from "react";
import { Keyboard } from "lucide-react";

const KEYS: [string[], string][] = [
  [["↑", "↓"], "Move through a list (also j and k)"],
  [["Home", "End"], "First and last row"],
  [["Enter"], "Open the request of the selected row"],
  [["Esc"], "Back: from a request to the replay, from Compare to the request"],
  [["[", "]"], "Previous and next request"],
  [["/"], "Search or filter the current view"],
  [["e"], "Next error in the replay or a request"],
  [["?"], "Show or hide this help"],
];

const MARKS: [string, string][] = [
  ["replay-key-prompt", "A prompt starts here"],
  ["replay-key-request", "Model request, taller is slower"],
  ["replay-key-setup", "Setup request"],
  ["replay-key-error", "Failed"],
  ["replay-key-cancelled", "Cancelled by the client"],
];

/**
 * Everything the screen no longer spells out inline: the keys that work in
 * every list, and how to read the request strip.
 */
export function ShortcutHelp({ open, onToggle }: { open: boolean; onToggle: (open: boolean) => void }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) onToggle(false);
    };
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, [open, onToggle]);
  return (
    <div className="help" ref={root}>
      <button
        type="button"
        className="button button-ghost icon-button"
        aria-label="Keyboard shortcuts"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Keyboard shortcuts (?)"
        onClick={() => onToggle(!open)}
      >
        <Keyboard size={15} />
      </button>
      {open && (
        <div className="help-popover" role="dialog" aria-label="Keyboard shortcuts">
          <h2>Keyboard</h2>
          <dl className="help-keys">
            {KEYS.map(([keys, what]) => (
              <div key={what}>
                <dt>
                  {keys.map((key) => (
                    <kbd key={key}>{key}</kbd>
                  ))}
                </dt>
                <dd>{what}</dd>
              </div>
            ))}
          </dl>
          <h2>Request strip</h2>
          <ul className="help-marks" aria-label="How to read the request strip">
            {MARKS.map(([mark, what]) => (
              <li key={mark}>
                <i className={mark} />
                {what}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
