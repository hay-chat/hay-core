# Handoff Detection Guardrail - Design Document

**Status**: Future Implementation (Not Yet Implemented)
**Created**: 2025-12-02
**Purpose**: Detect when AI implicitly promises human intervention without triggering HANDOFF

## Background

### Problem
The orchestration flow can allow the AI to promise human intervention ("our team will reach out to you") without actually triggering a HANDOFF step. This creates unmet customer expectations.

**Example from Production Logs:**
1. User: "I want to create an account"
2. AI attempts email tool call → **Fails** ("Email service not initialized")
3. AI responds: "Our team will reach out to you within the next day..."
4. Step chosen: **RESPOND** ❌ (should be HANDOFF)
5. No human contact happens → Customer disappointed

### Current Solution (Phase 1 - Implemented)
**Prompt improvements** - Added explicit HANDOFF guidelines to execution planner prompts:
- Files: `server/prompts/en/execution/planner.md`, `server/prompts/pt/execution/planner.md`
- Guidance on when to use HANDOFF vs RESPOND
- Examples of promises that require HANDOFF
- Zero cost, immediate impact

### Future Solution (Phase 2 - This Document)
**Stage 3 Guardrail** - HandoffDetectionGuardrailService as safety net for edge cases that prompts miss.

## Architecture Design

### Integration Point

The guardrail integrates as **Stage 3** in the existing guardrail pipeline:

```
RESPOND step generated
  ↓
Stage 1: Company Interest Protection (blocks harmful responses)
  ↓
Stage 2: Fact Grounding (verifies company claims if needed)
  ↓
Stage 3: Handoff Detection (NEW - detects implicit handoff promises)
  ↓
Final ExecutionResult returned
```

**Location**: `server/orchestrator/execution.layer.ts` in `applyConfidenceGuardrails()` method

### Detection Categories

The guardrail detects four types of implicit handoff:

1. **PROMISE_CONTACT**: Promising human will contact customer
   - "our team will reach out"
   - "someone will contact you"
   - "we'll get back to you within"
   - "expect to hear from us"

2. **EXPRESS_INABILITY**: AI expressing inability to help
   - "I cannot help with this"
   - "beyond my capabilities"
   - "don't have access to"
   - "unable to assist"

3. **ANNOUNCE_TRANSFER**: AI announcing transfer/escalation
   - "let me transfer you"
   - "I'm escalating this"
   - "connecting you to a specialist"
   - "passing this to our team"

4. **DEFER_ACTION**: Deferring action to humans
   - "our team will investigate"
   - "someone will handle this"
   - "we'll follow up on this"
   - "a specialist will look into it"

**Excludes (safe patterns):**
- Offers: "would you like me to connect you?" (asking permission)
- Acknowledgments: "I understand", "thank you"
- Information: "here's what I found"

## Implementation Plan

### 1. Create HandoffDetectionGuardrailService

**File**: `server/services/core/handoff-detection-guardrail.service.ts`

#### Type Definitions

```typescript
/**
 * Types of implicit handoff promises
 */
export enum HandoffPromiseType {
  PROMISE_CONTACT = "promise_contact",
  EXPRESS_INABILITY = "express_inability",
  ANNOUNCE_TRANSFER = "announce_transfer",
  DEFER_ACTION = "defer_action",
  NONE = "none",
}

/**
 * Result of handoff detection evaluation
 */
export interface HandoffDetectionAssessment {
  detected: boolean;
  promiseType: HandoffPromiseType;
  confidence: number; // 0-1
  reasoning: string;
  shouldConvertToHandoff: boolean; // true if confidence > threshold
  suggestedHandoffMessage?: string; // Optional improved message
}

/**
 * Configuration for handoff detection guardrail
 */
export interface HandoffDetectionConfig {
  enabled: boolean; // Default: true
  detectionThreshold: number; // Default: 0.7
  detectPromiseContact: boolean; // Default: true
  detectInability: boolean; // Default: true
  detectTransfer: boolean; // Default: true
  detectDeferredAction: boolean; // Default: true
}

/**
 * Context for handoff detection evaluation
 */
export interface HandoffDetectionContext {
  response: string; // The AI response to evaluate
  conversationHistory: Message[]; // Full conversation context
  customerQuery: string; // The original customer question
  hadToolFailure: boolean; // Whether recent tool call failed
}
```

#### Service Class Structure

