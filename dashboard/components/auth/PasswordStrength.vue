<template>
  <div v-if="password" class="space-y-3">
    <!-- Strength bar -->
    <div class="space-y-2">
      <div class="flex justify-between items-center">
        <span class="text-sm text-gray-600">Password strength</span>
        <span :class="['text-sm font-medium', strengthColor]">
          {{ strengthText }}
        </span>
      </div>
      <Progress :value="strengthPercentage" :class="strengthBarColor" />
    </div>

    <!-- Requirements checklist -->
    <div class="space-y-1">
      <p class="text-sm text-gray-600">Password must contain:</p>
      <ul class="space-y-1">
        <li :class="requirementClass(validation.requirements.length)">
          <CheckIcon v-if="validation.requirements.length" class="h-3 w-3" />
          <XMarkIcon v-else class="h-3 w-3" />
          At least 8 characters
        </li>
        <li :class="requirementClass(validation.requirements.uppercase)">
          <CheckIcon v-if="validation.requirements.uppercase" class="h-3 w-3" />
          <XMarkIcon v-else class="h-3 w-3" />
          One uppercase letter
        </li>
        <li :class="requirementClass(validation.requirements.lowercase)">
          <CheckIcon v-if="validation.requirements.lowercase" class="h-3 w-3" />
          <XMarkIcon v-else class="h-3 w-3" />
          One lowercase letter
        </li>
        <li :class="requirementClass(validation.requirements.number)">
          <CheckIcon v-if="validation.requirements.number" class="h-3 w-3" />
          <XMarkIcon v-else class="h-3 w-3" />
          One number
        </li>
        <li :class="requirementClass(validation.requirements.special)">
          <CheckIcon v-if="validation.requirements.special" class="h-3 w-3" />
          <XMarkIcon v-else class="h-3 w-3" />
          One special character
        </li>
      </ul>
    </div>
  </div>
</template>

<script setup lang="ts">
import { CheckIcon, XMarkIcon } from "@heroicons/vue/24/outline";
import { validatePassword } from "@/lib/utils";

export interface PasswordStrengthProps {
  password: string;
}

const props = defineProps<PasswordStrengthProps>();

const validation = computed(() => validatePassword(props.password));

const strengthText = computed(() => {
  switch (validation.value.strength) {
    case "weak":
      return "Weak";
    case "medium":
      return "Medium";
    case "strong":
      return "Strong";
    default:
      return "Weak";
  }
});

const strengthColor = computed(() => {
  switch (validation.value.strength) {
    case "weak":
      return "text-red-600";
    case "medium":
      return "text-yellow-600";
    case "strong":
      return "text-green-600";
    default:
      return "text-red-600";
  }
});

const strengthBarColor = computed(() => {
  switch (validation.value.strength) {
    case "weak":
      return "[&>div]:bg-red-500";
    case "medium":
      return "[&>div]:bg-yellow-500";
    case "strong":
      return "[&>div]:bg-green-500";
    default:
      return "[&>div]:bg-red-500";
  }
});

const strengthPercentage = computed(() => {
  switch (validation.value.strength) {
    case "weak":
      return 25;
    case "medium":
      return 60;
    case "strong":
      return 100;
    default:
      return 0;
  }
});

const requirementClass = (met: boolean) => {
  return [
    "flex items-center space-x-2 text-xs",
    met ? "text-green-600" : "text-gray-400",
  ];
};
</script>
