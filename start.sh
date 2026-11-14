#!/usr/bin/env bash
# Builds and starts Expense Copilot on http://127.0.0.1:8090
#   ./start.sh                      scripted agent (no key needed)
#   GEMINI_API_KEY=... ./start.sh   live Gemini agent (set the key in your own terminal)
set -euo pipefail
cd "$(dirname "$0")"
export PATH="$HOME/.local/node/bin:$HOME/.local/bin:$PATH"

if [[ ! -x .venv/bin/python ]]; then
  uv venv -q -p 3.12 .venv
  uv pip install -q -p .venv/bin/python -r server/requirements.txt
fi
.venv/bin/python catalog/build_catalog.py
(cd web && { [[ -d node_modules ]] || npm install --no-fund --no-audit --loglevel=error; } && npm run --silent build)

echo "Expense Copilot: http://127.0.0.1:${PORT:-8090}  ($([[ -n "${GEMINI_API_KEY:-}" ]] && echo "live Gemini" || echo "scripted agent"))"
exec .venv/bin/python -m uvicorn server.app:app --host 127.0.0.1 --port "${PORT:-8090}"
