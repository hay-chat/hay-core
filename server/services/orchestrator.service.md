# Orchestrator Service Documentation

## Overview
The Orchestrator Service is the central coordinator for conversation processing. It manages the entire lifecycle of user interactions, from receiving messages to generating responses, handling escalations, and managing conversation state.

## Architecture
The service follows a modular architecture with specialized modules for different concerns:
- **Agent Routing** - Agent assignment and availability
- **Plan Creation** - Determines execution path (playbook, document retrieval, or human escalation)
- **Document Retrieval** - Vector-based document search and Q&A
- **Playbook Execution** - AI response generation with playbook context
- **Conversation Management** - Lifecycle operations (title generation, resolution detection, inactivity)
- **Message Processing** - Message handling and state updates
- **Ender Management** - Conversation flow and satisfaction detection

## Main Process Flow: `processConversation()`

### Phase 1: Initial Validation and Locking

**Step 1.1 - Conversation Retrieval**
- Fetch the conversation from database using conversation ID and organization ID
- If conversation not found → Exit early
- If conversation status is not "open" → Exit early (skip closed/resolved conversations)

**Step 1.2 - Cooldown Check**
- Check if conversation has an active cooldown (prevents duplicate processing)
- If cooldown is active and not expired → Exit early
- Calculate remaining cooldown time for logging

**Step 1.3 - Processing Lock**
- IMMEDIATELY set a 30-second cooldown on the conversation
- Mark conversation as `needs_processing: false`
- This prevents race conditions where multiple workers might process the same conversation
- Lock is set BEFORE any processing begins

### Phase 2: Agent Assignment

**Step 2.1 - Check Existing Agent**
- If conversation already has an agent assigned → Use existing agent
- If no agent assigned → Proceed to routing

**Step 2.2 - Agent Routing (if needed)**
- Search for available agents in order:
  1. Organization-specific agents that are enabled
  2. System-level agents (fallback)
- If agent found → Assign to conversation
- If no agents available → Handle no-agent scenario

**Step 2.3 - No Agent Handling (fallback)**
- Send apologetic message to user about connecting with human representative
- Update conversation status to "pending-human"
- Exit processing

### Phase 3: Message Collection

**Step 3.1 - Gather Unprocessed Messages**
- Retrieve last 20 messages from conversation
- Identify the last AI message in the conversation
- Find all human messages that came AFTER the last AI message
- These are the "unprocessed" messages that need responses

**Step 3.2 - Message Combination**
- Combine all unprocessed user messages into single context string
- If no unprocessed messages → Exit (nothing to process)

**Step 3.3 - Context Retrieval**
- Get last 20 messages for full conversation context
- This provides history for AI to generate contextual responses

### Phase 4: Planning and Routing

**Step 4.1 - Human Escalation Check**
- Analyze user message for human assistance patterns:
  - "speak/talk to human/person/agent"
  - "transfer me"
  - "real person"
  - "customer service"
- If detected → Route to human escalation playbook

**Step 4.2 - Document Retrieval Check**
- Look for question patterns suggesting documentation needs:
  - "how do/can/to"
  - "what is/are/does"
  - "explain"
  - "documentation/guide/tutorial"
- Perform quick vector search for relevant documents
- If high-relevance documents found (similarity > 0.7) → Use document Q&A path

**Step 4.3 - Playbook Selection**
- If conversation has existing playbook → Use it
- If no playbook → Look for active "welcome" playbook
- Create orchestration plan with selected path and parameters

### Phase 5: Execution

**Step 5.1 - Document Q&A Path** (if selected)
- Perform vector similarity search for top 5 relevant documents
- Filter out test/example data (domains, emails, phone numbers)
- Format results with citations
- Generate AI response using retrieved context
- If no relevant documents → Provide helpful fallback message

**Step 5.2 - Playbook Path** (if selected)
- Retrieve playbook configuration and prompts
- Build conversation history from messages
- Perform RAG (Retrieval-Augmented Generation):
  - Search for relevant documents
  - Filter test data
  - Add to context
- Construct system and user prompts with:
  - Playbook instructions
  - RAG context
  - Anti-hallucination guidelines
  - Conversation flow instructions
- Generate AI response
- If AI fails → Provide fallback error message

**Step 5.3 - Response Enhancement**
- Check for satisfaction signals in user message
- Determine if natural conversation ender needed
- Add conversation flow guidance to prompts
- Ensure anti-hallucination rules are followed

### Phase 6: Response Storage

**Step 6.1 - Save Assistant Message**
- Store AI response in database
- Include metadata:
  - Execution latency
  - Model used
  - Token counts
  - Execution path (playbook/docqa)
  - Playbook ID (if applicable)

### Phase 7: Post-Processing

