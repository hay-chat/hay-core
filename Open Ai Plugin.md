PRD: OpenAI Plugin Implementation with Generic Model Abstraction Layer
Project Overview
Implement an OpenAI plugin as the first implementation of a generic model abstraction system. Business logic should interact with a unified HayModel interface that automatically routes to the organization's configured AI provider (OpenAI, Anthropic, Llama, etc.).
Architecture Context
Layered Architecture:
Business Logic Layer
↓
HayModel (Facade)
↓
Plugin Resolution Layer
↓
Model Plugin Interface
↓
Specific Provider Plugins (OpenAI, Anthropic, etc.)
↓
LangChain Layer
Core Requirements

1. HayModel Abstraction (PRIMARY REQUIREMENT)
   1.1 HayModel Facade
   typescript// Location: /lib/models/HayModel.ts
   export class HayModel {
   private modelPlugin: IModelPlugin;

constructor(organizationId: string) {
// Automatically resolve correct plugin based on organization config
this.modelPlugin = await this.resolveModelPlugin(organizationId);
}

// Generic methods that business logic uses
async complete(prompt: string, options?: ModelOptions): Promise<ModelResponse>;
async chat(messages: Message[], options?: ModelOptions): Promise<ModelResponse>;
async embed(text: string | string[]): Promise<EmbeddingResponse>;
async stream(messages: Message[], onToken: TokenCallback): Promise<void>;
}
1.2 Standard Types (Provider-Agnostic)
typescript// Location: /lib/models/types.ts
interface ModelOptions {
temperature?: number;
maxTokens?: number;
topP?: number;
stopSequences?: string[];
// Generic options that work across all providers
}

interface ModelResponse {
content: string;
usage?: {
promptTokens: number;
completionTokens: number;
totalTokens: number;
};
metadata?: Record<string, any>;
}

interface Message {
role: 'system' | 'user' | 'assistant';
content: string;
name?: string;
}
1.3 Model Resolution Service
typescript// Location: /lib/models/ModelResolver.ts
export class ModelResolver {
async resolveForOrganization(organizationId: string): Promise<IModelPlugin> {
// 1. Get organization configuration
// 2. Find enabled model provider
// 3. Get plugin from registry
// 4. Initialize with organization-specific config
// 5. Return ready-to-use plugin
}
} 2. Plugin System
2.1 Base Model Plugin Interface
typescript// Location: /plugins/base/IModelPlugin.ts
export interface IModelPlugin {
provider: string;
version: string;

// Lifecycle
initialize(config: any): Promise<void>;
destroy(): Promise<void>;

// Core capabilities - all must return standardized responses
complete(prompt: string, options?: ModelOptions): Promise<ModelResponse>;
chat(messages: Message[], options?: ModelOptions): Promise<ModelResponse>;
embed(text: string | string[]): Promise<EmbeddingResponse>;
stream(messages: Message[], onToken: TokenCallback): Promise<void>;

// Metadata
getCapabilities(): ModelCapabilities;
validateConfig(config: any): boolean;
mapOptionsToProvider(options: ModelOptions): any; // Convert generic to provider-specific
}

interface ModelCapabilities {
supportsStreaming: boolean;
supportsFunction: boolean;
supportsVision: boolean;
maxTokens: number;
supportedModels: string[];
}
2.2 Base Model Plugin Abstract Class
typescript// Location: /plugins/base/BaseModelPlugin.ts
export abstract class BaseModelPlugin implements IModelPlugin {
protected langchainModel: any;
protected config: any;

// Shared implementation for common functionality
protected normalizeResponse(providerResponse: any): ModelResponse {
// Convert provider-specific response to standard format
}

protected normalizeMessages(messages: Message[]): any {
// Convert standard messages to provider format
}
} 3. OpenAI Plugin Implementation
3.1 Plugin Structure
/plugins/openai/
├── manifest.ts // Plugin metadata
├── index.ts // OpenAIPlugin class
├── config.ts // OpenAI config schema
├── mapper.ts // Maps generic options to OpenAI format
├── types.ts // OpenAI-specific types (internal use only)
└── validators.ts // Config validation
3.2 OpenAI Plugin Class
typescript// Location: /plugins/openai/index.ts
export class OpenAIPlugin extends BaseModelPlugin {
provider = 'openai';
version = '1.0.0';

async initialize(config: OpenAIConfig): Promise<void> {
// Setup LangChain OpenAI
this.langchainModel = new ChatOpenAI(config);
}

async chat(messages: Message[], options?: ModelOptions): Promise<ModelResponse> {
// 1. Map generic messages to OpenAI format
const openAIMessages = this.normalizeMessages(messages);

    // 2. Map generic options to OpenAI options
    const openAIOptions = this.mapOptionsToProvider(options);

    // 3. Call OpenAI via LangChain
    const response = await this.langchainModel.invoke(openAIMessages, openAIOptions);

    // 4. Normalize response to standard format
    return this.normalizeResponse(response);

}
} 4. Organization Configuration
4.1 Organization Entity Extension
typescript// Extend /entities/organization.entity.ts
interface OrganizationModelConfig {
enabled: boolean;
provider: 'openai' | 'anthropic' | 'llama' | string;
modelName: string; // e.g., 'gpt-4', 'claude-3', etc.
config: Record<string, any>; // Provider-specific config
fallbackProvider?: string; // If primary fails
}

