<template>
  <aside
    class="self-start rounded-xl border border-border bg-background-secondary p-4 lg:sticky lg:top-6"
    :aria-label="$t('setup.live.label')"
  >
    <h2 class="text-base">{{ $t("setup.live.title") }}</h2>

    <p
      v-if="siteLine"
      class="mt-1.5 flex items-center gap-2 text-sm text-neutral-muted"
      role="status"
    >
      <span
        class="h-1.5 w-1.5 shrink-0 rounded-full"
        :class="
          siteState === 'reading'
            ? 'bg-primary motion-safe:animate-pulse'
            : siteState === 'done'
              ? 'bg-neutral-700'
              : 'bg-neutral-400'
        "
        aria-hidden="true"
      />
      {{ siteLine }}
    </p>

    <ul v-if="items.length" class="mt-3">
      <li
        v-for="item in items"
        :key="item.key"
        class="setup-live-item flex justify-between gap-3 border-t border-border py-2 text-neutral-900"
      >
        <span class="min-w-0">{{ item.text }}</span>
        <span class="whitespace-nowrap text-sm text-neutral-muted">{{ item.tag }}</span>
      </li>
    </ul>
    <p v-else class="mt-3 text-sm text-neutral-muted">{{ $t("setup.live.empty") }}</p>
  </aside>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { SetupSiteState } from "@/stores/setup";

export interface LiveItem {
  key: string;
  text: string;
  tag: string;
}

const props = defineProps<{
  items: LiveItem[];
  /** The crawl as the server reports it, when one has started. */
  site: SetupSiteState | null;
  /** The website typed in the first question, which may not be saved yet. */
  website: string;
}>();

const { t } = useI18n();

const siteState = computed(() => props.site?.state ?? "none");

const host = computed(() => {
  const raw = (props.site?.website || props.website || "").trim();
  if (!raw) return "";
  try {
    return new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`).host;
  } catch {
    return raw;
  }
});

const siteLine = computed(() => {
  if (!host.value) return "";
  const site = props.site;
  switch (siteState.value) {
    case "reading":
      if (site?.total) {
        return t(`setup.live.readingOf${site.total === 1 ? "One" : "Other"}`, {
          site: host.value,
          processed: site.processed,
          total: site.total,
        });
      }
      return t(`setup.live.reading${site?.processed === 1 ? "One" : "Other"}`, {
        site: host.value,
        count: site?.processed ?? 0,
      });
    case "done": {
      const count = site?.processed ?? 0;
      return t(`setup.live.done${count === 1 ? "One" : "Other"}`, { site: host.value, count });
    }
    case "failed":
      return t("setup.live.failed", { site: host.value });
    default:
      return t("setup.live.willRead", { site: host.value });
  }
});
</script>

<style scoped>
.setup-live-item {
  animation: setup-live-in 0.35s cubic-bezier(0.16, 1, 0.3, 1);
}
@keyframes setup-live-in {
  from {
    opacity: 0;
    transform: translateY(5px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  .setup-live-item {
    animation: none;
  }
}
</style>
