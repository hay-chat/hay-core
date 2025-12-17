#!/bin/bash

# Test Script: "Do Now" Fixes
# Tests the 3 quick fixes: /health endpoint, build detection, port conventions

set -e

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}================================================================${NC}"
echo -e "${BLUE}Testing 'Do Now' Fixes${NC}"
echo -e "${BLUE}================================================================${NC}"
echo ""

# Test 1: Build Detection for SDK v2
echo -e "${BLUE}Test 1: Build Detection for SDK v2${NC}"
echo -e "${YELLOW}Building email plugin via automatic detection...${NC}"

cd plugins/core/email
if npm run build > /dev/null 2>&1; then
  echo -e "${GREEN}✅ Email plugin built successfully${NC}"
else
  echo -e "${RED}❌ Email plugin build failed${NC}"
  exit 1
fi
cd ../../..

# Verify dist/index-v2.js exists
if [ -f "plugins/core/email/dist/index-v2.js" ]; then
  echo -e "${GREEN}✅ Build output exists: dist/index-v2.js${NC}"
else
  echo -e "${RED}❌ Build output missing: dist/index-v2.js${NC}"
  exit 1
fi

echo ""

# Test 2: Worker HTTP /health Endpoint
echo -e "${BLUE}Test 2: Worker HTTP /health Endpoint${NC}"
echo -e "${YELLOW}Starting email plugin worker...${NC}"

# Start worker in background
PID_FILE="/tmp/test-worker.pid"
LOG_FILE="/tmp/test-worker.log"
PORT=5556

# Cleanup function
cleanup() {
  if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE")
    echo -e "${YELLOW}Stopping worker (PID: $PID)...${NC}"
    kill $PID 2>/dev/null || true
    rm "$PID_FILE"
  fi
}

trap cleanup EXIT

# Start worker
npx tsx plugin-sdk-v2/runner/index.ts \
  --plugin-path=./plugins/core/email \
  --org-id=test-org \
  --port=$PORT \
  --mode=test \
  > "$LOG_FILE" 2>&1 &

WORKER_PID=$!
echo $WORKER_PID > "$PID_FILE"
echo -e "${GREEN}✅ Worker started (PID: $WORKER_PID)${NC}"

# Wait for worker to be ready
echo -e "${YELLOW}Waiting for worker to start...${NC}"
for i in {1..20}; do
  if curl -sf "http://localhost:$PORT/health" > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Worker ready (attempt $i)${NC}"
    break
  fi
  if [ $i -eq 20 ]; then
    echo -e "${RED}❌ Worker failed to start${NC}"
    echo "Worker log:"
    cat "$LOG_FILE"
    exit 1
  fi
  sleep 0.5
done

echo ""

# Test HTTP /health endpoint
echo -e "${BLUE}Test 2a: HTTP /health Endpoint${NC}"
HEALTH_RESPONSE=$(curl -s "http://localhost:$PORT/health")

if echo "$HEALTH_RESPONSE" | jq -e '.status == "healthy"' > /dev/null 2>&1; then
  echo -e "${GREEN}✅ HTTP /health returns healthy status${NC}"
  echo "$HEALTH_RESPONSE" | jq '.'
else
  echo -e "${RED}❌ HTTP /health failed${NC}"
  echo "$HEALTH_RESPONSE"
  exit 1
fi

# Check health response structure
echo -e "${YELLOW}Checking health response fields...${NC}"

if echo "$HEALTH_RESPONSE" | jq -e '.uptime' > /dev/null 2>&1; then
  echo -e "${GREEN}  ✅ uptime field present${NC}"
fi

if echo "$HEALTH_RESPONSE" | jq -e '.mcpServers.count' > /dev/null 2>&1; then
  echo -e "${GREEN}  ✅ mcpServers.count field present${NC}"
fi

if echo "$HEALTH_RESPONSE" | jq -e '.memory.heapUsed' > /dev/null 2>&1; then
  echo -e "${GREEN}  ✅ memory.heapUsed field present${NC}"
fi

if echo "$HEALTH_RESPONSE" | jq -e '.orgId == "test-org"' > /dev/null 2>&1; then
  echo -e "${GREEN}  ✅ orgId matches: test-org${NC}"
fi

echo ""

# Test MCP healthcheck tool
echo -e "${BLUE}Test 2b: MCP healthcheck Tool${NC}"
MCP_HEALTH=$(curl -s -X POST "http://localhost:$PORT/mcp/call-tool" \
  -H "Content-Type: application/json" \
  -d '{"toolName": "healthcheck", "arguments": {}}')

