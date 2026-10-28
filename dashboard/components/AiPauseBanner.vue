<template>
  <!-- The team paused the AI everywhere (D11-9): visible on every page until resumed -->
  <div
    v-if="paused"
    role="status"
    class="flex flex-wrap items-center justify-center gap-3 border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-900"
    data-testid="ai-pause-banner"
  >
    <PauseCircle class="h-4 w-4 shrink-0" />
    <span>{{ $t("home.aiPause.banner") }}</span>
    <Button
      v-if="canManage"
      size="sm"
      variant="outline"
      class="bg-white/70"
      :loading="busy"
      data-testid="ai-pause-banner-resume"
      @click="resume"
    >
      {{ $t("home.aiPause.resume") }}
    </Button>
  </div>
</template>

<script setup lang="ts">
import { PauseCircle } from "lucide-vue-next";
import { useAiPause } from "@/composables/useAiPause";
import { useToast } from "@/composables/useToast";

const { paused, canManage, busy, setPaused } = useAiPause();
const toast = useToast();
const { t } = useI18n();

const resume = async () => {
  if (await setPaused(false)) {
    toast.success(t("home.aiPause.resumed"));
  } else {
    toast.error(t("home.aiPause.failed"));
  }
};
</script>
