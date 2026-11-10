<template>
  <!-- The documents an answer is based on. `read` lists them; `edit` lets them be removed and
       added in place, with the search at the foot of the same table. -->
  <div
    :class="[
      'rounded-lg border bg-background transition-shadow motion-reduce:transition-none',
      mode === 'edit' ? 'border-primary ring-[3px] ring-primary/15' : 'border-border',
    ]"
    data-testid="setup-documents"
  >
    <div
      class="flex min-h-10 items-center justify-between gap-2 rounded-t-lg border-b border-border bg-background-secondary py-1 pl-3 pr-1.5"
    >
      <span class="text-sm font-medium text-neutral-700">{{ title }}</span>
      <slot name="actions" />
    </div>

    <ul v-if="documents.length" :aria-label="title">
      <li
        v-for="doc in documents"
        :key="doc.id"
        class="grid grid-cols-[1.75rem_minmax(0,1fr)_auto] items-center gap-2.5 border-b border-border py-1.5 pl-3 pr-1.5 last:border-b-0"
      >
        <span class="grid h-7 w-7 place-items-center rounded-md bg-background-tertiary">
          <FileText class="h-3.5 w-3.5 text-neutral-muted" aria-hidden="true" />
        </span>
        <span class="truncate text-sm font-medium text-neutral-900">
          {{ pageTitle(doc.title) }}
        </span>
        <SetupIconButton
          v-if="mode === 'edit'"
          :label="$t('setup.documents.remove', { document: pageTitle(doc.title) })"
          :tooltip="$t('setup.documents.removeTip')"
          side="left"
          data-testid="setup-document-remove"
          @click="emit('remove', doc.id)"
        >
          <X class="h-4 w-4" aria-hidden="true" />
        </SetupIconButton>
        <SetupIconButton
          v-else-if="canOpen"
          :label="$t('setup.documents.open', { document: pageTitle(doc.title) })"
          :tooltip="$t('setup.documents.openTip')"
          side="left"
          @click="router.push(`/documents/${doc.id}`)"
        >
          <ExternalLink class="h-4 w-4" aria-hidden="true" />
        </SetupIconButton>
      </li>
    </ul>

    <div
      v-if="mode === 'edit'"
      class="border-t border-border p-2"
      :class="!documents.length && 'border-t-0'"
    >
      <SetupDocumentSearch
        ref="searchEl"
        :exclude-ids="[...excludeIds, ...documents.map((d) => d.id)]"
        @select="emit('add', $event)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { ExternalLink, FileText, X } from "lucide-vue-next";
import type { SetupDocumentRef } from "@/stores/setup";
import { pageTitle } from "@/utils/format";
import SetupDocumentSearch from "./SetupDocumentSearch.vue";
import SetupIconButton from "./SetupIconButton.vue";

withDefaults(
  defineProps<{
    documents: SetupDocumentRef[];
    mode: "read" | "edit";
    title: string;
    /** Whether the role can open a document in Knowledge. */
    canOpen?: boolean;
    /** Never offered in the search: the row's own answer document. */
    excludeIds?: string[];
  }>(),
  { canOpen: false, excludeIds: () => [] },
);

const emit = defineEmits<{
  remove: [documentId: string];
  add: [document: SetupDocumentRef];
}>();

const router = useRouter();
const searchEl = ref<InstanceType<typeof SetupDocumentSearch> | null>(null);
defineExpose({ focus: () => searchEl.value?.focus() });
</script>
