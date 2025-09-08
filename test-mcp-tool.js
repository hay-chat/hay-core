#!/usr/bin/env node
/*
 * Test script for MCP tool execution
 * Tests the create_ticket tool from the Zendesk plugin
 */

const { exec } = require('child_process');

const testToolCall = async () => {
  console.log('🧪 Testing MCP tool execution...');
  
  const curlCommand = `curl -X POST http://localhost:3001/v1/conversations.create \\
    -H "Content-Type: application/json" \\
    -H "Authorization: Bearer your-test-token" \\
    -H "x-organization-id: c3578568-c83b-493f-991c-ca2d34a3bd17" \\
    -d '{
      "name": "Test MCP Tool Execution",
      "systemPrompt": "You are a helpful assistant that can create Zendesk tickets.",
      "initialMessage": "Please create a Zendesk ticket with the subject \\"Test Ticket\\" and comment \\"This is a test ticket created via MCP tool execution\\""
    }'`;
  
  exec(curlCommand, (error, stdout, stderr) => {
    if (error) {
      console.error('❌ Error:', error);
      return;
    }
    if (stderr) {
      console.error('❌ stderr:', stderr);
      return;
    }
    
    console.log('✅ Response:', stdout);
  });
};

testToolCall();