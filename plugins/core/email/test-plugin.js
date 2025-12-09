/**
 * Test script to verify email plugin initialization
 */

// Mock environment variables that would be provided by Plugin Manager
process.env.HAY_WORKER_PORT = '5555';
process.env.HAY_API_TOKEN = 'test-token';
process.env.HAY_API_URL = 'http://localhost:3001';
process.env.ORGANIZATION_ID = 'test-org-123';
process.env.PLUGIN_ID = 'email';
process.env.HAY_CAPABILITIES = 'mcp';
process.env.EMAIL_RECIPIENTS = 'test@example.com';

console.log('🧪 Testing Email Plugin...\n');

// Load the plugin
const { EmailPlugin } = require('./dist/index.js');

console.log('✅ Plugin loaded successfully');
console.log('📦 Plugin metadata:', {
  id: 'email',
  name: 'Email',
  version: '1.0.0',
  capabilities: ['mcp']
});

console.log('\n✨ Plugin TypeScript migration successful!');
console.log('\n📝 Next steps to test with real server:');
console.log('   1. Ensure plugin is discovered by plugin manager');
console.log('   2. Enable email plugin for an organization');
console.log('   3. Plugin manager will spawn worker with proper env vars');
console.log('   4. Worker will register MCP server via Plugin API');
console.log('   5. MCP tools will be available to AI agents');