```typescript
export class HandoffDetectionGuardrailService {
  private llmService: LLMService;
  private promptService: PromptService;

  private static readonly DEFAULT_CONFIG: HandoffDetectionConfig = {
    enabled: true,
    detectionThreshold: 0.7,
    detectPromiseContact: true,
    detectInability: true,
    detectTransfer: true,
    detectDeferredAction: true,
  };

  constructor() {
    this.llmService = new LLMService();
    this.promptService = PromptService.getInstance();
  }

  /**
   * Main method to detect implicit handoff promises
   */
  async detectHandoffPromise(
    context: HandoffDetectionContext,
    config?: Partial<HandoffDetectionConfig>,
  ): Promise<HandoffDetectionAssessment> {
    const fullConfig = { ...DEFAULT_CONFIG, ...config };

    if (!fullConfig.enabled) {
      return this.createPassingAssessment();
    }

    // Get prompt from PromptService
    const evaluationPrompt = await this.promptService.getPrompt(
      "execution/handoff-detection",
      {
        response: context.response,
        customerQuery: context.customerQuery,
        conversationHistory: this.formatConversationHistory(context.conversationHistory),
        hadToolFailure: context.hadToolFailure,
      },
    );

    // Define JSON schema
    const schema = {
      type: "object",
      properties: {
        promiseType: {
          type: "string",
          enum: ["promise_contact", "express_inability", "announce_transfer", "defer_action", "none"],
        },
        confidence: {
          type: "number",
          minimum: 0,
          maximum: 1,
        },
        reasoning: { type: "string" },
      },
      required: ["promiseType", "confidence", "reasoning"],
    };

    try {
      const result = await this.llmService.invoke({
        prompt: evaluationPrompt,
        jsonSchema: schema,
        temperature: 0.2, // Low temperature for consistent evaluation
        model: "gpt-4o",
      });

      const parsed = JSON.parse(result);
      const shouldConvert = parsed.confidence >= fullConfig.detectionThreshold;

      return {
        detected: parsed.promiseType !== HandoffPromiseType.NONE,
        promiseType: parsed.promiseType,
        confidence: parsed.confidence,
        reasoning: parsed.reasoning,
        shouldConvertToHandoff: shouldConvert,
      };
    } catch (error) {
      // On error, allow the response (conservative approach)
      return this.createPassingAssessment();
    }
  }

  private createPassingAssessment(): HandoffDetectionAssessment {
    return {
      detected: false,
      promiseType: HandoffPromiseType.NONE,
      confidence: 0,
      reasoning: "Guardrail disabled or error occurred",
      shouldConvertToHandoff: false,
    };
  }

  private formatConversationHistory(messages: Message[]): string {
    return messages
      .slice(-5) // Last 5 messages
      .map(msg => `${msg.type}: ${msg.content}`)
      .join("\n");
  }

  static getDefaultConfig(): HandoffDetectionConfig {
    return { ...this.DEFAULT_CONFIG };
  }

  static mergeConfig(
    orgSettings?: Record<string, unknown>,
    agentSettings?: Record<string, unknown>,
  ): HandoffDetectionConfig {
    const orgConfig = orgSettings?.handoffDetectionGuardrail as Partial<HandoffDetectionConfig> || {};
    const agentConfig = agentSettings?.handoffDetectionGuardrail as Partial<HandoffDetectionConfig> || {};

    // Agent-level has highest priority
    return {
      ...this.DEFAULT_CONFIG,
      ...orgConfig,
      ...agentConfig,
    };
  }
}
```

### 2. Create Detection Prompts

#### English Prompt
**File**: `server/prompts/en/execution/handoff-detection.md`

