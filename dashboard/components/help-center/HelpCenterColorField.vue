<template>
  <div class="space-y-1.5">
    <Label :for="id">{{ label }}</Label>
    <div class="flex items-center gap-2">
      <input
        type="color"
        class="h-10 w-12 shrink-0 cursor-pointer rounded-md border border-input bg-background p-1"
        :value="modelValue"
        :aria-label="pickerLabel"
        @input="onColorPicked"
      />
      <div class="w-32">
        <Input
          :id="id"
          v-model="hexText"
          maxlength="7"
          autocomplete="off"
          spellcheck="false"
          :aria-describedby="`${id}-notes`"
        />
      </div>
    </div>
    <div
      v-if="swatches?.length"
      class="flex flex-wrap items-center gap-1.5"
      role="group"
      :aria-label="$t('helpCenter.theme.brandColors')"
    >
      <span class="mr-1 text-xs text-neutral-muted">{{ $t("helpCenter.theme.brandColors") }}</span>
      <button
        v-for="swatch in swatches"
        :key="swatch"
        type="button"
        class="h-6 w-6 rounded-full border border-input ring-offset-2 ring-offset-background transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        :class="{ 'ring-2 ring-primary': swatch === modelValue }"
        :style="{ backgroundColor: swatch }"
        :aria-label="$t('helpCenter.theme.useBrandColor', { color: swatch })"
        :aria-pressed="swatch === modelValue"
        :data-testid="`${testId}-swatch`"
        @click="emit('update:modelValue', swatch)"
      />
    </div>
    <div :id="`${id}-notes`" class="space-y-1 text-sm" aria-live="polite">
      <p v-if="!hexValid" class="text-destructive" :data-testid="`${testId}-invalid`">
        {{ $t("helpCenter.theme.colorInvalid") }}
      </p>
      <slot v-else />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { isHexColor } from "@/utils/help-center";

/** A `#rrggbb` colour as a picker plus a hex field; only a valid colour is ever emitted. */
const props = defineProps<{
  modelValue: string;
  id: string;
  label: string;
  pickerLabel: string;
  /** Prefix of the notes' test ids. */
  testId: string;
  /** One-click colours, such as the ones imported from the website. */
  swatches?: string[];
}>();

const emit = defineEmits<{ "update:modelValue": [value: string] }>();

// The text field may hold a half-typed colour; the model only ever holds a valid one.
const hexText = ref(props.modelValue);
const hexValid = computed(() => isHexColor(hexText.value.trim()));

watch(hexText, (text) => {
  const hex = text.trim().toLowerCase();
  if (isHexColor(hex) && hex !== props.modelValue) emit("update:modelValue", hex);
});
watch(
  () => props.modelValue,
  (color) => {
    if (color !== hexText.value.trim().toLowerCase()) hexText.value = color;
  },
);

function onColorPicked(event: Event) {
  if (event.target instanceof HTMLInputElement) {
    emit("update:modelValue", event.target.value.toLowerCase());
  }
}
</script>
