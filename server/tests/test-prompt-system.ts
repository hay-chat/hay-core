#!/usr/bin/env ts-node

import { VariableEngine } from "../utils/variable-engine";
import { PromptParser } from "../utils/prompt-parser";

// Test colors for console output
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';
const BLUE = '\x1b[34m';

async function testPromptSystem() {
  console.log(`${BLUE}🧪 Testing Prompt Management System${RESET}\n`);

  let passedTests = 0;
  let failedTests = 0;

  // Test 1: Simple variable replacement
  console.log("Test 1: Simple Variable Replacement");
  const template1 = "Hello {{name}}, welcome to {{place}}!";
  const result1 = VariableEngine.render(template1, { name: "John", place: "Hay" });
  const expected1 = "Hello John, welcome to Hay!";
  if (result1 === expected1) {
    console.log(`${GREEN}✅ PASS${RESET}: ${result1}`);
    passedTests++;
  } else {
    console.log(`${RED}❌ FAIL${RESET}: Expected "${expected1}", got "${result1}"`);
    failedTests++;
  }
  console.log();

  // Test 2: Conditionals
  console.log("Test 2: Conditional Blocks");
  const template2 = "{{#if premium}}Premium features enabled{{else}}Upgrade to premium{{/if}}";
  const result2a = VariableEngine.render(template2, { premium: true });
  const result2b = VariableEngine.render(template2, { premium: false });
  if (result2a === "Premium features enabled" && result2b === "Upgrade to premium") {
    console.log(`${GREEN}✅ PASS${RESET}: Conditionals working`);
    passedTests++;
  } else {
    console.log(`${RED}❌ FAIL${RESET}: Conditionals not working properly`);
    failedTests++;
  }
  console.log();

  // Test 3: Loops
  console.log("Test 3: Loop Blocks");
  const template3 = "Items:{{#each items}} {{item}}{{/each}}";
  const result3 = VariableEngine.render(template3, { items: ["apple", "banana", "orange"] });
  const expected3 = "Items: apple banana orange";
  if (result3 === expected3) {
    console.log(`${GREEN}✅ PASS${RESET}: ${result3}`);
    passedTests++;
  } else {
    console.log(`${RED}❌ FAIL${RESET}: Expected "${expected3}", got "${result3}"`);
    failedTests++;
  }
  console.log();

  // Test 4: Default values
  console.log("Test 4: Default Values");
  const template4 = 'Hello {{name|default:"Guest"}}!';
  const result4a = VariableEngine.render(template4, { name: "Alice" });
  const result4b = VariableEngine.render(template4, {});
  if (result4a === "Hello Alice!" && result4b === "Hello Guest!") {
    console.log(`${GREEN}✅ PASS${RESET}: Default values working`);
    passedTests++;
  } else {
    console.log(`${RED}❌ FAIL${RESET}: Default values not working`);
    failedTests++;
  }
  console.log();

  // Test 5: Nested objects
  console.log("Test 5: Nested Object Access");
  const template5 = "User: {{user.name}} ({{user.email}})";
  const result5 = VariableEngine.render(template5, {
    user: { name: "Bob", email: "bob@example.com" }
  });
  const expected5 = "User: Bob (bob@example.com)";
  if (result5 === expected5) {
    console.log(`${GREEN}✅ PASS${RESET}: ${result5}`);
    passedTests++;
  } else {
    console.log(`${RED}❌ FAIL${RESET}: Expected "${expected5}", got "${result5}"`);
    failedTests++;
  }
  console.log();

  // Test 6: Prompt parser with frontmatter
  console.log("Test 6: Prompt Parser with Frontmatter");
  const promptContent = `---
id: test-prompt
name: Test Prompt
description: A test prompt
version: 1.0.0
---

This is the prompt content with {{variable}}.`;

  const parsed = PromptParser.parsePromptContent(promptContent, "default-id");
  if (
    parsed.metadata.id === "test-prompt" &&
    parsed.metadata.name === "Test Prompt" &&
    parsed.variables.includes("variable") &&
    parsed.content.includes("This is the prompt content")
  ) {
    console.log(`${GREEN}✅ PASS${RESET}: Prompt parser working`);
    console.log(`   Metadata: ${JSON.stringify(parsed.metadata)}`);
    console.log(`   Variables: ${parsed.variables.join(", ")}`);
    passedTests++;
  } else {
    console.log(`${RED}❌ FAIL${RESET}: Prompt parser not working properly`);
    failedTests++;
  }
  console.log();

  // Test 7: Complex template with multiple features
  console.log("Test 7: Complex Template");
  const complexTemplate = `
Hello {{user.name}},

{{#if messages}}
You have {{messages.length}} new messages:
{{#each messages}}
- {{item}}
{{/each}}
{{else}}
No new messages.
{{/if}}

Status: {{status|default:"Active"}}
`;

  const complexResult = VariableEngine.render(complexTemplate, {
    user: { name: "Charlie" },
    messages: ["Welcome!", "Check your settings"],
    status: "Premium"
  });

  const hasExpectedContent = 
    complexResult.includes("Hello Charlie") &&
    complexResult.includes("You have 2 new messages") &&
    complexResult.includes("Welcome!") &&
    complexResult.includes("Check your settings") &&
    complexResult.includes("Status: Premium");

  if (hasExpectedContent) {
    console.log(`${GREEN}✅ PASS${RESET}: Complex template working`);
    passedTests++;
  } else {
    console.log(`${RED}❌ FAIL${RESET}: Complex template not rendering properly`);
    console.log("Result:", complexResult);
    failedTests++;
  }
  console.log();

  // Summary
  console.log("─".repeat(50));
  console.log(`${BLUE}Test Summary:${RESET}`);
  console.log(`${GREEN}Passed: ${passedTests}${RESET}`);
  if (failedTests > 0) {
    console.log(`${RED}Failed: ${failedTests}${RESET}`);
  }
  console.log(`Total: ${passedTests + failedTests}`);
  
  if (failedTests === 0) {
    console.log(`\n${GREEN}✨ All tests passed! The prompt management system is working correctly.${RESET}`);
  } else {
    console.log(`\n${RED}⚠️ Some tests failed. Please check the implementation.${RESET}`);
    process.exit(1);
  }
}

// Run tests
testPromptSystem().catch(error => {
  console.error(`${RED}Error running tests:${RESET}`, error);
  process.exit(1);
});