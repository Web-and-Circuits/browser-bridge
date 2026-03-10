# browser-bridge

A Chrome extension + native host that lets a local agent read and control the active browser tab through files on disk.

No cloud. No API keys. Files in, files out.

---

## What it does

The agent writes a JSON request file. The native host picks it up and forwards it to the extension. The extension runs the action on the active tab and writes the response. The agent reads it.

```
agent  →  .bridge/requests/{id}.json
host   →  forwards to extension (native messaging)
ext    →  runs action on active tab
host   →  .bridge/responses/{id}.json
agent  →  reads result
```

---

## Setup

**1. Clone and load the extension**

```bash
git clone https://github.com/Web-and-Circuits/browser-bridge
```

In Chrome: open `chrome://extensions`, enable Developer Mode, click **Load unpacked**, select the `extension/` directory.

**2. Install the native host**

The side panel shows your extension ID and the exact command to run:

```bash
./install.sh <your-extension-id>
```

This installs the native messaging manifest and generates a wrapper script with the correct Node path. One-time per machine.

**3. Done**

Reload the extension. The side panel connects automatically and shows status.

---

## CLI

```bash
./bridge.js ping
./bridge.js get_active_tab
./bridge.js snapshot
./bridge.js snapshot --selector "main"
./bridge.js snapshot --mode forms
./bridge.js run_js "document.title"
./bridge.js click "#submit-btn"
./bridge.js fill "#email" "user@example.com"
./bridge.js navigate "https://example.com"
```

---

## Actions

| action | description |
|--------|-------------|
| `ping` | check the bridge is alive |
| `get_active_tab` | tab id, title, url |
| `snapshot` | visible text + links from active tab |
| `snapshot --selector <css>` | scope snapshot to a CSS selector |
| `snapshot --mode forms` | extract all form inputs, labels, selectors |
| `run_js <code>` | evaluate a JS expression in the page |
| `click <selector>` | click an element |
| `fill <selector> <value>` | set an input value, fire input + change events |
| `navigate <url>` | navigate the active tab |

---

## File protocol

For agents writing requests directly without the CLI:

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

---

## Requirements

- Node.js
- Chrome 114+
- Active tab must be a regular webpage (not `chrome://` pages)
- Reload any tab that was open before the extension was installed

---

## How it works

The side panel's matrix animation runs until the native host connects. Once connected it shows live request/response activity. The host polls `.bridge/requests/` every 300ms, claims files atomically via rename, forwards them to the extension over Chrome's native messaging protocol, and writes responses back to disk.

FSA (File System Access API) was evaluated and rejected — Chrome's sandbox on macOS prevents extensions from seeing files written by external processes. Native messaging is the correct transport for this use case.

---

## Roadmap

- Agent-side client library (`import { bridge } from 'browser-bridge/client'`)
- Browser-initiated observations (extension writes events to disk unprompted)
- Multi-tab targeting (`target: "tab:url:pattern"`)
- Replay + audit tooling over the `.bridge/archive/`

## See also

- `AGENTS.md` — concise reference for AI coding agents
