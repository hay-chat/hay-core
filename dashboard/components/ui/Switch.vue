<template>
  <SwitchRoot
    :id="id"
    :name="name"
    :required="required"
    :disabled="disabled"
    :model-value="modelValue"
    :class="
      cn(
        'peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'data-[state=checked]:bg-primary data-[state=unchecked]:bg-input',
        props.class,
      )
    "
    @update:model-value="emit('update:modelValue', $event)"
  >
    <SwitchThumb
      :class="
        cn(
          'pointer-events-none block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform',
          'data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0',
        )
      "
    />
  </SwitchRoot>
</template>

<script setup lang="ts">
import { SwitchRoot, SwitchThumb } from "reka-ui";
import { cn } from "@/lib/utils";

export interface SwitchProps {
  modelValue?: boolean;
  disabled?: boolean;
  class?: string;
  name?: string;
  id?: string;
  required?: boolean;
}

const props = withDefaults(defineProps<SwitchProps>(), {
  modelValue: false,
  disabled: false,
  class: "",
});

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
}>();
</script>
