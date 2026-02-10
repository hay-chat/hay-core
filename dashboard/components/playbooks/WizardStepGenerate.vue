<template>
  <div class="space-y-6">
    <!-- Summary of collected data -->
    <div class="rounded-lg border border-border bg-background-secondary p-4 space-y-3">
      <p class="text-sm font-medium text-foreground">Summary</p>
      <div class="grid grid-cols-2 gap-3 text-sm">
        <div>
          <p class="text-neutral-muted">Purpose</p>
          <p class="text-foreground line-clamp-2">{{ wizardData.purpose }}</p>
        </div>
        <div>
          <p class="text-neutral-muted">Actions</p>
          <p class="text-foreground">
            {{
              wizardData.selectedActions.length === 0
                ? "None (answer-only)"
                : `${wizardData.selectedActions.length} selected`
            }}
          </p>
        </div>
        <div>
          <p class="text-neutral-muted">Documents</p>
          <p class="text-foreground">
            {{
              wizardData.selectedDocumentIds.length === 0
                ? "None"
                : `${wizardData.selectedDocumentIds.length} selected`
            }}
          </p>
        </div>
        <div>
          <p class="text-neutral-muted">Boundaries</p>
          <p class="text-foreground">
            {{ hasBoundaries ? "Configured" : "None set" }}
          </p>
        </div>
      </div>
    </div>

    <!-- Generate button (before generation) -->
    <div v-if="!generatedResult && !generating" class="flex flex-col items-center gap-3 py-4">
      <p class="text-sm text-neutral-muted text-center">
        Ready to generate your playbook instructions based on the information you provided.
      </p>
      <Button size="lg" @click="$emit('generate')">
        <Sparkles class="h-4 w-4 mr-2" />
        Generate Instructions
      </Button>
    </div>

    <!-- Loading state -->
    <div v-else-if="generating" class="flex flex-col items-center gap-4 py-8">
      <Loader2 class="h-8 w-8 animate-spin text-primary" />
      <div class="text-center space-y-1">
        <p class="text-sm font-medium text-foreground">Generating instructions...</p>
        <p class="text-sm text-neutral-muted">This may take a few seconds.</p>
      </div>
    </div>

    <!-- Generated result preview -->
    <template v-else-if="generatedResult">
      <div class="space-y-4">
        <div class="space-y-1">
          <Label>Title</Label>
          <p class="text-foreground">{{ generatedResult.title }}</p>
        </div>

        <div class="space-y-1">
          <Label>Trigger</Label>
          <p class="text-sm text-neutral-muted">{{ generatedResult.trigger }}</p>
        </div>

        <div class="space-y-1">
          <Label>Description</Label>
          <p class="text-sm text-foreground">{{ generatedResult.description }}</p>
        </div>

        <div class="space-y-2">
          <Label>Instructions</Label>
          <div class="rounded-lg border border-border bg-background-secondary p-4 space-y-2">
            <div
              v-for="item in generatedResult.instructions"
              :key="item.id"
              class="text-sm text-foreground"
              :style="{ paddingLeft: `${(item.level - 1) * 1}rem` }"
            >
              {{ item.instructions }}
            </div>
          </div>
        </div>
      </div>

      <Alert variant="info" :icon="InfoIcon">
        <AlertDescription>
          This is a starting point. You'll be able to refine everything in the editor.
        </AlertDescription>
      </Alert>

      <Button variant="outline" size="sm" @click="$emit('generate')">
        <RefreshCw class="h-4 w-4 mr-2" />
        Regenerate
      </Button>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { Sparkles, Loader2, RefreshCw, Info as InfoIcon } from "lucide-vue-next";

interface WizardData {
  purpose: string;
  selectedActions: { name: string; description: string; pluginName: string }[];
  selectedDocumentIds: string[];
  escalationRules: string;
  boundaries: string;
  boundariesAcknowledged: boolean;
}

interface GeneratedResult {
  title: string;
  trigger: string;
  description: string;
  instructions: { id: string; level: number; instructions: string }[];
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
</script>
