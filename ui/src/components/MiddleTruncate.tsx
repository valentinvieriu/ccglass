/**
 * A name that is cut in the middle when it does not fit, so both ends stay:
 * `nemotron-3.5-lig…:30b-mlx`, `list_canva…bilities`. The full value is the
 * tooltip, and what a screen reader and a copy get.
 */
export function MiddleTruncate({
  text,
  tail = 8,
  className = "",
}: {
  text: string;
  /** How many characters of the end are always shown. */
  tail?: number;
  className?: string;
}) {
  // Too short to be worth splitting: it either fits or loses a letter or two.
  if (text.length <= tail * 2 + 4)
    return (
      <span className={className || undefined} title={text}>
        {text}
      </span>
    );
  return (
    <span className={`mid ${className}`} title={text}>
      <span className="mid-head">{text.slice(0, -tail)}</span>
      <span className="mid-tail">{text.slice(-tail)}</span>
    </span>
  );
}
