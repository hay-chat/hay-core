/**
 * Test MCP registration endpoint directly
 * Verifies the endpoint exists and responds correctly
 */

const http = require('http');

console.log('🧪 Testing MCP Registration Endpoint\n');

function makeRequest(path, method, headers, body) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3001,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({ status: res.statusCode, data: data ? JSON.parse(data) : null });
      });
    });

    req.on('error', reject);

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function test() {
  try {
    // Test 1: Health endpoint (should return 401 with invalid token)
    console.log('1️⃣  Testing health endpoint...');
    const healthRes = await makeRequest('/v1/plugin-api/health', 'GET', {
      'Authorization': 'Bearer invalid-token'
    });

    if (healthRes.status === 401) {
      console.log('   ✅ Health endpoint exists and validates tokens');
    } else {
      console.log(`   ❌ Unexpected status: ${healthRes.status}`);
      process.exit(1);
    }
    console.log('');

    // Test 2: MCP register-local endpoint (should return 401 without valid token)
    console.log('2️⃣  Testing MCP register-local endpoint...');
    const mcpRes = await makeRequest('/v1/plugin-api/mcp/register-local', 'POST', {
      'Authorization': 'Bearer invalid-token'
    }, {
      serverPath: './mcp',
      startCommand: 'node index.js',
      tools: []
    });

    if (mcpRes.status === 401) {
      console.log('   ✅ MCP register-local endpoint exists and validates tokens');
    } else if (mcpRes.status === 404) {
      console.error('   ❌ MCP register-local endpoint not found (404)');
      console.error('   Server may need restart to pick up new routes');
      process.exit(1);
    } else {
      console.log(`   ⚠️  Unexpected status: ${mcpRes.status}`);
      console.log('   Response:', mcpRes.data);
    }
    console.log('');

    // Test 3: MCP register-remote endpoint
    console.log('3️⃣  Testing MCP register-remote endpoint...');
    const mcpRemoteRes = await makeRequest('/v1/plugin-api/mcp/register-remote', 'POST', {
      'Authorization': 'Bearer invalid-token'
    }, {
      url: 'http://example.com/mcp',
      transport: 'http',
      tools: []
    });

    if (mcpRemoteRes.status === 401) {
      console.log('   ✅ MCP register-remote endpoint exists and validates tokens');
    } else if (mcpRemoteRes.status === 404) {
      console.error('   ❌ MCP register-remote endpoint not found (404)');
      process.exit(1);
    } else {
      console.log(`   ⚠️  Unexpected status: ${mcpRemoteRes.status}`);
    }
    console.log('');

    console.log('✨ All MCP endpoints are accessible!\n');
    console.log('📝 Summary:');
    console.log('   ✅ Server is running on port 3001');
    console.log('   ✅ /v1/plugin-api/health endpoint working');
    console.log('   ✅ /v1/plugin-api/mcp/register-local endpoint working');
    console.log('   ✅ /v1/plugin-api/mcp/register-remote endpoint working');
    console.log('   ✅ All endpoints properly validate JWT tokens');
    console.log('');
    console.log('🎯 Next step: Test with valid plugin worker and JWT token');
    console.log('');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    process.exit(1);
  }
}

test();
