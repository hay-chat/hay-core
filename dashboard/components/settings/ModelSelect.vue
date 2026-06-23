<template>
  <div class="space-y-2">
    <Input
      :model-value="isCustom ? CUSTOM : modelValue"
      type="select"
      :label="label"
      :options="selectOptions"
      :helper-text="isCustom ? undefined : helperText"
      @update:model-value="onSelect"
    />
    <Input
      v-if="isCustom"
      :model-value="modelValue"
      :placeholder="customPlaceholder"
      :helper-text="helperText"
      @update:model-value="(v: string | number | boolean) => emit('update:modelValue', String(v))"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * A model picker: a dropdown of preset model ids for the selected provider, plus a
 * "Custom…" option that reveals a free-text field. Custom state is derived purely
 * from whether the current value is one of the presets, so there's no internal
 * state to get out of sync when the preset list changes (e.g. provider switches).
 */
const props = defineProps<{
  modelValue: string;
  options: string[];
  label?: string;
  helperText?: string;
  customLabel: string;
  customPlaceholder: string;
}>();

const emit = defineEmits<{ "update:modelValue": [string] }>();

const CUSTOM = "__custom__";

// A value that isn't a known preset (including empty) is shown as custom.
const isCustom = computed(() => !props.options.includes(props.modelValue));

const selectOptions = computed(() => [
  ...props.options.map((o) => ({ label: o, value: o })),
  { label: props.customLabel, value: CUSTOM },
]);

function onSelect(value: string | number | boolean) {
  // Picking "Custom…" clears the value so the free-text field starts empty;
  // picking a preset emits it directly.
  const v = String(value);
  emit("update:modelValue", v === CUSTOM ? "" : v);
}
</script>
