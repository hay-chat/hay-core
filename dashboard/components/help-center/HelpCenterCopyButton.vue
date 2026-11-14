<template>
  <Button variant="outline" size="sm" :aria-label="label" @click="copyValue">
    <Check v-if="copied" class="h-3 w-3" :class="{ 'mr-1': !iconOnly }" />
    <Copy v-else class="h-3 w-3" :class="{ 'mr-1': !iconOnly }" />
    <span :class="{ 'sr-only': iconOnly }" aria-live="polite">
      {{ copied ? $t("helpCenter.copied") : $t("helpCenter.copy") }}
    </span>
  </Button>
</template>

<script setup lang="ts">
import { useClipboard } from "@vueuse/core";
import { Check, Copy } from "lucide-vue-next";

const props = defineProps<{
  value: string;
  /** What is copied, for screen readers (e.g. "Copy site address"). */
  label: string;
  iconOnly?: boolean;
}>();

const { t } = useI18n();
const toast = useToast();
const { copy, copied } = useClipboard({ copiedDuring: 2000, legacy: true });

async function copyValue() {
  try {
    await copy(props.value);
  } catch (error) {
    console.error("Failed to copy:", error);
    toast.error(t("helpCenter.copyFailed"));
  }
}
</script>