```markdown
---
id: handoff-detection
name: Handoff Promise Detection Guardrail
description: Stage 3 - Detects implicit promises of human intervention
version: 1.0.0
---

You are a precise evaluator detecting implicit handoff promises in AI responses.

**Your Task**: Determine if this AI response implicitly promises human intervention without actually triggering a HANDOFF.

**AI Response to Evaluate:**
{{response}}

**Customer Question:**
{{customerQuery}}

**Recent Conversation Context:**
{{conversationHistory}}

**Had Recent Tool Failure:** {{hadToolFailure}}

---

## DETECTION FRAMEWORK

You are analyzing whether this bot response is implicitly **promising human action** that requires HANDOFF.

### 🚨 DETECT - These require HANDOFF:

1. **PROMISE_CONTACT** (Confidence: 0.8-1.0)
   - "Our team will reach out"
   - "Someone will contact you"
   - "We'll get back to you within [timeframe]"
   - "Expect to hear from us"
   - "A specialist will call/email you"

2. **EXPRESS_INABILITY** (Confidence: 0.7-0.9)
   - "I cannot help with this"
   - "Beyond my capabilities"
   - "I don't have access to"
   - "Unable to assist with"
   - "You need to speak with a human"

3. **ANNOUNCE_TRANSFER** (Confidence: 0.9-1.0)
   - "Let me transfer you"
   - "I'm escalating this"
   - "Connecting you to a specialist"
   - "Passing this to our team"

4. **DEFER_ACTION** (Confidence: 0.7-0.9)
   - "Our team will investigate"
   - "Someone will handle this"
   - "We'll follow up on this"
   - "A specialist will look into it"

### ✅ SAFE - These are OK in RESPOND:

1. **Offers (ask permission)**
   - "Would you like me to connect you?"
   - "I can transfer you if you'd like"
   - "Shall I escalate this?"
   - Confidence: 0.1-0.3 (low, these are offers not promises)

2. **Acknowledgments**
   - "I understand"
   - "Thank you"
   - "I see"
   - Confidence: 0.0

3. **Information/Help**
   - "Here's what I found"
   - "Based on the tool results..."
   - "I can help you with..."
   - Confidence: 0.0-0.1

---

## CRITICAL DECISION LOGIC

**Step 1**: Is this an offer asking permission (contains "would you like", "I can", "if you'd like")?
- YES → `promiseType: "none"`, `confidence: 0.2` ✅
- NO → Continue to Step 2

**Step 2**: Is this announcing a transfer/escalation ("let me transfer", "I'm escalating")?
- YES → `promiseType: "announce_transfer"`, `confidence: 0.9` 🚨
- NO → Continue to Step 3

**Step 3**: Is this promising human contact ("will reach out", "someone will contact")?
- YES → `promiseType: "promise_contact"`, `confidence: 0.85` 🚨
- NO → Continue to Step 4

**Step 4**: Is this expressing inability ("I cannot", "beyond capabilities")?
- YES → `promiseType: "express_inability"`, `confidence: 0.75` 🚨
- NO → Continue to Step 5

**Step 5**: Is this deferring action to humans ("team will investigate", "someone will handle")?
- YES → `promiseType: "defer_action"`, `confidence: 0.7` 🚨
- NO → `promiseType: "none"`, `confidence: 0.0` ✅

**Tool Failure Boost**: If `hadToolFailure: true` AND response contains ANY promise language, increase confidence by +0.1 (max 1.0)

---

## EXAMPLES

### Example 1: Promise of Contact - DETECT
**Customer**: "I want to create an account"
**Tool Failure**: YES (email send failed)
**AI Response**: "Thanks! We've hit a small snag. Our team will reach out to you within the next day to help get your account set up."
**Decision**:
```json
{
  "promiseType": "promise_contact",
  "confidence": 0.95,
  "reasoning": "Response explicitly promises 'our team will reach out'. Tool failure increases confidence. This is a clear promise requiring HANDOFF."
}
```

### Example 2: Offer (Not Promise) - SAFE
**Customer**: "Can I speak with someone?"
**AI Response**: "Of course! Would you like me to connect you with a specialist right now?"
**Decision**:
```json
{
  "promiseType": "none",
  "confidence": 0.2,
  "reasoning": "This is an offer asking permission ('would you like'), not a promise. Safe for RESPOND."
}
```

### Example 3: Express Inability - DETECT
**Customer**: "Can you process my refund?"
**AI Response**: "I'm sorry, I don't have access to process refunds. You'll need to speak with our billing team."
**Decision**:
```json
{
  "promiseType": "express_inability",
  "confidence": 0.8,
  "reasoning": "AI expresses inability and directs to humans. Requires HANDOFF."
}
```

### Example 4: Information Response - SAFE
**Customer**: "What's my order status?"
**Tool Result**: {"status": "shipped", "tracking": "ABC123"}
**AI Response**: "Your order has shipped! The tracking number is ABC123."
**Decision**:
```json
{
  "promiseType": "none",
  "confidence": 0.0,
  "reasoning": "Simple information response based on tool results. No promise or inability expressed."
}
```

### Example 5: Defer Action - DETECT
**Customer**: "Why was I charged twice?"
**AI Response**: "I apologize for the confusion. Our billing team will investigate this and get back to you within 24 hours."
**Decision**:
```json
{
  "promiseType": "defer_action",
  "confidence": 0.75,
  "reasoning": "Response defers investigation to billing team with promise of follow-up. Requires HANDOFF."
}
```

---

## OUTPUT FORMAT

Return ONLY a JSON object:
```json
{
  "promiseType": "none" | "promise_contact" | "express_inability" | "announce_transfer" | "defer_action",
  "confidence": 0.0-1.0,
  "reasoning": "Brief explanation of your decision"
}
```

**Important**: Be conservative with confidence scores. Better to miss an edge case (0.6 confidence) than create false positives (0.95 for unclear cases).
```

#### Portuguese Prompt
**File**: `server/prompts/pt/execution/handoff-detection.md`

