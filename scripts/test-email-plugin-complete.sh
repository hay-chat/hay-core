#!/bin/bash
set -e

echo "🧪 Complete Email Plugin Integration Test"
echo "=========================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
API_URL="http://localhost:3001"
ORG_ID="test-org-123"
PLUGIN_ID="email"

echo "📋 Test Configuration:"
echo "   API URL: $API_URL"
echo "   Organization ID: $ORG_ID"
echo "   Plugin ID: $PLUGIN_ID"
echo ""

# Test 1: Check server is running
echo "1️⃣  Checking if server is running..."
if curl -s -f "$API_URL/v1/plugin-api/health" -H "Authorization: Bearer invalid" > /dev/null 2>&1; then
    echo -e "   ${RED}✗ Server returned success with invalid token (should be 401)${NC}"
    exit 1
elif curl -s "$API_URL/v1/plugin-api/health" -H "Authorization: Bearer invalid" 2>&1 | grep -q "401"; then
    echo -e "   ${GREEN}✓ Server is running and responding${NC}"
else
    echo -e "   ${RED}✗ Server is not running on $API_URL${NC}"
    echo "   Please start the server with: cd server && npm run dev"
    exit 1
fi
echo ""

# Test 2: Check MCP registration endpoint exists
echo "2️⃣  Checking MCP registration endpoint..."
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
  "$API_URL/v1/plugin-api/mcp/register-local" \
  -H "Content-Type: application/json" \
  -d '{}')

if [ "$RESPONSE" == "401" ]; then
    echo -e "   ${GREEN}✓ MCP registration endpoint exists (401 Unauthorized - expected without token)${NC}"
elif [ "$RESPONSE" == "404" ]; then
    echo -e "   ${RED}✗ MCP registration endpoint not found (404)${NC}"
    echo "   Server needs to be restarted to pick up new routes"
    echo "   Run: rs (in the server terminal)"
    exit 1
else
    echo -e "   ${YELLOW}⚠ Unexpected response: $RESPONSE${NC}"
fi
echo ""

# Test 3: Verify plugin SDK is built
echo "3️⃣  Checking Plugin SDK build..."
if [ -f "packages/plugin-sdk/dist/HayPlugin.js" ]; then
    echo -e "   ${GREEN}✓ Plugin SDK is built${NC}"
else
    echo -e "   ${RED}✗ Plugin SDK not built${NC}"
    echo "   Run: cd packages/plugin-sdk && npm run build"
    exit 1
fi
echo ""

# Test 4: Verify email plugin is built
echo "4️⃣  Checking Email plugin build..."
if [ -f "plugins/core/email/dist/index.js" ]; then
    echo -e "   ${GREEN}✓ Email plugin is built${NC}"
else
    echo -e "   ${RED}✗ Email plugin not built${NC}"
    echo "   Run: cd plugins/core/email && npm run build"
    exit 1
fi
echo ""

# Test 5: Test plugin loading
echo "5️⃣  Testing plugin can load..."
cd plugins/core/email
if node -e "require('./dist/index.js'); console.log('OK')" 2>&1 | grep -q "OK"; then
    echo -e "   ${GREEN}✓ Plugin loads successfully${NC}"
else
    echo -e "   ${RED}✗ Plugin failed to load${NC}"
    exit 1
fi
cd ../../..
echo ""

# Test 6: Test worker spawn with secure environment
echo "6️⃣  Testing worker spawn with secure environment..."
cd plugins/core/email

# Create a minimal test that spawns and immediately exits
cat > /tmp/test-spawn.js << 'EOF'
const { spawn } = require('child_process');

const worker = spawn('node', ['dist/index.js'], {
  cwd: __dirname,
  env: {
    NODE_ENV: 'test',
    PATH: process.env.PATH,
    ORGANIZATION_ID: 'test-org-123',
    PLUGIN_ID: 'email',
    HAY_CAPABILITIES: 'mcp',
    HAY_API_URL: 'http://localhost:3001',
    HAY_API_TOKEN: 'test-token-abc123',
    EMAIL_RECIPIENTS: 'test@example.com'
  },
  stdio: ['pipe', 'pipe', 'pipe']
});

let output = '';
let errors = '';
let mcpInitialized = false;

worker.stdout.on('data', (data) => {
  const text = data.toString();
  output += text;
  if (text.includes('Initializing MCP manager')) {
    mcpInitialized = true;
  }
});

worker.stderr.on('data', (data) => {
  errors += data.toString();
});

// Give it 3 seconds to initialize
setTimeout(() => {
  worker.kill();

  if (mcpInitialized) {
    console.log('✓ Worker spawned and initialized successfully');
    process.exit(0);
  } else {
    console.error('✗ Worker failed to initialize MCP manager');
    console.error('Output:', output);
    console.error('Errors:', errors);
    process.exit(1);
  }
}, 3000);

worker.on('error', (err) => {
  console.error('✗ Failed to spawn worker:', err.message);
  process.exit(1);
});
EOF

if node /tmp/test-spawn.js 2>&1 | grep -q "✓"; then
    echo -e "   ${GREEN}✓ Worker spawns successfully with secure environment${NC}"
else
    echo -e "   ${RED}✗ Worker failed to spawn${NC}"
    exit 1
fi

cd ../../..
echo ""

# Summary
echo "=========================================="
echo -e "${GREEN}✨ All tests passed!${NC}"
echo ""
echo "📝 Next steps:"
echo "   1. Enable email plugin for an organization in the dashboard"
echo "   2. Plugin manager will spawn worker automatically"
echo "   3. Worker will register MCP server via /v1/plugin-api/mcp/register-local"
echo "   4. MCP tools will be available to AI agents"
echo ""
echo "🔍 To test with real plugin manager:"
echo "   - Check plugin discovery: Plugin should appear in dashboard"
echo "   - Enable plugin: Should spawn worker and register tools"
echo "   - Check logs: Look for 'Registering MCP server' messages"
echo ""
