<template>
  <Dialog :open="open" size="lg" @update:open="handleOpenChange">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{{ $t("suggest.title") }}</DialogTitle>
        <DialogDescription>
          {{
            conversationId
              ? $t("suggest.descriptionConversation")
              : $t("suggest.descriptionFeedback")
          }}
        </DialogDescription>
      </DialogHeader>

      <!-- Input state -->
      <div v-if="phase === 'input'" class="space-y-4">
        <Input
          v-model="feedback"
          type="textarea"
          rows="4"
          :label="$t('suggest.feedbackLabel')"
          :placeholder="
            conversationId
              ? $t('suggest.feedbackPlaceholderOptional')
              : $t('suggest.feedbackPlaceholderRequired')
          "
        />
        <div
          v-if="initialSelection"
          class="rounded-md bg-background-secondary border border-border p-3"
        >
          <p class="text-xs font-medium text-neutral-muted mb-1">
            {{ $t("suggest.selectionLabel") }}
          </p>
          <p class="text-sm text-foreground line-clamp-3 whitespace-pre-wrap">
            {{ initialSelection }}
          </p>
        </div>
      </div>

      <!-- Loading state -->
      <div v-else-if="phase === 'loading'" class="flex flex-col items-center gap-4 py-10">
        <Loader2 class="h-8 w-8 animate-spin text-primary" />
        <p class="text-sm text-neutral-muted">
          {{ conversationId ? $t("suggest.loadingConversation") : $t("suggest.loadingFeedback") }}
        </p>
      </div>

      <!-- Review state -->
      <div
        v-else-if="phase === 'review' && result"
        class="space-y-4 max-h-[60vh] overflow-y-auto pr-1"
      >
        <div class="rounded-md bg-background-secondary border border-border p-3">
          <p class="text-xs font-medium text-neutral-muted mb-1">
            {{ $t("suggest.analysisLabel") }}
          </p>
          <p class="text-sm text-foreground whitespace-pre-wrap">{{ result.analysis }}</p>
        </div>

        <div v-if="result.noChangesNeeded">
          <EmptyState
            :title="$t('suggest.noChangesTitle')"
            :description="$t('suggest.noChangesText')"
          />
        </div>

        <template v-else>
          <div v-if="result.changes.length" class="space-y-2">
            <p class="text-xs font-medium text-neutral-muted">{{ $t("suggest.changesLabel") }}</p>
            <div
              v-for="(change, index) in result.changes"
              :key="index"
              class="flex items-start gap-2 text-sm"
            >
              <Badge :variant="changeBadgeVariant(change.changeType)" class="mt-0.5 shrink-0">
                {{ $t(`suggest.changeType.${change.changeType}`) }}
              </Badge>
              <p class="text-foreground">
                <span class="font-medium">{{ change.section }}</span>
                <span class="text-neutral-muted"> — {{ change.rationale }}</span>
              </p>
            </div>
          </div>

          <InstructionsDiff
            :current-markdown="result.currentMarkdown"
            :revised-markdown="result.revisedMarkdown"
            :references="result.references"
          />
        </template>

        <Alert v-if="staleWarning" variant="warning">
          <AlertDescription>{{ $t("suggest.staleWarning") }}</AlertDescription>
        </Alert>
      </div>

      <DialogFooter>
        <template #primary>
          <Button variant="outline" :disabled="applying" @click="handleOpenChange(false)">
            {{ phase === "review" ? $t("suggest.discard") : $t("common.cancel") }}
          </Button>
          <Button
            v-if="phase === 'input'"
            :loading="false"
            :disabled="!conversationId && !feedback.trim()"
            @click="generate"
          >
            <Sparkles class="h-4 w-4 mr-2" />
            {{ $t("suggest.generate") }}
          </Button>
          <Button
            v-else-if="phase === 'review' && result && !result.noChangesNeeded"
            variant="outline"
            :disabled="applying"
            @click="regenerate"
          >
            <RefreshCw class="h-4 w-4 mr-2" />
            {{ $t("suggest.regenerate") }}
          </Button>
          <Button
            v-if="phase === 'review' && result && !result.noChangesNeeded"
            :loading="applying"
            @click="apply"
          >
            <Check class="h-4 w-4 mr-2" />
            {{ $t("suggest.applyToDraft") }}
          </Button>
        </template>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { Sparkles, Check, RefreshCw, Loader2 } from "lucide-vue-next";
import type { JSONContent } from "@tiptap/vue-3";
import { HayApi } from "@/utils/api";
import { markdownToTiptapJSON, type MentionReferences } from "@/utils/markdownToTiptap";
import { useToast } from "@/composables/useToast";
import { useI18n } from "vue-i18n";

interface SuggestEditsResult {
  currentMarkdown: string;
  revisedMarkdown: string;
  analysis: string;
  changes: Array<{
    section: string;
    changeType: "added" | "modified" | "removed";
    rationale: string;
  }>;
  noChangesNeeded: boolean;
  references: MentionReferences;
  baseVersionId: string | null;
}

const props = defineProps<{
  open: boolean;
  playbookId: string;
  conversationId?: string;
  initialSelection?: string;
}>();

const emit = defineEmits<{
  "update:open": [value: boolean];
  applied: [instructions: JSONContent];
}>();

const toast = useToast();
const { t } = useI18n();

const phase = ref<"input" | "loading" | "review">("input");
const feedback = ref("");
const result = ref<SuggestEditsResult | null>(null);
const applying = ref(false);
const staleWarning = ref(false);

watch(
  () => props.open,
  (open) => {
    if (open) {
      phase.value = "input";
      feedback.value = "";
      result.value = null;
      staleWarning.value = false;
    }
  },
);

function handleOpenChange(value: boolean) {
  if (applying.value) return;
  emit("update:open", value);
}

function changeBadgeVariant(changeType: string): "success" | "destructive" | "secondary" {
  if (changeType === "added") return "success";
  if (changeType === "removed") return "destructive";
  return "secondary";
}

async function generate() {
  phase.value = "loading";
  try {
    result.value = (await HayApi.playbooks.suggestEdits.mutate({
      playbookId: props.playbookId,
      conversationId: props.conversationId,
      feedback: feedback.value.trim() || undefined,
      selection: props.initialSelection || undefined,
    })) as SuggestEditsResult;
    phase.value = "review";
  } catch (error) {
    console.error("Failed to generate playbook suggestion:", error);
    toast.error(t("suggest.generateError"));
    phase.value = "input";
  }
}

function regenerate() {
  result.value = null;
  staleWarning.value = false;
  generate();
}

async function apply() {
  if (!result.value) return;
  applying.value = true;
  try {
    // Staleness check: warn once if the draft changed since the suggestion
    // was generated; a second click applies anyway.
    if (!staleWarning.value) {
      const draft = await HayApi.playbooks.versions.getDraft.query({
        playbookId: props.playbookId,
      });
      if (draft && draft.id !== result.value.baseVersionId) {
        staleWarning.value = true;
        return;
      }
    }

    const instructions = markdownToTiptapJSON(
      result.value.revisedMarkdown,
      result.value.references,
    );
    await HayApi.playbooks.versions.saveDraft.mutate({
      playbookId: props.playbookId,
      instructions,
    });
    toast.success(t("suggest.appliedToast"));
    emit("applied", instructions);
    emit("update:open", false);
  } catch (error) {
    console.error("Failed to apply playbook suggestion:", error);
    toast.error(t("suggest.applyError"));
  } finally {
    applying.value = false;
  }
}
</script>