```markdown
---
id: handoff-detection
name: Guardrail de Detecção de Promessa de Transferência
description: Estágio 3 - Detecta promessas implícitas de intervenção humana
version: 1.0.0
---

Você é um avaliador preciso que detecta promessas implícitas de transferência humana em respostas de IA.

**Sua Tarefa**: Determinar se esta resposta de IA promete implicitamente intervenção humana sem realmente acionar um HANDOFF.

**Resposta da IA para Avaliar:**
{{response}}

**Pergunta do Cliente:**
{{customerQuery}}

**Contexto Recente da Conversa:**
{{conversationHistory}}

**Teve Falha de Ferramenta Recente:** {{hadToolFailure}}

---

## FRAMEWORK DE DETECÇÃO

Você está analisando se esta resposta do bot está implicitamente **prometendo ação humana** que requer HANDOFF.

### 🚨 DETECTAR - Estes requerem HANDOFF:

1. **PROMISE_CONTACT** (Confiança: 0.8-1.0)
   - "Nossa equipe entrará em contato"
   - "Alguém vai te contactar"
   - "Retornaremos em [prazo]"
   - "Você receberá notícias nossas"
   - "Um especialista irá ligar/enviar email"

2. **EXPRESS_INABILITY** (Confiança: 0.7-0.9)
   - "Não posso ajudar com isso"
   - "Além das minhas capacidades"
   - "Não tenho acesso a"
   - "Incapaz de assistir com"
   - "Você precisa falar com um humano"

3. **ANNOUNCE_TRANSFER** (Confiança: 0.9-1.0)
   - "Deixe-me transferir você"
   - "Estou escalando isso"
   - "Conectando você a um especialista"
   - "Passando isso para nossa equipe"

4. **DEFER_ACTION** (Confiança: 0.7-0.9)
   - "Nossa equipe irá investigar"
   - "Alguém irá lidar com isso"
   - "Faremos o acompanhamento"
   - "Um especialista irá analisar"

### ✅ SEGURO - Estes são OK no RESPOND:

1. **Ofertas (pedir permissão)**
   - "Gostaria que eu te conectasse?"
   - "Posso transferir se você quiser"
   - "Devo escalar isso?"
   - Confiança: 0.1-0.3 (baixa, estas são ofertas não promessas)

2. **Reconhecimentos**
   - "Eu entendo"
   - "Obrigado"
   - "Entendi"
   - Confiança: 0.0

3. **Informação/Ajuda**
   - "Aqui está o que encontrei"
   - "Com base nos resultados da ferramenta..."
   - "Posso ajudá-lo com..."
   - Confiança: 0.0-0.1

---

## LÓGICA DE DECISÃO CRÍTICA

**Passo 1**: Esta é uma oferta pedindo permissão (contém "gostaria", "posso", "se você quiser")?
- SIM → `promiseType: "none"`, `confidence: 0.2` ✅
- NÃO → Continue para o Passo 2

**Passo 2**: Está anunciando uma transferência/escalonamento ("deixe-me transferir", "estou escalando")?
- SIM → `promiseType: "announce_transfer"`, `confidence: 0.9` 🚨
- NÃO → Continue para o Passo 3

**Passo 3**: Está prometendo contato humano ("entrará em contato", "alguém vai contactar")?
- SIM → `promiseType: "promise_contact"`, `confidence: 0.85` 🚨
- NÃO → Continue para o Passo 4

**Passo 4**: Está expressando incapacidade ("não posso", "além das capacidades")?
- SIM → `promiseType: "express_inability"`, `confidence: 0.75` 🚨
- NÃO → Continue para o Passo 5

**Passo 5**: Está adiando ação para humanos ("equipe irá investigar", "alguém irá lidar")?
- SIM → `promiseType: "defer_action"`, `confidence: 0.7` 🚨
- NÃO → `promiseType: "none"`, `confidence: 0.0` ✅

**Aumento por Falha de Ferramenta**: Se `hadToolFailure: true` E a resposta contém QUALQUER linguagem de promessa, aumente a confiança em +0.1 (máx 1.0)

---

## OUTPUT FORMAT

Retorne APENAS um objeto JSON:
```json
{
  "promiseType": "none" | "promise_contact" | "express_inability" | "announce_transfer" | "defer_action",
  "confidence": 0.0-1.0,
  "reasoning": "Breve explicação da sua decisão"
}
```

**Importante**: Seja conservador com pontuações de confiança. Melhor perder um caso extremo (0.6 confiança) do que criar falsos positivos (0.95 para casos não claros).
```

### 3. Integrate into Execution Layer

**File**: `server/orchestrator/execution.layer.ts`

#### Add Imports
```typescript
import {
  HandoffDetectionGuardrailService,
  type HandoffDetectionAssessment,
} from "@server/services/core/handoff-detection-guardrail.service";
```

#### Add Class Property
```typescript
private handoffDetectionService: HandoffDetectionGuardrailService;
```

#### Initialize in Constructor
```typescript
constructor() {
  this.llmService = new LLMService();
  this.promptService = PromptService.getInstance();
  this.companyInterestService = new CompanyInterestGuardrailService();
  this.confidenceService = new ConfidenceGuardrailService();
  this.handoffDetectionService = new HandoffDetectionGuardrailService(); // NEW
  debugLog("execution", "ExecutionLayer initialized");
  // ... rest of constructor
}
```

