# ccglass: guide for coding agents

`CLAUDE.md` is a symlink to this file. Edit `AGENTS.md`.

## What this project is

ccglass shows exactly what a coding agent sends to the model. It is a local
logging proxy plus a web dashboard: the agent's API calls pass through the
proxy, every request and response is saved to disk, and the dashboard lets a
person read them (system prompt, tool schemas, messages, tokens, latency,
errors, turn-to-turn changes).

This repository is a fork of `jianshuo/ccglass` (remote `upstream`), kept at
`valentinvieriu/ccglass` (remote `origin`). The fork adds separately recorded
sessions, a React dashboard, container-friendly proxy settings and CORS
support. It is vendored into a project called `debug-proxy`. The fork does not
calculate or display billing.

When judging a change, ask whether it helps someone see the true context more
clearly. That is the product.

## Layout

| Path                                | What lives there                                                                                                                              |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `bin/ccglass.js`                    | CLI entry; calls `src/cli.js`                                                                                                                 |
| `src/cli.js`                        | Commands (`claude`, `codex`, `proxy`, `run`, `view`, `usage`, `export`, `rm`, …) and option parsing                                           |
| `src/providers.js`                  | Per-client settings: env var, upstream, wire format                                                                                           |
| `src/proxy.js`                      | Reverse proxy. Forwards the body byte-for-byte; rewrites `host`, strips `accept-encoding`                                                     |
| `src/forward-proxy.js`, `src/ca.js` | CONNECT + TLS interception, used only for CodeBuddy                                                                                           |
| `src/store.js`, `src/blobs.js`      | Content-addressed capture storage (see [Storage format](README.md#storage-format))                                                            |
| `src/formats/`                      | Adapters that turn Anthropic and OpenAI payloads into one view model                                                                          |
| `src/server.js`                     | Dashboard server: static files from `web/`, REST under `/api`, live updates over SSE                                                          |
| `src/mcp.js`                        | Self-inspection MCP tools injected into Claude Code                                                                                           |
| `ui/`                               | Dashboard source: React 19, TypeScript, Tailwind 4                                                                                            |
| `ui/src/components/`                | One component per view (`SessionsView`, `TimelineView`, `RequestDetail`, `FlowView`, `MessagesView`, `ToolsView`, `DiffView`, `UsageView`, …) |
| `ui/src/lib/`                       | Pure helpers: formatting, timeline and replay models, filters                                                                                 |
| `ui/src/useDashboard.ts`            | The single REST and SSE hook                                                                                                                  |
| `ui/src/styles.css`                 | All styling and the design tokens (OKLCH, light and dark)                                                                                     |
| `test/`                             | Backend tests (`node:test`)                                                                                                                   |
| `ui/tests/`                         | Frontend tests (Vitest, Testing Library, jsdom)                                                                                               |
| `web/`                              | Build output. Generated and git-ignored; never edit or commit it                                                                              |
| `.ccglass/`                         | Local captures from `vp run dev`. Git-ignored                                                                                                 |

## Commands

Tooling is [Vite+](https://viteplus.dev) (`vp`), pinned as the `vite-plus` dev
dependency. It provides Vite, Vitest, Oxlint and Oxfmt, all configured in
`vite.config.ts`; there is no separate `vitest.config.ts`. `vp run <script>`
runs a `package.json` script, while `vp test`, `vp check` and so on are the
built-in commands.

```sh
vp install              # install (also installs the pre-commit hook)
vp run dev              # backend (watch) + Vite dashboard with hot reload
vp run dev:server       # backend only
vp run dev:ui           # Vite only, against a backend that is already running
vp run build            # typecheck, then build ui/ into web/
vp run typecheck        # tsc --noEmit
vp check                # format check, lint and type check together
vp check --fix          # apply formatting and lint fixes
vp run test             # backend tests, then frontend tests
vp run test:server      # node --test test/*.test.js test/*.test.mjs
vp test                 # frontend tests (Vitest); `vp test watch` to watch
```

One test file: `node --test test/store.test.js` or
`vp test ui/tests/app.test.tsx`.

The pre-commit hook (`.vite-hooks/pre-commit`) runs `vp staged`, which applies
`vp check --fix` to staged files. Set `VP_GIT_HOOKS=0` to skip it for one
commit.

`vp run dev` listens on:

| Port | Service                                                                  |
| ---- | ------------------------------------------------------------------------ |
| 5173 | Vite dashboard (hot reload); proxies `/api` to 6657                      |
| 6657 | Dashboard server, serving the built `web/`                               |
| 6656 | Capture proxy; clients use `http://127.0.0.1:6656/openai/v1`             |
| 6655 | Expected upstream API (override with `CCGLASS_UPSTREAM` or `--upstream`) |

Run `vp run build` once before `vp run dev` so port 6657 has something to
serve.

## Rules that are easy to break

- **ccglass requires the current Node LTS (26), and `src/` has no runtime
  dependencies.** The core proxy and dashboard server use only Node built-ins.
  `@modelcontextprotocol/sdk` and `zod` are for `src/mcp.js` only. When a new
  LTS line starts, raise `engines` in `package.json` and the CI Node version
  together.
- **The dashboard works offline.** No CDN, remote fonts or network requests at
  runtime. Assets are bundled into `web/`.
- **Local only.** The dashboard server rejects non-loopback `Host` headers and
  checks the origin on mutating requests. Keep both.
- **Do not alter forwarded traffic.** The proxy records; it does not rewrite
  request or response bodies.
- **Secrets.** `authorization` and `x-api-key` are replaced with `[REDACTED]`
  in captures unless `--no-redact` is passed. Captures still contain full
  prompts and responses. Never commit `.ccglass/`, and check screenshots of the
  dashboard before committing them.
- **No billing.** Report tokens and cache rates, not prices.
- **Both wire formats.** Anything that reads a payload goes through
  `src/formats/` so Anthropic and OpenAI captures behave the same.

## Dashboard conventions

- Desktop app. Design and test for desktop windows (1440×900 down to about
  1280×720). Phone layouts are out of scope.
- No router library and no global state library. State lives in `App.tsx` and
  `useDashboard.ts`; views receive props.
- The place in the app (session, request, tab) is the URL hash, parsed and
  written by `ui/src/lib/route.ts`. Navigate with `navigate(route)` or a
  `routeLink`; do not keep the selected session or request in component state.
  In-page `href="#…"` anchors would overwrite the route.
- Put logic in `ui/src/lib/` as pure functions with tests, and keep components
  thin.
- Use the tokens in `ui/src/styles.css` instead of literal values, and define
  each colour for both themes. `ui/tests/palette.test.ts` checks contrast and
  fails on a literal font size, weight or radius, so run it after style changes.
  - Type: `--text-caption`, `-meta`, `-body`, `-prose`, `-title`, `-page`;
    weights `--font-weight-regular`, `-medium`, `-strong`.
  - Shape: `--radius-tag` (4), `-control` (6), `-card` (10), `-shell` (16),
    `-pill`, and `-mark` (2) for marks smaller than a tag.
  - Hue has a job: accent for selection, links, the primary action and the
    user; `--color-tool` for tool calls; danger for failures; warning for
    pending and cancelled; success only where success is news. The assistant
    is ink, the harness and system prompt an outline. Do not add a hue for
    decoration.
  - Surfaces are opaque: `--color-surface`, `-surface-subtle`, `-surface-muted`.
- The typeface is bundled from `ui/src/fonts/` (keep its licence beside it).
- Icons come from `lucide-react`.
- Oxfmt formats the code (two-space indent, double quotes, semicolons,
  100 columns; the `fmt` block in `vite.config.ts`). Oxlint lints it with
  type-aware rules. Run `vp check --fix` rather than formatting by hand.

## Working against a running dashboard

The dev dashboard at `http://127.0.0.1:5173` shows real captures. **Start
session**, **Stop session**, **Reset session** and **Delete** change or remove
them. Do not click these when checking a UI change unless asked; switching
sessions, opening requests, filtering and exporting are safe.

Playwright is not a project dependency. To drive the UI from a script, install
`playwright-core` in a scratch directory and launch the system Chrome.

## Before finishing a change

1. `vp check` (format, lint and types) and `vp run typecheck`
2. The tests for the side you touched (`vp test` or `vp run test:server`);
   `vp run test` before a commit that touches both.
3. For UI changes, look at the result in the browser in light and dark themes.
4. Update `README.md` if behaviour that it describes changed, and
   `CHANGELOG.md` under "Unreleased" for user-visible changes.

## Git

- Commit directly on `main` and push to `origin main`; do not create feature branches.
  Commit or push only when asked.
- Recent commit subjects are plain sentences that state the user-visible
  outcome, for example "Rebuild the Messages and Tools tabs around what they
  are read for". Follow that style.
- `upstream` is the original project. Do not open pull requests there unless
  asked.
