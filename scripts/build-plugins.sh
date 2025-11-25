#!/bin/bash

echo "🔨 Building plugins..."

# Build base plugin
echo "📦 Building base plugin..."
cd plugins/base && npm run build && cd ../..

# Build plugins that have manifests with build commands
for plugin_dir in plugins/*/; do
  plugin_name=$(basename "$plugin_dir")
  manifest_file="${plugin_dir}manifest.json"

  # Skip if no manifest exists
  if [ ! -f "$manifest_file" ]; then
    continue
  fi

  # Extract install and build commands from manifest using node
  install_cmd=$(node -e "
    const fs = require('fs');
    const manifest = JSON.parse(fs.readFileSync('$manifest_file', 'utf8'));
    console.log(manifest.capabilities?.mcp?.installCommand || '');
  ")

  build_cmd=$(node -e "
    const fs = require('fs');
    const manifest = JSON.parse(fs.readFileSync('$manifest_file', 'utf8'));
    console.log(manifest.capabilities?.mcp?.buildCommand || '');
  ")

  # Skip if no build command defined
  if [ -z "$build_cmd" ]; then
    continue
  fi

  echo "📦 Building plugin: $plugin_name..."

  # Execute install command if defined
  if [ -n "$install_cmd" ]; then
    if ! (cd "$plugin_dir" && eval "$install_cmd" 2>&1); then
      echo "⚠️  Install failed for $plugin_name, skipping"
      continue
    fi
  fi

  # Execute build command
  if ! (cd "$plugin_dir" && eval "$build_cmd" 2>&1); then
    echo "⚠️  Build failed for $plugin_name, skipping"
    continue
  fi

  echo "✅ Built $plugin_name"
done

echo "✅ All plugins built successfully"