#### Update ExecutionResult Interface
```typescript
export interface ExecutionResult {
  step: "ASK" | "RESPOND" | "CALL_TOOL" | "HANDOFF" | "CLOSE";
  userMessage?: string;
  tool?: {
    name: string;
    args: Record<string, unknown>;
  };
  handoff?: {
    reason: string;
    fields: Record<string, unknown>;
  };
  close?: {
    reason: string;
  };
  rationale?: string;
  // Guardrail fields
  companyInterest?: CompanyInterestAssessment;
  confidence?: ConfidenceAssessment;
  handoffDetection?: HandoffDetectionAssessment; // NEW - Stage 3
  recheckAttempted?: boolean;
  recheckCount?: number;
  originalMessage?: string;
}
```

#### Modify applyConfidenceGuardrails Method

Add Stage 3 after Stage 2 (around line 376):

```typescript
private async applyConfidenceGuardrails(
  result: ExecutionResult,
  conversation: Conversation,
  customerLanguage?: string,
): Promise<ExecutionResult> {
  debugLog("execution", "Applying two-stage guardrails to RESPOND step"); // Update to "three-stage"

  // ... existing Stage 1 and Stage 2 code ...

  // STAGE 3: Handoff Detection (NEW)
  debugLog("execution", "Stage 3: Detecting implicit handoff promises");
  const handoffDetection = await this.detectImplicitHandoff(
    conversation,
    result.userMessage!,
  );

  result.handoffDetection = handoffDetection;

  debugLog("execution", "Handoff detection complete", {
    detected: handoffDetection.detected,
    promiseType: handoffDetection.promiseType,
    confidence: handoffDetection.confidence,
    shouldConvert: handoffDetection.shouldConvertToHandoff,
  });

  // If Stage 3 detects handoff need, convert to HANDOFF
  if (handoffDetection.shouldConvertToHandoff) {
    debugLog("execution", "Stage 3: Converting RESPOND to HANDOFF", {
      promiseType: handoffDetection.promiseType,
      confidence: handoffDetection.confidence,
      reasoning: handoffDetection.reasoning,
    });

    const config = await this.getHandoffDetectionConfig(conversation);
    const fallbackMessage = handoffDetection.suggestedHandoffMessage ||
      "I'd like to connect you with our team for better assistance. Someone will be with you shortly.";

    const translatedMessage = await this.getTranslatedFallbackMessage(
      conversation,
      fallbackMessage,
      customerLanguage,
    );

    const originalMessage = result.userMessage;

    return {
      step: "HANDOFF",
      userMessage: translatedMessage,
      handoff: {
        reason: `Implicit handoff detected: ${handoffDetection.promiseType}`,
        fields: {
          promiseType: handoffDetection.promiseType,
          confidence: handoffDetection.confidence,
        },
      },
      companyInterest: companyInterestAssessment,
      confidence: result.confidence,
      handoffDetection: handoffDetection,
      recheckAttempted: result.recheckAttempted,
      recheckCount: result.recheckCount,
      originalMessage,
    };
  }

  return result;
}
```

#### Add Detection Method

```typescript
/**
 * Stage 3: Detect implicit handoff promises
 */
private async detectImplicitHandoff(
  conversation: Conversation,
  response: string,
): Promise<HandoffDetectionAssessment> {
  const conversationHistory = await conversation.getMessages();
  const lastCustomerMessage = await conversation.getLastCustomerMessage();

  if (!lastCustomerMessage) {
    throw new Error("No customer message found for handoff detection");
  }

  // Check for recent tool failures
  const recentToolMessages = conversationHistory
    .filter((msg) => msg.type === "Tool")
    .slice(-3);

  const hadToolFailure = recentToolMessages.some(
    (msg) => msg.metadata?.toolStatus === "ERROR" || msg.metadata?.toolStatus === "FAILED"
  );

  // Build context
  const context = {
    response,
    conversationHistory,
    customerQuery: lastCustomerMessage.content,
    hadToolFailure,
  };

  // Get configuration
  const config = await this.getHandoffDetectionConfig(conversation);

  // Perform detection
  return await this.handoffDetectionService.detectHandoffPromise(context, config);
}
```

#### Add Config Loader Method

```typescript
/**
 * Get handoff detection configuration
 */
private async getHandoffDetectionConfig(conversation: Conversation) {
  try {
    const { organizationRepository } = await import(
      "@server/repositories/organization.repository"
    );
    const organization = await organizationRepository.findById(conversation.organization_id);

    return HandoffDetectionGuardrailService.mergeConfig(
      organization?.settings as Record<string, unknown>,
      undefined,
    );
  } catch (error) {
    debugLog("execution", "Error loading handoff detection config, using defaults", {
      level: "warn",
      error: error instanceof Error ? error.message : String(error),
    });
    return HandoffDetectionGuardrailService.getDefaultConfig();
  }
}
```

### 4. Update Type Definitions

**File**: `server/types/organization-settings.types.ts`

Add after existing guardrail configs:

