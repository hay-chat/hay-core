<template>
  <fieldset class="space-y-2">
    <legend class="mb-2 text-sm font-medium leading-5">{{ legend }}</legend>
    <div class="flex flex-wrap gap-2">
      <label
        v-for="option in options"
        :key="option.value"
        :class="[
          'flex w-24 cursor-pointer flex-col items-center gap-2 rounded-lg border px-2 py-3 text-center text-xs transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary has-[:focus-visible]:ring-offset-2',
          modelValue === option.value
            ? 'border-primary bg-[#e8f3ff] font-medium text-primary'
            : 'bg-white text-neutral-700 hover:border-neutral-400',
        ]"
        :data-testid="`${name}-${option.value}`"
      >
        <input
          type="radio"
          class="sr-only"
          :name="name"
          :value="option.value"
          :checked="modelValue === option.value"
          @change="emit('update:modelValue', option.value)"
        />
        <slot name="tile" :value="option.value" />
        {{ option.label }}
      </label>
      <slot name="after" />
    </div>
  </fieldset>
</template>

<script setup lang="ts" generic="T extends string">
defineProps<{
  legend: string;
  name: string;
  modelValue: T;
  options: { value: T; label: string }[];
}>();

const emit = defineEmits<{ "update:modelValue": [value: T] }>();
</script>
