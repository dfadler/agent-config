#!/usr/bin/env bash
# Set up the directory structure for one eval run (with_skill only).
#
# Usage:
#   setup_eval.sh <iteration_dir> <eval_name> <eval_id> <prompt>
#
# Example:
#   setup_eval.sh iteration-3 vite-audit 1 "Audit GitHub Actions for vitejs/vite..."
#
# Creates:
#   <iteration_dir>/<eval_name>/with_skill/outputs/
#   <iteration_dir>/<eval_name>/with_skill/eval_metadata.json

set -euo pipefail

if [[ $# -lt 4 ]]; then
  echo "Usage: $0 <iteration_dir> <eval_name> <eval_id> <prompt>" >&2
  exit 1
fi

ITERATION_DIR="$1"
EVAL_NAME="$2"
EVAL_ID="$3"
PROMPT="$4"

DIR="$ITERATION_DIR/$EVAL_NAME/with_skill"
mkdir -p "$DIR/outputs"
cat >"$DIR/eval_metadata.json" <<EOF
{
  "eval_id": $EVAL_ID,
  "eval_name": "$EVAL_NAME",
  "prompt": $(python3 -c "import json,sys; print(json.dumps(sys.argv[1]))" "$PROMPT"),
  "assertions": []
}
EOF
echo "Created: $DIR/eval_metadata.json"