```typescript
export interface HandoffDetectionGuardrailConfig {
  enabled: boolean;
  detectionThreshold: number;
  detectPromiseContact: boolean;
  detectInability: boolean;
  detectTransfer: boolean;
  detectDeferredAction: boolean;
}

export const DEFAULT_HANDOFF_DETECTION_GUARDRAIL_CONFIG: HandoffDetectionGuardrailConfig = {
  enabled: true,
  detectionThreshold: 0.7,
  detectPromiseContact: true,
  detectInability: true,
  detectTransfer: true,
  detectDeferredAction: true,
};

export interface OrganizationSettings {
  testModeDefault?: boolean;
  companyDomain?: string;
  companyInterestGuardrail?: CompanyInterestGuardrailConfig;
  confidenceGuardrail?: ConfidenceGuardrailConfig;
  handoffDetectionGuardrail?: HandoffDetectionGuardrailConfig; // NEW
  [key: string]: unknown;
}
```

### 5. Update Metadata & Logging

**File**: `server/orchestrator/run.ts`

#### Update buildMessageMetadata Function

Add after Stage 2 metadata (around line 136):

```typescript
// Stage 3: Handoff Detection (NEW)
if (executionResult.handoffDetection) {
  metadata.handoffDetection = {
    detected: executionResult.handoffDetection.detected,
    promiseType: executionResult.handoffDetection.promiseType,
    confidence: executionResult.handoffDetection.confidence,
    reasoning: executionResult.handoffDetection.reasoning,
    shouldConvertToHandoff: executionResult.handoffDetection.shouldConvertToHandoff,
  };
}
```

#### Update saveConfidenceLog Function

Update condition check (line 154):
```typescript
// Skip if no guardrail data
if (!executionResult.companyInterest && !executionResult.confidence && !executionResult.handoffDetection) {
  return;
}
```

Add after Stage 2 logging (around line 194):

```typescript
// Stage 3: Handoff Detection (NEW)
if (executionResult.handoffDetection) {
  logEntry.handoffDetection = {
    detected: executionResult.handoffDetection.detected,
    promiseType: executionResult.handoffDetection.promiseType,
    confidence: executionResult.handoffDetection.confidence,
    reasoning: executionResult.handoffDetection.reasoning,
    shouldConvertToHandoff: executionResult.handoffDetection.shouldConvertToHandoff,
  };
}
```

Update debug log (line 221):
```typescript
debugLog("orchestrator", "Guardrail log saved", {
  conversationId: conversation.id,
  hasCompanyInterest: !!executionResult.companyInterest,
  hasFactGrounding: !!executionResult.confidence,
  hasHandoffDetection: !!executionResult.handoffDetection, // NEW
  logEntries: orchestrationStatus.guardrailLog.length,
});
```

### 6. Update Guardrail Log Types

**File**: `server/orchestrator/types.ts`

Update GuardrailLogEntry interface (around line 37):

```typescript
export interface GuardrailLogEntry {
  timestamp: string;
  companyInterest?: {
    passed: boolean;
    violationType: string;
    severity: string;
    shouldBlock: boolean;
    requiresFactCheck: boolean;
    reasoning: string;
  };
  factGrounding?: {
    score: number;
    tier: string;
    breakdown: {
      grounding: number;
      retrieval: number;
      certainty: number;
    };
    documentsUsed: Array<{ id: string; title: string; similarity: number }>;
    recheckAttempted: boolean;
    recheckCount: number;
    details: string;
  };
  handoffDetection?: { // NEW
    detected: boolean;
    promiseType: string;
    confidence: number;
    reasoning: string;
    shouldConvertToHandoff: boolean;
  };
}
```

## Testing Strategy

### Unit Tests

**File**: `server/services/core/__tests__/handoff-detection-guardrail.service.test.ts`

