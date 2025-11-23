# Two-Stage Guardrail System

## Overview

Hay uses a sophisticated two-stage guardrail system to ensure AI responses serve company interests while maintaining factual accuracy. This system replaces the previous single-stage confidence guardrail with a more pragmatic, company-focused approach.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│              AI Response Generated                       │
└───────────────────┬─────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────┐
│  STAGE 1: Company Interest Protection                   │
│  ┌─────────────────────────────────────────────────┐   │
│  │  Question: Does this response harm company      │   │
│  │            interests or is it helpful?          │   │
│  └─────────────────────────────────────────────────┘   │
│                                                          │
│  Checks:                                                 │
│  ✓ Off-topic conversations (weather, unrelated)         │
│  ✓ Generic competitor information                       │
│  ✓ Fabricated products/features/policies                │
│  ✓ Allows clarifications & helpful responses            │
│                                                          │
│  Result: PASS / BLOCK                                   │
└───────────────────┬─────────────────────────────────────┘
                    │
            ┌───────┴───────┐
            │               │
         BLOCK            PASS
            │               │
            ▼               ▼
        ESCALATE   ┌───────────────────┐
                   │ Requires Fact     │
                   │ Check?            │
                   └───────┬───────────┘
                           │
                    ┌──────┴──────┐
                    │             │
                   NO            YES
                    │             │
                DELIVER           ▼
                         ┌─────────────────────────────────┐
                         │ STAGE 2: Fact Grounding         │
                         │ ┌───────────────────────────┐   │
                         │ │ Question: Are company-    │   │
                         │ │ specific claims grounded  │   │
                         │ │ in documents?             │   │
                         │ └───────────────────────────┘   │
                         │                                 │
                         │ Scoring:                        │
                         │ • Grounding (60%)               │
                         │ • Retrieval Quality (30%)       │
                         │ • Certainty (10%)               │
                         │                                 │
                         │ Tiers:                          │
                         │ • High (≥0.8): Deliver          │
                         │ • Medium (0.5-0.8): Recheck     │
                         │ • Low (<0.5): Escalate          │
                         └─────────────────────────────────┘
```

## Stage 1: Company Interest Protection

### Purpose
Block responses that harm company interests while allowing helpful, on-topic assistance. This is the **primary** guardrail - pragmatic and business-focused.

### What Gets Blocked

#### 1. Off-Topic Responses (`violationType: "off_topic"`)
Responses completely unrelated to the company's business domain.

**Example (E-commerce):**
```
❌ BLOCKED
Customer: "What's the weather like?"
AI: "Let me check the weather for your city. Which city are you in?"

✅ SHOULD BE
AI: "I can't help with weather information. Is there anything about our products I can help you with? Or would you like me to transfer you to a team member?"
```

#### 2. Competitor Information (`violationType: "competitor_info"`)
Generic information about competitors without company advantage.

**Example:**
```
❌ BLOCKED
Customer: "Tell me about your competitors"
AI: "Our main competitors include Company A, Company B. Company A offers great pricing and Company B has excellent customer service."

✅ ALLOWED (with company advantage)
AI: "While there are competitors in the market, we differentiate ourselves through [specific documented advantages from knowledge base]."
```

#### 3. Fabricated Products (`violationType: "fabricated_product"`)
Mentioning products/features not in catalog or tool results.

**Example:**
```
❌ BLOCKED (E-commerce)
Customer: "Do you have iPhone 15 Pro?"
AI: "Yes, we have iPhone 15 Pro available in all colors!"
(when not in inventory/catalog)

✅ ALLOWED (from tool results)
AI: "I found iPhone 15 Pro in our inventory: [data from API call]"
```

#### 4. Fabricated Policies (`violationType: "fabricated_policy"`)
Inventing company policies, procedures, or rules.

**Example:**
```
❌ BLOCKED
Customer: "What's your return policy?"
AI: "Our return policy allows returns within 30 days."
(when not documented)

✅ ALLOWED
AI: "Let me check our return policy for you. One moment please."
```

### What Gets Allowed

#### 1. Clarifications ✅
AI explaining its own terminology or questions.

**Example (Your Bug):**
```
Customer: "what do you mean by monthly ticket volume"
AI: "Monthly ticket volume refers to the number of support tickets or customer inquiries your company handles each month."

