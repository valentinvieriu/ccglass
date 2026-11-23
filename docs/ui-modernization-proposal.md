# Proposal: a maintainable local dashboard

## Recommendation

Use **Vite + React + TypeScript**, with **Tailwind CSS generated locally**.
Keep the existing Node dashboard server, REST API, SSE transport, proxy, and
storage. Introduce a frontend build for contributors and releases; users still
run ccglass and receive ordinary local HTML, JavaScript, and CSS.

This assumes a development/release build is acceptable. Local operation does
not require avoiding builds: the installed app can remain self-contained, with
no compiler, frontend development server, CDN, or internet access at runtime.
Dependency installation still requires a registry or an existing local cache.

## What needs improving

`web/app.js` is currently 1,555 lines and combines mutable application state,
fetch calls, SSE subscriptions, HTML strings, DOM mutation, event wiring,
formatting, and provider-specific timeline logic. Adding a feature requires
understanding how those pieces affect one another.

The live timeline also stores DOM elements in application state and manually
merges tool results into tool-call rows. Session changes use version counters
to prevent stale asynchronous results from rendering. These are useful existing
behaviors that should become explicit, testable state transitions.

The backend is already a good boundary: `src/server.js` exposes request details,
sessions, statistics, diffs, exports, and live events independently of the UI.
The existing CSS variables and light/dark/system theme are also reusable.

## Stack and responsibilities

| Choice | Purpose here |
| --- | --- |
| Vite | ES modules, a fast local development server, hot updates, and static production assets. |
| React | Components for the toolbar, request list, detail tabs, timeline, and summaries; declarative rendering and event handling. |
| TypeScript | Explicit types for API responses, SSE events, selection state, and timeline steps. Type checking runs separately from Vite's build. |
| Tailwind CSS | Consistent layout, spacing, and control styling, compiled into a local CSS file. |
| Vitest + React Testing Library | Pure transformation tests and component behavior tests that replace frontend tests coupled to script globals. |
| Playwright | A small set of real-browser checks for live capture and session management. |

Use React's local state and a reducer/context for shared dashboard state
initially. Add a query/cache library only if maintaining server state becomes a
material problem. This app does not currently need routing, server rendering,
a meta-framework, or a large component kit.

## Source organization

```text
ui/                          # editable frontend source
  index.html
  src/
    main.tsx
    App.tsx
    api/                     # REST client, response types, SSE connection
    state/                   # reducer, selectors, dashboard hooks
    features/
      sessions/
      requests/
      timeline/              # components and pure timeline transformations
      diff/
      summary/
    components/              # shared buttons, tabs, badges, empty states
    lib/                     # formatting, cURL generation, shared helpers
    styles/                  # theme tokens, Tailwind entry, specialist CSS
  tests/
web/                         # generated assets served by src/server.js
src/                         # existing Node backend
```

Keep one package manifest and lockfile for now. Frontend build and test tools
are development dependencies; bundled browser libraries ship inside `web/`.
After migration, generated `web/` should be ignored by Git and built from source
for packaging and Docker. During migration it remains the existing dashboard
until its replacement is ready; do not overwrite or ignore it prematurely.

## State and live updates

- Separate server data (sessions, request summaries, full records, statistics)
  from UI state (selection, filters, active tab, expanded rows, auto-scroll).
- Represent tool calls/results as data keyed by stable identifiers. Derive
  timeline rows from that data instead of storing DOM nodes in state. Preserve
  existing deduplication and Codex-specific request visibility rules.
- Use one SSE subscription with explicit cleanup. Upsert summaries by request
  ID and refresh affected records; a completed request must replace its pending
  version rather than create another row.
- Handle the race between loading an initial snapshot and receiving live events.
  Session changes and resets must invalidate pending loads; use cancellation
  and generation checks where cancellation alone is insufficient.
- Preserve expansion and scroll position through stable component keys. Use
  DOM refs for scrolling and measurement, not as the application's data model.

A framework will not automatically solve these races or timeline semantics.
Extracting them into small functions and state transitions is the essential
part of this change.

## Styling

