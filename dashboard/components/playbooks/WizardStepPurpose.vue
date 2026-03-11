<template>
  <div class="space-y-4">
    <div class="space-y-2">
      <Label for="purpose">{{ $t("wizard.purpose.label") }}</Label>
      <Textarea
        id="purpose"
        :model-value="modelValue"
        :placeholder="$t('wizard.purpose.placeholder')"
        :rows="5"
        @update:model-value="$emit('update:modelValue', $event)"
      />
      <p class="text-sm text-neutral-muted">
        {{ $t("wizard.purpose.helperText") }}
      </p>
    </div>

    <div class="rounded-lg border border-border bg-background-secondary p-4 space-y-2">
      <p class="text-sm font-medium text-foreground">{{ $t("wizard.purpose.tipsTitle") }}</p>
      <ul class="text-sm text-neutral-muted space-y-1 list-disc list-inside">
        <li>{{ $t("wizard.purpose.tipsFocus") }}</li>
        <li>{{ $t("wizard.purpose.tipsMention") }}</li>
        <li>{{ $t("wizard.purpose.tipsOutcomes") }}</li>
      </ul>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  modelValue: string;
}>();

defineEmits<{
  "update:modelValue": [value: string];
}>();
</script>
