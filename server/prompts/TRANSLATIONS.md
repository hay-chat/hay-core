# Prompt Translations Guide

## Available Languages

Currently, the prompt system has full translations for:

- **English (en)** - Default language
- **Portuguese (pt)** - Complete translation
- **Spanish (es)** - Partial (only intent-analysis)
- **French (fr)** - Structure only (no prompts yet)

## Portuguese Translations Status

✅ **Fully Translated**:

### Perception Layer

- `perception/intent-analysis.md` - Análise de intenção do usuário
- `perception/agent-selection.md` - Seleção de agente apropriado

### Retrieval Layer

- `retrieval/playbook-selection.md` - Seleção de playbook relevante

### Conversation Management

- `conversation/title-generation.md` - Geração de título para conversas
- `conversation/inactivity-check.md` - Mensagem de verificação de inatividade
- `conversation/closure-message.md` - Mensagem de encerramento
- `conversation/closure-validation.md` - Validação de encerramento

### Execution Layer

- `execution/planner.md` - Planejador de execução de ações

## How to Add New Translations

1. Create the language directory structure:

   ```bash
   mkdir -p prompts/{lang_code}/{perception,retrieval,conversation,execution}
   ```

2. Copy English prompts as templates:

   ```bash
   cp -r prompts/en/* prompts/{lang_code}/
   ```

3. Translate each `.md` file, keeping:
   - The frontmatter metadata (id, name, description, version)
   - The variable placeholders ({{variable}})
   - The conditional logic ({{#if}}, {{#each}}, etc.)

4. Test the translations:
   ```bash
   npx ts-node tests/test-{language}-prompts.ts
   ```

## Language Selection Priority

1. **Explicit language parameter** - When specified in the API call
2. **Organization default** - From organization.defaultLanguage
3. **System default** - English (en)

## Fallback Behavior

If a prompt is not available in the requested language:

1. System attempts to load the English version
2. If English version is also missing, an error is thrown

## Usage Examples

### Setting Organization Language

```typescript
// Update organization to use Portuguese
await organizationRepository.update(organizationId, {
  defaultLanguage: SupportedLanguage.PORTUGUESE,
});
```

### Explicit Language Override

```typescript
// Force Spanish regardless of organization setting
const prompt = await promptService.getPrompt(
  "perception/intent-analysis",
  { message: "Hola" },
  { language: SupportedLanguage.SPANISH },
);
```

## Translation Guidelines

When translating prompts:

- Maintain the same tone and formality level
- Keep technical terms consistent across prompts
- Preserve all formatting and structure
- Test with actual use cases
- Consider cultural context and idioms

## Adding New Prompts

When adding a new prompt:

1. Create the English version first
2. Add to all existing language directories
3. Update this document with translation status
4. Create tests for each language version