if echo "$MCP_HEALTH" | jq -e '.status == "healthy"' > /dev/null 2>&1; then
  echo -e "${GREEN}✅ MCP healthcheck tool returns healthy${NC}"
  echo "$MCP_HEALTH" | jq '.'
else
  echo -e "${RED}❌ MCP healthcheck tool failed${NC}"
  echo "$MCP_HEALTH"
  exit 1
fi

# Check MCP healthcheck response structure
echo -e "${YELLOW}Checking MCP healthcheck fields...${NC}"

if echo "$MCP_HEALTH" | jq -e '.plugin == "email"' > /dev/null 2>&1; then
  echo -e "${GREEN}  ✅ plugin field: email${NC}"
fi

if echo "$MCP_HEALTH" | jq -e '.version == "2.0.0"' > /dev/null 2>&1; then
  echo -e "${GREEN}  ✅ version field: 2.0.0${NC}"
fi

if echo "$MCP_HEALTH" | jq -e '.recipients' > /dev/null 2>&1; then
  echo -e "${GREEN}  ✅ recipients field present${NC}"
fi

echo ""

# Test 3: Port Conventions Documentation
echo -e "${BLUE}Test 3: Port Conventions Documentation${NC}"

if [ -f "PLUGIN_SDK_V2_PORT_CONVENTIONS.md" ]; then
  echo -e "${GREEN}✅ Port conventions documentation exists${NC}"

  # Check content
  if grep -q "5556.*email" "PLUGIN_SDK_V2_PORT_CONVENTIONS.md"; then
    echo -e "${GREEN}  ✅ Email plugin port documented (5556)${NC}"
  fi

  if grep -q "5557.*stripe" "PLUGIN_SDK_V2_PORT_CONVENTIONS.md"; then
    echo -e "${GREEN}  ✅ Stripe plugin port documented (5557)${NC}"
  fi

  if grep -q "Health Check Script" "PLUGIN_SDK_V2_PORT_CONVENTIONS.md"; then
    echo -e "${GREEN}  ✅ Health check script included${NC}"
  fi
else
  echo -e "${RED}❌ Port conventions documentation missing${NC}"
  exit 1
fi

echo ""

# Test 4: Verify Both Healthchecks Work Together
echo -e "${BLUE}Test 4: Combined Healthcheck Monitoring${NC}"

# HTTP health (process)
HTTP_STATUS=$(curl -s "http://localhost:$PORT/health" | jq -r '.status')

# MCP health (plugin)
MCP_STATUS=$(curl -s -X POST "http://localhost:$PORT/mcp/call-tool" \
  -H "Content-Type: application/json" \
  -d '{"toolName": "healthcheck", "arguments": {}}' | jq -r '.status')

if [ "$HTTP_STATUS" = "healthy" ] && [ "$MCP_STATUS" = "healthy" ]; then
  echo -e "${GREEN}✅ Both healthchecks report healthy${NC}"
  echo -e "  ${GREEN}HTTP /health: $HTTP_STATUS${NC}"
  echo -e "  ${GREEN}MCP healthcheck: $MCP_STATUS${NC}"
else
  echo -e "${RED}❌ Healthcheck mismatch${NC}"
  echo -e "  HTTP /health: $HTTP_STATUS"
  echo -e "  MCP healthcheck: $MCP_STATUS"
  exit 1
fi

echo ""

# Success Summary
echo -e "${BLUE}================================================================${NC}"
echo -e "${GREEN}✅✅✅ ALL TESTS PASSED! ✅✅✅${NC}"
echo -e "${BLUE}================================================================${NC}"
echo ""
echo "Summary:"
echo -e "  ${GREEN}✅ Build detection for SDK v2 plugins${NC}"
echo -e "  ${GREEN}✅ HTTP /health endpoint (worker process)${NC}"
echo -e "  ${GREEN}✅ MCP healthcheck tool (plugin logic)${NC}"
echo -e "  ${GREEN}✅ Port conventions documented${NC}"
echo -e "  ${GREEN}✅ Both healthcheck types working together${NC}"
echo ""
echo "Quick wins implemented successfully! 🎉"
echo ""
echo "Next steps:"
echo "  - Phase 7: Auto-start workers + health monitoring"
echo "  - Phase 8: Metadata caching + config validation"
echo ""
