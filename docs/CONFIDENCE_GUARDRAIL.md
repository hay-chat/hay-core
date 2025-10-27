# Confidence Guardrail System

## Overview

The Confidence Guardrail system ensures that Hay only delivers responses that are grounded in the retrieved context (documents) and prevents responses based on the AI's general knowledge. This feature helps maintain accuracy and trustworthiness in customer interactions.

## How It Works

### 1. Confidence Scoring

Every AI response is automatically evaluated across three dimensions:

#### Grounding Score (60% weight)
- **Purpose**: Evaluates whether the response uses information from retrieved documents or the AI's general knowledge
- **Scoring**:
  - 1.0: Entirely based on provided context
  - 0.7-0.9: Mostly grounded with minor general knowledge
  - 0.4-0.6: Mix of context and general knowledge
  - 0.1-0.3: Primarily general knowledge
  - 0.0: Completely ignores or contradicts context

#### Retrieval Score (30% weight)
- **Purpose**: Measures the quality and relevance of retrieved documents
- **Scoring**: Based on average similarity scores from vector search
- Higher similarity = higher confidence in document relevance

#### Certainty Score (10% weight)
- **Purpose**: Measures the AI's self-assessed confidence
- **Scoring**: Based on hedging language detection and LLM self-assessment
- Reduced for phrases like "I think", "maybe", "possibly", etc.

### 2. Confidence Tiers

Based on the weighted overall score, responses are categorized into three tiers:

- **High Confidence (≥ 0.8)**: ✓ Response is delivered immediately
- **Medium Confidence (0.5-0.79)**: ⚡ Triggers automatic recheck
- **Low Confidence (< 0.5)**: ⚠ Escalates to human or uses fallback message

### 3. Recheck Mechanism

When a response scores in the medium confidence tier:

1. **Retrieve More Documents**: Increases retrieval from top 5 to top 10 documents
2. **Lower Similarity Threshold**: Reduces threshold from 0.4 to 0.3 for broader search
3. **Re-generate Response**: Creates a new response with additional context
4. **Re-assess Confidence**: Evaluates the new response
5. **Compare**: If improved, uses new response; otherwise reverts to original

### 4. Fallback & Escalation

For low confidence responses (after recheck if applicable):

- **If escalation enabled**: Converts response to HANDOFF, connecting customer with human agent
- **If escalation disabled**: Uses configured fallback message

Default fallback message:
> "I'm not confident I can provide an accurate answer to this question based on the available information. Let me connect you with a team member who can help."

## Configuration

### Organization-Level Configuration

Add to your organization's `settings` JSONB field:

```json
{
  "confidenceGuardrail": {
    "highThreshold": 0.8,
    "mediumThreshold": 0.5,
    "enableRecheck": true,
    "enableEscalation": true,
    "fallbackMessage": "Custom fallback message..."
  }
}
```

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `highThreshold` | number | 0.8 | Minimum score for high confidence tier |
| `mediumThreshold` | number | 0.5 | Minimum score for medium confidence tier |
| `enableRecheck` | boolean | true | Enable automatic recheck for medium confidence |
| `enableEscalation` | boolean | true | Enable human handoff for low confidence |
| `fallbackMessage` | string | See above | Message shown when escalation is disabled |

## Message Metadata

Every bot response includes confidence information in its metadata:

```typescript
{
  confidence: 0.85,                    // Overall score (0-1)
  confidenceTier: "high",             // Tier: "high", "medium", or "low"
  confidenceBreakdown: {
    grounding: 0.9,                    // Context grounding score
    retrieval: 0.8,                    // Document retrieval quality
    certainty: 0.7                     // LLM certainty score
  },
  confidenceDetails: "...",           // Human-readable explanation
  documentsUsed: [                    // Documents referenced
    { id: "doc-123", title: "...", similarity: 0.85 }
  ],
  recheckAttempted: false,            // Whether recheck was triggered
  recheckCount: 0                     // Number of recheck attempts
}
```

## Orchestration Status

Confidence events are logged in the conversation's `orchestration_status`:

```json
{
  "confidenceLog": [
    {
      "timestamp": "2025-10-27T12:00:00Z",
      "score": 0.85,
      "tier": "high",
      "breakdown": { "grounding": 0.9, "retrieval": 0.8, "certainty": 0.7 },
      "documentsUsed": [...],
      "recheckAttempted": false,
      "recheckCount": 0,
      "details": "Overall Confidence: 85.0% (HIGH)..."
    }
  ]
}
```

