<template>
  <div class="input-wrapper">
    <Label v-if="label && type !== 'switch'" :for="inputId">{{ label }}</Label>

    <!-- Select Type -->
    <div v-if="type === 'select'" class="select-wrapper">
      <Select v-model="selectValue">
        <SelectTrigger :class="[props.class, { 'has-error': error }]">
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

    <!-- Switch Type -->
    <div v-else-if="type === 'switch'" class="switch-wrapper">
      <Switch
        :id="inputId"
        :model-value="Boolean(modelValue)"
        :disabled="disabledAttr"
        :name="nameAttr"
        :required="requiredAttr"
        :class="props.class"
        @update:model-value="handleSwitchChange"
      />
      <Label v-if="label" :for="inputId">{{ label }}</Label>
    </div>

    <!-- Regular Input -->
    <div v-else-if="type !== 'textarea'" class="input-container">
      <component :is="iconStart" v-if="iconStart" class="input-icon icon-start" />
      <input
        :id="inputId"
        :value="typeof modelValue === 'boolean' ? '' : (modelValue ?? '')"
        :type="actualInputType"
        :class="[
          props.class,
          {
            'has-icon-start': iconStart,
            'has-icon-end': iconEnd || type === 'password',
            'has-error': error,
          },
        ]"
        :placeholder="placeholder"
        class="input"
        v-bind="$attrs"
        @input="handleInputChange"
      />
      <component :is="iconEnd" v-if="iconEnd && type !== 'password'" class="input-icon icon-end" />
      <button
        v-if="type === 'password'"
        type="button"
        class="password-toggle"
        @click="togglePasswordVisibility"
      >
        <Eye v-if="showPassword" class="w-5 h-5" />
        <EyeOff v-else class="w-5 h-5" />
      </button>
    </div>

    <!-- Textarea -->
    <textarea
      v-else
      :id="inputId"
      ref="textareaRef"
      :value="typeof modelValue === 'boolean' ? '' : (modelValue ?? '')"
      :class="[props.class, 'input', 'textarea', { 'has-error': error }]"
      :placeholder="placeholder"
      v-bind="$attrs"
      @input="handleInput"
    />
    <p v-if="error" class="error-text">{{ error }}</p>
    <p v-else-if="hint" class="hint-text">{{ hint }}</p>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onMounted, watch, useAttrs, type Component } from "vue";
import { Eye, EyeOff } from "lucide-vue-next";
import Select from "./Select.vue";
import SelectTrigger from "./SelectTrigger.vue";
import SelectValue from "./SelectValue.vue";
import SelectContent from "./SelectContent.vue";
import SelectItem from "./SelectItem.vue";
import Switch from "./Switch.vue";
import Label from "./Label.vue";

export type SelectOption = string | { label: string; value: string | number };

export interface InputProps {
  class?: string;
  modelValue?: string | number | boolean | undefined;
  type?: "text" | "textarea" | "select" | "password" | "email" | "switch";
  label?: string;
  hint?: string;
  error?: string;
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
  "update:modelValue": [value: string | number | boolean];
}>();

// Refs
const textareaRef = ref<HTMLTextAreaElement | null>(null);
const inputId = Math.random().toString(36).substring(7);
const showPassword = ref(false);

// Password toggle
const actualInputType = computed(() => {
  if (props.type === "password") {
    return showPassword.value ? "text" : "password";
  }
  return props.type;
});

const togglePasswordVisibility = () => {
  showPassword.value = !showPassword.value;
};

// Input handler for email trimming
const handleInputChange = (event: Event) => {
  const target = event.target as HTMLInputElement;
  let value = target.value;

  // Trim whitespace for email fields
  if (props.type === "email") {
    value = value.trim();
  }

  emit("update:modelValue", value);
};

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

// Switch handler
const handleSwitchChange = (value: boolean) => {
  emit("update:modelValue", value);
};

// Get attrs
const attrs = useAttrs();

// Computed properties for attrs
const disabledAttr = computed(() => attrs.disabled as boolean | undefined);
const nameAttr = computed(() => attrs.name as string | undefined);
const requiredAttr = computed(() => attrs.required as boolean | undefined);

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
watch(
  () => props.modelValue,
  () => {
    if (props.type === "textarea") {
      nextTick(() => {
        adjustTextareaHeight();
      });
    }
  },
);

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
  font-size: var(--font-size-input);
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
    font-size: var(--font-size-input);
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

  &.has-error {
    border-color: var(--color-destructive);

    &:focus-visible {
      box-shadow:
        0 0 0 2px var(--color-background),
        0 0 0 4px var(--color-destructive);
    }
  }
}

.hint-text {
  font-size: var(--font-size-sm);
  line-height: 1rem;
  color: var(--color-neutral-muted);
  margin: 0;
}

.error-text {
  font-size: var(--font-size-sm);
  line-height: 1rem;
  color: var(--color-destructive);
  margin: 0;
}

.select-wrapper {
  width: 100%;
}

.switch-wrapper {
  display: flex;
  align-items: center;
}

.password-toggle {
  position: absolute;
  right: 0.5rem;
  background: none;
  border: none;
  cursor: pointer;
  padding: 0.25rem;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-neutral-muted);
  transition: color 0.2s;
  pointer-events: auto;

  &:hover {
    color: var(--color-foreground);
  }

  &:focus {
    outline: none;
  }
}

.switch-wrapper {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
</style>