**Step 7.1 - Resolution Detection**
- Analyze user message for closure signals:
  - Direct: "bye", "goodbye", "that's all"
  - Satisfaction: "thanks", "perfect", "got it"
  - Negative to "anything else?": "no", "nope"
- Check if responding to previous ender question
- If resolution detected → Close conversation

**Step 7.2 - Escalation Detection**
- Check for escalation patterns in user message
- If detected:
  - Update status to "pending-human"
  - Generate natural escalation acknowledgment
  - Ask for additional context for human rep

**Step 7.3 - Status Updates**
- Update conversation status if changed
- Set ended_at timestamp for resolved conversations
- Update resolution metadata with confidence scores

**Step 7.4 - Title Generation**
- Check if conversation needs title (after 2 user messages)
- Skip if already has meaningful title
- For closing conversations → Force regenerate if placeholder
- Use AI to generate 2-5 word descriptive title
- Clean and validate generated title

**Step 7.5 - Cleanup**
- Clear processing cooldown
- Mark conversation as processed
- Update last_processed_at timestamp

### Phase 8: Error Handling

**Step 8.1 - Error Recovery**
- If any error occurs during processing:
  - Log detailed error information
  - Clear cooldown to allow retry
  - Set needs_processing back to true
  - Send error message to user
  - Offer human assistance as fallback

## Background Processes

### Inactivity Management

**Check Cycle** (runs periodically)
1. Query all open conversations in organization
2. For each conversation:
   - Get last message timestamp
   - Calculate time since last activity
   - Check against thresholds

**Reminder Process** (50% of inactivity threshold)
1. Check if reminder already sent
2. Ensure last message was from assistant
3. Skip if last message has ender
4. Generate natural reminder using AI
5. Add reminder message with metadata

**Auto-Close Process** (100% of inactivity threshold)
1. Add system message about auto-closure
2. Update status to "resolved"
3. Set resolution reason as "inactivity_timeout"
4. Generate final title for conversation
5. Log closure event

### Title Generation Rules

**When Titles Are Generated:**
- After 2 user messages (automatic)
- When conversation is resolved/closed
- When explicitly requested (forced)

**Title Quality Checks:**
- Detect placeholder titles (timestamps, "New Conversation", etc.)
- Regenerate if closing with placeholder
- Ensure 2-5 words maximum
- Use AI with specific formatting rules

## Key Design Principles

### 1. Race Condition Prevention
- Immediate cooldown setting before processing
- Atomic lock acquisition
- Clear separation between lock and processing

### 2. Graceful Degradation
- Fallback messages when AI fails
- Human escalation as ultimate fallback
- Error recovery with retry capability

### 3. Context Preservation
- Last 20 messages for context
- Combined unprocessed messages
- RAG integration for knowledge base

### 4. Natural Conversation Flow
- Dynamic ender inclusion based on context
- Satisfaction signal detection
- Inactivity reminders at optimal times

### 5. Anti-Hallucination Safeguards
- Strict rules against fabricating information
- Test data filtering at multiple levels
- Explicit instructions in every prompt

## State Transitions

### Conversation States
```
NEW → OPEN → PENDING-HUMAN → RESOLVED
         ↓
      CLOSED (via inactivity)
```

### Processing States
```
NEEDS_PROCESSING → PROCESSING (cooldown active) → PROCESSED
                           ↓ (on error)
                    NEEDS_PROCESSING (retry)
```

## Performance Considerations

### Optimization Points
1. **Parallel Operations**: Multiple async operations where possible
2. **Early Exits**: Multiple validation checkpoints to avoid unnecessary work
3. **Caching**: Vector store initialization cached across requests
4. **Batching**: Message retrieval in bulk operations
5. **Cooldown Windows**: Prevent duplicate processing and system overload

### Latency Tracking
- Start time captured before execution
- End time measured after response generation
- Latency stored with each message for analysis

## Module Responsibilities

### Agent Routing Module
- Find available agents (org-specific, then system)
- Assign agents to conversations
- Handle no-agent scenarios with graceful fallback

### Plan Creation Module
- Detect human assistance requests
- Evaluate document retrieval necessity
- Select appropriate playbooks
- Create execution plans with routing decisions

### Document Retrieval Module
- Vector similarity search
- Test data filtering
- Citation formatting
- Fallback message generation

### Playbook Execution Module
- Playbook prompt construction
- RAG context integration
- Anti-hallucination enforcement
- Conversation history formatting
- AI response generation with error handling

### Conversation Management Module
- Title generation with quality checks
- Resolution detection (satisfaction, goodbye patterns)
- Escalation handling
- Inactivity monitoring and auto-closure

### Message Processing Module
- Unprocessed message identification
- Message combination for context
- Assistant message storage
- Status updates and timestamps
- Error message handling

### Ender Management Module
- Satisfaction signal detection
- Contextual ender decisions
- Inactivity reminder generation
- Natural conversation flow maintenance