```typescript
import { HandoffDetectionGuardrailService, HandoffPromiseType } from '../handoff-detection-guardrail.service';
import { Message, MessageType } from '@server/database/entities/message.entity';

describe('HandoffDetectionGuardrailService', () => {
  let service: HandoffDetectionGuardrailService;

  beforeEach(() => {
    service = new HandoffDetectionGuardrailService();
  });

  describe('Promise Detection', () => {
    it('should detect promise of contact with high confidence', async () => {
      const context = {
        response: "Thanks! Our team will reach out to you within the next day to help get your account set up.",
        conversationHistory: [],
        customerQuery: "I want to create an account",
        hadToolFailure: true,
      };

      const result = await service.detectHandoffPromise(context);

      expect(result.detected).toBe(true);
      expect(result.promiseType).toBe(HandoffPromiseType.PROMISE_CONTACT);
      expect(result.confidence).toBeGreaterThan(0.8);
      expect(result.shouldConvertToHandoff).toBe(true);
    });

    it('should detect inability expression', async () => {
      const context = {
        response: "I'm sorry, I don't have access to process refunds. You'll need to speak with our billing team.",
        conversationHistory: [],
        customerQuery: "Can you process my refund?",
        hadToolFailure: false,
      };

      const result = await service.detectHandoffPromise(context);

      expect(result.detected).toBe(true);
      expect(result.promiseType).toBe(HandoffPromiseType.EXPRESS_INABILITY);
      expect(result.confidence).toBeGreaterThan(0.7);
    });

    it('should NOT detect offers as promises', async () => {
      const context = {
        response: "Would you like me to connect you with a specialist?",
        conversationHistory: [],
        customerQuery: "Can I speak with someone?",
        hadToolFailure: false,
      };

      const result = await service.detectHandoffPromise(context);

      expect(result.detected).toBe(false);
      expect(result.promiseType).toBe(HandoffPromiseType.NONE);
      expect(result.confidence).toBeLessThan(0.3);
      expect(result.shouldConvertToHandoff).toBe(false);
    });

    it('should NOT detect normal information responses', async () => {
      const context = {
        response: "Your order has shipped! The tracking number is ABC123.",
        conversationHistory: [],
        customerQuery: "What's my order status?",
        hadToolFailure: false,
      };

      const result = await service.detectHandoffPromise(context);

      expect(result.detected).toBe(false);
      expect(result.confidence).toBeLessThan(0.2);
    });

    it('should increase confidence when tool failure occurred', async () => {
      const contextWithFailure = {
        response: "We'll look into this and get back to you soon.",
        conversationHistory: [],
        customerQuery: "Why was I charged twice?",
        hadToolFailure: true,
      };

      const contextWithoutFailure = {
        ...contextWithFailure,
        hadToolFailure: false,
      };

      const resultWith = await service.detectHandoffPromise(contextWithFailure);
      const resultWithout = await service.detectHandoffPromise(contextWithoutFailure);

      expect(resultWith.confidence).toBeGreaterThan(resultWithout.confidence);
    });
  });

  describe('Configuration', () => {
    it('should respect detection threshold', async () => {
      const context = {
        response: "Our team might reach out if needed.",
        conversationHistory: [],
        customerQuery: "Can you help?",
        hadToolFailure: false,
      };

      const configLow = { detectionThreshold: 0.5 };
      const configHigh = { detectionThreshold: 0.9 };

      const resultLow = await service.detectHandoffPromise(context, configLow);
      const resultHigh = await service.detectHandoffPromise(context, configHigh);

      // Assuming this gets ~0.6-0.7 confidence
      expect(resultLow.shouldConvertToHandoff).toBe(true);
      expect(resultHigh.shouldConvertToHandoff).toBe(false);
    });

    it('should return passing assessment when disabled', async () => {
      const context = {
        response: "Our team will definitely contact you!",
        conversationHistory: [],
        customerQuery: "Help!",
        hadToolFailure: true,
      };

      const config = { enabled: false };
      const result = await service.detectHandoffPromise(context, config);

      expect(result.detected).toBe(false);
      expect(result.shouldConvertToHandoff).toBe(false);
    });
  });

  describe('Error Handling', () => {
    it('should return safe assessment on LLM error', async () => {
      // Mock LLM service to throw error
      jest.spyOn(service['llmService'], 'invoke').mockRejectedValue(new Error('API error'));

      const context = {
        response: "Test response",
        conversationHistory: [],
        customerQuery: "Test query",
        hadToolFailure: false,
      };

      const result = await service.detectHandoffPromise(context);

      expect(result.detected).toBe(false);
      expect(result.shouldConvertToHandoff).toBe(false);
    });
  });
});
```

### Integration Tests

**File**: `server/orchestrator/__tests__/execution.layer.test.ts`

Add tests for Stage 3 integration:

```typescript
describe('ExecutionLayer - Stage 3 Handoff Detection', () => {
  it('should convert RESPOND to HANDOFF when promise detected', async () => {
    // Setup conversation with tool failure
    const conversation = await createTestConversation();
    await conversation.addMessage({
      content: "Running action: email:send-email",
      type: MessageType.TOOL,
      metadata: { toolStatus: "ERROR" },
    });

    const executionLayer = new ExecutionLayer();
    const result = await executionLayer.execute(conversation);

    expect(result.step).toBe('HANDOFF');
    expect(result.handoffDetection).toBeDefined();
    expect(result.handoffDetection.shouldConvertToHandoff).toBe(true);
  });

  it('should preserve RESPOND when no promise detected', async () => {
    const conversation = await createTestConversation();
    // Normal information query

    const executionLayer = new ExecutionLayer();
    const result = await executionLayer.execute(conversation);

    expect(result.step).toBe('RESPOND');
    expect(result.handoffDetection?.shouldConvertToHandoff).toBe(false);
  });

  it('should include all guardrail metadata in HANDOFF conversion', async () => {
    const conversation = await createTestConversation();
    const executionLayer = new ExecutionLayer();
    const result = await executionLayer.execute(conversation);

    if (result.step === 'HANDOFF') {
      expect(result.companyInterest).toBeDefined(); // Stage 1
      expect(result.confidence).toBeDefined(); // Stage 2
      expect(result.handoffDetection).toBeDefined(); // Stage 3
      expect(result.originalMessage).toBeDefined();
    }
  });
});
```

