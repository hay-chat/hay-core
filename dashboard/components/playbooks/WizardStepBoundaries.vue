<template>
  <div class="space-y-6">
    <div class="space-y-1">
      <Label>{{ $t("wizard.boundaries.label") }}</Label>
      <p class="text-sm text-neutral-muted">
        {{ $t("wizard.boundaries.helperText") }}
      </p>
    </div>

    <!-- High-risk emphasis warning -->
    <div
      class="rounded-lg border border-yellow-200 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-950/20 p-4 space-y-1"
    >
      <p class="text-sm font-medium text-yellow-900 dark:text-yellow-100">
        {{ $t("wizard.boundaries.whyMatters") }}
      </p>
      <p class="text-sm text-yellow-800 dark:text-yellow-200">
        {{ $t("wizard.boundaries.warningText") }}
      </p>
    </div>

    <!-- Escalation rules -->
    <div class="space-y-2">
      <Label for="escalation-rules">{{ $t("wizard.boundaries.escalationLabel") }}</Label>
      <Textarea
        id="escalation-rules"
        :model-value="escalationRules"
        :placeholder="$t('wizard.boundaries.escalationPlaceholder')"
        :rows="4"
        @update:model-value="$emit('update:escalationRules', $event)"
      />
      <div class="flex flex-wrap gap-1.5">
        <Badge
          v-for="(example, key) in escalationExamples"
          :key="key"
          variant="outline"
          :on-click="() => appendToEscalation(example)"
        >
          + {{ example }}
        </Badge>
      </div>
    </div>

    <!-- Boundary rules -->
    <div class="space-y-2">
      <Label for="boundaries">{{ $t("wizard.boundaries.boundariesLabel") }}</Label>
      <Textarea
        id="boundaries"
        :model-value="boundaries"
        :placeholder="$t('wizard.boundaries.boundariesPlaceholder')"
        :rows="4"
        @update:model-value="$emit('update:boundaries', $event)"
      />
      <div class="flex flex-wrap gap-1.5">
        <Badge
          v-for="(example, key) in boundaryExamples"
          :key="key"
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
        {{ $t("wizard.boundaries.acknowledgment") }}
      </span>
    </label>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";

const { t } = useI18n();

const escalationExamples = {
  legal: t("wizard.boundaries.escalationExamples.legal"),
  refund: t("wizard.boundaries.escalationExamples.refund"),
  safety: t("wizard.boundaries.escalationExamples.safety"),
  manager: t("wizard.boundaries.escalationExamples.manager"),
};

const boundaryExamples = {
  policies: t("wizard.boundaries.boundaryExamples.policies"),
  competitor: t("wizard.boundaries.boundaryExamples.competitor"),
  medical: t("wizard.boundaries.boundaryExamples.medical"),
  employee: t("wizard.boundaries.boundaryExamples.employee"),
};

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
