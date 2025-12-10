#!/usr/bin/env ts-node
/**
 * Test script to verify plugin metadata loading from package.json
 */

const { existsSync, readFileSync } = require('fs');
const { join } = require('path');

const PLUGINS_DIR = join(__dirname, '..', 'plugins', 'core');
const EXPECTED_PLUGINS = [
  '@hay/plugin-hubspot',
  '@hay/email-plugin',
  '@hay/plugin-stripe',
  '@hay/plugin-zendesk',
  '@hay/plugin-shopify',
  '@hay/plugin-woocommerce',
  '@hay/plugin-magento',
  '@hay/plugin-judo-in-cloud',
];

interface HayPluginConfig {
  entry: string;
  displayName: string;
  category: string;
  capabilities: string[];
  env: string[];
  config?: Record<string, any>;
}

interface PackageJson {
  name: string;
  version: string;
  description: string;
  author: string;
  'hay-plugin': HayPluginConfig;
}

console.log('🔍 Testing Plugin Metadata Loading\n');

let passed = 0;
let failed = 0;

for (const expectedId of EXPECTED_PLUGINS) {
  // Handle special case for email plugin which is just "email", not "email-plugin"
  let pluginName = expectedId.replace('@hay/plugin-', '').replace('@hay/', '');
  if (pluginName === 'email-plugin') {
    pluginName = 'email';
  }
  const packageJsonPath = join(PLUGINS_DIR, pluginName, 'package.json');
  const distPath = join(PLUGINS_DIR, pluginName, 'dist', 'index.js');

  console.log(`\n📦 Testing ${expectedId}...`);

  // Check if package.json exists
  if (!existsSync(packageJsonPath)) {
    console.log(`  ❌ package.json not found at ${packageJsonPath}`);
    failed++;
    continue;
  }

  // Check if built
  if (!existsSync(distPath)) {
    console.log(`  ❌ Built file not found at ${distPath}`);
    failed++;
    continue;
  }

  // Read and validate package.json
  const packageJson: PackageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));

  // Validate structure
  const errors: string[] = [];

  if (packageJson.name !== expectedId) {
    errors.push(`  ❌ Package name mismatch: expected ${expectedId}, got ${packageJson.name}`);
  }

  if (!packageJson['hay-plugin']) {
    errors.push(`  ❌ Missing 'hay-plugin' configuration`);
  } else {
    const hayPlugin = packageJson['hay-plugin'];

    if (!hayPlugin.entry) {
      errors.push(`  ❌ Missing 'hay-plugin.entry'`);
    }

    if (!hayPlugin.displayName) {
      errors.push(`  ❌ Missing 'hay-plugin.displayName'`);
    }

    if (!hayPlugin.category) {
      errors.push(`  ❌ Missing 'hay-plugin.category'`);
    }

    if (!hayPlugin.capabilities || !Array.isArray(hayPlugin.capabilities)) {
      errors.push(`  ❌ Missing or invalid 'hay-plugin.capabilities' (should be array)`);
    }

    if (!Array.isArray(hayPlugin.env)) {
      errors.push(`  ❌ Missing or invalid 'hay-plugin.env' (should be array)`);
    }

    // Check for old 'id' field that should be removed
    if ((hayPlugin as any).id) {
      errors.push(`  ⚠️  Found deprecated 'hay-plugin.id' field (should be removed)`);
    }
  }

  if (errors.length > 0) {
    console.log(errors.join('\n'));
    failed++;
  } else {
    console.log(`  ✅ Package structure valid`);
    console.log(`  ✅ Display name: ${packageJson['hay-plugin'].displayName}`);
    console.log(`  ✅ Category: ${packageJson['hay-plugin'].category}`);
    console.log(`  ✅ Capabilities: ${packageJson['hay-plugin'].capabilities.join(', ')}`);
    console.log(`  ✅ Env vars: ${packageJson['hay-plugin'].env.length > 0 ? packageJson['hay-plugin'].env.join(', ') : 'none'}`);
    console.log(`  ✅ Built successfully`);
    passed++;
  }
}

console.log(`\n${'='.repeat(50)}`);
console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);

if (failed === 0) {
  console.log('\n✅ All plugins validated successfully!\n');
  process.exit(0);
} else {
  console.log('\n❌ Some plugins failed validation\n');
  process.exit(1);
}
