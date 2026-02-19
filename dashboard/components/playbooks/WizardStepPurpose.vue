<template>
  <div class="space-y-4">
    <div class="space-y-2">
      <Label for="purpose">What is this playbook for?</Label>
      <Textarea
        id="purpose"
        :model-value="modelValue"
        placeholder="e.g. Handle refund requests for orders placed in the last 30 days"
        :rows="5"
        @update:model-value="$emit('update:modelValue', $event)"
      />
      <p class="text-sm text-neutral-muted">
        Describe what this playbook should help resolve or automate. 1–3 sentences recommended.
      </p>
    </div>

    <div class="rounded-lg border border-border bg-background-secondary p-4 space-y-2">
      <p class="text-sm font-medium text-foreground">Tips for a good description</p>
      <ul class="text-sm text-neutral-muted space-y-1 list-disc list-inside">
        <li>Focus on the specific problem or task this playbook should handle</li>
        <li>Mention who typically needs help with this (e.g. customers, internal team)</li>
        <li>Include any key outcomes you expect (e.g. issue a refund, escalate to manager)</li>
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
