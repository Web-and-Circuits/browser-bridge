# browser-bridge

A Chrome extension + local server that lets an agent read and control the active browser tab through files on disk.

No cloud. No API keys. Files in, files out.

---

## What it does

The agent writes a JSON request file. The bridge picks it up, runs the action on the active tab, and writes the response. The agent reads it.

```
agent  →  .bridge/requests/{id}.json
bridge →  runs action on active tab
bridge →  .bridge/responses/{id}.json
agent  →  reads result
```

---

## Two modes

| | Extension mode | Bookmarklet mode |
|---|---|---|
| **transport** | Native messaging (no server) | WebSocket (`ws://localhost:9876`) |
| **sidebar** | Yes — status, chat, on/off toggle | No — headless |
| **persistence** | Always connected | Click bookmark per page |
| **use when** | Extensions are allowed | Extensions blocked by policy |

---

## Extension mode

### Setup

```bash
git clone https://github.com/Web-and-Circuits/browser-bridge
```

In Chrome: `chrome://extensions` → enable Developer Mode → **Load unpacked** → select the `extension/` directory.

The side panel shows your extension ID and the install command. Run it:

```bash
./install.sh <your-extension-id>
```

This finds your Node.js binary, writes a wrapper script with baked-in paths, and installs the native messaging manifest. One-time per machine.

Reload the extension. The side panel connects automatically.

### Side panel

The side panel gives you:
- **On/off toggle** — bright green bar at the top; click to disable the bridge (useful on sensitive pages like Gmail)
- **Status dot** — shows connected / disconnected / active
- **Chat** — type a task, Claude runs it on the page using `bridge.js` commands, output streams into the sidebar
- **Chat modes** — `amnesia` (stateless), `session` (persistent conversation), `terminal` (paste a session ID to join a running Claude session)
- **Activity log** — every request/response logged with tally marks for duplicates

The bridge only works when the sidebar is open and the toggle is on. Requests sent while it's off or closed return an immediate error rather than timing out.

---

## Bookmarklet mode

For environments where Chrome extensions are blocked by policy.

### How it works

A local WebSocket server replaces the native messaging host. The bookmarklet connects to it from the browser. The file protocol and CLI are identical — only the transport changes.

```
agent     →  .bridge/requests/{id}.json
server.js →  forwards via WebSocket
bookmarklet → runs action on active tab
server.js →  .bridge/responses/{id}.json
agent     →  reads result
```

### Setup

```bash
git clone https://github.com/Web-and-Circuits/browser-bridge
cd browser-bridge
npm install
node server.js           # starts on ws://localhost:9876
```

To use a different port:
```bash
BRIDGE_PORT=9999 node server.js
```

### Add the bookmarklet

1. Open `bookmarklet.js` in any text editor
2. Copy the last line — the minified `javascript:(function(){...})();` one-liner
3. In Chrome: open Bookmarks → **Add new bookmark** → paste it as the URL → save

### Connect

Navigate to any page, click the bookmark. The server terminal prints:
```
[bridge] bookmarklet connected
```

Run commands normally:
```bash
./bridge.js ping
./bridge.js snapshot
./bridge.js run_js "document.title"
```

### Notes

- **One click per page** — the bookmarklet runs in the page's JavaScript context. When you navigate to a new page, the connection drops. Click the bookmark again to reconnect. The `server.js` process stays running.
- **HTTPS pages** — Chrome allows `ws://localhost` from HTTPS pages (localhost is treated as a secure context).
- **No sidebar** — bookmarklet mode is headless. Status visible in browser console (`[bridge] connected / disconnected`).
- **Audit trail** — all processed requests are moved to `.bridge/archive/` and kept permanently.

---

## CLI

Works the same in both modes.

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
./bridge.js ping --timeout 5000     # custom timeout (ms, default 15000)
```

---

## Actions

| action | args | returns |
|--------|------|---------|
| `ping` | — | `{ pong: true }` |
| `get_active_tab` | — | `{ tabId, title, url }` |
| `snapshot` | `selector?`, `mode?` | `{ title, url, visibleText, links, selectionText }` |
| `snapshot --mode forms` | — | `{ title, url, forms: [{tag, type, name, id, label, value, selector}] }` |
| `run_js` | `code` | return value of the JS expression |
| `click` | `selector` | `{ clicked: selector }` |
| `fill` | `selector`, `value` | `{ filled: selector }` |
| `navigate` | `url` | `{ url }` |

`run_js`, `click`, and `fill` run in the page's main JS context — full DOM access.

---

## File protocol

For agents writing requests directly:

**Request** — write to `.bridge/requests/{id}.json`:
```json
{
  "id": "req-001",
  "createdAt": "2026-03-10T00:00:00Z",
  "target": "active-tab",
  "action": "snapshot",
  "args": {}
}
```

**Response** — appears at `.bridge/responses/{id}.json`:
```json
{
  "id": "req-001",
  "ok": true,
  "createdAt": "2026-03-10T00:00:01Z",
  "result": { "title": "...", "url": "...", "visibleText": "...", "links": [] },
  "error": null
}
```

Queue layout:
```
.bridge/
  requests/           ← drop request files here
  requests-inflight/  ← claimed by host (do not touch)
  responses/          ← responses appear here
  archive/            ← processed requests (permanent audit trail)
  state/              ← logs (stderr.log, host-error.log)
```

---

## Requirements

- Node.js
- Chrome 114+
- Active tab must be a regular webpage (not `chrome://` pages)

---

## How it works

**Extension mode**: the host process (`host/bridge-host.js`) connects to the extension via Chrome's native messaging protocol. It polls `.bridge/requests/` every 300ms, claims files atomically via rename (preventing double-processing), forwards requests to the extension, and writes responses back to disk. The extension runs actions in the active tab via content scripts and `chrome.scripting.executeScript`.

**Bookmarklet mode**: `server.js` runs a WebSocket server instead. The bookmarklet connects to it from the page's JavaScript context. Same file queue, same CLI, different transport.

In both modes, processed request files are renamed to `.bridge/archive/` rather than deleted — no Trash prompts, full audit trail.

FSA (File System Access API) was evaluated and rejected early — Chrome's sandbox on macOS prevents extensions from seeing files written by external processes. Native messaging / WebSocket are the correct transports.

---

## Roadmap

- Agent-side client library (`import { bridge } from 'browser-bridge/client'`)
- Browser-initiated observations (extension writes events to disk unprompted)
- Multi-tab targeting (`target: "tab:url:pattern"`)
- Replay + audit tooling over `.bridge/archive/`

---

## See also

- `AGENTS.md` — concise reference for AI coding agents
- `CLAUDE.md` — Claude-specific instructions (auto-loaded by `claude -p`)
