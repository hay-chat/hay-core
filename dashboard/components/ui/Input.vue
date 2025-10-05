<template>
  <div class="input-wrapper">
    <Label v-if="label" :for="inputId">{{ label }}</Label>

    <!-- Select Type -->
    <div v-if="type === 'select'" class="select-wrapper">
      <Select v-model="selectValue">
        <SelectTrigger :class="props.class">
          <SelectValue :placeholder="placeholder" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem
            v-for="option in options"
            :key="getOptionValue(option)"
            :value="String(getOptionValue(option))"
          >
            {{ getOptionLabel(option) }}
          </SelectItem>
        </SelectContent>
      </Select>
    </div>

    <!-- Regular Input -->
    <div v-else-if="type !== 'textarea'" class="input-container">
      <component :is="iconStart" v-if="iconStart" class="input-icon icon-start" />
      <input
        :id="inputId"
        :value="modelValue ?? ''"
        :class="[props.class, { 'has-icon-start': iconStart, 'has-icon-end': iconEnd }]"
        :placeholder="placeholder"
        class="input"
        v-bind="$attrs"
        @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
      />
      <component :is="iconEnd" v-if="iconEnd" class="input-icon icon-end" />
    </div>

    <!-- Textarea -->
    <textarea
      v-else
      :id="inputId"
      ref="textareaRef"
      :value="modelValue ?? ''"
      :class="[props.class, 'input', 'textarea']"
      :placeholder="placeholder"
      v-bind="$attrs"
      @input="handleInput"
    />
    <p v-if="helperText" class="helper-text">{{ helperText }}</p>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onMounted, watch, type Component } from "vue";
import Select from "./Select.vue";
import SelectTrigger from "./SelectTrigger.vue";
import SelectValue from "./SelectValue.vue";
import SelectContent from "./SelectContent.vue";
import SelectItem from "./SelectItem.vue";
import Label from "./Label.vue";

export type SelectOption = string | { label: string; value: string | number };

export interface InputProps {
  class?: string;
  modelValue?: string | number | undefined;
  type?: "text" | "textarea" | "select";
  label?: string;
  helperText?: string;
  iconStart?: Component;
  iconEnd?: Component;
  options?: SelectOption[];
  placeholder?: string;
}

const props = withDefaults(defineProps<InputProps>(), {
  class: "",
  type: "text",
  options: () => [],
});

const emit = defineEmits<{
  "update:modelValue": [value: string | number];
}>();

// Refs
const textareaRef = ref<HTMLTextAreaElement | null>(null);
const inputId = Math.random().toString(36).substring(7);

// Select helpers
const getOptionValue = (option: SelectOption): string | number => {
  return typeof option === "string" ? option : option.value;
};

const getOptionLabel = (option: SelectOption): string => {
  return typeof option === "string" ? option : option.label;
};

// Select value management
const selectValue = computed({
  get: () => (props.modelValue ? String(props.modelValue) : undefined),
  set: (value: string | undefined) => {
    if (value) {
      // Try to convert back to number if the original was a number
      const numValue = Number(value);
      emit("update:modelValue", isNaN(numValue) ? value : numValue);
    }
  },
});

// Textarea helpers
const adjustTextareaHeight = () => {
  if (textareaRef.value) {
    textareaRef.value.style.height = "auto";
    textareaRef.value.style.height = `${textareaRef.value.scrollHeight}px`;
  }
};

const handleInput = (event: Event) => {
  const target = event.target as HTMLTextAreaElement;
  emit("update:modelValue", target.value);
  nextTick(() => {
    adjustTextareaHeight();
  });
};

// Watch for value changes to adjust textarea height
watch(() => props.modelValue, () => {
  if (props.type === "textarea") {
    nextTick(() => {
      adjustTextareaHeight();
    });
  }
});

onMounted(() => {
  if (props.type === "textarea") {
    adjustTextareaHeight();
  }
});
</script>

<style lang="scss">
.input-wrapper {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  width: 100%;
}

.input-container {
  position: relative;
  display: flex;
  align-items: center;
  width: 100%;
}

.input-icon {
  position: absolute;
  width: 1rem;
  height: 1rem;
  color: var(--color-neutral-muted);
  pointer-events: none;

  &.icon-start {
    left: 0.75rem;
  }

  &.icon-end {
    right: 0.75rem;
  }
}

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

  &.has-icon-start {
    padding-left: 2.5rem;
  }

  &.has-icon-end {
    padding-right: 2.5rem;
  }

  &.textarea {
    min-height: 2.5rem;
    height: auto;
    resize: none;
    overflow: hidden;
    font-family: inherit;
  }

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

.helper-text {
  font-size: 0.75rem;
  line-height: 1rem;
  color: var(--color-neutral-muted);
  margin: 0;
}

.select-wrapper {
  width: 100%;
}
</style>
