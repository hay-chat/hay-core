#!/usr/bin/env node

// Production entry point that sets up module aliases
const path = require('path');

// Register module aliases for production
require('module-alias/register');

// Add path aliases
const moduleAlias = require('module-alias');
moduleAlias.addAliases({
  '@server': path.join(__dirname, 'dist/server'),
  '@plugins': path.join(__dirname, 'dist/plugins')
});

// Set environment
process.env.NODE_ENV = process.env.NODE_ENV || 'production';

// Check for unified mode from environment
if (process.env.UNIFIED_MODE === 'true') {
  console.log('🔄 Starting in UNIFIED MODE');
  // Load unified server (which includes frontend)
  require('./dist/server/unified');
} else {
  console.log('🚀 Starting in SEPARATE MODE');
  // Load regular server (API only)
  require('./dist/server/main');
}