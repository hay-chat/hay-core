<template>
  <textarea
    v-bind="textareaAttrs"
    class="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
    @input="$emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
  />
</template>

<script setup lang="ts">
const props = defineProps<{
  id?: string;
  modelValue?: string;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
}>();

defineEmits<{
  "update:modelValue": [value: string];
}>();

const textareaAttrs = computed(() => {
  const attrs: Record<string, any> = {
    value: props.modelValue || "",
    rows: props.rows || 4,
    disabled: props.disabled || false,
  };

  if (props.id) attrs["id"] = props.id;
  if (props.placeholder) attrs["placeholder"] = props.placeholder;

  return attrs;
});
</script>
