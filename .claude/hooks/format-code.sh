#!/bin/bash

# PostToolUse hook to automatically format code with Prettier
# Runs after Edit or Write operations

# Read JSON input from stdin
INPUT=$(cat)

# Extract file_path from tool_input using Python
FILE_PATH=$(echo "$INPUT" | python3 -c "
import sys
import json

try:
    data = json.load(sys.stdin)
    tool_input = data.get('tool_input', {})
    file_path = tool_input.get('file_path', '')
    print(file_path)
except:
    sys.exit(1)
")

# Exit if we couldn't extract the file path
if [ -z "$FILE_PATH" ]; then
    exit 0
fi

# Only format code files (TypeScript, JavaScript, Vue, JSON, etc.)
if [[ "$FILE_PATH" =~ \.(ts|tsx|js|jsx|vue|json|css|scss|md|html|yml|yaml)$ ]]; then
    # Run prettier on the file
    npx prettier --write "$FILE_PATH" 2>&1
    exit 0
fi

# For other file types, just exit successfully
exit 0
