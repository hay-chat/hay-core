<template>
  <div class="space-y-6">
    <div class="space-y-1">
      <Label>Set boundaries and escalation rules</Label>
      <p class="text-sm text-neutral-muted">
        Define when the playbook should escalate to a human and what topics it should avoid.
      </p>
    </div>

    <!-- High-risk emphasis warning -->
    <div
      class="rounded-lg border border-yellow-200 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-950/20 p-4 space-y-1"
    >
      <p class="text-sm font-medium text-yellow-900 dark:text-yellow-100">Why this matters</p>
      <p class="text-sm text-yellow-800 dark:text-yellow-200">
        Clear escalation rules prevent your playbook from handling sensitive situations it
        shouldn't. Boundaries keep responses focused and safe.
      </p>
    </div>

    <!-- Escalation rules -->
    <div class="space-y-2">
      <Label for="escalation-rules">Always escalate when...</Label>
      <Textarea
        id="escalation-rules"
        :model-value="escalationRules"
        placeholder="e.g. Customer mentions legal action, requests a refund over $500..."
        :rows="4"
        @update:model-value="$emit('update:escalationRules', $event)"
      />
      <div class="flex flex-wrap gap-1.5">
        <Badge
          v-for="example in escalationExamples"
          :key="example"
          variant="outline"
          :on-click="() => appendToEscalation(example)"
        >
          + {{ example }}
        </Badge>
      </div>
    </div>

    <!-- Boundary rules -->
    <div class="space-y-2">
      <Label for="boundaries">Never answer questions about...</Label>
      <Textarea
        id="boundaries"
        :model-value="boundaries"
        placeholder="e.g. Internal company policies, competitor pricing..."
        :rows="4"
        @update:model-value="$emit('update:boundaries', $event)"
      />
      <div class="flex flex-wrap gap-1.5">
        <Badge
          v-for="example in boundaryExamples"
          :key="example"
          variant="outline"
          :on-click="() => appendToBoundaries(example)"
        >
          + {{ example }}
        </Badge>
      </div>
    </div>

    <!-- Acknowledgment checkbox -->
    <label class="flex items-start gap-3 cursor-pointer">
      <Checkbox
        :model-value="acknowledged"
        class="mt-0.5"
        @update:model-value="$emit('update:acknowledged', $event)"
      />
      <span class="text-sm text-foreground">
        I have reviewed the escalation rules and boundaries
      </span>
    </label>
  </div>
</template>

<script setup lang="ts">
const escalationExamples = [
  "Legal threats",
  "Refund requests over $500",
  "Safety concerns",
  "Customer asks for manager",
];

const boundaryExamples = [
  "Internal policies",
  "Competitor comparisons",
  "Medical/legal advice",
  "Employee information",
];

const props = defineProps<{
  escalationRules: string;
  boundaries: string;
  acknowledged: boolean;
}>();

const emit = defineEmits<{
  "update:escalationRules": [value: string];
  "update:boundaries": [value: string];
  "update:acknowledged": [value: boolean];
}>();

function appendToEscalation(text: string) {
  const current = props.escalationRules.trim();
  const newValue = current ? `${current}\n${text}` : text;
  emit("update:escalationRules", newValue);
}

function appendToBoundaries(text: string) {
  const current = props.boundaries.trim();
  const newValue = current ? `${current}\n${text}` : text;
  emit("update:boundaries", newValue);
}
</script>
