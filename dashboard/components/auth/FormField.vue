<template>
  <div class="space-y-2">
    <Label v-if="label"
:for="id">
      {{ label }}
      <span v-if="required"
class="text-red-500">*</span>
    </Label>
    <div class="relative">
      <Input
        :id="id"
        v-model="inputValue"
        :type="actualType"
        :placeholder="placeholder"
        :disabled="disabled"
        :class="cn(errorMessage && 'border-red-500 focus-visible:ring-red-500', $props.class)"
        @blur="handleBlur"
      />
      <div
        v-if="type === 'password' && showPasswordToggle"
        class="absolute inset-y-0 right-0 pr-3 flex items-center"
      >
        <button
          type="button"
          class="text-gray-400 hover:text-gray-600 focus:outline-none"
          @click="togglePasswordVisibility"
        >
          <EyeIcon v-if="showPassword"
class="h-5 w-5" />
          <EyeSlashIcon v-else
class="h-5 w-5" />
        </button>
      </div>
    </div>
    <p v-if="errorMessage"
class="text-sm text-red-600">
      {{ errorMessage }}
    </p>
    <p v-if="description"
class="text-sm text-gray-500">
      {{ description }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { EyeIcon, EyeSlashIcon } from "@heroicons/vue/24/outline";
import { cn } from "@/lib/utils";

export interface FormFieldProps {
  id: string;
  label?: string;
  type?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  errorMessage?: string;
  description?: string;
  showPasswordToggle?: boolean;
  modelValue?: string;
  class?: string;
}

const props = withDefaults(defineProps<FormFieldProps>(), {
  type: "text",
  required: false,
  disabled: false,
  showPasswordToggle: false,
  modelValue: "",
  class: "",
});

const emit = defineEmits<{
  "update:modelValue": [value: string];
  blur: [event: FocusEvent];
}>();

const showPassword = ref(false);

const inputValue = computed({
  get: () => props.modelValue,
  set: (value: string) => emit("update:modelValue", value),
});

const actualType = computed(() => {
  if (props.type === "password" && props.showPasswordToggle) {
    return showPassword.value ? "text" : "password";
  }
  return props.type;
});

const togglePasswordVisibility = () => {
  showPassword.value = !showPassword.value;
};

const handleBlur = (event: FocusEvent) => {
  emit("blur", event);
};
</script>
