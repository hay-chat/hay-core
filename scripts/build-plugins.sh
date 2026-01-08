#!/bin/bash

echo "Building plugins..."

# Build plugins that have hay-plugin section in package.json
for plugin_dir in plugins/core/*/; do
  plugin_name=$(basename "$plugin_dir")
  package_file="${plugin_dir}package.json"

  # Skip if no package.json exists
  if [ ! -f "$package_file" ]; then
    continue
  fi

  # Check if package.json has hay-plugin section
  has_hay_plugin=$(node -e "
    const fs = require('fs');
    const pkg = JSON.parse(fs.readFileSync('$package_file', 'utf8'));
    console.log(pkg['hay-plugin'] ? 'true' : 'false');
  ")

  # Skip if no hay-plugin section
  if [ "$has_hay_plugin" != "true" ]; then
    continue
  fi

  # Check if build script exists
  has_build=$(node -e "
    const fs = require('fs');
    const pkg = JSON.parse(fs.readFileSync('$package_file', 'utf8'));
    console.log(pkg.scripts?.build ? 'true' : 'false');
  ")

  # Skip if no build script
  if [ "$has_build" != "true" ]; then
    echo "Skipping $plugin_name (no build script)"
    continue
  fi

  echo "Building plugin: $plugin_name..."

  # Install dependencies if node_modules doesn't exist
  if [ ! -d "${plugin_dir}node_modules" ]; then
    if ! (cd "$plugin_dir" && npm install 2>&1); then
      echo "  Install failed for $plugin_name, skipping"
      continue
    fi
  fi

  # Run build
  if ! (cd "$plugin_dir" && npm run build 2>&1); then
    echo "  Build failed for $plugin_name, skipping"
    continue
  fi

  echo "  Built $plugin_name"
done

echo ""
echo "All plugins built successfully"
echo ""
echo "Plugin UI assets are served directly from plugins/ directory"
echo "No copying needed - changes are reflected immediately after rebuild"
