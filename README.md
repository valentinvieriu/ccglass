# ccglass

**See exactly what your coding agent sends to the model.**

A coding agent puts far more in front of the model than what you type: a long
system prompt, dozens of tool definitions, reminders injected by the harness,
and the whole conversation so far, sent again on every turn. The agent's own
interface shows almost none of it.

ccglass sits between the agent and the model API, records every request and
response, and shows them in a local dashboard. It works with **Claude Code,
Codex, OpenCode, DeepSeek-TUI, Reasonix, CodeBuddy, Kimi, Ollama, OpenRouter,
and more**.

## What it is for

ccglass answers questions you cannot answer from the agent's own output:

| Question                                  | What ccglass shows                                                                                                                              |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| What is actually in the context?          | The full system prompt, every tool schema, messages injected by the harness, and the message history of any request                             |
| What did this turn add?                   | Each request separates earlier turns from what is new; Compare diffs any two requests                                                           |
| Where do the tokens go?                   | A per-request breakdown (system prompt, tool definitions, earlier turns, new content), the cache-hit rate, and totals per session and per model |
| Why was it slow, or why did it fail?      | Latency, time to first token, HTTP status and the raw response for every call                                                                   |
| What did the agent do, and in what order? | Session replay: prompts, tool calls with their results, and replies on one timeline                                                             |
| Which tools does the model really use?    | Tools offered against tools called, with the size of each definition                                                                            |
| How do I keep or share the evidence?      | A separate recording per session; export as HTTP transcript, Markdown, JSON or HAR; copy any request as cURL                                    |

That makes it useful when you are writing or tuning prompts and tools,
debugging an agent that misbehaves, comparing models or providers on the same
task, or checking what a third-party agent sends on your behalf.

## How it works

