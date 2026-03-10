# AGENTS.md — Browser Bridge

A Chrome extension + native host that lets an agent read and control the active browser tab through files on disk.

## CLI

```bash
./bridge.js ping
./bridge.js get_active_tab
./bridge.js snapshot
./bridge.js snapshot --selector "main"
./bridge.js snapshot --mode forms
./bridge.js run_js "document.title"
./bridge.js run_js "document.querySelectorAll('h2').length"
./bridge.js click "#submit-btn"
./bridge.js fill "#email" "user@example.com"
./bridge.js navigate "https://example.com"

# flags
./bridge.js snapshot --raw          # full response JSON
./bridge.js ping --timeout 5000     # custom timeout (ms)
```

## Actions

| action | args | returns |
|--------|------|---------|
| `ping` | — | `{ pong: true }` |
| `get_active_tab` | — | `{ tabId, title, url }` |
| `snapshot` | `selector?`, `mode?` | `{ title, url, visibleText, links, selectionText }` |
| `snapshot --mode forms` | — | `{ title, url, forms: [{tag, type, name, id, label, value, selector}] }` |
| `run_js` | `code` | return value of the JS expression |
| `click` | `selector` | `{ clicked: selector }` |
| `fill` | `selector`, `value` | `{ filled: selector }` — fires input + change events |
| `navigate` | `url` | `{ url }` |

`run_js` and `click`/`fill` run in the page's main JS context — full DOM access.

## File protocol (direct)

Write to `.bridge/requests/{id}.json`, read from `.bridge/responses/{id}.json`.

**Request:**
```json
{
  "id": "any-unique-id",
  "createdAt": "2026-03-10T00:00:00Z",
  "target": "active-tab",
  "action": "snapshot",
  "args": {}
}
```

**Response:**
```json
{
  "id": "any-unique-id",
  "ok": true,
  "createdAt": "2026-03-10T00:00:01Z",
  "result": { ... },
  "error": null
}
```

## Common patterns

**Load page context into agent:**
```bash
./bridge.js snapshot --selector "article"
./bridge.js snapshot --mode forms     # what inputs exist on this page
```

**Act on page:**
```bash
./bridge.js fill "#search" "query"
./bridge.js click "[type=submit]"
```

**Evaluate then act:**
```bash
./bridge.js run_js "document.querySelector('#price').textContent"
# agent reasons about result, then:
./bridge.js click "#add-to-cart"
```

## Requirements

- Chrome with extension loaded (`extension/` dir, unpacked)
- Native host running — run `./install.sh <extension-id>` once
- Active tab must be a regular webpage (not `chrome://` pages)
- Reload the tab if it was open before the extension was installed

## Setup

```bash
# clone and load extension/ as unpacked in Chrome
# extension ID is shown in the side panel
./install.sh <extension-id>
# side panel auto-connects — ready
```

## Queue

```
.bridge/
  requests/    ← drop request files here
  responses/   ← responses appear here (same filename)
  state/       ← stderr.log, host-error.log
```
