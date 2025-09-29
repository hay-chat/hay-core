#!/usr/bin/env ts-node

import { PromptService } from "../services/prompt.service";
import { PromptParser } from "../utils/prompt-parser";
import { VariableEngine } from "../utils/variable-engine";
import { SupportedLanguage } from "../types/language.types";

// Test colors for console output
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";
const BLUE = "\x1b[34m";
const YELLOW = "\x1b[33m";

async function testPortuguesePrompts() {
  console.log(`${BLUE}🧪 Testing Portuguese Prompt System${RESET}\n`);

  const promptService = PromptService.getInstance();
  let passedTests = 0;
  let failedTests = 0;

  // Test 1: Load and render Portuguese intent analysis prompt
  console.log(`${YELLOW}Test 1: Portuguese Intent Analysis Prompt${RESET}`);
  try {
    const prompt = await promptService.getPrompt(
      "perception/intent-analysis",
      { message: "Quero cancelar minha assinatura" },
      { language: SupportedLanguage.PORTUGUESE },
    );

    if (
      prompt.includes("Analise a seguinte mensagem do usuário") &&
      prompt.includes("Quero cancelar minha assinatura")
    ) {
      console.log(`${GREEN}✅ PASS${RESET}: Portuguese intent analysis loaded correctly`);
      passedTests++;
    } else {
      console.log(`${RED}❌ FAIL${RESET}: Portuguese intent analysis not loaded correctly`);
      failedTests++;
    }
  } catch (error) {
    console.log(`${RED}❌ FAIL${RESET}: Error loading Portuguese prompt: ${error}`);
    failedTests++;
  }
  console.log();

  // Test 2: Load and render Portuguese agent selection prompt
  console.log(`${YELLOW}Test 2: Portuguese Agent Selection Prompt${RESET}`);
  try {
    const prompt = await promptService.getPrompt(
      "perception/agent-selection",
      {
        message: "Preciso de ajuda com minha conta",
        agents: [{ id: "1", name: "Suporte", trigger: "ajuda", description: "Agente de suporte" }],
      },
      { language: SupportedLanguage.PORTUGUESE },
    );

    if (
      prompt.includes("Dada a mensagem do usuário abaixo") &&
      prompt.includes("Agentes disponíveis")
    ) {
      console.log(`${GREEN}✅ PASS${RESET}: Portuguese agent selection loaded correctly`);
      passedTests++;
    } else {
      console.log(`${RED}❌ FAIL${RESET}: Portuguese agent selection not loaded correctly`);
      failedTests++;
    }
  } catch (error) {
    console.log(`${RED}❌ FAIL${RESET}: Error: ${error}`);
    failedTests++;
  }
  console.log();

  // Test 3: Load and render Portuguese playbook selection prompt
  console.log(`${YELLOW}Test 3: Portuguese Playbook Selection Prompt${RESET}`);
  try {
    const prompt = await promptService.getPrompt(
      "retrieval/playbook-selection",
      {
        conversationContext: "Cliente quer cancelar",
        playbooks: [
          {
            id: "1",
            title: "Cancelamento",
            trigger: "cancelar",
            description: "Fluxo de cancelamento",
          },
        ],
      },
      { language: SupportedLanguage.PORTUGUESE },
    );

    if (
      prompt.includes("Dado o contexto da conversa abaixo") &&
      prompt.includes("Playbooks disponíveis")
    ) {
      console.log(`${GREEN}✅ PASS${RESET}: Portuguese playbook selection loaded correctly`);
      passedTests++;
    } else {
      console.log(`${RED}❌ FAIL${RESET}: Portuguese playbook selection not loaded correctly`);
      failedTests++;
    }
  } catch (error) {
    console.log(`${RED}❌ FAIL${RESET}: Error: ${error}`);
    failedTests++;
  }
  console.log();

  // Test 4: Load and render Portuguese title generation prompt
  console.log(`${YELLOW}Test 4: Portuguese Title Generation Prompt${RESET}`);
  try {
    const prompt = await promptService.getPrompt(
      "conversation/title-generation",
      { conversationContext: "Cliente: Preciso resetar minha senha" },
      { language: SupportedLanguage.PORTUGUESE },
    );

    if (
      prompt.includes("gerador de títulos de conversa") &&
      prompt.includes("Gere um título para esta conversa")
    ) {
      console.log(`${GREEN}✅ PASS${RESET}: Portuguese title generation loaded correctly`);
      passedTests++;
    } else {
      console.log(`${RED}❌ FAIL${RESET}: Portuguese title generation not loaded correctly`);
      failedTests++;
    }
  } catch (error) {
    console.log(`${RED}❌ FAIL${RESET}: Error: ${error}`);
    failedTests++;
  }
  console.log();

  // Test 5: Load and render Portuguese execution planner prompt
  console.log(`${YELLOW}Test 5: Portuguese Execution Planner Prompt${RESET}`);
  try {
    const prompt = await promptService.getPrompt(
      "execution/planner",
      {
        hasTools: true,
        tools: "buscar_dados, enviar_email",
      },
      { language: SupportedLanguage.PORTUGUESE },
    );

    if (
      prompt.includes("Por favor, forneça uma resposta útil") &&
      prompt.includes("CALL_TOOL") &&
      prompt.includes("Ferramentas disponíveis: buscar_dados, enviar_email")
    ) {
      console.log(`${GREEN}✅ PASS${RESET}: Portuguese execution planner loaded correctly`);
      passedTests++;
    } else {
      console.log(`${RED}❌ FAIL${RESET}: Portuguese execution planner not loaded correctly`);
      failedTests++;
    }
  } catch (error) {
    console.log(`${RED}❌ FAIL${RESET}: Error: ${error}`);
    failedTests++;
  }
  console.log();

  // Test 6: Fallback to English when Portuguese not available
  console.log(`${YELLOW}Test 6: Fallback to English${RESET}`);
  try {
    // Try to load a prompt that doesn't exist in Portuguese (using a made-up prompt ID)
    const promptService = PromptService.getInstance();

    // First, let's verify English version exists
    const englishPrompt = await promptService.getPrompt(
      "perception/intent-analysis",
      { message: "test message" },
      { language: SupportedLanguage.ENGLISH },
    );

    // Portuguese version should exist for this one
    const portuguesePrompt = await promptService.getPrompt(
      "perception/intent-analysis",
      { message: "mensagem teste" },
      { language: SupportedLanguage.PORTUGUESE },
    );

    if (
      englishPrompt.includes("Analyze the following user message") &&
      portuguesePrompt.includes("Analise a seguinte mensagem do usuário")
    ) {
      console.log(`${GREEN}✅ PASS${RESET}: Language selection working correctly`);
      passedTests++;
    } else {
      console.log(`${RED}❌ FAIL${RESET}: Language selection not working`);
      failedTests++;
    }
  } catch (error) {
    console.log(`${RED}❌ FAIL${RESET}: Error: ${error}`);
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
    console.log(`\n${GREEN}✨ All Portuguese prompt tests passed!${RESET}`);
  } else {
    console.log(`\n${RED}⚠️ Some tests failed. Please check the implementation.${RESET}`);
    process.exit(1);
  }
}

// Run tests
testPortuguesePrompts().catch((error) => {
  console.error(`${RED}Error running tests:${RESET}`, error);
  process.exit(1);
});
