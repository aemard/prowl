#!/usr/bin/env bash
# Ralph — run fresh-context agent iterations until every prd.json story passes.
# Adapted from https://github.com/snarktank/ralph.
#
# Usage: scripts/ralph/ralph.sh [--tool claude|amp] [max_iterations]
#   RALPH_TIMEOUT   per-iteration timeout (default 60m)
#   RALPH_MODEL     optional model passed to claude --model
#
# Each iteration pipes scripts/ralph/prompt.md to a fresh agent with full tool access.
# Run it only in a disposable sandbox or container.
set -euo pipefail

TOOL="claude"
MAX_ITERATIONS=10
while [[ $# -gt 0 ]]; do
  case "$1" in
    --tool) TOOL="$2"; shift 2 ;;
    --tool=*) TOOL="${1#*=}"; shift ;;
    *) if [[ "$1" =~ ^[0-9]+$ ]]; then MAX_ITERATIONS="$1"; fi; shift ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PROMPT="$SCRIPT_DIR/prompt.md"
LOG_DIR="$SCRIPT_DIR/logs"
TIMEOUT="${RALPH_TIMEOUT:-60m}"
mkdir -p "$LOG_DIR"
cd "$ROOT"

remaining() {
  node -e "const p=require('./prd.json');console.log(p.userStories.filter(s=>!s.passes).length)"
}

for i in $(seq 1 "$MAX_ITERATIONS"); do
  left="$(remaining)"
  if [[ "$left" == "0" ]]; then
    echo "All stories pass."
    exit 0
  fi
  log="$LOG_DIR/iteration-$(date +%Y%m%d-%H%M%S)-$i.log"
  echo "=== Ralph iteration $i/$MAX_ITERATIONS ($TOOL) — $left stories left — log: $log"

  if [[ "$TOOL" == "amp" ]]; then
    timeout "$TIMEOUT" amp --dangerously-allow-all < "$PROMPT" > "$log" 2>&1 || true
  else
    args=(--print --dangerously-skip-permissions)
    if [[ -n "${RALPH_MODEL:-}" ]]; then args+=(--model "$RALPH_MODEL"); fi
    timeout "$TIMEOUT" claude "${args[@]}" < "$PROMPT" > "$log" 2>&1 || true
  fi

  tail -n 20 "$log"
  if grep -q "<promise>COMPLETE</promise>" <(tail -n 5 "$log"); then
    echo "Ralph completed all stories at iteration $i."
    exit 0
  fi
  sleep 2
done

echo "Ralph reached $MAX_ITERATIONS iterations; $(remaining) stories left. See progress.txt."
exit 1