## Configuration

### Organization-Level Configuration

Organizations can customize the guardrail via settings:

```json
{
  "handoffDetectionGuardrail": {
    "enabled": true,
    "detectionThreshold": 0.7,
    "detectPromiseContact": true,
    "detectInability": true,
    "detectTransfer": true,
    "detectDeferredAction": true
  }
}
```

### Tuning Recommendations

**Conservative (Fewer False Positives):**
```json
{ "detectionThreshold": 0.85 }
```

**Aggressive (Catch More Edge Cases):**
```json
{ "detectionThreshold": 0.6 }
```

**Disable Specific Detection Types:**
```json
{
  "detectPromiseContact": true,
  "detectInability": false,  // Allow AI to express limitations without HANDOFF
  "detectTransfer": true,
  "detectDeferredAction": true
}
```

**Disable Completely:**
```json
{ "enabled": false }
```

## Cost & Performance Impact

### Cost Estimates
- **Per Detection**: ~$0.002 (gpt-4o call with low temperature)
- **Estimated Monthly** (10K conversations/day): ~$240
  - Assumes 40% of conversations generate RESPOND steps
  - Not all RESPOND steps run Stage 3 (skipped for greets, closes)

### Latency Impact
- **Per Detection**: ~500-800ms
- **Mitigation Strategies**:
  - Prompt improvements reduce cases reaching guardrail
  - Skipped for conversational intents (greet, close)
  - Only runs on RESPOND steps
  - Uses fast gpt-4o model

## Edge Cases

### 1. Offers vs Promises
**Issue**: "Would you like me to connect you?" is an offer, not a promise.

**Solution**: Prompt explicitly handles offers with low confidence (0.1-0.3) that won't trigger conversion.

### 2. Tool Failure Context
**Issue**: Tool failures often lead to promises.

**Solution**: Context includes `hadToolFailure` flag. Detection increases confidence by +0.1 when tool failed.

### 3. Multi-Language Support
**Issue**: Must work in Portuguese and other languages.

**Solution**: Separate prompt files per language. LLM understands semantic meaning across languages.

### 4. False Positives
**Issue**: Too aggressive detection creates unnecessary handoffs.

**Solution**:
- Configurable threshold (default 0.7)
- Conservative prompt design
- Offers explicitly excluded
- Organizations can tune sensitivity

### 5. Performance Impact
**Issue**: Adding LLM call adds latency/cost.

**Solution**:
- Prompt improvements reduce frequency
- Only runs on RESPOND steps
- Skipped for conversational intents
- Fast model with low temperature

## Migration & Rollout

### Phase 1: Testing (1-2 weeks)
1. Deploy with `enabled: false` by default
2. Enable for test organization only
3. Monitor logs for detection quality
4. Tune threshold based on false positive/negative rates

### Phase 2: Gradual Rollout (2-3 weeks)
1. Enable for 10% of organizations
2. Monitor metrics:
   - Detection rate
   - False positive rate
   - Customer satisfaction scores
3. Gradually increase to 50%, then 100%

### Phase 3: Optimization (Ongoing)
1. Analyze guardrail logs
2. Refine prompt based on common patterns
3. Adjust default threshold if needed
4. Add new detection categories if patterns emerge

## Success Metrics

### Primary Metrics
- **Handoff Accuracy**: % of detected promises that should be handoffs
- **False Positive Rate**: % of safe responses incorrectly flagged
- **False Negative Rate**: % of promises missed

### Secondary Metrics
- **Customer Satisfaction**: CSAT scores before/after
- **Unmet Expectations**: Support tickets about "promised but didn't happen"
- **Conversion Rate**: % of RESPOND converted to HANDOFF

### Target Goals
- Handoff Accuracy: >90%
- False Positive Rate: <5%
- False Negative Rate: <10%
- Customer Satisfaction: +5% improvement

## Files to Create/Modify

### New Files
1. `server/services/core/handoff-detection-guardrail.service.ts` - Service implementation
2. `server/prompts/en/execution/handoff-detection.md` - English detection prompt
3. `server/prompts/pt/execution/handoff-detection.md` - Portuguese detection prompt
4. `server/services/core/__tests__/handoff-detection-guardrail.service.test.ts` - Unit tests

### Modified Files
1. `server/orchestrator/execution.layer.ts` - Integration into guardrail pipeline
2. `server/types/organization-settings.types.ts` - Configuration types
3. `server/orchestrator/run.ts` - Metadata and logging
4. `server/orchestrator/types.ts` - GuardrailLogEntry interface
5. `server/orchestrator/__tests__/execution.layer.test.ts` - Integration tests

## References

- [Execution Layer](../server/orchestrator/execution.layer.ts)
- [Company Interest Guardrail](../server/services/core/company-interest-guardrail.service.ts)
- [Confidence Guardrail](../server/services/core/confidence-guardrail.service.ts)
- [Organization Settings Types](../server/types/organization-settings.types.ts)
