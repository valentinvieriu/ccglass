import { formatRoute, routeLink, type Navigate, type Route } from "../lib/route";

/**
 * The views of one level of the hierarchy (a session's Replay and Usage, say).
 * They are links: each view has an address, and a tab says which one is open.
 */
export function ViewTabs({
  label,
  tabs,
  current,
  navigate,
}: {
  label: string;
  tabs: [Route, string][];
  current: Route;
  navigate: Navigate;
}) {
  const here = formatRoute(current);
  return (
    <nav className="view-tabs" aria-label={label}>
      {tabs.map(([route, name]) => {
        const link = routeLink(route, navigate);
        return (
          <a
            key={name}
            className="view-tab"
            aria-current={link.href === here ? "page" : undefined}
            href={link.href}
            onClick={(event) => {
              // Another view of the same thing is not a new place to go back to.
              if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
              event.preventDefault();
              navigate(route, { replace: true });
            }}
          >
            {name}
          </a>
        );
      })}
    </nav>
  );
}