Preserve the current appearance first. Keep the existing semantic CSS variables
for colors and theme selection, and connect Tailwind utilities to those tokens.
Use utilities for ordinary layout and controls; keep scoped CSS for timeline
connectors, animations, and other specialized rendering. Review Tailwind's base
reset against existing controls before enabling it throughout the dashboard.

Tailwind's build generates the required CSS locally. Do not use the browser/CDN
compiler. Use complete class names or explicit variant maps so the generator
can discover status-dependent styles. Small shared components should own
repeated styling rather than repeating long class lists across every view.
Keep an early theme initialization script to avoid a flash of the wrong theme.

## Development and distribution

Proposed commands, available through the existing `vp run` workflow or npm:

| Command | Behavior |
| --- | --- |
| `dev` | Start the existing proxy/dashboard backend and Vite together. |
| `dev:server` | Run the current Node watch workflow independently. |
| `dev:ui` | Run Vite on loopback at port 5173 with hot updates. |
| `build` | Generate the frontend into `web/`. |
| `typecheck` | Check frontend TypeScript without emitting files. |
| `test:ui` | Run frontend unit/component tests. |
| `test:e2e` | Run the focused browser checks. |

Vite should forward `/api/*`, including SSE, to the dashboard on port 6657.
Relative API URLs then work in both development and production. For the local
development proxy, rewrite Host and Origin to the dashboard target for forwarded
requests: changing Host alone would cause session-control POSTs to fail the
server's exact same-origin check. Bind Vite to loopback and retain the production
server's existing checks. The reverse-proxy CORS setting is separate from this
dashboard development setup.

Keep `src/server.js` serving `web/`; Vite is not a runtime dependency. Ensure
asset MIME types cover any added file types. Internal tabs can remain state,
so there is no need to introduce SPA route fallback handling.

Update npm packaging to build before packing/publishing and verify that the
tarball includes `web/index.html` and all referenced assets. The current publish
workflow needs the build and frontend checks. Update the parent Dockerfile to
use a build/test stage with development dependencies, then copy generated
assets into a runtime stage with production dependencies only. Its existing
frontend test command also needs updating when the legacy script is retired.

Pin a current Vite version and a compatible build Node version, for example
Node 22.12+ on the Node 22 line. The npm publish workflow currently uses Node 20
without a minor-version pin; Docker currently uses Node 26. The CLI's advertised
Node 18 support is a separate runtime contract and should not be changed merely
to accommodate frontend tooling.

## Migration sequence

1. **Establish the build and extract logic.** Introduce `ui/`, Vite, scripts, and
   the packaging path while preserving the current UI. Extract formatting,
   cURL generation, classification, and timeline transformations into modules.
   Adapt their existing regression tests as modules replace script globals.
2. **Introduce components and typed state.** Migrate the toolbar/session controls
   and request list, then detail tabs, diff, and summary. Give each migrated
   subtree one rendering owner; legacy DOM mutation must not also control it.
   Keep styles and behavior recognizable during this step.
3. **Migrate the timeline.** Preserve replay, tool-result merging, deduplication,
   model filtering, pending/completed transitions, expanded rows, and auto-scroll.
   Validate rapid session changes, resets, and live events during initial loads.
4. **Apply Tailwind incrementally and finish packaging.** Consolidate shared
   controls and layout styles, retire legacy rendering, and verify the packaged
   CLI and Docker image serve the built UI locally without external assets.

Keep the backend Node test suite. Replace the fake-DOM/VM frontend tests with
tests of exported logic and rendered behavior as the relevant code moves.
Browser acceptance checks should cover live pending-to-complete updates,
session switching/reset/delete, read-only controls, tool-result merging, and
export downloads. Include theme persistence and preserved expansion/scroll
behavior in the UI acceptance review.

The first milestone should be the build plus modular extraction, preserving
the dashboard. A visual redesign and performance features such as list
virtualization can be separate work, justified by actual usage.

## If absolutely no compilation is allowed

Use native ES modules, JSDoc types checked during development, and locally
vendored Lit components instead. This improves boundaries and rendering without
bundling, but leaves dependency distribution and cache/version handling more
manual. Tailwind still requires generating CSS to avoid its runtime compiler;
if even a CSS build is excluded, keep the existing CSS.

For this project, the modest build step is a better trade: it simplifies
maintenance while preserving the local, static-file runtime.
