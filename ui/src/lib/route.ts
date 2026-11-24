import { useCallback, useEffect, useMemo, useState, type MouseEvent } from "react";
import type { RequestTab } from "./request";

/**
 * Where the dashboard is, as the hierarchy people think in: all sessions, one
 * session, one request of it. The place lives in the URL hash, so a reload
 * keeps it and the browser's Back button moves inside the app.
 *
 *   #/                                  every session
 *   #/usage                             usage across every session
 *   #/s/<session>                       a session's replay
 *   #/s/<session>/usage                 a session's usage
 *   #/s/<session>/r/<seq>/<tab>         a request, on one of its tabs
 *   #/s/<session>/r/<seq>/compare/<a>   that request compared with request <a>
 */
export type Route =
  | { view: "sessions"; tab: "sessions" | "usage" }
  | { view: "session"; session: string; tab: "replay" | "usage" }
  | { view: "request"; session: string; seq: number; tab?: RequestTab }
  | { view: "compare"; session: string; seq: number; base?: number };

export const HOME: Route = { view: "sessions", tab: "sessions" };
const REQUEST_TABS: RequestTab[] = ["overview", "system", "messages", "tools", "response", "http"];

const seqOf = (text: string | undefined) => {
  const seq = Number(text);
  return text && /^\d+$/.test(text) && seq > 0 ? seq : null;
};

export function parseRoute(hash: string): Route {
  const parts = hash
    .replace(/^#\/?/, "")
    .split("/")
    .filter(Boolean)
    .map((part) => {
      try {
        return decodeURIComponent(part);
      } catch {
        return part;
      }
    });
  if (parts[0] === "usage") return { view: "sessions", tab: "usage" };
  if (parts[0] !== "s" || !parts[1]) return HOME;
  const session = parts[1];
  if (parts[2] === "usage") return { view: "session", session, tab: "usage" };
  const seq = parts[2] === "r" ? seqOf(parts[3]) : null;
  if (seq == null) return { view: "session", session, tab: "replay" };
  if (parts[4] === "compare")
    return { view: "compare", session, seq, base: seqOf(parts[5]) ?? undefined };
  const tab = REQUEST_TABS.find((name) => name === parts[4]);
  return { view: "request", session, seq, tab };
}

export function formatRoute(route: Route): string {
  if (route.view === "sessions") return route.tab === "usage" ? "#/usage" : "#/";
  const session = `#/s/${encodeURIComponent(route.session)}`;
  if (route.view === "session") return route.tab === "usage" ? `${session}/usage` : session;
  const request = `${session}/r/${route.seq}`;
  if (route.view === "compare")
    return `${request}/compare${route.base != null ? `/${route.base}` : ""}`;
  return route.tab ? `${request}/${route.tab}` : request;
}

/** The session a route is inside, if any. */
export const routeSession = (route: Route) => (route.view === "sessions" ? null : route.session);

/** One level up: what Escape and "back" mean at each place. */
export function parentRoute(route: Route): Route | null {
  if (route.view === "compare")
    return { view: "request", session: route.session, seq: route.seq };
  if (route.view === "request") return { view: "session", session: route.session, tab: "replay" };
  if (route.view === "session") return HOME;
  return null;
}

export type Navigate = (route: Route, options?: { replace?: boolean }) => void;

/**
 * The current route and a way to change it. Moving to another place adds a
 * history entry; `replace` is for showing the same place differently (a tab)
 * and for correcting an address that no longer exists.
 */
export function useRoute(): [Route, Navigate] {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const sync = () => setHash(window.location.hash);
    window.addEventListener("popstate", sync);
    window.addEventListener("hashchange", sync);
    return () => {
      window.removeEventListener("popstate", sync);
      window.removeEventListener("hashchange", sync);
    };
  }, []);
  const route = useMemo(() => parseRoute(hash), [hash]);
  const navigate = useCallback<Navigate>((next, options) => {
    const target = formatRoute(next);
    if (target === window.location.hash) return;
    window.history[options?.replace ? "replaceState" : "pushState"](null, "", target);
    setHash(target);
  }, []);
  return [route, navigate];
}

/**
 * Props for a link to a route. It is a real link, so it can be opened in a new
 * tab or copied; a plain click stays in the page.
 */
export function routeLink(route: Route, navigate: Navigate) {
  return {
    href: formatRoute(route),
    onClick: (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      navigate(route);
    },
  };
}