Stage 1 Result: PASS (no fact check needed)
Reasoning: "AI is clarifying its own terminology, which is helpful"
```

#### 2. Tool Results ✅
Responses presenting data from API calls, databases, system integrations.

**Example:**
```
Customer: "show me available hotels"
AI: "Here are 3 hotels: Hotel ABC, Hotel XYZ, Hotel 123"
[Based on API response]

Stage 1 Result: PASS (no fact check needed)
Reasoning: "Response presents real data from tool results"
```

#### 3. General Conversation ✅
Greetings, acknowledgments, offers to help.

**Example:**
```
AI: "Hello! How can I help you today?"
AI: "I'd be happy to help you with that."
AI: "Let me look that up for you."

Stage 1 Result: PASS (no fact check needed)
Reasoning: "Appropriate conversational response"
```

#### 4. Company Claims (requiring fact check) ✅→Stage 2
Responses making specific claims about company need verification.

**Example:**
```
Customer: "what's your return policy?"
AI: "Our return policy allows returns within 30 days of purchase."

Stage 1 Result: PASS (requires fact check)
→ Proceed to Stage 2 to verify claim
```

## Stage 2: Fact Grounding

### Purpose
Only activated when Stage 1 detects company-specific claims. Verifies that factual claims about the company are grounded in retrieved documents.

### When It Runs
- **Only if** Stage 1 passes AND sets `requiresFactCheck: true`
- **Skipped if** response is a clarification, tool result, or general conversation

### Scoring Components

#### Grounding Score (60% weight)
- 1.0: Claims verified in documents OR no specific claims made
- 0.7-0.9: Mostly grounded with minor inferences
- 0.4-0.6: Mix of documented and undocumented info
- 0.1-0.3: Primarily undocumented when facts needed
- 0.0: Contradicts documents or makes up info

#### Retrieval Score (30% weight)
Based on average similarity scores from vector search.

#### Certainty Score (10% weight)
LLM self-assessment of confidence.

### Confidence Tiers

| Tier | Score | Action |
|------|-------|--------|
| **High** | ≥ 0.8 | ✓ Deliver immediately |
| **Medium** | 0.5-0.79 | ⚡ Trigger automatic recheck |
| **Low** | < 0.5 | ⚠ Escalate to human or fallback |

### Recheck Mechanism

When Medium confidence:
1. Retrieve more documents (top 10 instead of 5)
2. Lower similarity threshold (0.3 instead of 0.4)
3. Re-generate response with additional context
4. Re-assess confidence
5. Use improved response if better, otherwise revert

## Configuration

### Organization-Level Settings

```typescript
{
  "companyDomain": "e-commerce", // Optional: helps Stage 1 understand context

  // Stage 1: Company Interest Protection
  "companyInterestGuardrail": {
    "enabled": true,
    "blockOffTopic": true,
    "blockCompetitorInfo": true,
    "blockFabrications": true,
    "allowClarifications": true
  },

  // Stage 2: Fact Grounding
  "confidenceGuardrail": {
    "highThreshold": 0.8,
    "mediumThreshold": 0.5,
    "enableRecheck": true,
    "enableEscalation": true,
    "fallbackMessage": "I'm not confident I can provide an accurate answer...",
    "recheckConfig": {
      "maxDocuments": 10,
      "similarityThreshold": 0.3
    }
  }
}
```

## Message Metadata

Every bot response includes guardrail information:

```typescript
{
  // Stage 1: Company Interest
  companyInterest: {
    passed: true,
    violationType: "none",
    severity: "none",
    shouldBlock: false,
    requiresFactCheck: false,
    reasoning: "Clarifying terminology"
  },

  // Stage 2: Fact Grounding (if ran)
  confidence: 0.85,
  confidenceTier: "high",
  confidenceBreakdown: {
    grounding: 0.9,
    retrieval: 0.8,
    certainty: 0.7
  },
  confidenceDetails: "...",
  documentsUsed: [...],
  recheckAttempted: false,
  recheckCount: 0,

  // Original message if replaced
  originalMessage: "..."
}
```

## Orchestration Logs

```typescript
{
  "guardrailLog": [
    {
      "timestamp": "2025-11-23T12:00:00Z",
      "companyInterest": {
        "passed": true,
        "violationType": "none",
        "severity": "none",
        "shouldBlock": false,
        "requiresFactCheck": true,
        "reasoning": "Response makes company claim about return policy"
      },
      "factGrounding": {
        "score": 0.92,
        "tier": "high",
        "breakdown": {...},
        "documentsUsed": [...],
        "recheckAttempted": false,
        "recheckCount": 0,
        "details": "..."
      }
    }
  ]
}
```

## Use Cases

### Use Case 1: Clarification (Stage 1 Pass, No Fact Check)
```
Customer: "what do you mean by monthly ticket volume"
AI: "Monthly ticket volume refers to the number of support tickets per month."

