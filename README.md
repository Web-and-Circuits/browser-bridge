# browser-bridge

A Chrome extension + native host that lets a local agent talk to the active browser tab through files on disk.

Built for dev and debug use. Not hardened for distribution.

---

## How it works

The agent writes a JSON request file to disk. The native host picks it up and forwards it to the extension via Chrome's native messaging protocol. The extension runs the action on the active tab and responds. The response lands on disk as a JSON file. The agent reads it.

Neither side holds a live connection to the other. The filesystem is the shared surface.

```
agent  →  writes   ~/.browser-bridge/requests/{id}.json
host   →  claims   requests-inflight/{id}.json  (atomic rename)
host   →  forwards to extension via native messaging
ext    →  runs action on active tab
ext    →  responds via native messaging
host   →  writes   ~/.browser-bridge/responses/{id}.json
agent  →  reads response
```

---

## Supported actions

| action | what it does |
|--------|-------------|
| `ping` | check the host is alive |
| `get_active_tab` | return tab id, title, url |
| `snapshot` | visible text, links, selection, title, url |
| `run_js` | evaluate JavaScript in the active tab |

---

## Queue layout

```
~/.browser-bridge/
  requests/           ← agent drops request files here
  requests-inflight/  ← host claims files here (atomic rename)
  responses/          ← host writes responses here
  state/              ← host error logs
```

---

## Request format

```json
{
  "id": "req-001",
  "createdAt": "2026-03-10T04:00:00Z",
  "target": "active-tab",
  "action": "snapshot",
  "args": {}
}
```

## Response format

```json
{
  "id": "req-001",
  "ok": true,
  "createdAt": "2026-03-10T04:00:01Z",
  "result": {
    "title": "Example",
    "url": "https://example.com",
    "selectionText": "",
    "visibleText": "...",
    "links": []
  },
  "error": null
}
```

---

## Installation

### 1. Load the extension

Open `chrome://extensions`, enable Developer Mode, click **Load unpacked**, select the `extension/` directory. Copy the extension ID.

### 2. Install the native host manifest

Edit `host/com.webandcircuits.browser_bridge.json` — replace the extension ID in `allowed_origins`.

Copy the manifest to Chrome's native messaging location:

```bash
# macOS
cp host/com.webandcircuits.browser_bridge.json \
  ~/Library/Application\ Support/Google/Chrome/NativeMessagingHosts/

# Linux
cp host/com.webandcircuits.browser_bridge.json \
  ~/.config/google-chrome/NativeMessagingHosts/
```

### 3. Run the native host

```bash
cd host
node bridge-host.js
```

### 4. Write a request

```bash
cp examples/request.snapshot.json ~/.browser-bridge/requests/req-001.json
```

Then read the response:

```bash
cat ~/.browser-bridge/responses/req-001.json
```

---

## Posture

No on/off toggle. No JS denylist. The bridge is live when the host is running.

The one constraint that matters: **deliberate invocation only.** Nothing fires automatically. Requests only happen when something explicitly writes a request file. The host polls an empty directory constantly but does nothing until a file appears — no tab touches, no JS.

Write one request. Read the result. Decide if you need more.
