<template>
  <div
    v-if="visible"
    class="grid gap-2 rounded-lg border border-border bg-background p-3 text-sm"
    :aria-label="$t('setup.nav.widgetLabel')"
    role="group"
    data-testid="setup-widget"
  >
    <b class="font-medium text-neutral-900">
      {{ $t("setup.nav.progress", { ready: store.readyCount, total: store.totalCount }) }}
    </b>
    <Progress :value="percent" class="h-1.5" :aria-label="$t('setup.nav.widgetLabel')" />
    <span v-if="copy" class="text-neutral-muted">
      {{ $t("setup.nav.upNext", { title: copy.title }) }}
    </span>
    <NuxtLink to="/setup" :class="textLinkClass" class="justify-self-start">
      {{ $t("setup.nav.continue") }}
    </NuxtLink>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useSetupStore } from "@/stores/setup";
import { describeUpNext } from "@/composables/useSetupCopy";
import { textLinkClass } from "./styles";

const store = useSetupStore();
const route = useRoute();
const { t } = useI18n();

// Away from /setup, once answers exist, and while something is left to do.
const visible = computed(
  () =>
    store.showInNav &&
    Boolean(store.board?.answeredAt) &&
    store.totalCount > 0 &&
    route.path !== "/setup",
);

const percent = computed(() =>
  store.totalCount ? (store.readyCount / store.totalCount) * 100 : 0,
);
const copy = computed(() => (store.board ? describeUpNext(t, store.board.upNext) : null));
</script>
