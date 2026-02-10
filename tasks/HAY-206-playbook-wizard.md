# HAY-206: Playbook Creation Wizard/Helper

**Jira**: https://hay-team.atlassian.net/browse/HAY-206
**Plan**: `.claude/plans/velvety-churning-beacon.md`
**Status**: In Progress

---

User Story
As a support lead or operations manager
I want a guided wizard to create a new playbook from a blank state
So I can quickly define its purpose, attach the right documents, and generate a solid first version without needing to understand AI or system internals.

Scope
This story covers only the Wizard experience, not the Editor, auto-save, or versioning behavior after creation.

The wizard is responsible for:

Collecting minimal intent

Helping users select relevant documents (with suggestions)

Generating the first playbook draft

Handing off to the Playbook Editor for refinement

Wizard Structure (v1)
Step 1 — Define Purpose
Goal: Capture intent with the lowest possible cognitive load.

UI

Single large textarea:

Label: “What is this playbook for?”

Helper text: “Describe what this playbook should help resolve or automate.”

Constraints

No tone selection

No channel selection

No industry selection

No advanced options

Acceptance Criteria

User can proceed with only this field filled

Soft guidance on length (e.g. “1–3 sentences recommended”)

Example text is shown inline (not placeholder-only)

Step 2 — Key Actions (unchanged conceptually)
Goal: Define what the playbook is allowed to do via integrations or actions.

UI

List of suggested actions based on connected integrations

Ability to select multiple actions

Optional free-text field for custom actions

Acceptance Criteria

Suggested actions appear automatically if integrations exist

User can continue even if no actions are selected

Clear copy explains that “no actions” means “answer-only playbook”

Step 3 — Documents & Knowledge (with Suggestions)
Goal: Ground the playbook in the right source material.

UI

Document selector (multi-select)

Suggested documents section:

Highlighted list of recommended documents

Based on:

Document usage frequency

Title / tag relevance to Step 1 description

Ability to preview documents

Acceptance Criteria

Suggested documents are visually distinct from the full list

User can accept or ignore suggestions freely

Wizard does not block progression if no documents are selected

Selected documents are clearly listed before moving forward

Exploration / Open Questions

What heuristic defines “suggested” (usage, tags, semantic match)?

Do we show why a document is suggested (v1 optional)?

Step 4 — Boundaries & Escalation
Goal: Ensure safe defaults before generation.

UI

Simple checklist + text inputs:

“Always escalate when…”

“Never answer questions about…”

Preset examples shown inline

Acceptance Criteria

At least one escalation rule is encouraged but not strictly required

High-risk examples are visually emphasized

User must acknowledge review of escalation rules before proceeding

Step 5 — Generate Instructions
Goal: Generate the initial playbook and transition to the Editor.

UI

Full-width generated instruction preview (read-only)

Short explanatory copy:

“This is a starting point. You’ll be able to refine everything next.”

Primary CTA: “Create playbook & open editor”

Behavior

On confirmation:

Playbook is created

Initial draft/version is generated

User is redirected into the Playbook Editor

Acceptance Criteria

Wizard does not support deep editing at this step

No publishing happens in the wizard

User lands in the editor with generated content pre-filled

Out of Scope (Explicit)
Editing instructions inside the wizard

Auto-save behavior

Version history UI

Publishing or activation

Analytics or optimization suggestions

These are handled in the Playbook Editor.

UX & Product Principles
Wizard should take < 5 minutes for first-time users

Every step must feel reversible

Copy avoids technical or AI-centric language

Wizard optimizes for confidence, not completeness

---

## Progress Tracker

### Backend

- [x] **1. Create prompt template**
  - File: `server/prompts/en/playbook/generate-instructions.md`
  - Handlebars template with frontmatter (follow pattern from `server/prompts/en/retrieval/playbook-selection.md`)
  - Variables: `purpose`, `actions` (array), `documents` (array), `escalationRules`, `boundaries`
  - Instructs LLM to produce structured step-by-step playbook instructions

