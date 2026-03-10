# Future Vision

Where browser-bridge could go — in rough priority order.

---

## Near term

### Agent-side helper library

Right now the agent hand-writes JSON files and polls `responses/`. A thin wrapper would clean this up:

```js
import { bridge } from 'browser-bridge/client'

const result = await bridge.snapshot()
const title  = await bridge.runJs('document.title')
```

Handles id generation, file writes, response polling, cleanup. Still files underneath — just a nicer surface.

### Response signal file

The host writes `responses/{id}.json` but gives no other signal. An agent that doesn't want to poll could watch for a `responses/{id}.ready` sentinel file (zero bytes) and then read the JSON. File watches are cheaper than polling loops.

### TTL + cleanup

Old response files accumulate. The host should sweep responses older than N minutes. Configurable via an env var or a `~/.browser-bridge/config.json`.

---

## Medium term

### Browser-initiated observations

Right now flow is always agent → browser. The extension could also write *observations* to disk unprompted:

```
~/.browser-bridge/events/
  {timestamp}-navigation.json
  {timestamp}-selection.json
```

Agent reads them when relevant. Still file-mediated. Still deliberate on the read side. Useful for "tell me when the user lands on a page matching X" without polling.

### Multi-tab targeting

`"target": "active-tab"` is the only option. Could add:

- `"target": "tab:{id}"` — specific tab by id
- `"target": "tab:url:{pattern}"` — tab matching a URL pattern

### Structured snapshot modes

`snapshot` currently dumps all visible text (up to 10k chars). Could add modes:

- `"args": { "mode": "links" }` — links only
- `"args": { "mode": "headings" }` — h1–h4 only
- `"args": { "mode": "selection" }` — selected text only
- `"args": { "mode": "aria" }` — accessibility tree

Smaller payloads where full snapshots aren't needed.

---

## Longer term

### Replay and audit tooling

Every request and response is already on disk. A simple CLI that replays a session (`bridge-replay`) or diffs two snapshots of the same URL would make this useful for regression testing.

### Action support

Read-only today. Bounded write actions are a natural next step if the use case demands it:

- `click` — click an element by selector or aria label
- `fill` — fill a form field
- `scroll` — scroll to position or element

Each action should be explicit, logged, and reversible where possible.

### Protocol versioning

Request schema has no version field. Add `"version": "1"` now before it matters. Makes forward compat easy when actions evolve.

---

## What we won't do

- Auto-fire requests based on page events (kills deliberateness)
- Persistent background agent polling the tab (same problem)
- Packaging this for the Chrome Web Store (it's a dev tool)
- WebSocket or localhost server transport (files are simpler and we mean it)
