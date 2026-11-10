<template>
  <div class="space-y-4">
    <Input
      id="hc-collection-title"
      :model-value="modelValue.title"
      :label="$t('helpCenter.collection.title')"
      :placeholder="$t('helpCenter.collection.titlePlaceholder')"
      maxlength="120"
      @update:model-value="update({ title: String($event) })"
    />
    <Input
      id="hc-collection-description"
      :model-value="modelValue.description"
      :label="$t('helpCenter.collection.description')"
      :placeholder="$t('helpCenter.collection.descriptionPlaceholder')"
      maxlength="300"
      @update:model-value="update({ description: String($event) })"
    />

    <div class="space-y-1.5">
      <Label for="hc-collection-icon">{{ $t("helpCenter.collection.icon") }}</Label>
      <div
        role="group"
        :aria-label="$t('helpCenter.collection.iconSuggestions')"
        class="grid grid-cols-8 gap-1 sm:grid-cols-12"
      >
        <button
          v-for="emoji in COLLECTION_EMOJI"
          :key="emoji"
          type="button"
          class="flex h-9 items-center justify-center rounded-md border text-lg transition-colors hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          :class="modelValue.icon === emoji ? 'border-primary bg-primary/5' : 'border-transparent'"
          :aria-pressed="modelValue.icon === emoji"
          @click="update({ icon: modelValue.icon === emoji ? '' : emoji })"
        >
          {{ emoji }}
        </button>
      </div>
      <div class="w-40">
        <Input
          id="hc-collection-icon"
          :model-value="modelValue.icon"
          :placeholder="$t('helpCenter.collection.iconPlaceholder')"
          :maxlength="COLLECTION_ICON_MAX_LENGTH"
          @update:model-value="update({ icon: String($event) })"
        />
      </div>
      <p class="text-sm text-neutral-muted">{{ $t("helpCenter.collection.iconHint") }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  COLLECTION_EMOJI,
  COLLECTION_ICON_MAX_LENGTH,
  type HelpCenterCollectionDraft,
} from "@/utils/help-center";

const props = defineProps<{ modelValue: HelpCenterCollectionDraft }>();
const emit = defineEmits<{ "update:modelValue": [value: HelpCenterCollectionDraft] }>();

function update(patch: Partial<HelpCenterCollectionDraft>) {
  emit("update:modelValue", { ...props.modelValue, ...patch });
}
</script>