ccglass starts a proxy on localhost, points the client at it through the
client's base-URL environment variable, and forwards each request to the real
API. (CodeBuddy cannot be redirected that way and uses a forward proxy
instead: see [CodeBuddy](#codebuddy).)

These CLIs are Node/native apps that **ignore `HTTP_PROXY`/`HTTPS_PROXY`** — so
Charles/mitmproxy never see the traffic, and `fetch`-patching tools break across
updates. `ccglass` sidesteps all of it: the client does the HTTPS to the real API
itself; you only intercept the plain HTTP hop to localhost. No CA certs, no TLS
pinning.

Three things hold throughout:

- **Local only.** Captures are written to your disk, and the dashboard rejects
  requests that do not address it as localhost. Nothing leaves the machine
  except the request the agent was already making.
- **Traffic is recorded, not rewritten.** Request and response bodies are
  forwarded as they are. The reverse proxy changes two request headers: `host`,
  and `accept-encoding` (removed so the saved response is readable). It adds
  CORS response headers only if you set `CCGLASS_CORS_ORIGINS`. One caveat:
  when wrapping Claude Code, ccglass registers its own inspection tools, which
  then appear in the tool list. Pass `--no-mcp` for an unmodified context.
- **Secrets are masked by default.** `authorization` and `x-api-key` are
  redacted in saved captures. Prompts and responses are stored in full, so
  treat the capture directory as sensitive.

## Quick start

```bash
npm install -g ccglass     # or: brew install jianshuo/tap/ccglass
ccglass
```

The published packages are the upstream release
([jianshuo/ccglass](https://github.com/jianshuo/ccglass)). To use what this
fork adds, run it from a checkout: see [What this fork changes](#what-this-fork-changes)
and [Development](#development).

Run with no arguments and `ccglass` asks which client to inspect:

```
  Which client do you want to inspect?

    1) Claude Code
    2) Codex (OpenAI)
    3) DeepSeek-TUI
    4) Reasonix
    5) Kimi (Moonshot, via Claude Code)
    6) OpenCode
    7) CodeBuddy (Tencent)

  >
```

Or name it directly: `ccglass claude`, `ccglass codex`, `ccglass deepseek`,
`ccglass deepseek-tui`, `ccglass reasonix`, `ccglass dsnix`, or `ccglass kimi`.

`ccglass` starts a proxy, points the client at it via the right base-URL env var,
launches it for you, and opens a dashboard where you watch every request in real
time — the full system prompt, every tool schema, the message history,
token/cache numbers, and a turn-to-turn diff.

```
  ● ccglass watching Codex (OpenAI) → https://api.openai.com
    dashboard: http://127.0.0.1:57633
```

## Providers

| `ccglass <provider>` or `--provider` | Wraps                                 | Env var                      | Upstream                  | Format                  |
| ------------------------------------ | ------------------------------------- | ---------------------------- | ------------------------- | ----------------------- |
| `claude`                             | Claude Code                           | `ANTHROPIC_BASE_URL`         | api.anthropic.com         | Anthropic Messages      |
| `codex`                              | Codex                                 | `OPENAI_BASE_URL`            | api.openai.com            | OpenAI Responses / Chat |
| `deepseek`                           | DeepSeek-TUI dispatcher               | `DEEPSEEK_BASE_URL`          | api.deepseek.com          | OpenAI Chat             |
| `deepseek-tui`                       | DeepSeek-TUI runtime                  | `DEEPSEEK_BASE_URL`          | api.deepseek.com          | OpenAI Chat             |
| `reasonix`                           | Reasonix                              | `DEEPSEEK_BASE_URL`          | api.deepseek.com          | OpenAI Chat             |
| `dsnix`                              | Reasonix (`dsnix` alias)              | `DEEPSEEK_BASE_URL`          | api.deepseek.com          | OpenAI Chat             |
| `kimi`                               | Claude Code → Moonshot                | `ANTHROPIC_BASE_URL`         | api.moonshot.ai/anthropic | Anthropic Messages      |
| `opencode`                           | OpenCode                              | `OPENAI_BASE_URL`            | auto (from env)           | OpenAI Chat             |
| `qoder`                              | Qoder                                 | `OPENAI_BASE_URL`            | auto (from env)           | OpenAI Chat             |
| `ollama`                             | any Ollama-backed client              | `OPENAI_BASE_URL`            | 127.0.0.1:11434           | OpenAI Chat             |
| `lmstudio`                           | any LM Studio-backed client           | `OPENAI_BASE_URL`            | 127.0.0.1:1234            | OpenAI Chat             |
| `openrouter`                         | any OpenRouter-backed client          | `OPENAI_BASE_URL`            | openrouter.ai/api         | OpenAI Chat             |
| `glm`                                | any GLM/Zhipu-backed client           | `OPENAI_BASE_URL`            | auto (from env)           | OpenAI Chat             |
| `bedrock`                            | Claude Code → AWS Bedrock             | `ANTHROPIC_BEDROCK_BASE_URL` | auto (from env)           | Anthropic Messages      |
| `vertex`                             | Claude Code → Google Vertex AI        | `ANTHROPIC_BASE_URL`         | auto (from env)           | Anthropic Messages      |
| `codebuddy`                          | CodeBuddy (IDE / VS Code / JetBrains) | forward-proxy                | copilot.tencent.com       | OpenAI Chat             |
| `run --provider <p> -- <cmd>`        | any client                            | per provider                 | per provider              | per provider            |

**Notes by provider:**

- **Codex** — captures traffic when Codex is in **API-key mode** (`OPENAI_API_KEY`). If Codex is authenticated via **ChatGPT login**, it uses a WebSocket transport (`wss://chatgpt.com/...`) that bypasses `OPENAI_BASE_URL` — the dashboard will be empty. Run `codex doctor` to check your auth mode; if it shows `auth mode: chatgpt`, switch to API-key mode to use ccglass.
- **Kimi** — runs through Claude Code against Moonshot's Anthropic-compatible endpoint; set `ANTHROPIC_AUTH_TOKEN` to your Moonshot key.
- **DeepSeek-TUI** — OpenAI-compatible Chat Completions; set `DEEPSEEK_API_KEY`.
- **Reasonix** — OpenAI-compatible Chat Completions; set `DEEPSEEK_API_KEY`.
- **OpenCode** — auto-detects upstream from `OPENAI_BASE_URL`; set it before running. Use `--env-var` if your OpenCode provider uses a different env var name.
- **Qoder** — OpenAI-compatible; pass `--upstream <url>` to point at your Qoder endpoint (e.g. `ccglass qoder --upstream https://your-qoder-endpoint.com`).
- **Ollama / LM Studio** — no key needed for local models; pass `--upstream` if your server runs on a non-default address.
- **OpenRouter** — set `OPENAI_API_KEY` to your OpenRouter key.
- **GLM/Zhipu** — set `OPENAI_BASE_URL` to your Zhipu endpoint (e.g. `https://open.bigmodel.cn/api/paas/v4`) and `OPENAI_API_KEY` to your Zhipu key.
- **AWS Bedrock** — set `ANTHROPIC_BEDROCK_BASE_URL` to your Bedrock endpoint before running. Claude Code in Bedrock mode reads its endpoint from this var (not `ANTHROPIC_BASE_URL`). Works against Bedrock-compat gateways (bearer / mTLS auth). Direct AWS endpoints (`*.amazonaws.com`) will fail through the proxy because SigV4 signs the Host header — ccglass prints a warning if it detects this.
- **Google Vertex AI** — set `ANTHROPIC_BASE_URL` to your Vertex AI endpoint (e.g. `https://us-east5-aiplatform.googleapis.com`) before running; GCP credentials are forwarded as-is.
- **CodeBuddy** — uses a **forward-proxy** mode (HTTP CONNECT + TLS MITM) because CodeBuddy's built-in models hardcode their upstream URL. See [CodeBuddy setup](#codebuddy) below.

### Custom provider recipe

Any tool that reads a base-URL env var can be inspected with the generic escape hatch:

```bash
# OpenAI-compatible tool with a custom endpoint
ccglass run \
  --upstream https://my.custom.api/v1 \
  --env-var MY_CUSTOM_BASE_URL \
  -- my-tool [args...]

# Shorthand alias
ccglass run --base-url https://my.custom.api/v1 --env-var MY_BASE_URL -- my-tool

# Reuse an existing provider's format but point at a different upstream
ccglass run --provider openai --upstream https://my.openai-compat.api -- my-tool
```

## IDE Support (Cursor, Cline, Continue…)

IDE extensions that let you configure a **custom API base URL** (e.g. Cursor in BYOK mode, Cline, Continue.dev, Copilot Chat with custom models) can be inspected with the `proxy` subcommand — it starts the proxy + dashboard **without spawning any child process**:

```bash
ccglass proxy --provider openai   # OpenAI-compatible IDEs (Cursor, Cline, Continue…)
ccglass proxy --provider claude   # Anthropic-compatible IDEs
```

Output:

```
  ● ccglass proxy → https://api.openai.com
    Set your IDE's API base URL to: http://127.0.0.1:PORT
    dashboard: http://127.0.0.1:DASHPORT
    (Ctrl-C to stop)
```

Point your IDE's API base URL at the printed proxy address, then open the dashboard URL to watch every request in real time.

**Limitation:** This only works when the IDE is configured to use _your own API key_ with a custom base URL (BYOK mode). Cursor's built-in subscription models route through Cursor's own backend (`api2.cursor.sh`) and cannot be intercepted this way.

## CodeBuddy

CodeBuddy (Tencent) uses built-in models whose API endpoint (`copilot.tencent.com`) is hardcoded — it cannot be redirected via environment variables. ccglass uses a **forward-proxy** mode to intercept these requests: it accepts HTTP CONNECT tunnels, performs TLS MITM on targeted hosts only, and forwards the decrypted traffic to the real upstream.

This works with **CodeBuddy IDE**, **VS Code plugin**, **JetBrains plugin**, and **Visual Studio plugin** — any form factor that supports HTTP proxy settings.

### Quick start

```bash
ccglass codebuddy
```

Output:

```
  ● ccglass forward-proxy watching CodeBuddy (Tencent)
    proxy:     http://127.0.0.1:9999
    dashboard: http://127.0.0.1:56181
    intercepting: copilot.tencent.com

    Add to your client settings:
      "http.proxy": "http://127.0.0.1:9999"
      "http.proxyStrictSSL": false

    Press Ctrl-C to stop.
```

### Configure your IDE

**CodeBuddy IDE / VS Code plugin** — open `settings.json` (`Cmd+,` or `Ctrl+,`, then "Open Settings (JSON)") and add:

```json
{
  "http.proxy": "http://127.0.0.1:9999",
  "http.proxyStrictSSL": false
}
```

**JetBrains plugin** — go to _Settings → Appearance & Behavior → System Settings → HTTP Proxy_, select _Manual proxy configuration_, and set Host: `127.0.0.1`, Port: `9999`.

**Visual Studio plugin** — go to _Tools → Options → Environment → Network_, configure the proxy address.

> Use the port number from the `ccglass codebuddy` output (or fix it with `--proxy-port 9999`).

### How it works

```
CodeBuddy → http.proxy → ccglass forward-proxy (CONNECT + TLS MITM)
                              │
                              ├─ intercept & log POST /v2/chat/completions
                              │
                              └─ forward → copilot.tencent.com:443
```

- Only `copilot.tencent.com` traffic is intercepted; all other HTTPS traffic (npm, git, etc.) passes through transparently without decryption.
- A local CA certificate is auto-generated on first run (stored in the session directory). Setting `http.proxyStrictSSL: false` tells the IDE to accept it without system-level trust.
- Request bodies are gzip-compressed by CodeBuddy; ccglass decompresses them for display in the dashboard.

### Cleanup

When you're done, remove the proxy settings from your IDE and press `Ctrl-C` to stop ccglass. Your captured logs remain available via `ccglass view`.

## What you get

- **Sessions**: the dashboard opens on the list of recordings, each told apart
  by its first prompt, model, request count and how many requests failed or
  were cancelled. Sort by any column; the last row totals them. A path at the
  top (`Sessions › Nov 23 · 23:34:32 › Request #4`) says where you are and
  leads back up.
- **Replay**: a session reads as one timeline, live while it records: the
  prompt you typed, the tool calls it caused with their results, and the
  reply. A streamed reply appears while it is generated, its reasoning and
  text growing about twice a second, and the request is marked **streaming**
  until it ends. A strip of bars shows every request, taller when slower, red when
  failed and amber when the client cancelled it. Opening a request puts the
  list of requests beside it, each row saying what the request was for: the
  prompt that started it, or the tools whose output it sends back.
- **Addresses**: the session, request and tab are in the URL
  (`#/s/2026-11-23T23-34-32-264/r/4/messages`), so a reload keeps your place,
  the browser's Back button moves inside the dashboard, and a place can be
  bookmarked.
- **Request inspector**: six views of one request. It opens on Overview:
  everything sent, split into what goes with every request, earlier turns and
  what is new, followed by the response. System, Messages, Tools and Response
  each read one part in full, and HTTP has the headers and raw bodies. A line
  above the tabs gives the outcome, timing and tokens; **Details** unfolds the
  full breakdown.
- **Tools view**: which of the offered tools were called and which never were,
  sortable by size. Jump from a call to its definition and back.
- **Compare**: see what one request sent that another did not. **Compare with
  #N** on a request compares it with the one before it, which shows what that
  turn added; any other pair can be picked from the list.
- **Token and cache metrics**: exact input, output and cache tokens from the
  response `usage`, and the cache-hit rate, per request and per session. This
  fork does not calculate or display billing.
- **Usage**: token totals and each model's share, for one session (its
  **Usage** tab) or across every captured session (**Usage** beside
  **Sessions**).
- **Recordings**: start, stop, reset, delete and export sessions from the
  dashboard without interrupting forwarding.
- **Filters and search**: scope a session to one of its models (offered when it
  called more than one), show only errors, and find text within a session or a
  request.
- **Latency**: end-to-end time on each list row; a request's Details add time
  to first token, the generation window and approximate input and output
  tok/s.
- **Response reassembly and export**: streamed SSE is rebuilt into the final
  message (`stop_reason`, tool calls, usage) for both the Anthropic and OpenAI
  wire formats. Export any request as a readable **raw** HTTP transcript,
  Markdown, JSON or HAR.
- **Copy as cURL**: from the request header, copy a shell-ready replay of the
  proxied request.
- **Keyboard**: arrow keys (or `j`/`k`) move through any list, `Enter` opens
  a request, `Esc` goes up a level, `[` and `]` step to the previous
  and next request, `/` searches. Press `?` for the full list.
- **Room for the payload**: one top bar instead of a sidebar, and a button to
  hide the request list when a payload needs the whole width.
- **Light and dark theme**: **System**, **Light** or **Dark** in the top bar;
  the choice is saved in the browser. The typeface (Inter, SIL Open Font
  License) is bundled, so the dashboard looks the same on every machine and
  works offline.
- **Self-inspection (MCP)**: when wrapping Claude Code, ccglass registers its
  own query tools so the agent can inspect the very requests it just made,
  right inside the chat (`--no-mcp` to skip).

## Usage

```bash
ccglass                       # pick a client interactively
ccglass claude [args...]      # inspect Claude Code (args pass through, e.g. --resume)
ccglass codex  [args...]      # inspect Codex
ccglass deepseek [args...]    # inspect DeepSeek-TUI (dispatcher)
ccglass deepseek-tui [args...] # inspect DeepSeek-TUI runtime directly
ccglass reasonix [args...]    # inspect Reasonix
ccglass dsnix    [args...]    # inspect Reasonix (dsnix alias)
ccglass kimi   [args...]      # inspect Kimi (via Claude Code)
ccglass opencode [args...]    # inspect OpenCode (auto-detects upstream from OPENAI_BASE_URL)
ccglass codebuddy             # inspect CodeBuddy (forward-proxy mode)
ccglass run --provider openai -- <cmd...>   # inspect any client
ccglass proxy --provider openai            # proxy only — point your IDE at the proxy URL
ccglass view                  # re-open the dashboard over saved logs (global + ./.ccglass)
ccglass migrate               # copy this project's ./.ccglass into the global store
ccglass repack [session]      # force-migrate existing captures to content-addressed (v2) format
ccglass rm <session>          # delete a session and reclaim its orphaned blobs
ccglass usage [--by-session|--by-timestamp] [--format json]   # token rollup; lists each session
ccglass export <session>/<seq> --format raw|md|json|har   # e.g. 2026-05-25T12-00-00-000Z/0003
```

With `--by-session`, each row is labelled by the agent's own session name when it
can be recovered — Claude Code's `/rename` title, else its auto-generated title,
else the first prompt — falling back to the capture timestamp otherwise. Use
`--by-timestamp` to label rows by the raw capture-timestamp id instead (handy for
`ccglass rm`/`export`, which take that id).

### Options

| Flag                     | Default                                  | Meaning                                                                                                            |
| ------------------------ | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `--provider <p>`         | from command                             | Force format/env for `run` (`claude`/`codex`/`deepseek`/`reasonix`/`kimi`/`openai`)                                |
| `--upstream <url>`       | per provider                             | Override the upstream API                                                                                          |
| `--port <n>`             | auto                                     | Dashboard port                                                                                                     |
| `--proxy-port <n>`       | auto                                     | Proxy port                                                                                                         |
| `--dir <path>`           | `~/.ccglass/sessions/<full-path>-<hash>` | Where new logs are written; also used as `migrate` destination. Dashboard still reads `./.ccglass` in the project. |
| `--no-open`              | off                                      | The dashboard opens in your browser by default; pass this to skip it                                               |
| `--no-mcp`               | off                                      | Don't inject ccglass's self-inspection tools into Claude Code                                                      |
| `--no-settings-override` | off                                      | Don't force Claude Code onto the proxy via `--settings` (for when a provider switcher set `ANTHROPIC_BASE_URL`)    |
| `--no-redact`            | off                                      | Keep auth tokens unmasked in saved logs                                                                            |
| `--env-var <name>`       | per provider                             | Override the environment variable used to set the proxy URL                                                        |

## Logs & secrets

New captures are written under `~/.ccglass/sessions/`, one directory per project.
The folder name is the full resolved project path (slashes become `--`, Unicode
kept) plus a short hash suffix, for example:

`~/.ccglass/sessions/Users--you--Coding--ccglass-a1b2c3d4/<session>/NNNN.json`

While you inspect a client, the dashboard merges logs from that global directory
and from `./.ccglass` in the **current project** (if it still exists from older
runs). The first time ccglass sees `./.ccglass` with data but no logs in the new
global store yet, it prints a note suggesting `ccglass migrate`.

`ccglass migrate` copies `.json` files from **this project's** `./.ccglass` into
the store for the current directory (default: the global path above, or `--dir` if
you passed it). It skips files that already exist at the destination, only runs in
the current working directory, and exits with a clear message if there are no
`.json` logs to copy (empty session folders alone are not enough).

### Storage format

Captures are stored content-addressed (git-style): each message, the `tools`
array, and the `system` block are written once to `<root>/blobs/` and referenced
by hash from per-request manifests. This keeps long sessions from growing
quadratically. Legacy captures are migrated to this format automatically the
first time they are read.

- `ccglass repack [session]` — force-migrate existing captures now.
- `ccglass rm <session>` — delete a session and reclaim its orphaned blobs.

Auth tokens (`authorization`, `x-api-key`) are **masked by default** — pass
`--no-redact` to keep them. Treat the log directory as sensitive regardless.

## What this fork changes

This fork supports the Docker-based inspection setup in `debug-proxy`:

- `CCGLASS_BIND_HOST` overrides the proxy and dashboard bind address. It defaults
  to `127.0.0.1`; Docker sets it to `0.0.0.0` and publishes only on host loopback.
- The dashboard rejects non-loopback `Host` headers with HTTP 403.
- `CCGLASS_CORS_ORIGINS` enables reverse-proxy CORS for a comma-separated list
  of exact origins (for example, `http://localhost:5173`), or `*` for any origin
  (like `OLLAMA_ORIGINS="*"`). Preflight requests are answered locally without
  capturing them, and actual responses include the allowed origin (or `*`).
  An explicit list rejects other origins with HTTP 403; requests without an
  Origin header still work. Unset or empty leaves upstream CORS unchanged.
- Captured request `authorization` and `x-api-key` headers are fully replaced
  with `[REDACTED]` unless `--no-redact` is explicitly selected. Forwarded
  authentication is unchanged; other headers, bodies, and URLs are not redacted.
- Reverse-proxy streaming honors downstream backpressure and cancels upstream
  work when clients disconnect. Interrupted streams are recorded as errors, keep
  the part of the reply that arrived before the break, and close the transport
  rather than appending error text to a started response. The dashboard shows a
  stream the client closed as **cancelled**, apart from requests that failed,
  after whatever reasoning and text it had produced.
- Each chunk is forwarded to the client the moment it arrives. The dashboard
  is shown a copy of the reply so far while it streams; that copy is held in
  memory, and the capture file is written once, when the reply ends or breaks
  off.
- The dashboard's **Record** / **Stop** control creates separate recordings
  without interrupting forwarding. Recording begins automatically; stop before
  starting a fresh session. While stopped, the header says **Not saving
  requests**: the proxy keeps forwarding and stores nothing. Saved recordings
  are listed under **Sessions**. **Clear
  requests…** in a session's ⋯ menu clears only that recording after an in-app
  confirmation that names it, preserving its recording/stopped state and other
  sessions. Pending responses cannot restore cleared requests.
  In-flight requests remain assigned to the session where they were captured.
  **Delete session…** in the same menu permanently removes a stopped session after
  confirmation; recording sessions cannot be deleted. Other sessions and live
  forwarding are unaffected, and late responses cannot restore deleted captures.
  Read-only dashboards hide recording/reset/delete controls. Docker's tmpfs storage
  still wipes all sessions when the container stops or restarts.
- **Export session**, also available per row in **Sessions**,
  downloads a self-contained JSON file with `session`, `exportedAt`, and full
  `entries` (reconstructed request bodies, captured headers, raw responses,
  errors, and timing metadata). It ignores UI filters and works in read-only
  mode. Active sessions export a snapshot, including pending requests with a
  null response and streaming ones with the reply so far (`streaming: true`). Stop capture and wait for pending responses before exporting
  a completed recording. Existing header redaction is preserved; other captured
  data may contain secrets, so sanitize exports before sharing them.

Run `node --test test/setup.test.mjs test/proxy-latency.test.js test/store.test.js test/server.test.js`
to check these changes, or `vp run test` for the complete upstream suite.

## Development

From this checkout (`vendor/ccglass` in `debug-proxy`), run:

```sh
vp install
vp run build
vp run dev
```

Development uses [Vite+](https://viteplus.dev) (`vp`), which bundles Vite,
Vitest, Oxlint and Oxfmt; all of them are configured in `vite.config.ts`.

This starts the proxy at **http://127.0.0.1:6656**, the production dashboard at
**http://127.0.0.1:6657**, and the hot-reloading React dashboard at
**http://localhost:5173**, forwarding to **http://127.0.0.1:6655** without Docker.
Keep the host API running and point clients at
**http://127.0.0.1:6656/openai/v1**. Stop the Docker stack first if it uses the
same ports. Browser requests from `http://localhost:5173` are allowed by default.

Edit components in `ui/src/`; Vite updates the development dashboard automatically.
`vp run build` compiles TypeScript and Tailwind into `web/`, which the existing
server serves directly at port 6657. No CDN, remote fonts, or frontend server is
needed in production. Node watch mode restarts the backend on server-source edits.
Captures are saved in the ignored `.ccglass/` directory and survive restarts.
Press Ctrl-C to stop.

Use `vp run dev:ui` with an already-running backend, or `vp run dev:server`
for the backend alone. `vp check` checks formatting, lint rules and types;
`vp check --fix` applies fixes, and the pre-commit hook does the same for
staged files. `vp test` runs the frontend tests, `vp run test:server` the
backend tests, and `vp run test` both. Packaging builds `web/`
automatically; generated assets are not edited or committed.

The UI uses small components in `ui/src/components`, one REST/SSE hook in
`useDashboard.ts`, and pure formatting/timeline helpers in `ui/src/lib`.
It has no router or global state framework. Full payloads for the latest 500
requests are cached for replay; all request summaries remain searchable and
older full requests can still be opened individually or exported.

Override defaults with shell environment variables (`CCGLASS_UPSTREAM`,
`CCGLASS_PROXY_PORT`, `CCGLASS_DASHBOARD_PORT`, `CCGLASS_CORS_ORIGINS`) or CLI
options, for example:

```sh
vp run dev --upstream http://127.0.0.1:7777 --proxy-port 6666 --port 6667
CCGLASS_CORS_ORIGINS='*' vp run dev
```

## Requirements

Node 26 (the current LTS) or newer. The core proxy + dashboard have no runtime dependencies; the
optional MCP self-inspection feature (`ccglass claude`) pulls in
`@modelcontextprotocol/sdk` and `zod`.

## Issues

Open an [issue](https://github.com/jianshuo/ccglass/issues/new) and Claude picks
it up automatically — it investigates against the code, and if it's a real,
well-scoped bug or small feature, opens a fix PR that references your issue. Keep
iterating by commenting `@claude` on the issue or the PR. Claude only ever opens
PRs for review; a maintainer merges and releases.

## Acknowledgments

ccglass is better because of the people who took the time to open a PR. Thank you,
all of you. 🙏

**庄表伟 ([@zhuangbiaowei](https://github.com/zhuangbiaowei))** contributed
**first-class DeepSeek-TUI support** ([#1](https://github.com/jianshuo/ccglass/pull/1)).
DeepSeek-TUI ships as a dual-binary coding agent — a `deepseek` dispatcher and a
`deepseek-tui` runtime. 庄表伟 wired up both as native ccglass providers, pointing
them at the proxy via `DEEPSEEK_BASE_URL` and reusing the existing
OpenAI-compatible Chat Completions adapter, so every DeepSeek request now shows up
in the dashboard with zero extra setup. The contribution also added them to the
interactive picker, documented usage across the README, and shipped provider
regression tests to keep it working. Thank you for making ccglass better for the
whole DeepSeek community.

And huge thanks to everyone else who shipped improvements:

- **[@KorenKrita](https://github.com/KorenKrita)** — built the richer dashboard with
  latency, theming, model filtering, and session stats
  ([#50](https://github.com/jianshuo/ccglass/pull/50)), added the **Reasonix** CLI
  provider ([#49](https://github.com/jianshuo/ccglass/pull/49)), moved captured logs
  into `~/.ccglass/sessions/` so they survive project-folder deletion
  ([#39](https://github.com/jianshuo/ccglass/pull/39)), and fixed a CLI crash when
  `xdg-open` fails ([#12](https://github.com/jianshuo/ccglass/pull/12)).
- **Marcus ([@marcuslannister](https://github.com/marcuslannister))** — added the
  token-usage summary across every session
  ([#48](https://github.com/jianshuo/ccglass/pull/48)) and fixed Bedrock interception
  to key off `ANTHROPIC_BEDROCK_BASE_URL`
  ([#38](https://github.com/jianshuo/ccglass/pull/38)).
- **[@ivanberry](https://github.com/ivanberry)** — added the `--env-var` option and
  **OpenCode** provider support
  ([#11](https://github.com/jianshuo/ccglass/pull/11)).
- **[@ping-coding](https://github.com/ping-coding)** — fixed Windows Codex proxy
  routing ([#20](https://github.com/jianshuo/ccglass/pull/20)).

Thank you all. 🙏

## Related tools

| Tool                                               | What it does                                                             |
| -------------------------------------------------- | ------------------------------------------------------------------------ |
| **ccglass** ← you are here                         | See exactly what your coding agent sends to the model                    |
| [**ccline**](https://github.com/jianshuo/ccline)   | Type a thought at your zsh prompt — get an AI answer and run the command |
| [**cclight**](https://github.com/jianshuo/cclight) | MacBook notch glow tells you when Claude Code is thinking                |

## License

MIT