- [x] **2. Add `generateInstructions` mutation to playbooks router**
  - File: `server/routes/v1/playbooks/index.ts`
  - Input schema:
    ```typescript
    z.object({
      purpose: z.string().min(1),
      actions: z
        .array(z.object({ name: z.string(), description: z.string(), pluginName: z.string() }))
        .optional()
        .default([]),
      documentIds: z.array(z.string().uuid()).optional().default([]),
      escalationRules: z.string().optional().default(""),
      boundaries: z.string().optional().default(""),
    });
    ```
  - Flow:
    1. Fetch document metadata (title, description) for `documentIds` via `documentRepository`
    2. Render prompt via `PromptService.getInstance().getPrompt("playbook/generate-instructions", variables)`
    3. Call `LLMService.invoke()` with `jsonSchema` for structured output (title, trigger, description, instructions[])
    4. Return parsed result
  - Uses: `scopedProcedure(RESOURCES.PLAYBOOKS, ACTIONS.CREATE)`
  - Reuses: `LLMService` (`server/services/core/llm.service.ts`), `PromptService` (`server/services/prompt.service.ts`), `documentRepository` (`server/repositories/document.repository.ts`)
  - JSON schema for structured output:
    ```json
    {
      "type": "object",
      "properties": {
        "title": { "type": "string" },
        "trigger": { "type": "string" },
        "description": { "type": "string" },
        "instructions": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "id": { "type": "string" },
              "level": { "type": "number" },
              "instructions": { "type": "string" }
            },
            "required": ["id", "level", "instructions"],
            "additionalProperties": false
          }
        }
      },
      "required": ["title", "trigger", "description", "instructions"],
      "additionalProperties": false
    }
    ```

### Frontend — Step Components

- [x] **3. Create `WizardStepPurpose.vue` (Step 1)**
  - File: `dashboard/components/playbooks/WizardStepPurpose.vue`
  - Single textarea with `v-model`, label "What is this playbook for?"
  - Helper text: "Describe what this playbook should help resolve or automate."
  - Inline tips section (not just placeholder)
  - Validation: `purpose.trim().length >= 10`

- [x] **4. Create `WizardStepActions.vue` (Step 2)**
  - File: `dashboard/components/playbooks/WizardStepActions.vue`
  - On mount: `HayApi.plugins.getMCPTools.query()` to fetch available tools
  - Group tools by `pluginName`
  - Each tool as `OptionCard` (`dashboard/components/ui/OptionCard.vue`) with checkbox behavior
  - If no tools: info message "This playbook will be answer-only unless you connect integrations"
  - `v-model` binds to array of selected tool objects `{ name, description, pluginName }`
  - Can proceed without selecting any

- [x] **5. Create `WizardStepDocuments.vue` (Step 3)**
  - File: `dashboard/components/playbooks/WizardStepDocuments.vue`
  - Props: `purpose` (string from Step 1)
  - On mount, parallel fetch:
    - `HayApi.documents.search.query({ query: purpose, limit: 5 })` → "Suggested" section
    - `HayApi.documents.list.query({})` → "All Documents" section (excluding suggested)
  - Each doc as selectable card with title + description snippet
  - Search input to filter "All Documents"
  - `v-model` binds to `selectedDocumentIds: string[]`
  - Can proceed with 0 docs

- [ ] **6. Create `WizardStepBoundaries.vue` (Step 4)**
  - File: `dashboard/components/playbooks/WizardStepBoundaries.vue`
  - Two textareas: "Always escalate when..." and "Never answer questions about..."
  - Preset example rules as clickable `Badge` elements that append to textarea
  - Escalation examples: "Legal threats", "Refund requests over $500", "Safety concerns", "Customer asks for manager"
  - Boundary examples: "Internal policies", "Competitor comparisons", "Medical/legal advice", "Employee information"
  - Styled warning div for high-risk emphasis
  - `Checkbox` for acknowledgment: "I have reviewed the escalation rules and boundaries"
  - `v-model:escalation-rules`, `v-model:boundaries`, `v-model:acknowledged`

- [ ] **7. Create `WizardStepGenerate.vue` (Step 5)**
  - File: `dashboard/components/playbooks/WizardStepGenerate.vue`
  - Props: `wizardData`, `generatedResult`, `generating` (boolean)
  - Emits: `generate`
  - Summary of collected wizard data (purpose snippet, action count, doc count, boundary rules)
  - "Generate Instructions" button (emits `generate`)
  - Loading state during generation
  - Read-only preview of generated title, trigger, description, instruction steps
  - Info text: "This is a starting point. You'll be able to refine everything in the editor."
  - "Regenerate" button available after first generation

### Frontend — Wizard Page

