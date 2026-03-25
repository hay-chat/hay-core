#!/bin/zsh
# Update docs based on verification reports using Claude Code CLI
# Usage: ./scripts/update-docs.sh [max_parallel]
#
# Reads reports from tasks/doc-verification/, skips docs that are
# ACCURATE or have empty reports, and launches Claude sessions to
# rewrite the docs that need updating.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DOCS_DIR="$REPO_ROOT/docs"
REPORTS_DIR="$REPO_ROOT/tasks/doc-verification"
MAX_PARALLEL="${1:-3}"  # Lower default — these sessions do more work

LOGS_DIR="$REPO_ROOT/tasks/doc-update-logs"

if [ ! -d "$REPORTS_DIR" ]; then
  echo "Error: No reports found at $REPORTS_DIR"
  echo "Run ./scripts/verify-docs.sh first."
  exit 1
fi

mkdir -p "$LOGS_DIR"

# Collect all doc files
DOC_FILES=("${(@f)$(find "$DOCS_DIR" -name "*.md" -type f | sort)}")

# Categorize docs by report status
DOCS_TO_UPDATE=()
DOCS_ACCURATE=()
DOCS_NO_REPORT=()

for doc_file in "${DOC_FILES[@]}"; do
  relative_path="${doc_file#$DOCS_DIR/}"
  safe_name="${relative_path//\//__}"
  safe_name="${safe_name%.md}"
  report_file="$REPORTS_DIR/${safe_name}.md"

  if [ ! -f "$report_file" ] || [ ! -s "$report_file" ]; then
    DOCS_NO_REPORT+=("$relative_path")
    continue
  fi

  # Check the status line in the report
  report_status=$(grep -o 'ACCURATE\|NEEDS UPDATE\|OUTDATED' "$report_file" | head -1)

  if [ "$report_status" = "ACCURATE" ]; then
    DOCS_ACCURATE+=("$relative_path")
  else
    DOCS_TO_UPDATE+=("$relative_path")
  fi
done

echo "=== Doc Update Plan ==="
echo ""
echo "Accurate (skipping):  ${#DOCS_ACCURATE[@]}"
for doc in "${DOCS_ACCURATE[@]}"; do echo "  ✓ $doc"; done
echo ""
echo "No report (skipping): ${#DOCS_NO_REPORT[@]}"
for doc in "${DOCS_NO_REPORT[@]}"; do echo "  ? $doc"; done
echo ""
echo "Need updates:         ${#DOCS_TO_UPDATE[@]}"
for doc in "${DOCS_TO_UPDATE[@]}"; do echo "  → $doc"; done
echo ""
echo "Max parallel sessions: $MAX_PARALLEL"
echo "Logs directory:       $LOGS_DIR"
echo ""
echo "Tip: tail -f $LOGS_DIR/*.log to watch progress"
echo "---"

if [ ${#DOCS_TO_UPDATE[@]} -eq 0 ]; then
  echo "Nothing to update!"
  exit 0
fi

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
        echo "✓ Done: ${NAMES[$i]}"
      fi
    done
    PIDS=("${new_pids[@]}")
    NAMES=("${new_names[@]}")
    if [ "${#PIDS[@]}" -ge "$MAX_PARALLEL" ]; then
      sleep 2
    fi
  done
}

for relative_path in "${DOCS_TO_UPDATE[@]}"; do
  safe_name="${relative_path//\//__}"
  safe_name="${safe_name%.md}"
  doc_file="$DOCS_DIR/$relative_path"
  report_file="$REPORTS_DIR/${safe_name}.md"

  wait_for_slot

  echo "→ Updating: $relative_path"

  claude -p \
    --output-format text \
    --permission-mode acceptEdits \
    --disallowedTools "Bash" \
    <<PROMPT > "$LOGS_DIR/${safe_name}.log" 2>&1 &
You are rewriting a documentation file to make it accurate based on a verification report.

## Your Task

1. Read the VERIFICATION REPORT at: $report_file
2. Read the CURRENT DOC at: $doc_file
3. Explore the actual codebase to understand the current state for each finding.
4. Rewrite the doc file in place so it accurately reflects the codebase.

## Rules

- Keep the same general structure and writing style of the doc.
- Fix every issue flagged in the report — do not leave known inaccuracies.
- Remove sections that describe features/systems that don't exist in the codebase.
- Add sections for important things that exist but are undocumented, if they fit the doc's scope.
- Keep it concise and practical — this is developer documentation, not marketing.
- Use code examples from the actual codebase when helpful.
- Update any internal links to point to files that actually exist.
- If the doc is so outdated that it's beyond repair, rewrite it from scratch based on what the codebase actually does.
- Write the updated doc directly to: $doc_file

## Important

- Do NOT create new files unless the report specifically suggests a new doc page is needed.
- Do NOT modify any source code — only documentation files under docs/.
- If you need to delete a doc because it's entirely irrelevant, replace its content with a short redirect note pointing to the correct doc, or empty the file and note why.
PROMPT

  PIDS+=($!)
  NAMES+=("$relative_path")
done

echo "---"
echo "Waiting for remaining sessions..."
for i in {1..${#PIDS[@]}}; do
  wait "${PIDS[$i]}" || true
  echo "✓ Done: ${NAMES[$i]}"
done

echo ""
echo "=== All updates complete ==="
echo ""
echo "Review changes with:"
echo "  git diff docs/"
echo ""
echo "Session logs at: $LOGS_DIR/"
echo ""
echo "Check for errors:"
echo "  grep -l 'error\|Error\|failed' $LOGS_DIR/*.log 2>/dev/null"
echo ""
echo "Docs that had no report (may need manual review or re-run verify-docs.sh):"
for doc in "${DOCS_NO_REPORT[@]}"; do echo "  $doc"; done
