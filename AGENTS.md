# AGENTS.md — Browser Bridge

This repo is a Chrome extension + native host that lets an agent read and control the active browser tab through files on disk.

## How to use it

Write a JSON request file. Read the response file. That's the full protocol.

### CLI (fastest)

```bash
./bridge.js ping
./bridge.js get_active_tab
./bridge.js snapshot
./bridge.js run_js "document.title"
./bridge.js run_js "document.querySelector('h1').textContent"
./bridge.js run_js "document.body.style.background = 'red'"
./bridge.js run_js --raw "document.title"   # full response JSON
```

### File protocol (direct)

Write to `.bridge/requests/{id}.json`, read from `.bridge/responses/{id}.json`.

Request format:
```json
{
  "id": "unique-id",
  "createdAt": "2026-03-10T00:00:00Z",
  "target": "active-tab",
  "action": "snapshot",
  "args": {}
}
```

Response format:
```json
{
  "id": "unique-id",
  "ok": true,
  "createdAt": "2026-03-10T00:00:01Z",
  "result": { ... },
  "error": null
}
```

## Actions

| action | args | returns |
|--------|------|---------|
| `ping` | — | `{ pong: true }` |
| `get_active_tab` | — | `{ tabId, title, url }` |
| `snapshot` | — | `{ title, url, visibleText, links, selectionText }` |
| `run_js` | `{ code: "..." }` | return value of the expression |

`run_js` runs in the page's main JS context — full DOM access, reads and writes, no restrictions.

## Requirements

- Extension must be loaded in Chrome (`extension/` dir, unpacked)
- Native host must be running (`./install.sh <extension-id>` — one-time setup)
- Active tab must be a regular webpage (not `chrome://` pages)
- Tab must have loaded after the extension was installed (reload if unsure)

## Queue layout

```
.bridge/
  requests/    ← drop request files here
  responses/   ← responses appear here (same filename)
  state/       ← host logs (stderr.log, host-error.log)
```

## Setup (one-time per machine)

```bash
# 1. load extension/  as unpacked in Chrome
# 2. get extension ID from the side panel
./install.sh <extension-id>
# 3. reload the extension — side panel auto-connects
```
