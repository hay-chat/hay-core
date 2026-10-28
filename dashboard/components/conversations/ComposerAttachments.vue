<template>
  <div>
    <input
      ref="fileInput"
      type="file"
      class="hidden"
      multiple
      data-testid="composer-attachment-input"
      @change="onFilesPicked"
    />
    <ul
      v-if="modelValue.length"
      class="mb-2 flex flex-wrap gap-2"
      data-testid="composer-attachments"
    >
      <li
        v-for="item in modelValue"
        :key="item.key"
        class="flex max-w-full items-center gap-1.5 rounded-md border bg-muted px-2 py-1 text-xs"
      >
        <Loader2 v-if="!item.attachment" class="h-3.5 w-3.5 flex-shrink-0 animate-spin" />
        <Paperclip v-else class="h-3.5 w-3.5 flex-shrink-0" />
        <span class="truncate" :title="item.name">
          {{
            item.attachment
              ? item.name
              : t("conversations.attachment.uploading", { name: item.name })
          }}
        </span>
        <button
          type="button"
          class="flex-shrink-0 rounded p-0.5 hover:bg-background focus-visible:outline focus-visible:outline-2"
          :aria-label="t('conversations.attachment.remove', { name: item.name })"
          @click="remove(item.key)"
        >
          <X class="h-3.5 w-3.5" />
        </button>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
/**
 * Files a person adds to their reply in the Inbox composer (D8-16). Each file
 * is uploaded as soon as it is picked (`conversations.uploadAttachment`); the
 * page sends the ready ones' ids with the message. The server checks type and
 * size; the size check here only saves a pointless upload.
 */
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { Loader2, Paperclip, X } from "lucide-vue-next";
import { HayApi } from "@/utils/api";
import { useToast } from "@/composables/useToast";
import type { RouterOutputs } from "@/types/trpc";

export type ComposerAttachment = RouterOutputs["conversations"]["uploadAttachment"];
export interface ComposerAttachmentItem {
  key: string;
  name: string;
  /** Set once the upload finished. */
  attachment?: ComposerAttachment;
}

/** Matches the server's default conversation media cap (CONVERSATION_MEDIA_MAX_SIZE_MB). */
const MAX_FILE_MB = 25;
/** Matches STAFF_ATTACHMENT_MAX_COUNT on the server. */
const MAX_FILES = 10;

const props = defineProps<{ conversationId: string; modelValue: ComposerAttachmentItem[] }>();
const emit = defineEmits<{ "update:modelValue": [items: ComposerAttachmentItem[]] }>();

const { t } = useI18n();
const toast = useToast();
const fileInput = ref<HTMLInputElement>();
// The latest list, so uploads finishing out of order don't overwrite each other.
let items = props.modelValue;

const update = (next: ComposerAttachmentItem[]) => {
  items = next;
  emit("update:modelValue", next);
};

const remove = (key: string) => update(items.filter((item) => item.key !== key));

const readAsBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

const upload = async (file: File, key: string) => {
  try {
    const attachment = await HayApi.conversations.uploadAttachment.mutate({
      conversationId: props.conversationId,
      data: await readAsBase64(file),
      mimeType: file.type || "application/octet-stream",
      fileName: file.name,
    });
    if (!items.some((item) => item.key === key)) return; // removed while uploading
    update(items.map((item) => (item.key === key ? { ...item, attachment } : item)));
  } catch {
    remove(key);
    toast.error(t("conversations.attachment.uploadFailed", { name: file.name }));
  }
};

const onFilesPicked = (event: Event) => {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  input.value = "";
  items = props.modelValue;
  for (const file of files) {
    if (items.length >= MAX_FILES) {
      toast.error(t("conversations.attachment.tooMany", { count: MAX_FILES }));
      break;
    }
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      toast.error(t("conversations.attachment.tooLarge", { name: file.name, size: MAX_FILE_MB }));
      continue;
    }
    const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    update([...items, { key, name: file.name }]);
    void upload(file, key);
  }
};

defineExpose({ open: () => fileInput.value?.click(), maxFiles: MAX_FILES });
</script>
