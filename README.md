# browser-bridge

A Chrome extension that lets a local agent talk to the active browser tab through files on disk.

No native host. No Node process. No install ceremony beyond loading the extension.

Built for dev and debug use. Not hardened for distribution.

---

## How it works

The agent writes a JSON request file to disk. The extension's side panel polls that directory via the File System Access API, picks up the request, runs the action on the active tab, and writes the response back to disk. The agent reads it.

```
agent      →  writes   {queue}/requests/{id}.json
side panel →  picks it up (polls every 300ms)
side panel →  messages background service worker
background →  runs action on active tab
background →  responds to side panel
side panel →  writes   {queue}/responses/{id}.json
agent      →  reads response
```

The side panel is the filesystem proxy. Background handles tab operations (scripting, tabs API). The queue directory is wherever you point it.

---

## Supported actions

| action | what it does |
|--------|-------------|
| `ping` | check the bridge is alive |
| `get_active_tab` | return tab id, title, url |
| `snapshot` | visible text, links, selection, title, url |
| `run_js` | evaluate JavaScript in the active tab |

---

## Queue layout

```
{your chosen directory}/
  requests/    ← agent drops request files here
  responses/   ← side panel writes responses here
```

Sub-directories are created automatically on first use.

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

1. Open `chrome://extensions`, enable Developer Mode
2. Click **Load unpacked**, select the `extension/` directory
3. Click the extension icon — the side panel opens
4. Click **Select queue directory**, point it at your queue folder (e.g. `~/.browser-bridge`)
5. Done — the panel polls for requests automatically

Permission is stored in IndexedDB and restored on next open. Keep the side panel open while the bridge is in use.

---

## Posture

No on/off toggle. No JS denylist. The bridge is live when the side panel is open and a directory is selected.

**Deliberate invocation only.** Nothing fires automatically. Requests only happen when something explicitly writes a request file. Polling an empty directory is essentially free.

Write one request. Read the result. Decide if you need more.
