#!/bin/bash
set -e

echo "🔨 Building plugins..."

# Build base plugin
echo "📦 Building base plugin..."
cd plugins/base && npm run build && cd ../..

# Build plugins with MCP subdirectories that have package.json
for plugin_dir in plugins/*/mcp; do
  if [ -f "$plugin_dir/package.json" ]; then
    plugin_name=$(basename $(dirname "$plugin_dir"))
    echo "📦 Building plugin: $plugin_name..."

    # Check if build script exists in the mcp package.json
    if grep -q '"build"' "$plugin_dir/package.json"; then
      (cd "$plugin_dir" && npm install && npm run build)
      echo "✅ Built $plugin_name"
    else
      echo "ℹ️  No build script for $plugin_name, skipping"
    fi
  fi
done

echo "✅ All plugins built successfully"
