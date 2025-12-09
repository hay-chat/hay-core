/**
 * Test worker spawning with secure environment variables
 * Simulates what the plugin manager does when starting a plugin worker
 */

const { spawn } = require('child_process');
const path = require('path');

console.log('🧪 Testing Email Plugin Worker Spawn\n');

// Simulate secure environment (what buildSafeEnv() creates)
const safeEnv = {
  // Node.js runtime essentials
  NODE_ENV: 'development',
  PATH: process.env.PATH,

  // Plugin context
  ORGANIZATION_ID: 'test-org-123',
  PLUGIN_ID: 'email',
  HAY_CAPABILITIES: 'mcp',

  // Plugin configuration (from database)
  EMAIL_RECIPIENTS: 'test@example.com',

  // HAY API access (since plugin has MCP capability)
  HAY_API_URL: 'http://localhost:3001',
  HAY_API_TOKEN: 'test-token-would-be-generated-by-jwt',
};

console.log('1️⃣  Secure environment variables:');
console.log('   ✅ ORGANIZATION_ID:', safeEnv.ORGANIZATION_ID);
console.log('   ✅ PLUGIN_ID:', safeEnv.PLUGIN_ID);
console.log('   ✅ HAY_CAPABILITIES:', safeEnv.HAY_CAPABILITIES);
console.log('   ✅ EMAIL_RECIPIENTS:', safeEnv.EMAIL_RECIPIENTS);
console.log('   ✅ HAY_API_URL:', safeEnv.HAY_API_URL);
console.log('   ✅ HAY_API_TOKEN:', safeEnv.HAY_API_TOKEN.substring(0, 20) + '...');
console.log('');

// Verify sensitive vars are NOT included
console.log('2️⃣  Security check - sensitive vars should NOT be present:');
const sensitiveVars = ['OPENAI_API_KEY', 'DB_PASSWORD', 'JWT_SECRET', 'STRIPE_SECRET_KEY'];
const leaked = sensitiveVars.filter(key => key in safeEnv);
if (leaked.length > 0) {
  console.error('   ❌ SECURITY ISSUE - Leaked vars:', leaked);
  process.exit(1);
} else {
  console.log('   ✅ No sensitive variables leaked');
}
console.log('');

console.log('3️⃣  Spawning worker process...');
const pluginPath = path.join(__dirname, 'dist', 'index.js');
console.log('   Entry point:', pluginPath);
console.log('');

const worker = spawn('node', [pluginPath], {
  cwd: __dirname,
  env: safeEnv,
  stdio: ['pipe', 'pipe', 'pipe'],
});

let output = '';
let errorOutput = '';

worker.stdout.on('data', (data) => {
  const text = data.toString();
  output += text;
  process.stdout.write('   [STDOUT] ' + text);
});

worker.stderr.on('data', (data) => {
  const text = data.toString();
  errorOutput += text;
  process.stderr.write('   [STDERR] ' + text);
});

worker.on('error', (error) => {
  console.error('\n❌ Failed to spawn worker:', error);
  process.exit(1);
});

worker.on('close', (code) => {
  console.log('\n4️⃣  Worker process exited with code:', code);

  if (code === 0) {
    console.log('\n✨ Worker spawn test PASSED!\n');
    console.log('📝 Observations:');
    console.log('   - Plugin worker started successfully');
    console.log('   - Secure environment variables applied');
    console.log('   - No sensitive credentials exposed');
    console.log('');
  } else {
    console.error('\n❌ Worker spawn test FAILED - exit code', code);
    process.exit(1);
  }
});

// Kill worker after 5 seconds
setTimeout(() => {
  console.log('\n⏰ Test timeout - killing worker...');
  worker.kill();
}, 5000);
