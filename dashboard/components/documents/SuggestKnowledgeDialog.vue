<template>
  <Dialog :open="open" size="lg" @update:open="handleOpenChange">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{{ $t("knowledgeSuggest.title") }}</DialogTitle>
        <DialogDescription>
          {{
            conversationId
              ? $t("knowledgeSuggest.descriptionConversation")
              : $t("knowledgeSuggest.descriptionDocument")
          }}
        </DialogDescription>
      </DialogHeader>

      <!-- Input state -->
      <div v-if="phase === 'input'" class="space-y-4">
        <Input
          v-model="feedback"
          type="textarea"
          rows="4"
          :label="$t('knowledgeSuggest.feedbackLabel')"
          :placeholder="
            conversationId
              ? $t('knowledgeSuggest.feedbackPlaceholderOptional')
              : $t('knowledgeSuggest.feedbackPlaceholderRequired')
          "
        />
      </div>

      <!-- Loading state -->
      <div v-else-if="phase === 'loading'" class="flex flex-col items-center gap-4 py-10">
        <Loader2 class="h-8 w-8 animate-spin text-primary" />
        <p class="text-sm text-neutral-muted">{{ $t("knowledgeSuggest.loading") }}</p>
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
            :description="$t('knowledgeSuggest.noChangesText')"
          />
        </div>

        <template v-else>
          <div class="flex items-center gap-2 text-sm">
            <Badge :variant="result.mode === 'add' ? 'success' : 'secondary'">
              {{
                result.mode === "add"
                  ? $t("knowledgeSuggest.modeAdd")
                  : $t("knowledgeSuggest.modeEdit")
              }}
            </Badge>
            <span class="font-medium text-foreground">{{ result.title }}</span>
          </div>

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

          <Input
            v-if="editingText"
            v-model="result.revisedMarkdown"
            type="textarea"
            rows="10"
            :label="$t('knowledgeSuggest.textLabel')"
          />
          <InstructionsDiff
            v-else
            :current-markdown="result.currentMarkdown"
            :revised-markdown="result.revisedMarkdown"
            :references="noReferences"
          />
          <div>
            <Button variant="ghost" size="sm" @click="editingText = !editingText">
              <Pencil v-if="!editingText" class="h-4 w-4 mr-2" />
              {{
                editingText ? $t("knowledgeSuggest.showChanges") : $t("knowledgeSuggest.editText")
              }}
            </Button>
          </div>

          <Alert v-if="hasPlaceholder" variant="warning">
            <AlertDescription>{{ $t("knowledgeSuggest.placeholderWarning") }}</AlertDescription>
          </Alert>

          <p class="text-xs text-neutral-muted">
            {{
              result.mode === "add"
                ? $t("knowledgeSuggest.addHint")
                : $t("knowledgeSuggest.editHint")
            }}
          </p>
        </template>

        <Alert v-if="staleWarning" variant="warning">
          <AlertDescription>{{ $t("knowledgeSuggest.staleWarning") }}</AlertDescription>
        </Alert>
      </div>

      <DialogFooter>
        <template #primary>
          <Button variant="outline" :disabled="applying" @click="handleOpenChange(false)">
            {{ phase === "review" ? $t("suggest.discard") : $t("common.cancel") }}
          </Button>
          <Button
            v-if="phase === 'input'"
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
            @click="generate"
          >
            <RefreshCw class="h-4 w-4 mr-2" />
            {{ $t("suggest.regenerate") }}
          </Button>
          <Button
            v-if="phase === 'review' && result && !result.noChangesNeeded"
            :loading="applying"
            :disabled="hasPlaceholder || !result.revisedMarkdown.trim()"
            @click="apply"
          >
            <Check class="h-4 w-4 mr-2" />
            {{ result.mode === "add" ? $t("knowledgeSuggest.addQa") : $t("knowledgeSuggest.save") }}
          </Button>
        </template>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Sparkles, Check, RefreshCw, Loader2, Pencil } from "lucide-vue-next";
