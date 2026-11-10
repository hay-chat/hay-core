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
        <!-- The reviewer's translation of the reply; the editor below holds the original -->
        <div
          v-if="translation"
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
        <div v-if="isEdited" class="bg-neutral-100 dark:bg-neutral-800 p-3 rounded-md">
          <p class="text-xs font-medium text-neutral-muted mb-1">
            {{ t("conversations.draftApproval.original") }}
          </p>
          <p class="text-sm">{{ originalContent }}</p>
        </div>

        <!-- Editable Content -->
        <div>
          <!-- TODO: let the reviewer edit in their own language and translate the edit back. -->
          <Input
            id="message-content"
            v-model="editedContent"
            :label="
              translation
                ? t('conversations.translation.approvalOriginalLabel')
                : t('conversations.draftApproval.content')
            "
            type="textarea"
            rows="8"
            class="w-full mt-1"
            :placeholder="t('conversations.draftApproval.placeholder')"
          />
          <p class="text-xs text-neutral-muted mt-1">
            {{ t("conversations.draftApproval.characters", { count: editedContent.length }) }}
          </p>
        </div>
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
import { languageName } from "@/utils/languages";
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

const editedContent = ref("");
const isEdited = computed(() => editedContent.value !== props.originalContent);

// Reset content when dialog opens
watch(
  () => props.open,
  (newValue) => {
    if (newValue) {
      editedContent.value = props.originalContent;
    }
  },
);

const handleApprove = async () => {
  try {
    const content = isEdited.value ? editedContent.value : undefined;
    await approveMessage(props.messageId, content);
    emit("approved", props.messageId, content);
    emit("update:open", false);
  } catch (error) {
    console.error("Failed to approve message:", error);
  }
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
