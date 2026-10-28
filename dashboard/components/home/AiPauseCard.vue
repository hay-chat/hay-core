<template>
  <!-- "Pause AI everywhere" (D11-9): one tap from the phone stops every AI reply -->
  <section
    v-if="canManage"
    aria-labelledby="home-ai-pause-heading"
    class="space-y-3 rounded-xl border border-border bg-background p-4"
    data-testid="ai-pause-card"
  >
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0 flex-1 space-y-1">
        <h2 id="home-ai-pause-heading" class="text-sm font-semibold">
          {{ $t("home.aiPause.title") }}
        </h2>
        <p class="text-sm text-neutral-muted">{{ $t("home.aiPause.description") }}</p>
      </div>
      <Input
        type="switch"
        :label="paused ? $t('home.aiPause.statusOn') : $t('home.aiPause.statusOff')"
        :model-value="paused"
        :disabled="busy"
        data-testid="ai-pause-switch"
        @update:model-value="toggle($event === true)"
      />
    </div>

    <p v-if="paused && pausedLine" class="text-sm text-red-900" data-testid="ai-pause-by">
      {{ pausedLine }}
    </p>

    <ul class="space-y-1 text-sm">
      <li>
        <NuxtLink
          to="/settings/customer-privacy"
          class="inline-flex min-h-11 items-center gap-1 text-primary hover:underline sm:min-h-0"
        >
          {{ $t("home.aiPause.perChannel") }}
          <ChevronRight class="h-4 w-4" />
        </NuxtLink>
      </li>
      <li>
        <NuxtLink
          to="/agents"
          class="inline-flex min-h-11 items-center gap-1 text-primary hover:underline sm:min-h-0"
        >
          {{ $t("home.aiPause.perAgent") }}
          <ChevronRight class="h-4 w-4" />
        </NuxtLink>
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ChevronRight } from "lucide-vue-next";
import { Hay } from "@/utils/api";
import { useAiPause } from "@/composables/useAiPause";
import { useToast } from "@/composables/useToast";
import { useOrgDateTime } from "@/composables/useOrgDateTime";

const { paused, canManage, busy, setPaused } = useAiPause();
const toast = useToast();
const { t } = useI18n();
const { formatDateTime } = useOrgDateTime();

const pausedBy = ref<{ name: string } | null>(null);
const pausedAt = ref<Date | string | null>(null);

const loadDetails = async () => {
  if (!canManage.value || !paused.value) {
    pausedBy.value = null;
    pausedAt.value = null;
    return;
  }
  try {
    const result = await Hay.organizations.getAiPause.query();
    pausedBy.value = result.pausedBy;
    pausedAt.value = result.pausedAt;
  } catch (error) {
    console.error("[AiPause] details failed:", error);
  }
};

// Re-read who paused it whenever the state changes (here or on another device)
watch(paused, () => void loadDetails(), { immediate: true });

const pausedLine = computed(() => {
  if (!pausedAt.value) return "";
  const when = formatDateTime(pausedAt.value);
  return pausedBy.value
    ? t("home.aiPause.pausedBy", { name: pausedBy.value.name, when })
    : t("home.aiPause.pausedAt", { when });
});

const toggle = async (value: boolean) => {
  if (!(await setPaused(value))) {
    toast.error(t("home.aiPause.failed"));
    return;
  }
  toast.success(value ? t("home.aiPause.paused") : t("home.aiPause.resumed"));
};
</script>
