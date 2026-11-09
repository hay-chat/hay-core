<template>
  <!-- Where drafting an answer from the picked documents stands. -->
  <p v-if="drafting" class="text-sm text-neutral-muted" role="status">
    {{ message("setup.panel.drafting") }}
  </p>
  <p v-else-if="failed" class="text-sm text-destructive" role="alert">
    {{ $t("setup.panel.draftError") }}
  </p>
  <p v-else-if="noAnswer" class="text-sm text-neutral-900" role="status">
    {{ message("setup.panel.noAnswer") }}
  </p>
  <div v-else-if="pendingDraft" class="flex flex-wrap items-center gap-x-3" role="status">
    <span class="text-sm text-neutral-muted">{{ $t("setup.panel.draftReady") }}</span>
    <Button
      type="button"
      variant="link"
      size="sm"
      class="min-h-11 md:min-h-0"
      @click="emit('replace')"
    >
      {{ $t("setup.panel.replaceDraft") }}
    </Button>
  </div>
</template>

<script setup lang="ts">
import type { SetupDocumentRef } from "@/stores/setup";
import { pageTitle } from "@/utils/format";

const props = defineProps<{
  drafting: boolean;
  failed: boolean;
  noAnswer: boolean;
  /** A draft is ready but the person typed their own text, so it waits to be swapped in. */
  pendingDraft: boolean;
  documents: SetupDocumentRef[];
}>();

const emit = defineEmits<{ replace: [] }>();

const { t } = useI18n();

/** One document is named; several are counted. */
const message = (key: string) =>
  props.documents.length === 1
    ? t(`${key}One`, { document: pageTitle(props.documents[0].title) })
    : t(`${key}Other`, { count: props.documents.length });
</script>