import { HayApi } from "@/utils/api";
import { markdownToDocumentContent } from "@/utils/markdownToDocument";
import type { MentionReferences } from "@/utils/markdownToTiptap";
import { useToast } from "@/composables/useToast";
import { useI18n } from "vue-i18n";

type CreateDocumentInput = Parameters<typeof HayApi.documents.create.mutate>[0];

interface KnowledgeSuggestionResult {
  mode: "edit" | "add";
  noChangesNeeded: boolean;
  analysis: string;
  changes: Array<{
    section: string;
    changeType: "added" | "modified" | "removed";
    rationale: string;
  }>;
  documentId: string | null;
  title: string;
  currentMarkdown: string;
  revisedMarkdown: string;
  baseUpdatedAt: string | null;
}

const props = defineProps<{
  open: boolean;
  conversationId?: string;
  /** Restrict the suggestion to this document (the document page). */
  documentId?: string;
}>();

const emit = defineEmits<{
  "update:open": [value: boolean];
  applied: [documentId: string];
}>();

const toast = useToast();
const { t } = useI18n();

const noReferences: MentionReferences = { actions: [], documents: [] };
const phase = ref<"input" | "loading" | "review">("input");
const feedback = ref("");
const result = ref<KnowledgeSuggestionResult | null>(null);
const applying = ref(false);
const staleWarning = ref(false);
const editingText = ref(false);

// The AI marks facts it does not know as "[to confirm: …]" ("[a confirmar: …]");
// they must be filled in before anything reaches the knowledge base.
const PLACEHOLDER_REGEX = /\[(to confirm|a confirmar)\b/i;
const hasPlaceholder = computed(() => PLACEHOLDER_REGEX.test(result.value?.revisedMarkdown ?? ""));

watch(
  () => props.open,
  (open) => {
    if (open) {
      phase.value = "input";
      feedback.value = "";
      result.value = null;
      staleWarning.value = false;
      editingText.value = false;
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
  result.value = null;
  staleWarning.value = false;
  editingText.value = false;
  phase.value = "loading";
  try {
    result.value = (await HayApi.documents.suggestEdits.mutate({
      conversationId: props.conversationId,
      documentId: props.documentId,
      feedback: feedback.value.trim() || undefined,
    })) as KnowledgeSuggestionResult;
    phase.value = "review";
  } catch (error) {
    console.error("Failed to generate knowledge suggestion:", error);
    toast.error(t("suggest.generateError"));
    phase.value = "input";
  }
}

async function apply() {
  const suggestion = result.value;
  if (!suggestion) return;
  applying.value = true;
  try {
    const { json, html } = markdownToDocumentContent(suggestion.revisedMarkdown);
    let documentId: string;

    if (suggestion.mode === "edit" && suggestion.documentId) {
      // Staleness check: warn once if the document changed since the
      // suggestion was generated; a second click saves anyway.
      if (!staleWarning.value) {
        const current = await HayApi.documents.getById.query({ id: suggestion.documentId });
        const updatedAt = current?.updatedAt ? new Date(current.updatedAt).toISOString() : null;
        if (updatedAt !== suggestion.baseUpdatedAt) {
          staleWarning.value = true;
          return;
        }
      }
      await HayApi.documents.update.mutate({
        id: suggestion.documentId,
        contentJson: json as Record<string, unknown>,
        contentHtml: html,
      });
      documentId = suggestion.documentId;
      toast.success(t("knowledgeSuggest.savedToast"));
    } else {
      const created = await HayApi.documents.create.mutate({
        title: suggestion.title,
        content: suggestion.revisedMarkdown,
        contentJson: json as Record<string, unknown>,
        contentHtml: html,
        type: "faq" as CreateDocumentInput["type"],
        status: "published" as CreateDocumentInput["status"],
      });
      documentId = created.id;
      toast.success(t("knowledgeSuggest.addedToast"));
    }

    emit("applied", documentId);
    emit("update:open", false);
  } catch (error) {
    console.error("Failed to apply knowledge suggestion:", error);
    toast.error(t("suggest.applyError"));
  } finally {
    applying.value = false;
  }
}
</script>