Stage 1: ✓ PASS - Clarification, no fact check needed
Stage 2: ⊗ SKIPPED
Result: ✓ DELIVERED
```

### Use Case 2: Tool Results (Stage 1 Pass, No Fact Check)
```
Customer: "show me available hotels"
AI: "Here are 3 hotels: [from API]"

Stage 1: ✓ PASS - Tool results, authoritative data
Stage 2: ⊗ SKIPPED
Result: ✓ DELIVERED
```

### Use Case 3: Off-Topic (Stage 1 Block)
```
Customer: "what's the weather?"
AI: "Let me check the weather for you..."

Stage 1: ✗ BLOCK - Off-topic for e-commerce
Stage 2: ⊗ SKIPPED
Result: ✗ ESCALATED
```

### Use Case 4: Company Claim High Confidence
```
Customer: "what's your return policy?"
AI: "Our return policy allows returns within 30 days."

Stage 1: ✓ PASS - Requires fact check
Stage 2: ✓ HIGH CONFIDENCE (0.92) - Verified in docs
Result: ✓ DELIVERED
```

### Use Case 5: Company Claim Low Confidence
```
Customer: "what are your business hours?"
AI: "We operate 9am-5pm Monday-Friday."

Stage 1: ✓ PASS - Requires fact check
Stage 2: ✗ LOW CONFIDENCE (0.35) - Not in docs
Result: ✗ ESCALATED or FALLBACK
```

## Migration from Previous System

The new two-stage system:
- ✅ **Fixes** the "ticket volume" false positive
- ✅ **Blocks** harmful responses (competitors, off-topic)
- ✅ **Allows** helpful clarifications and tool results
- ✅ **Verifies** company claims when needed
- ✅ Backward compatible (maintains `confidenceLog`)

## Best Practices

1. **Set Company Domain**: Add `companyDomain` to organization settings for better Stage 1 evaluation
2. **Monitor Guardrail Logs**: Review `guardrailLog` to identify patterns
3. **Adjust Stage 1**: Fine-tune `blockOffTopic`, `blockCompetitorInfo` based on use case
4. **Adjust Stage 2**: Fine-tune thresholds based on risk tolerance
5. **Document Coverage**: Ensure comprehensive docs to pass Stage 2
6. **Test Mode**: Review both stages before enabling escalation

## API Integration

```typescript
// Get conversation with guardrail data
const conversation = await Hay.conversations.get(conversationId);

// Access guardrail information
conversation.messages.forEach(message => {
  if (message.type === 'BotAgent' && message.metadata) {
    // Stage 1
    if (message.metadata.companyInterest) {
      console.log('Company Interest:', message.metadata.companyInterest);
    }

    // Stage 2
    if (message.metadata.confidence) {
      console.log('Fact Grounding:', message.metadata.confidence);
    }
  }
});
```

## Troubleshooting

### Issue: Clarifications being blocked
**Cause**: Stage 1 not recognizing clarifications
**Solution**: Ensure `allowClarifications: true` in config

### Issue: Too many escalations
**Cause**: Stage 1 too restrictive OR Stage 2 thresholds too high
**Solution**: Review `guardrailLog` to identify which stage is blocking

### Issue: Tool results triggering fact checks
**Cause**: Stage 1 not detecting tool results
**Solution**: Ensure tool messages are in conversation history

## Technical Details

### Services
- `CompanyInterestGuardrailService` - Stage 1 implementation
- `ConfidenceGuardrailService` - Stage 2 implementation (refactored)

### Prompts
- `execution/company-interest-check` - Stage 1 evaluation (EN, PT, ES)
- `execution/confidence-grounding` - Stage 2 grounding (updated)
- `execution/confidence-certainty` - Stage 2 certainty

### Files
- `/server/services/core/company-interest-guardrail.service.ts`
- `/server/services/core/confidence-guardrail.service.ts`
- `/server/orchestrator/execution.layer.ts`
- `/server/orchestrator/run.ts`
- `/server/types/organization-settings.types.ts`
