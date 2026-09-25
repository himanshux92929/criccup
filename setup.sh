#!/bin/bash
set -e

echo "Installing npm dependencies..."
npm install

echo "Downloading curl-impersonate-chrome binary..."
mkdir -p bin
RELEASE_URL="https://github.com/lwthiker/curl-impersonate/releases/download/v0.6.1/curl-impersonate-v0.6.1.x86_64-linux-gnu.tar.gz"
curl -L "$RELEASE_URL" -o /tmp/curl-impersonate.tar.gz
tar -xzf /tmp/curl-impersonate.tar.gz -C bin curl-impersonate-chrome
chmod +x bin/curl-impersonate-chrome

echo "Verifying binary..."
./bin/curl-impersonate-chrome --version

echo "Build complete."
