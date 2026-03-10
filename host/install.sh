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
HOST_SCRIPT="$SCRIPT_DIR/bridge-host.js"
MANIFEST_NAME="com.webandcircuits.browser_bridge"

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
  "path": "$HOST_SCRIPT",
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
echo "✓ starting host…"
echo ""

exec node "$HOST_SCRIPT"
