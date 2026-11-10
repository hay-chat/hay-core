<template>
  <Dialog :open="open" size="lg" @update:open="$emit('update:open', $event)">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{{ t("conversations.draftApproval.dialogTitle") }}</DialogTitle>
        <DialogDescription>
          {{ t("conversations.draftApproval.dialogDescription") }}
        </DialogDescription>
      </DialogHeader>

      <div class="space-y-4">
        <!-- Editing in the reviewer's language: the customer gets the edit translated -->
        <div
          v-if="editsTranslation"
          class="bg-neutral-100 dark:bg-neutral-800 p-3 rounded-md"
          data-testid="approval-customer-version"
        >
          <p class="text-xs font-medium text-neutral-muted mb-1">
            {{ t("conversations.translation.approvalCustomerVersion") }}
          </p>
          <p class="text-sm whitespace-pre-wrap">{{ originalContent }}</p>
        </div>

        <!-- Editing the original: the reviewer's translation is shown for reference -->
        <div
          v-else-if="translation"
          class="bg-neutral-100 dark:bg-neutral-800 p-3 rounded-md"
          data-testid="approval-translation"
        >
          <p class="text-xs font-medium text-neutral-muted mb-1">
            {{
              translation.sourceLanguage
                ? t("conversations.translation.approvalTranslatedFrom", {
                    language: languageName(translation.sourceLanguage, locale),
                  })
                : t("conversations.translation.approvalTranslated")
            }}
          </p>
          <p class="text-sm whitespace-pre-wrap">{{ translation.text }}</p>
          <p class="text-xs text-neutral-muted mt-2">
            {{ t("conversations.translation.approvalEditsOriginal") }}
          </p>
        </div>

        <!-- Original Content (if edited) -->
        <div
          v-if="isEdited && !editsTranslation"
          class="bg-neutral-100 dark:bg-neutral-800 p-3 rounded-md"
        >
          <p class="text-xs font-medium text-neutral-muted mb-1">
            {{ t("conversations.draftApproval.original") }}
          </p>
          <p class="text-sm">{{ originalContent }}</p>
        </div>

        <!-- Editable Content -->
        <div>
          <Input
            id="message-content"
            v-model="editedContent"
            :label="editorLabel"
            type="textarea"
            rows="8"
            class="w-full mt-1"
            :placeholder="t('conversations.draftApproval.placeholder')"
          />
          <p class="text-xs text-neutral-muted mt-1">
            {{ t("conversations.draftApproval.characters", { count: editedContent.length }) }}
          </p>
        </div>

        <!-- The edit could not be translated: the reply is still waiting -->
        <Alert
          v-if="translationFailed"
          variant="destructive"
          data-testid="approval-translation-failed"
        >
          <AlertTitle>{{ t("conversations.translation.approvalFailedTitle") }}</AlertTitle>
          <AlertDescription>
            {{ t("conversations.translation.approvalFailedMessage") }}
            <div class="flex flex-wrap gap-2 mt-3">
              <Button
                size="sm"
                variant="outline"
                :loading="loading"
                data-testid="approval-approve-original"
                @click="approve()"
              >
                {{ t("conversations.translation.approvalApproveOriginal") }}
              </Button>
              <Button
                size="sm"
                variant="outline"
                :disabled="loading"
                data-testid="approval-edit-untranslated"
                @click="editWithoutTranslation"
              >
                {{ t("conversations.translation.approvalEditUntranslated") }}
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      </div>

      <DialogFooter>
        <template #secondary>
          <Button variant="destructive" :disabled="loading" @click="handleBlock">
            <Ban class="h-4 w-4 mr-2" />
            {{ t("conversations.draftApproval.blockMessage") }}
          </Button>
        </template>
        <template #primary>
          <Button variant="outline" :disabled="loading" @click="handleCancel">
            {{ t("common.cancel") }}
          </Button>
          <Button
            variant="success"
            :disabled="loading || !editedContent.trim()"
            @click="handleApprove"
          >
            <Check class="h-4 w-4 mr-2" />
            {{
              isEdited
                ? t("conversations.draftApproval.approveEdited")
                : t("conversations.draftApproval.approve")
            }}
          </Button>
        </template>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { Check, Ban } from "lucide-vue-next";
import { useI18n } from "vue-i18n";
import { useMessageApproval } from "@/composables/useMessageApproval";
import { languageName, type LanguageCode } from "@/utils/languages";
import type { DisplayTranslation } from "@/composables/useMessageTranslations";

const { t, locale } = useI18n();

const props = defineProps<{
  open: boolean;
  messageId: string;
  originalContent: string;
  /** The reviewer's translation of the pending reply, when they have a translation language. */
  translation?: DisplayTranslation | null;
}>();

const emit = defineEmits<{
  "update:open": [value: boolean];
  approved: [messageId: string, editedContent?: string];
  blocked: [messageId: string];
}>();

const { approveMessage, blockMessage, loading } = useMessageApproval();

/**
 * A reviewer with a translation edits the reply in their own language and the
 * server translates it for the customer; "edit without translation" (after a
 * failed translation) switches to editing the original.
 */
const editUntranslated = ref(false);
const editsTranslation = computed(() => !!props.translation && !editUntranslated.value);
const baseContent = computed(() =>
  editsTranslation.value ? props.translation!.text : props.originalContent,
);
const editedContent = ref("");
const isEdited = computed(() => editedContent.value !== baseContent.value);
const translationFailed = ref(false);

const editorLabel = computed(() => {
  if (editsTranslation.value) {
    return t("conversations.translation.approvalEditLabel", {
      language: languageName(props.translation!.language, locale.value),
    });
  }
  return props.translation
    ? t("conversations.translation.approvalOriginalLabel")
    : t("conversations.draftApproval.content");
});

// Reset content when dialog opens
watch(
  () => props.open,
  (newValue) => {
    if (newValue) {
      editUntranslated.value = false;
      translationFailed.value = false;
      editedContent.value = baseContent.value;
    }
  },
);

const isTranslationFailure = (error: unknown) =>
  error instanceof Error && error.message === "TRANSLATION_FAILED";

/** Release the reply; with no `content` it goes out as is. */
const approve = async (content?: string, editedInLanguage?: LanguageCode) => {
  try {
    await approveMessage(props.messageId, content, editedInLanguage);
    emit("approved", props.messageId, content);
    emit("update:open", false);
  } catch (error) {
    if (editedInLanguage && isTranslationFailure(error)) {
      translationFailed.value = true;
      return;
    }
    console.error("Failed to approve message:", error);
  }
};

const handleApprove = () => {
  if (!isEdited.value) return approve();
  return editsTranslation.value
    ? approve(editedContent.value, props.translation!.language)
    : approve(editedContent.value);
};

const editWithoutTranslation = () => {
  editUntranslated.value = true;
  translationFailed.value = false;
  editedContent.value = props.originalContent;
};

const handleBlock = async () => {
  try {
    await blockMessage(props.messageId, "Blocked by reviewer");
    emit("blocked", props.messageId);
    emit("update:open", false);
  } catch (error) {
    console.error("Failed to block message:", error);
  }
};

const handleCancel = () => {
  emit("update:open", false);
};
</script>
