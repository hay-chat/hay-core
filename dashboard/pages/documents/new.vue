<template>
  <Page :title="$t('documents.new.pageTitle')">
    <template #header>
      <div class="flex items-center gap-3">
        <Button variant="ghost" @click="router.push('/documents')">
          <ArrowLeft class="h-4 w-4 mr-2" />
          {{ $t("documents.detail.backToDocuments") }}
        </Button>
        <Button :disabled="!canSave || saving" :loading="saving" @click="save">
          {{ $t("documents.new.save") }}
        </Button>
      </div>
    </template>

    <div class="space-y-4 max-w-3xl mx-auto w-full">
      <input
        v-model="title"
        type="text"
        :placeholder="$t('documents.new.titlePlaceholder')"
        class="w-full bg-transparent text-3xl font-semibold outline-none border-0 placeholder:text-neutral-muted/60"
      />

      <DocumentTiptap
        ref="editorRef"
        :placeholder="$t('documents.new.contentPlaceholder')"
        @update="onUpdate"
      />
    </div>
  </Page>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import { useRouter } from "vue-router";
import { HayApi } from "@/utils/api";
import { useToast } from "@/composables/useToast";
import type { JSONContent } from "@tiptap/vue-3";
import { ArrowLeft } from "lucide-vue-next";

const router = useRouter();
const { t } = useI18n();
const toast = useToast();

const title = ref("");
const editorJson = ref<JSONContent | null>(null);
const editorHtml = ref("");
const saving = ref(false);
const editorRef = ref<{
  getJSON: () => JSONContent | null;
  getHTML: () => string;
} | null>(null);

const canSave = computed(() => title.value.trim().length > 0);

const onUpdate = (payload: { json: JSONContent; html: string }) => {
  editorJson.value = payload.json;
  editorHtml.value = payload.html;
};

const save = async () => {
  if (!canSave.value || saving.value) return;
  saving.value = true;
  try {
    const json = editorJson.value || editorRef.value?.getJSON() || { type: "doc", content: [] };
    const html = editorHtml.value || editorRef.value?.getHTML() || "";
    const result = await HayApi.documents.create.mutate({
      title: title.value.trim(),
      content: html,
      contentJson: json as Record<string, unknown>,
      contentHtml: html,
    });
    toast.success(t("documents.new.created"));
    router.push(`/documents/${result.id}`);
  } catch (err) {
    console.error("Failed to create document:", err);
    toast.error(t("documents.new.createFailed"));
  } finally {
    saving.value = false;
  }
};
</script>
