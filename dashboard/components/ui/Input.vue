<template>
  <input
    :value="modelValue ?? ''"
    :class="props.class"
    class="input"
    v-bind="$attrs"
    @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
  />
</template>

<script setup lang="ts">
export interface InputProps {
  class?: string;
  modelValue?: string | number | undefined;
}

const props = withDefaults(defineProps<InputProps>(), {
  class: "",
});

defineEmits<{
  "update:modelValue": [value: string];
}>();
</script>

<style lang="scss">
.input {
  display: flex;
  height: 2.5rem;
  width: 100%;
  border-radius: var(--border-radius-md);
  border: 1px solid var(--color-input);
  background-color: var(--color-background);
  padding: 0.5rem 0.75rem;
  font-size: 0.875rem;
  line-height: 1.25rem;
  outline: none;
  transition: box-shadow 0.2s;

  &::placeholder {
    color: var(--color-neutral-muted);
  }

  &::file-selector-button {
    border: 0;
    background-color: transparent;
    font-size: 0.875rem;
    line-height: 1.25rem;
    font-weight: 500;
  }

  &:focus-visible {
    outline: none;
    box-shadow:
      0 0 0 2px var(--color-background),
      0 0 0 4px var(--color-ring);
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }
}
</style>
