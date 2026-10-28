<template>
  <!-- iOS "Add to Home Screen" steps (D11-12): iPhone push alerts only work from the installed app -->
  <section
    v-if="visible"
    aria-labelledby="install-app-heading"
    class="space-y-3 rounded-xl border border-border bg-background p-4"
    data-testid="install-app-guide"
  >
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0 flex-1 space-y-1">
        <h2 id="install-app-heading" class="text-sm font-semibold">
          {{ $t("home.install.title") }}
        </h2>
        <p class="text-sm text-neutral-muted">{{ $t("home.install.description") }}</p>
      </div>
      <Button
        v-if="dismissible"
        variant="ghost"
        size="icon"
        :aria-label="$t('home.install.dismiss')"
        data-testid="install-app-dismiss"
        @click="dismiss"
      >
        <X class="h-4 w-4" />
      </Button>
    </div>

    <ol class="space-y-2 text-sm">
      <li class="flex items-start gap-2">
        <span class="step">1</span>
        <span>
          {{ $t("home.install.stepShare") }}
          <Share class="inline h-4 w-4 align-text-bottom text-primary" aria-hidden="true" />
        </span>
      </li>
      <li class="flex items-start gap-2">
        <span class="step">2</span>
        <span>
          {{ $t("home.install.stepAdd") }}
          <PlusSquare class="inline h-4 w-4 align-text-bottom text-primary" aria-hidden="true" />
        </span>
      </li>
      <li class="flex items-start gap-2">
        <span class="step">3</span>
        <span>{{ $t("home.install.stepOpen") }}</span>
      </li>
    </ol>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { Share, PlusSquare, X } from "lucide-vue-next";
import { browserNeedsIosInstall } from "@/utils/install-app";

const props = withDefaults(defineProps<{ dismissible?: boolean }>(), { dismissible: false });

const DISMISS_KEY = "hay.installGuideDismissed";
const visible = ref(false);

onMounted(() => {
  if (!browserNeedsIosInstall()) return;
  if (props.dismissible) {
    try {
      if (localStorage.getItem(DISMISS_KEY) === "1") return;
    } catch {
      // Storage blocked (private mode): show the guide
    }
  }
  visible.value = true;
});

const dismiss = () => {
  visible.value = false;
  try {
    localStorage.setItem(DISMISS_KEY, "1");
  } catch {
    // Storage blocked: hidden until the next visit
  }
};
</script>

<style scoped>
.step {
  @apply inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-background-tertiary text-xs font-semibold tabular-nums;
}
</style>
