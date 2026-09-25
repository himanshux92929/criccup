#!/bin/bash
# setup.sh — download lexiforest/curl-impersonate v2 (single binary, --impersonate flag)
# Supports Chrome 110–150+, ECH, ZSTD, X25519Kyber768, trust_anchors (Chrome 152+)
set -euo pipefail

REPO="lexiforest/curl-impersonate"
FALLBACK_VERSION="v2.2.2"
BIN_DIR="$(cd "$(dirname "$0")" && pwd)/bin"
mkdir -p "$BIN_DIR"

# ─── Detect arch ──────────────────────────────────────────────────────────────
ARCH=$(uname -m)
case "$ARCH" in
  x86_64)  ARCH_STR="x86_64-linux-gnu" ;;
  aarch64) ARCH_STR="aarch64-linux-gnu" ;;
  armv7l)  ARCH_STR="arm-linux-gnueabihf" ;;
  *)        echo "Unsupported arch: $ARCH"; exit 1 ;;
esac

# ─── Resolve latest tag (or fall back) ────────────────────────────────────────
echo "Resolving latest release from ${REPO}..."
LATEST_TAG=$(curl -fsSL \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/${REPO}/releases/latest" \
  2>/dev/null | grep '"tag_name"' | head -1 \
  | sed 's/.*"tag_name": "\(.*\)".*/\1/') || true

if [ -z "$LATEST_TAG" ]; then
  echo "Warning: could not resolve latest tag, using $FALLBACK_VERSION"
  LATEST_TAG="$FALLBACK_VERSION"
fi

echo "Using curl-impersonate ${LATEST_TAG} for ${ARCH_STR}"

# ─── Download ─────────────────────────────────────────────────────────────────
ASSET="curl-impersonate-${LATEST_TAG}.${ARCH_STR}.tar.gz"
URL="https://github.com/${REPO}/releases/download/${LATEST_TAG}/${ASSET}"

echo "Downloading ${URL}..."
curl -fSL "$URL" -o /tmp/curl-impersonate.tar.gz

# ─── Extract — the v2 release ships a single 'curl-impersonate' binary ────────
echo "Extracting..."
tar -xzf /tmp/curl-impersonate.tar.gz -C "$BIN_DIR"
rm -f /tmp/curl-impersonate.tar.gz

# The v2 tarball ships the binary as 'curl-impersonate' (no version suffix)
BINARY="$BIN_DIR/curl-impersonate"
if [ ! -f "$BINARY" ]; then
  # Fallback: pick any file named curl-impersonate*
  BINARY=$(find "$BIN_DIR" -name "curl-impersonate*" -not -name "*.sh" | head -1)
fi

chmod +x "$BINARY"
ln -sf "$BINARY" "$BIN_DIR/curl-impersonate" 2>/dev/null || true

echo "Verifying binary..."
"$BIN_DIR/curl-impersonate" --version | head -2

# ─── CA bundle ────────────────────────────────────────────────────────────────
if [ ! -f "$BIN_DIR/cacert.pem" ]; then
  echo "Downloading CA bundle..."
  curl -fsSL https://curl.se/ca/cacert.pem -o "$BIN_DIR/cacert.pem"
fi

echo ""
echo "✓  Build complete"
echo "   Binary  : $BIN_DIR/curl-impersonate"
echo "   CA cert : $BIN_DIR/cacert.pem"
echo ""
echo "Available impersonation targets (subset):"
echo "  chrome110 chrome116 chrome119 chrome120 chrome123 chrome124 chrome131 chrome150"
echo ""
echo "Run:  npm start"
