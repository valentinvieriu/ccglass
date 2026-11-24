# Changelog

All notable changes to ccglass are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Releases
up to and including 1.1.2 predate this file; see the git history for those.

## [Unreleased]

### Added
- `ccglass usage --by-session` now labels each row with the agent's own session name (Claude Code's `/rename` title, else its auto-generated title, else the first prompt), recovered from the Claude Code transcript linked via each request's `metadata.user_id`. The raw timestamp id column is kept alongside so sessions sharing a title stay distinguishable.
- `ccglass usage --by-timestamp` lists sessions by their raw capture-timestamp id (the id `ccglass rm`/`export` take), without resolving names.
- The web dashboard's Summary → "by session" table now shows the resolved session name alongside the timestamp id, matching `ccglass usage --by-session`. A new "by timestamp" sub-tab lists sessions by their raw capture-timestamp id only, matching `ccglass usage --by-timestamp`.

### Changed
- Dashboard numbers use one vocabulary: **Input (total)** is everything sent to the model, **of which cached** is the part read from cache, and **Output**. The session band, the Summary and a request's Overview previously showed different quantities under the same "Input" label. A rate is shown as "—" when nothing was measured, instead of 0%.
- Sizes in the dashboard are shown in tokens (an estimate marked "~" where no measured count exists), with the character count on hover. Times use one format: the 24-hour clock, a short date outside today, and the time since the session's first request (`+0:57`) in the request list.
- A request shows its outcome on every tab (`HTTP 200 · 2.25s, first token 1.27s · 47,247 tokens in (98% cached) · 102 tokens out`). A failed request opens on its Response tab and says what happened (`Failed after 8.85s · client disconnected`) instead of reporting zero tokens and a first-token time.
- Requests without a model (model listings, health probes) are titled by method and path and show only the Response and HTTP tabs.
- The header separates recording from session actions: `Recording 00:12:31 [Stop]` or `Not saving requests [Record]`. Clearing and deleting a session moved from an unlabelled icon into a labelled menu with an in-app confirmation that names the session and its request count.
- The request list's filter is labelled for what it matches (model, status or URL). The list and the session replay count failed requests the same way; failed tool calls have their own "Tool errors" filter in the replay.
- Auto-scroll is offered only while recording. An empty saved session says so and offers to delete it; an empty recording says where to point the agent.
- The dashboard gives the screen to the captured content. The sidebar became a single top bar, the band of session totals became one line in the replay header (`21 requests · 1.06M tokens in (97% cached) · 4.46k tokens out · avg 3.99s`), and the request strip and a request's header each take one row. At 1440×900 the first replay row moved from 400px down to 191px; at 1280×720 the replay shows 12 rows beside the preview instead of 3.
- Request list rows say what each request was for: the prompt that started it, or the tools whose output it sends back (`→ open_canvas`), then how long it took and how many tokens came out. The model is named only when a session has more than one, and a status only when it is not a success. The filter matches the same text.
- The same keys work in every list: arrow keys or `j`/`k` to move, `Enter` to open a request, `Esc` to go back to the replay, `[` and `]` for the previous and next request, `/` to search. `?` opens a list of them, which also holds the key to the request strip. In the replay, the whole gutter cell opens the request, as does a double click on a row.
- When a window is too narrow for a list and its preview side by side, the list keeps the height and the preview opens over it on demand.
- A request opens on what was sent. The former Flow tab is now **Overview** and the default; the grid of timing and token cards it replaced is a **Details** block that unfolds from the outcome line on any tab. The tabs went from seven to six (Overview, System, Messages, Tools, Response, HTTP), and a single system prompt opens in full.
- A stream the client closed is shown as **cancelled**, in amber, instead of being counted as a failure: in the request list, the request strip, a request's outcome line and its Response tab. The replay has a "Cancelled" filter beside "Failed". Red is kept for HTTP 4xx/5xx and transport errors.
- **Compare with #N** in a request's header compares it with the previous request to the same model, which shows what that turn added. In Compare, the two requests are marked A and B in the list, a click there replaces B only, and the dropdowns name requests the way the list does (`#4 · → open_canvas`) instead of by capture id. The result is one line of counts, and uses one column when nothing was removed or nothing was added. `Esc` returns to the request Compare was opened from.
- An empty text block that a model sends alongside a tool call no longer gets a row of its own in Overview and the replay (the Messages tab still shows every block as sent). The preview pane no longer titles an item twice ("User prompt / User").
- A request that returned no usage shows its estimated input in Overview instead of "0 tokens sent".
- The dashboard is organised the way a recording is: **Sessions**, then a session, then a request. It opens on the list of sessions (or on the session being recorded, when there is one), which replaces the dropdown of timestamps: each session is labelled with its first prompt, its model, its request count and how many requests failed or were cancelled, the columns sort, and the last row totals them. A path in the top bar (`Sessions › Nov 23 · 23:34:32 › Request #4`) replaces the Requests / Compare / Summary navigation.
- The session, request and tab are in the URL hash (`#/s/2026-11-23T23-34-32-264/r/4/messages`). A reload keeps the place, the browser's Back and Forward buttons move inside the dashboard, and the page title names what is open.
- A session is read at full width: the replay is its list of requests, with **Replay** and **Usage** as its two views. The request list appears beside a request once one is open. A session that called several models offers the model filter in the replay header.
- **Usage** exists at both levels: a session's own totals and per-model breakdown, and the totals across every session. Large totals are shortened (`1.06M`) with the exact number on hover.
- Compare belongs to the request it is about (`…/r/5/compare/4`), and `Esc` goes up one level at a time: from Compare to the request, from a request to the replay.
- One name per thing: the session view is the **Replay** whether or not it is recording, and the top bar's export is labelled **Export session**.
- The dashboard has one type scale (six sizes, three weights), four corner radii and a typeface of its own: Inter is bundled, so it looks the same on every machine and still loads nothing from the network. Message text and tool descriptions are larger (14px) and at most 80 characters wide.
- Colour means something. The user is the accent colour, the assistant ink, tool calls teal, and what the harness injects an outline: on the rows of the replay and a request, and on the filter chips for them. A tool result that worked says "ok" without the green, and "cached" and "HTTP 200" badges are neutral, so red and amber stand out.
- A selected row is marked by an accent bar on its leading edge. The chosen filter is a soft accent instead of the brightest thing on screen.
- Panels are opaque on a quiet background; the gradient is on the wordmark only. In the replay, the list and the preview fill the panel with one line between them.
- Long model and tool names are cut in the middle, keeping the end that tells them apart (`nemotron-3.5-lig…:30b-mlx`), with the full name on hover. Copy buttons in Messages appear on hover and keyboard focus. Cache-share bars are neutral at any value.
- ccglass now requires Node 26, the current LTS. Node 18, which upstream supported, reached end of life in April 2025 and was not tested.
- Session-name resolution is opt-in and lazy: the CLI's `--by-session` enables it, and the web dashboard requests names (`/api/usage?names=1`) only for its by-session tab — the by-model and by-timestamp tabs, default `usage`, and the MCP session tools never scan `~/.claude/projects`. A short-lived shared cache keeps the dashboard's live-session reloads from re-scanning on every refresh.

### Removed
- Removed the old dashboard demo, screenshots and superseded design notes (UI modernization proposal, storage plan, Bedrock bug report, cost bucketing) from the project documentation.
