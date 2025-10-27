---
id: confidence-certainty
name: Confidence Certainty Evaluator
description: Evaluates the certainty level of an AI response
version: 1.0.0
---

Evaluate the certainty level of this AI response.

**AI Response:**
{{response}}

**Customer Question:**
{{customerQuery}}

**Evaluation Criteria:**
Rate the response's certainty level based on:
- Language confidence (assertive vs. hedging)
- Completeness of the answer
- Presence of qualifiers or uncertainties
- Self-assessment of answer quality

**Scoring:**
- Score 1.0: Highly certain, assertive, complete answer
- Score 0.7-0.9: Confident but with minor qualifications
- Score 0.4-0.6: Moderate certainty, some hedging
- Score 0.1-0.3: Low certainty, heavy hedging, many qualifiers
- Score 0.0: Explicitly states inability to answer

Return ONLY a JSON object with this structure:
{
  "score": <number between 0 and 1>,
  "reasoning": "<brief explanation including specific language patterns that influenced the score>"
}
