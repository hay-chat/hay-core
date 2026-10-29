<template>
  <div
    role="status"
    class="p-4 rounded-lg"
    :class="
      result.success
        ? 'bg-green-50 text-green-800 dark:bg-green-950/20 dark:text-green-200'
        : result.status === 'unconfigured'
          ? 'bg-muted text-foreground'
          : 'bg-red-50 text-red-800 dark:bg-red-950/20 dark:text-red-200'
    "
  >
    <div class="flex items-center gap-2">
      <CheckCircle v-if="result.success" class="h-5 w-5 shrink-0" />
      <Info v-else-if="result.status === 'unconfigured'" class="h-5 w-5 shrink-0" />
      <XCircle v-else class="h-5 w-5 shrink-0" />
      <span class="font-medium">
        {{
          result.success
            ? t("pluginSettings.connectionTest.success")
            : result.status === "unconfigured"
              ? t("pluginSettings.connectionTest.configRequired")
              : t("pluginSettings.connectionTest.failed")
        }}
      </span>
    </div>
    <p v-if="result.message" class="mt-2 text-sm">{{ result.message }}</p>
    <p
      v-if="!result.success && result.error"
      class="mt-2 text-xs font-mono break-words bg-red-100 dark:bg-red-900/30 p-2 rounded border border-red-200 dark:border-red-800"
    >
      {{ result.error }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { CheckCircle, Info, XCircle } from "lucide-vue-next";

/** Outcome of a plugin connection test (plugins.testConnection). */
defineProps<{
  result: { success: boolean; status?: string; message?: string; error?: string };
}>();

const { t } = useI18n();
</script>
