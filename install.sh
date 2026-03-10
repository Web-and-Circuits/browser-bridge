#!/usr/bin/env bash
set -euo pipefail

# ── Usage ──────────────────────────────────────────────────────────────────
if [[ $# -lt 1 ]]; then
  echo "Usage: ./install.sh <extension-id>"
  echo ""
  echo "  The extension ID is shown in the Browser Bridge side panel"
  echo "  when the host is not yet connected."
  echo ""
  echo "  Example:"
  echo "    ./install.sh abcdefghijklmnopabcdefghijklmnop"
  exit 1
fi

EXT_ID="$1"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOST_DIR="$SCRIPT_DIR/host"
HOST_SCRIPT="$SCRIPT_DIR/host/bridge-host.js"
WRAPPER="$HOST_DIR/run.sh"
MANIFEST_NAME="com.webandcircuits.browser_bridge"

# ── Find node ──────────────────────────────────────────────────────────────
NODE_BIN="$(command -v node 2>/dev/null)"
if [[ -z "$NODE_BIN" ]]; then
  # common install locations
  for p in /usr/local/bin/node /opt/homebrew/bin/node /usr/bin/node; do
    [[ -x "$p" ]] && NODE_BIN="$p" && break
  done
fi
if [[ -z "$NODE_BIN" ]]; then
  echo "✗ node not found — install Node.js and try again"
  exit 1
fi
echo "✓ node: $NODE_BIN"

# ── Find claude ────────────────────────────────────────────────────────────
CLAUDE_BIN="$(command -v claude 2>/dev/null)"
if [[ -z "$CLAUDE_BIN" ]]; then
  for p in \
    "$HOME/.claude/local/claude" \
    "$HOME/.nvm/versions/node/$(node --version 2>/dev/null)/bin/claude" \
    /usr/local/bin/claude /opt/homebrew/bin/claude /usr/bin/claude; do
    [[ -x "$p" ]] && CLAUDE_BIN="$p" && break
  done
fi
if [[ -n "$CLAUDE_BIN" ]]; then
  echo "✓ claude: $CLAUDE_BIN"
else
  echo "⚠ claude CLI not found — sidebar chat will show an error until CLAUDE_PATH is set in host/run.sh"
fi

BRIDGE_DIR="$SCRIPT_DIR/.bridge"

# ── Write wrapper script (bakes in node + claude paths + working dir) ──────
mkdir -p "$BRIDGE_DIR/state"
cat > "$WRAPPER" <<EOF
#!/bin/bash
cd "$HOST_DIR"
export BROWSER_BRIDGE_DIR="$BRIDGE_DIR"
${CLAUDE_BIN:+export CLAUDE_PATH="$CLAUDE_BIN"}
exec "$NODE_BIN" bridge-host.js 2>>"$BRIDGE_DIR/state/stderr.log"
EOF
chmod +x "$WRAPPER"

# ── Detect Chrome native messaging host directory ──────────────────────────
if [[ "$OSTYPE" == "darwin"* ]]; then
  DEST_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
  DEST_DIR="$HOME/.config/google-chrome/NativeMessagingHosts"
else
  echo "Unsupported OS: $OSTYPE"
  exit 1
fi

# ── Write manifest ─────────────────────────────────────────────────────────
MANIFEST_PATH="$SCRIPT_DIR/$MANIFEST_NAME.json"
cat > "$MANIFEST_PATH" <<EOF
{
  "name": "$MANIFEST_NAME",
  "description": "Browser Bridge native host",
  "path": "$WRAPPER",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://$EXT_ID/"
  ]
}
EOF

# ── Install ────────────────────────────────────────────────────────────────
mkdir -p "$DEST_DIR"
cp "$MANIFEST_PATH" "$DEST_DIR/$MANIFEST_NAME.json"

echo ""
echo "✓ manifest installed → $DEST_DIR/$MANIFEST_NAME.json"
echo "✓ done — reload the extension in Chrome and the host will connect automatically"
echo ""
