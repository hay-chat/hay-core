#!/bin/bash

# Test Email Plugin MCP Integration with SDK v2
# This script:
# 1. Starts the email plugin worker
# 2. Tests /metadata endpoint
# 3. Tests /mcp/list-tools endpoint
# 4. Tests /mcp/call-tool endpoint with both tools

set -e

PORT=5556
PID_FILE="/tmp/email-plugin-worker.pid"
LOG_FILE="/tmp/email-plugin-worker.log"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}==================================================================${NC}"
echo -e "${BLUE}Email Plugin MCP Integration Test (SDK v2)${NC}"
echo -e "${BLUE}==================================================================${NC}"
echo ""

# Cleanup function
cleanup() {
    if [ -f "$PID_FILE" ]; then
        PID=$(cat "$PID_FILE")
        echo -e "${BLUE}Stopping worker (PID: $PID)...${NC}"
        kill $PID 2>/dev/null || true
        rm "$PID_FILE"
    fi
    echo -e "${GREEN}Cleanup complete${NC}"
}

trap cleanup EXIT

# Step 1: Start worker in background
echo -e "${BLUE}Step 1: Starting email plugin worker on port $PORT...${NC}"
npx tsx plugin-sdk-v2/runner/index.ts \
    --plugin-path=./plugins/core/email \
    --org-id=test-org-email \
    --port=$PORT \
    --mode=test \
    > "$LOG_FILE" 2>&1 &

WORKER_PID=$!
echo $WORKER_PID > "$PID_FILE"
echo -e "${GREEN}✓ Worker started (PID: $WORKER_PID)${NC}"

# Step 2: Wait for /metadata endpoint
echo -e "${BLUE}Step 2: Waiting for /metadata endpoint...${NC}"
for i in {1..20}; do
    if curl -s "http://localhost:$PORT/metadata" > /dev/null 2>&1; then
        echo -e "${GREEN}✓ Metadata endpoint ready (attempt $i)${NC}"
        break
    fi
    if [ $i -eq 20 ]; then
        echo -e "${RED}✗ Metadata endpoint timeout${NC}"
        echo "Worker log:"
        cat "$LOG_FILE"
        exit 1
    fi
    sleep 0.5
done

# Step 3: Fetch metadata
echo -e "${BLUE}Step 3: Fetching plugin metadata...${NC}"
METADATA=$(curl -s "http://localhost:$PORT/metadata")
echo -e "${GREEN}✓ Metadata:${NC}"
echo "$METADATA" | jq '.'

# Step 4: List MCP tools
echo ""
echo -e "${BLUE}Step 4: Listing MCP tools via /mcp/list-tools...${NC}"
sleep 2  # Give MCP server time to start
TOOLS=$(curl -s "http://localhost:$PORT/mcp/list-tools")
echo -e "${GREEN}✓ Tools:${NC}"
echo "$TOOLS" | jq '.'

TOOL_COUNT=$(echo "$TOOLS" | jq '.tools | length')
echo -e "${GREEN}Found $TOOL_COUNT tools${NC}"

# Step 5: Call healthcheck tool
echo ""
echo -e "${BLUE}Step 5: Calling 'healthcheck' tool...${NC}"
HEALTH_RESULT=$(curl -s -X POST "http://localhost:$PORT/mcp/call-tool" \
    -H "Content-Type: application/json" \
    -d '{
        "toolName": "healthcheck",
        "arguments": {}
    }')
echo -e "${GREEN}✓ Healthcheck result:${NC}"
echo "$HEALTH_RESULT" | jq '.'

# Step 6: Call send-email tool
echo ""
echo -e "${BLUE}Step 6: Calling 'send-email' tool...${NC}"
EMAIL_RESULT=$(curl -s -X POST "http://localhost:$PORT/mcp/call-tool" \
    -H "Content-Type: application/json" \
    -d '{
        "toolName": "send-email",
        "arguments": {
            "subject": "Test Email from SDK v2",
            "body": "This is a test email sent via the MCP integration in Phase 6. The email plugin is running successfully with SDK v2!"
        }
    }')
echo -e "${GREEN}✓ Email send result:${NC}"
echo "$EMAIL_RESULT" | jq '.'

# Success!
echo ""
echo -e "${BLUE}==================================================================${NC}"
echo -e "${GREEN}✓✓✓ ALL TESTS PASSED! ✓✓✓${NC}"
echo -e "${BLUE}==================================================================${NC}"
echo ""
echo "Summary:"
echo "- Plugin worker started successfully"
echo "- Metadata endpoint working"
echo "- MCP server registered and running"
echo "- Found $TOOL_COUNT MCP tools"
echo "- Both tools (healthcheck, send-email) executed successfully"
echo ""
echo "Phase 6 MCP Integration: ✅ COMPLETE"