class Organization extends BaseEntity {
@Column('jsonb')
modelConfig: OrganizationModelConfig;
}
4.2 Configuration Service
typescript// Location: /services/OrganizationConfigService.ts
export class OrganizationConfigService {
async getModelConfig(organizationId: string): Promise<OrganizationModelConfig>;
async updateModelConfig(organizationId: string, config: OrganizationModelConfig): Promise<void>;
async validateModelConfig(config: OrganizationModelConfig): Promise<boolean>;
} 5. Usage in Business Logic
5.1 Service Layer Example
typescript// Location: /services/DocumentService.ts
export class DocumentService {
async processDocument(organizationId: string, documentId: string) {
// No need to know which AI provider!
const model = new HayModel(organizationId);

    const summary = await model.complete(
      `Summarize this document: ${documentContent}`,
      { maxTokens: 500, temperature: 0.3 }
    );

    // Same code works for ANY provider
    return summary.content;

}
}
5.2 Route Handler Example
typescript// Location: /routes/v1/chat/index.ts
router.post('/chat', async (req, res) => {
const { messages } = req.body;
const organizationId = req.user.organizationId;

// Business logic doesn't care about provider
const model = new HayModel(organizationId);
const response = await model.chat(messages);

res.json(response);
}); 6. Plugin Registry System
typescript// Location: /plugins/PluginRegistry.ts
export class PluginRegistry {
private static instance: PluginRegistry;
private plugins: Map<string, IModelPlugin>;

registerPlugin(name: string, plugin: IModelPlugin): void;
getPlugin(name: string): IModelPlugin | undefined;
listPlugins(type?: PluginType): IModelPlugin[];

// Auto-discover and load plugins on startup
async loadPlugins(): Promise<void> {
// Scan /plugins directory
// Load manifests
// Instantiate plugins
}
}
Implementation Scope
IN SCOPE:

HayModel abstraction layer - The main facade for all model interactions
Model Resolution Service - Organization-based plugin resolution
Standard type definitions - Provider-agnostic interfaces
OpenAI plugin - Full implementation as first provider
BaseModelPlugin abstract class - Shared functionality
Plugin Registry - Plugin management system
Organization model configuration - Database schema and service
Response normalization - Convert all provider responses to standard format
Error handling - Unified error handling across providers
Unit and integration tests for all components

OUT OF SCOPE:

Anthropic, Llama, or other provider implementations
Model switching UI/admin panel
Usage tracking and billing
Model performance comparison tools
A/B testing between models
Caching layer for responses
Prompt template management
Fine-tuning or training features
Multi-model orchestration (using multiple models in one request)
Webhook/connector plugins

Technical Constraints

Dependencies to Add:
json{
"langchain": "^0.x.x",
"@langchain/openai": "^0.x.x",
"@langchain/core": "^0.x.x",
"zod": "^3.x.x"
}

Database Migration Needed:
typescript// New migration: 004_add_organization_model_config.ts

- Add modelConfig column to organizations table

Environment Variables:
env# Default fallback (optional)
DEFAULT_MODEL_PROVIDER=openai
DEFAULT_MODEL_NAME=gpt-3.5-turbo

# Provider API keys (used if not in organization config)

OPENAI_API_KEY=sk-...

Success Criteria

Abstraction Works: Business logic can use HayModel without knowing the provider
Organization Isolation: Each organization can have different AI providers
Provider Switching: Can change organization's provider without code changes
Consistent Responses: All providers return same response format
Error Handling: Provider errors are normalized to standard errors
Tests Pass: Full test coverage for abstraction layer and OpenAI plugin
No Provider Leakage: No OpenAI-specific types/imports outside plugin directory

Testing Requirements
typescript// Core test files needed:
/tests/unit/lib/models/HayModel.test.ts // Facade tests
/tests/unit/lib/models/ModelResolver.test.ts // Resolution logic tests
/tests/unit/plugins/openai/index.test.ts // OpenAI plugin tests
/tests/integration/models/model-switching.test.ts // Multi-organization tests

// Test scenarios:

- Different organizations using different providers
- Fallback when primary provider fails
- Response normalization across providers
- Error handling and retries
- Configuration validation
  Example Usage Scenarios
  typescript// Scenario 1: Document Processing (provider-agnostic)
  async function analyzeDocument(organizationId: string, content: string) {
  const model = new HayModel(organizationId); // Could be OpenAI, Anthropic, etc.
  const analysis = await model.chat([
  { role: 'system', content: 'You are a document analyzer' },
  { role: 'user', content: `Analyze this: ${content}` }
  ]);
  return analysis.content;
  }

// Scenario 2: Embedding Generation (same interface, any provider)
async function generateEmbeddings(organizationId: string, texts: string[]) {
const model = new HayModel(organizationId);
return await model.embed(texts); // Works with any provider that supports embeddings
}

// Scenario 3: Streaming Response (if provider supports it)
async function streamChat(organizationId: string, messages: Message[]) {
const model = new HayModel(organizationId);

await model.stream(messages, (token) => {
console.log('Token:', token); // Real-time streaming if supported
});
}
Architecture Diagram
┌─────────────────────────────────────────────┐
│ Business Logic Layer │
│ (DocumentService, ChatService, etc.) │
└────────────────┬────────────────────────────┘
│ Uses
↓
┌─────────────────────────────────────────────┐
│ HayModel (Facade) │
│ - Unified interface for all models │
│ - No provider-specific code │
└────────────────┬────────────────────────────┘
│ Resolves via
↓
┌─────────────────────────────────────────────┐
│ ModelResolver │
│ - Reads organization configuration │
│ - Gets plugin from registry │
└────────────────┬────────────────────────────┘
│ Returns
↓
┌─────────────────────────────────────────────┐
│ IModelPlugin Interface │
│ - Standard methods all plugins implement │
└────────────────┬────────────────────────────┘
│ Implemented by
↓
┌──────────────────────────────────┐
│ OpenAIPlugin │ AnthropicPlugin │ ...
│ - Provider-specific logic │
│ - Uses LangChain internally │
└──────────────────────────────────┘