## Frontend Display

Confidence scores are displayed in the conversation UI:

- **Badge Color**:
  - Green: High confidence (≥ 80%)
  - Yellow: Medium confidence (50-79%)
  - Red: Low confidence (< 50%)

- **Icons**:
  - ✓ High confidence
  - ⚡ Medium confidence (recheck may occur)
  - ⚠ Low confidence (escalation may occur)

- **Recheck Indicator**: ↻ symbol shows when response was rechecked

## Use Cases

### Use Case 1: High Confidence Response
1. Customer asks: "What are your business hours?"
2. System retrieves document with business hours (similarity: 0.92)
3. Response perfectly matches document content
4. **Result**: Confidence 0.95 (HIGH) - delivered immediately

### Use Case 2: Medium Confidence with Recheck
1. Customer asks: "Can I return a product after 30 days?"
2. Initial retrieval finds somewhat relevant docs (similarity: 0.65)
3. Response partially based on docs
4. **Result**: Confidence 0.68 (MEDIUM)
5. System retrieves 10 docs with lower threshold
6. Finds better match with return policy
7. **Result**: New confidence 0.87 (HIGH) - improved response delivered

### Use Case 3: Low Confidence with Escalation
1. Customer asks: "What's your CEO's favorite color?"
2. No relevant documents found
3. System would need to use general knowledge
4. **Result**: Confidence 0.15 (LOW)
5. **Action**: Escalates to human agent with explanation

## Best Practices

1. **Document Coverage**: Ensure comprehensive documentation for common questions
2. **Monitor Confidence Logs**: Review low-confidence responses to identify gaps
3. **Adjust Thresholds**: Fine-tune based on your organization's risk tolerance
4. **Test Mode**: Use test mode to review confidence scores before enabling escalation
5. **Feedback Loop**: Use message feedback to improve document quality

## Monitoring & Analytics

Track confidence metrics:

- **Average confidence score** by conversation/time period
- **Recheck frequency**: How often medium confidence triggers recheck
- **Escalation rate**: Percentage of low confidence responses
- **Improvement rate**: How often rechecks improve confidence

## Technical Architecture

```
┌─────────────────────────────────────────────────┐
│  Execution Layer (Response Generation)          │
└────────────────┬────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────┐
│  ConfidenceExecutionOrchestrator                │
│                                                  │
│  1. Execute → Get Response                      │
│  2. Assess Confidence → Calculate Score         │
│  3. Determine Tier → Apply Logic                │
│  4. Recheck (if medium) → Retry with more docs │
│  5. Escalate (if low) → Handoff or fallback    │
└────────────────┬────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────┐
│  ConfidenceGuardrailService                     │
│                                                  │
│  • calculateGroundingScore() → LLM evaluation   │
│  • calculateRetrievalScore() → Similarity avg   │
│  • calculateCertaintyScore() → Self-assessment  │
│  • Weighted combination → Final score           │
└─────────────────────────────────────────────────┘
```

## API Integration

The confidence guardrail is automatically applied to all bot responses. No API changes are required.

To retrieve confidence information from the API:

```typescript
// Get conversation with messages
const conversation = await Hay.conversations.get(conversationId);

// Access confidence from bot messages
conversation.messages.forEach(message => {
  if (message.type === 'BotAgent' && message.metadata?.confidence) {
    console.log('Confidence:', message.metadata.confidence);
    console.log('Tier:', message.metadata.confidenceTier);
    console.log('Documents:', message.metadata.documentsUsed);
  }
});
```

## Troubleshooting

### Issue: All responses showing low confidence
- **Cause**: Insufficient or irrelevant documents
- **Solution**: Review and improve document coverage

### Issue: Frequent rechecks slowing responses
- **Cause**: Medium threshold too low or document quality issues
- **Solution**: Increase `mediumThreshold` or improve document relevance

### Issue: Responses incorrectly marked as low confidence
- **Cause**: Grounding evaluation too strict
- **Solution**: Review grounding evaluation prompts or threshold settings

## Future Enhancements

Potential improvements to the confidence system:

- [ ] Agent-specific confidence configuration
- [ ] Confidence score history and trending
- [ ] A/B testing of different threshold settings
- [ ] Fine-tuned confidence models per industry
- [ ] Real-time confidence monitoring dashboard
- [ ] Confidence-based routing (different agents for different confidence levels)
