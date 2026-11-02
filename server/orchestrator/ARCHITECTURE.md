# Orchestrator Architecture Best Practices

## Overview
This document defines the architectural principles and best practices for the Orchestrator v2 implementation. The goal is to create a clean, readable, and maintainable codebase with clear separation of concerns.

## Core Principles

### 1. Layer Separation
- **Perception Layer**: Analyze and understand user input
- **Retrieval Layer**: Find and retrieve relevant data
- **Execution Layer**: Generate responses and take actions

### 2. Repository Pattern
- All database operations should go through repositories
- Entity instances should contain business logic methods
- Never perform raw SQL queries in layers - delegate to repositories

### 3. Entity Methods
- Entity classes should contain methods for their own manipulation
- Use entity methods for updates, state changes, and business logic
- Keep entity methods focused and single-responsibility

## Method Organization Rules

### Repository Layer (Lowest Level)
**Purpose**: Data access and basic CRUD operations
**Location**: `@server/repositories/*.repository.ts`

**Should contain**:
- `findById()`, `findByX()` methods
- `create()`, `update()`, `delete()` methods
- Complex queries with joins
- Database-specific optimizations

**Should NOT contain**:
- Business logic
- AI/LLM calls
- Complex processing

### Entity Layer (Middle Level)
**Purpose**: Business logic and domain operations
**Location**: `@server/database/entities/*.entity.ts`

**Should contain**:
- State manipulation methods (`updatePlaybook()`, `addMessage()`)
- Business validation methods
- Helper methods for entity relationships
- Methods that operate on the entity's own data

**Should NOT contain**:
- External API calls
- AI/LLM operations
- Cross-entity business logic

### Service Layer (Highest Level)
**Purpose**: Complex business operations and orchestration
**Location**: `@server/orchestrator2/*.layer.ts`

**Should contain**:
- AI/LLM service calls
- Complex business logic spanning multiple entities
- External API interactions
- Cross-cutting concerns

**Should NOT contain**:
- Direct database queries
- Raw entity manipulation

## Specific Layer Responsibilities

### Perception Layer
**Primary Functions**:
- Analyze message intent and sentiment
- Process and interpret user input

**Method Signatures**:
```typescript
async perceive(message: Message): Promise<Perception>
```

**Dependencies**: LLMService, Entity types

### Retrieval Layer
**Primary Functions**:
- Find relevant playbooks
- Retrieve relevant documents
- Search and match content

**Method Signatures**:
```typescript
async getPlaybookCandidate(messages: Message[], playbooks: Playbook[]): Promise<Playbook | null>
async getRelevantDocuments(messages: Message[], organizationId: string): Promise<Document[]>
```

**Dependencies**: VectorService, DocumentRepository

### Execution Layer
**Primary Functions**:
- Generate AI responses
- Execute playbook steps
- Coordinate final output

**Method Signatures**:
```typescript
async execute(conversation: Conversation, messages: Message[]): Promise<ExecutionResult | null>
```

**Dependencies**: LLMService, assistant instructions, Playbook logic

## The Assistant

Each organization has exactly one assistant, configured on the organization
(`assistantName`, `assistantTone`, `assistantAvoid`, `assistantInstructions`,
`initialGreeting` and the `humanHandoff*` settings). There is no agent entity and
no routing: every conversation of the organization is answered by its assistant,
and all of its playbooks apply.

- `Conversation.addInitialAssistantInstructions()` writes the persona as a system
  message, built by `buildAssistantInstructions()` in `services/assistant.ts`.
- `Conversation.addInitialBotMessage()` uses the organization's `initialGreeting`.
- Hand-off instructions and the "create a ticket" hand-off come from the
  organization (`run.ts`, `handoff-tickets.service.ts`).
- The reply language falls back to `organization.defaultLanguage`; Require
  Approval is `organization.settings.testModeDefault`.
- Whether the AI replies at all is the organization-level pause
  (`agentPausedAt` by the operator, `aiPausedAt` by the owner) and the
  per-channel AI mode in the organization settings.

## Data Flow Rules

### 1. Repository → Entity → Service
```typescript
// ✅ GOOD: Repository loads entity, entity has business methods, service coordinates
const conversation = await conversationRepository.findById(id);
await conversation.updatePlaybook(playbookId); // Entity method
const result = await executionLayer.execute(conversation, messages); // Service method
```

### 2. No Direct Database Access in Services
```typescript
// ❌ BAD: Service accessing database directly
const conversation = await db.query('SELECT * FROM conversations...');

// ✅ GOOD: Service using repository
const conversation = await conversationRepository.findById(id);
```

### 3. Entity Methods for State Changes
```typescript
// ❌ BAD: Direct property manipulation
conversation.playbook_id = newPlaybookId;

// ✅ GOOD: Using entity method
await conversation.updatePlaybook(newPlaybookId);
```

## Type Usage Guidelines

### 1. Use Entity Enums
Always use enums defined in entity files:
```typescript
// ✅ GOOD
import { MessageIntent, MessageSentiment } from "@server/database/entities/message.entity";

// ❌ BAD: Defining custom types
type CustomIntent = "greet" | "question";
```

### 2. Interface Definitions
Keep interfaces minimal and focused:
```typescript
interface Perception {
  intent: { label: MessageIntent; score: number };
  sentiment: { label: MessageSentiment; score: number };
}

interface ExecutionResult {
  content: string;
  metadata?: Record<string, any>;
}
```

## Error Handling

### 1. Layer-Specific Error Handling
- **Repository**: Database errors, validation errors
- **Entity**: Business rule violations
- **Service**: Integration errors, complex business errors

### 2. Error Propagation
- Let errors bubble up through layers
- Handle errors at the appropriate level
- Use meaningful error messages

## Testing Strategy

### 1. Unit Tests per Layer
- Repository: Database operations
- Entity: Business logic methods
- Service: Integration logic

### 2. Mock Dependencies
- Mock external services in layer tests
- Use test databases for repository tests
- Mock repositories in service tests

## Performance Considerations

### 1. Database Queries
- Minimize N+1 queries in repositories
- Use eager loading where appropriate
- Implement pagination for large datasets

### 2. AI Service Calls
- Cache LLM responses where possible
- Use appropriate timeouts
- Handle rate limiting gracefully

## Code Style

### 1. Naming Conventions
- Methods: `camelCase` verbs (`perceive`, `getPlaybookCandidate`)
- Interfaces: `PascalCase` nouns (`Perception`, `ExecutionResult`)
- Files: `kebab-case.type.ts` (`perception.layer.ts`)

### 2. Method Size
- Keep methods focused and small (< 50 lines)
- Extract complex logic into private methods
- Use descriptive method names

### 3. Comments
- Document complex business logic
- Explain non-obvious decisions
- Use JSDoc for public methods

This architecture ensures maintainability, testability, and clear separation of concerns while keeping the codebase readable and expandable.