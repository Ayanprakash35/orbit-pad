#!/bin/sh
# Serve Orbit Pad locally and open it in your browser.
# Uses port 8820, or the next free one if that's taken.
cd "$(dirname "$0")"
PORT=${PORT:-8820}
while lsof -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; do PORT=$((PORT + 1)); done
echo "Orbit Pad: http://localhost:$PORT  (Ctrl+C to stop)"
(sleep 1; open "http://localhost:$PORT") &
exec python3 -m http.server "$PORT"
