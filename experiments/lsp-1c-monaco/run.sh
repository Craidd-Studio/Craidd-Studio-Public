#!/usr/bin/env bash
# Headless-Chrome run of the V10-V12 Monaco probes. Needs node_modules (the repo's
# pinned monaco-editor 0.56.x), google-chrome-stable, python3. Port defaults to 1461:
# never 1420 (AgentIShip) or 1440 (Craidd UI harness).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
out="${PROBE_OUT:-$(mktemp -d)}"
port="${PROBE_PORT:-1461}"
PROBE_OUT="$out" npx vite build --config "$here/vite.config.mjs" >/dev/null
python3 -m http.server "$port" --bind 127.0.0.1 --directory "$out" >/dev/null 2>&1 &
server=$!
trap 'kill "$server" 2>/dev/null || true' EXIT
sleep 1
google-chrome-stable --headless=new --no-sandbox --disable-gpu --user-data-dir="$out/profile" \
  --virtual-time-budget=60000 --dump-dom "http://127.0.0.1:$port/index.html" \
  | python3 -c "import sys,re,html; d=sys.stdin.read(); m=re.search(r'<pre id=\"result\">(.*?)</pre>', d, re.S); print(html.unescape(m.group(1)) if m else d)"
