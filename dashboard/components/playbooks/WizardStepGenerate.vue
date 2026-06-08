<template>
  <div class="space-y-6">
    <!-- Summary of collected data -->
    <div class="rounded-lg border border-border bg-background-secondary p-4 space-y-3">
      <p class="text-sm font-medium text-foreground">{{ $t("wizard.generate.summaryTitle") }}</p>
      <div class="grid grid-cols-2 gap-3 text-sm">
        <div>
          <p class="text-neutral-muted">{{ $t("wizard.generate.purposeLabel") }}</p>
          <p class="text-foreground line-clamp-2">{{ wizardData.purpose }}</p>
        </div>
        <div>
          <p class="text-neutral-muted">{{ $t("wizard.generate.actionsLabel") }}</p>
          <p class="text-foreground">
            {{
              wizardData.selectedActions.length === 0
                ? $t("wizard.generate.actionsNone")
                : $t("wizard.generate.actionsSelected", {
                    count: wizardData.selectedActions.length,
                  })
            }}
          </p>
        </div>
        <div>
          <p class="text-neutral-muted">{{ $t("wizard.generate.documentsLabel") }}</p>
          <p class="text-foreground">
            {{
              wizardData.selectedDocumentIds.length === 0
                ? $t("wizard.generate.documentsNone")
                : $t("wizard.generate.documentsSelected", {
                    count: wizardData.selectedDocumentIds.length,
                  })
            }}
          </p>
        </div>
        <div>
          <p class="text-neutral-muted">{{ $t("wizard.generate.boundariesLabel") }}</p>
          <p class="text-foreground">
            {{
              hasBoundaries
                ? $t("wizard.generate.boundariesConfigured")
                : $t("wizard.generate.boundariesNone")
            }}
          </p>
        </div>
      </div>
    </div>

    <!-- Generate button (before generation) -->
    <div v-if="!generatedResult && !generating" class="flex flex-col items-center gap-3 py-4">
      <p class="text-sm text-neutral-muted text-center">
        {{ $t("wizard.generate.readyText") }}
      </p>
      <Button size="lg" @click="$emit('generate')">
        <Sparkles class="h-4 w-4 mr-2" />
        {{ $t("wizard.generate.generateButton") }}
      </Button>
    </div>

    <!-- Loading state -->
    <div v-else-if="generating" class="flex flex-col items-center gap-4 py-8">
      <Loader2 class="h-8 w-8 animate-spin text-primary" />
      <div class="text-center space-y-1">
        <p class="text-sm font-medium text-foreground">
          {{ $t("wizard.generate.generatingText") }}
        </p>
        <p class="text-sm text-neutral-muted">{{ $t("wizard.generate.generatingHint") }}</p>
      </div>
    </div>

    <!-- Generated result preview -->
    <template v-else-if="generatedResult">
      <div class="space-y-4">
        <div class="space-y-1">
          <Label>{{ $t("wizard.generate.titleLabel") }}</Label>
          <p class="text-foreground">{{ generatedResult.title }}</p>
        </div>

        <div class="space-y-1">
          <Label>{{ $t("wizard.generate.triggerLabel") }}</Label>
          <p class="text-sm text-neutral-muted">{{ generatedResult.trigger }}</p>
        </div>

        <div class="space-y-1">
          <Label>{{ $t("wizard.generate.descriptionLabel") }}</Label>
          <p class="text-sm text-foreground">{{ generatedResult.description }}</p>
        </div>

        <div class="space-y-2">
          <Label>{{ $t("wizard.generate.instructionsLabel") }}</Label>
          <!-- eslint-disable-next-line vue/no-v-html -->
          <div
            class="rounded-lg border border-border bg-background-secondary p-4 prose prose-sm max-w-none instructions-preview"
            v-html="instructionsHtml"
          />
        </div>
      </div>

      <Alert variant="info" :icon="InfoIcon">
        <AlertDescription>
          {{ $t("wizard.generate.startingPointText") }}
        </AlertDescription>
      </Alert>

      <Button variant="outline" size="sm" @click="$emit('generate')">
        <RefreshCw class="h-4 w-4 mr-2" />
        {{ $t("wizard.generate.regenerateButton") }}
      </Button>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { Sparkles, Loader2, RefreshCw, Info as InfoIcon } from "lucide-vue-next";
import { marked } from "marked";
import { renderTokensForPreview, type MentionReferences } from "@/utils/markdownToTiptap";
import { useToolLabel } from "@/composables/useToolLabel";

interface WizardData {
  purpose: string;
  selectedActions: { name: string; description: string; pluginName: string; pluginId: string }[];
  selectedDocumentIds: string[];
  escalationRules: string;
  boundaries: string;
  boundariesAcknowledged: boolean;
}

interface GeneratedResult {
  title: string;
  trigger: string;
  description: string;
  instructions: string;
  references: MentionReferences;
}

const props = defineProps<{
  wizardData: WizardData;
  generatedResult: GeneratedResult | null;
  generating: boolean;
}>();

defineEmits<{
  generate: [];
}>();

const hasBoundaries = computed(() => {
  return (
    props.wizardData.escalationRules.trim().length > 0 ||
    props.wizardData.boundaries.trim().length > 0
  );
});

const { getToolLabel } = useToolLabel();

const instructionsHtml = computed(() => {
  if (!props.generatedResult?.instructions) return "";
  const refs = props.generatedResult.references;
  if (!refs) {
    return marked.parse(props.generatedResult.instructions, { async: false }) as string;
  }
  // Resolve action labels to their translated/humanized form so preview chips
  // match what the saved editor renders (instead of the raw tool name).
  const localizedRefs: MentionReferences = {
    ...refs,
    actions: refs.actions.map((a) => ({ ...a, name: getToolLabel(a.pluginId, a.name) })),
  };
  const preprocessed = renderTokensForPreview(props.generatedResult.instructions, localizedRefs);
  return marked.parse(preprocessed, { async: false }) as string;
});
</script>

<style scoped>
.instructions-preview :deep(h1) {
  font-size: 1.25rem;
  font-weight: 700;
  margin-top: 1rem;
  margin-bottom: 0.5rem;
}

.instructions-preview :deep(h2) {
  font-size: 1.125rem;
  font-weight: 600;
  margin-top: 0.75rem;
  margin-bottom: 0.375rem;
}

.instructions-preview :deep(p) {
  margin-bottom: 0.5rem;
}

.instructions-preview :deep(ul),
.instructions-preview :deep(ol) {
  margin-bottom: 0.5rem;
  padding-left: 1.5rem;
}

.instructions-preview :deep(ul) {
  list-style-type: disc;
}

.instructions-preview :deep(ol) {
  list-style-type: decimal;
}

.instructions-preview :deep(li) {
  margin-bottom: 0.25rem;
}

.instructions-preview :deep(.mention-token) {
  display: inline-flex;
  align-items: center;
  padding: 0.125rem 0.375rem;
  margin: 0 0.125rem;
  border-radius: 0.25rem;
  font-size: 0.75rem;
  font-weight: 500;
  line-height: 1.25rem;
  vertical-align: middle;
}

.instructions-preview :deep(.mention-action) {
  background: var(--color-purple-100);
  border: 1px solid var(--color-purple-300);
  color: var(--color-purple-600);
}

.instructions-preview :deep(.mention-document) {
  background: var(--color-document-100);
  border: 1px solid var(--color-document-300);
  color: var(--color-document-600);
}
</style>