- [ ] **8. Create wizard page**
  - File: `dashboard/pages/playbooks/wizard.vue`
  - `useStepper(['purpose', 'actions', 'documents', 'boundaries', 'generate'])` from `@vueuse/core`
  - Reactive `wizardData` object:
    ```typescript
    {
      purpose: '',
      selectedActions: [],
      selectedDocumentIds: [],
      escalationRules: '',
      boundaries: '',
      boundariesAcknowledged: false,
    }
    ```
  - Stepper header bar: step numbers + labels + connecting lines
    - Completed: primary color circle with checkmark
    - Current: primary color circle with number, highlighted
    - Upcoming: muted circle with number
    - Uses `stepper.isBefore()` / `isCurrent()` / `isAfter()`
  - `Card` wrapping current step component (conditional rendering with `v-if`)
  - Navigation bar:
    - "Previous" button (hidden on Step 1)
    - "Continue" button (Steps 1-4), disabled when `!canProceed`
    - "Create Playbook & Open Editor" button (Step 5 only), `:loading="creating"`
  - `canProceed` computed per step:
    - Step 1: `purpose.trim().length >= 10`
    - Step 2: always true
    - Step 3: always true
    - Step 4: `boundariesAcknowledged === true`
    - Step 5: `generatedResult !== null`
  - `handleGenerate`: calls `HayApi.playbooks.generateInstructions.mutate(wizardData)`
  - `handleCreate`: calls `HayApi.playbooks.create.mutate(...)` with generated data, then `router.push('/playbooks/<id>')`
  - `ConfirmDialog` for cancel/navigation-away
  - Uses: `Page`, `Card`, `CardContent`, `Button`, `ConfirmDialog`
  - Head: `title: "Create Playbook - Hay Dashboard"`

### Route Updates

- [ ] **9. Update list page route**
  - File: `dashboard/pages/playbooks/index.vue`
  - Change "Create Playbook" button from routing to `/playbooks/new` → `/playbooks/wizard`
  - Also update `EmptyState` action link if applicable

- [ ] **10. Add redirect from `/playbooks/new`**
  - File: `dashboard/pages/playbooks/[...id].vue`
  - Add early check in `onMounted`: if route is `/playbooks/new`, `router.replace('/playbooks/wizard')`
  - Page then exclusively handles editing existing playbooks

### Verification

- [ ] **11. Generate tRPC types**
  - Run `npm run generate:trpc`

- [ ] **12. Run typecheck**
  - Run `npm run typecheck`

- [ ] **13. Run lint**
  - Run `npm run lint` (fix any issues)

---

## Key Files Reference

| File                                          | Role                                                          |
| --------------------------------------------- | ------------------------------------------------------------- |
| `server/routes/v1/playbooks/index.ts`         | Playbook tRPC router — add generation endpoint here           |
| `server/services/core/llm.service.ts`         | LLM invocation with `jsonSchema` structured output            |
| `server/services/prompt.service.ts`           | Template rendering (singleton: `PromptService.getInstance()`) |
| `server/repositories/document.repository.ts`  | Document data access (`findById`)                             |
| `server/database/entities/playbook.entity.ts` | Playbook entity — `InstructionItem` type definition           |
| `dashboard/components/ui/OptionCard.vue`      | Checkbox-style card for multi-select (tools/docs)             |
| `dashboard/utils/api.ts`                      | tRPC client (`HayApi` / `Hay`)                                |
| `dashboard/composables/useToast.ts`           | Toast notifications                                           |
| `dashboard/composables/useUnsavedChanges.ts`  | Unsaved changes detection                                     |
| `.claude/FRONTEND.md`                         | Frontend component guidelines                                 |

## Acceptance Criteria (from Jira)

- AC-01: Multi-step wizard with forward/back navigation, progress indicator
- AC-02: Step 1 single textarea, inline examples, validation
- AC-03: Step 2 suggested actions from integrations, multi-select
- AC-04: Step 3 document selector with suggestions section, preview
- AC-05: Step 4 escalation/boundary inputs, preset examples, acknowledgment required
- AC-06: Step 5 read-only preview of generated instructions, "initial draft" messaging
- AC-07: Creates playbook + initial draft, redirects to editor
- AC-08: No publishing/activation/auto-save/version history in wizard
- AC-09: Error handling with clear messages, no partial state, retry/exit safely
