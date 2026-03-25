#!/bin/zsh
# Verify all docs in parallel using Claude Code CLI
# Usage: ./scripts/verify-docs.sh [max_parallel]
#
# Each session reads one doc file and checks if its content
# is still accurate against the current codebase.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DOCS_DIR="$REPO_ROOT/docs"
OUTPUT_DIR="$REPO_ROOT/tasks/doc-verification"
MAX_PARALLEL="${1:-5}"  # Default 5 concurrent sessions to avoid rate limits

mkdir -p "$OUTPUT_DIR"

# Collect all markdown files
DOC_FILES=("${(@f)$(find "$DOCS_DIR" -name "*.md" -type f | sort)}")

echo "Found ${#DOC_FILES[@]} doc files to verify"
echo "Max parallel sessions: $MAX_PARALLEL"
echo "Output directory: $OUTPUT_DIR"
echo "---"

# Track background PIDs
PIDS=()
NAMES=()

wait_for_slot() {
  while [ "${#PIDS[@]}" -ge "$MAX_PARALLEL" ]; do
    local new_pids=()
    local new_names=()
    for i in {1..${#PIDS[@]}}; do
      if kill -0 "${PIDS[$i]}" 2>/dev/null; then
        new_pids+=("${PIDS[$i]}")
        new_names+=("${NAMES[$i]}")
      else
        wait "${PIDS[$i]}" || true
        echo "✓ Finished: ${NAMES[$i]}"
      fi
    done
    PIDS=("${new_pids[@]}")
    NAMES=("${new_names[@]}")
    if [ "${#PIDS[@]}" -ge "$MAX_PARALLEL" ]; then
      sleep 2
    fi
  done
}

for doc_file in "${DOC_FILES[@]}"; do
  # Create a safe filename for output
  relative_path="${doc_file#$DOCS_DIR/}"
  safe_name="${relative_path//\//__}"
  safe_name="${safe_name%.md}"
  output_file="$OUTPUT_DIR/${safe_name}.md"

  wait_for_slot

  echo "→ Starting: $relative_path"

  # Launch Claude in non-interactive mode
  claude -p \
    --output-format text \
    <<PROMPT > "$output_file" 2>&1 &
You are reviewing documentation for accuracy.

Read the doc file at: $doc_file

Then explore the actual codebase to verify whether the information in this doc is still correct.

For each section or claim in the doc:
1. Check if the referenced files/paths still exist
2. Check if the described behavior/API/patterns match the current code
3. Check if any features described have been removed or changed

Output a structured report in markdown:

# Doc Verification: $relative_path

## Status: [ACCURATE / NEEDS UPDATE / OUTDATED]

## Summary
(1-2 sentence overall assessment)

## Findings

For each issue found:
### [Section Name]
- **Status**: Accurate / Needs Update / Outdated / Missing Info
- **Issue**: What is wrong or outdated
- **Current State**: What the code actually does now
- **Suggested Fix**: How to update the doc

If everything is accurate, just note that with a brief confirmation.

## Files Checked
(List the key source files you examined)
PROMPT

  PIDS+=($!)
  NAMES+=("$relative_path")
done

# Wait for all remaining
echo "---"
echo "Waiting for remaining sessions to finish..."
for i in {1..${#PIDS[@]}}; do
  wait "${PIDS[$i]}" || true
  echo "✓ Finished: ${NAMES[$i]}"
done

echo ""
echo "=== All verifications complete ==="
echo "Results are in: $OUTPUT_DIR/"
echo ""
echo "To see a summary of files needing updates:"
echo "  grep -l 'NEEDS UPDATE\|OUTDATED' $OUTPUT_DIR/*.md"
