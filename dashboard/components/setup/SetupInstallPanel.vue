<template>
  <section
    :id="panelId"
    class="rounded-lg border border-border bg-background-secondary p-4"
    :aria-labelledby="headingId"
    data-testid="setup-install"
  >
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0 flex-1 basis-64">
        <h2 :id="headingId" ref="heading" tabindex="-1" class="text-base outline-none">
          {{ $t("setup.install.title") }}
        </h2>
        <p class="mt-1 text-sm text-neutral-700" data-testid="install-honesty">
          {{ honesty }}
        </p>
      </div>
      <Button variant="outline" size="sm" @click="emit('close')">
        {{ $t("setup.install.close") }}
      </Button>
    </div>

    <p v-if="loading" class="mt-3 text-sm text-neutral-muted" role="status">
      {{ $t("setup.install.loading") }}
    </p>
    <div v-else-if="failed" class="mt-3 flex flex-wrap items-center gap-3" role="alert">
      <p class="text-sm text-destructive">{{ $t("setup.install.error") }}</p>
      <Button variant="outline" size="sm" @click="load">{{ $t("setup.install.retry") }}</Button>
    </div>
    <template v-else-if="snippet">
      <p class="mt-3 text-sm text-neutral-muted">{{ $t("setup.install.instructions") }}</p>
      <pre
        class="mt-2 overflow-x-auto rounded-md bg-background p-3 text-sm"
        tabindex="0"
        :aria-label="$t('setup.install.codeLabel')"
        data-testid="install-code"
        >{{ snippet }}</pre>
      <div class="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" @click="copy">
          <component :is="copied ? Check : Copy" class="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          {{ copied ? $t("setup.install.copied") : $t("setup.install.copy") }}
        </Button>
        <NuxtLink v-if="settingsTo" :to="settingsTo" :class="textLinkClass">
          {{ $t("setup.install.moreOptions") }}
        </NuxtLink>
        <span class="sr-only" role="status">{{ copied ? $t("setup.install.copied") : "" }}</span>
      </div>
      <p v-if="copyFailed" class="mt-2 text-sm text-destructive" role="alert">
        {{ $t("setup.install.copyError") }}
      </p>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { Check, Copy } from "lucide-vue-next";
import { useWebchatSnippet } from "@/composables/useWebchatSnippet";
import { requestsCount } from "@/composables/useSetupCopy";
import { textLinkClass } from "./styles";

const props = defineProps<{
  /** Requests on the list that are not ready yet. */
  notReady: number;
  total: number;
  /** Where the full web chat settings live, or null when the role cannot open them. */
  settingsTo: string | null;
}>();

const emit = defineEmits<{ close: [] }>();

const { t } = useI18n();
const panelId = "setup-install-panel";
const headingId = "setup-install-heading";
const heading = ref<HTMLElement | null>(null);

const { snippet, loading, failed, load } = useWebchatSnippet();

const honesty = computed(() => {
  if (props.total === 0) return t("setup.install.noRequests");
  if (props.notReady === 0) return t("setup.install.allReady");
  return requestsCount(t, "setup.install.notReady", props.notReady);
});

const copied = ref(false);
const copyFailed = ref(false);
let copiedTimer: ReturnType<typeof setTimeout> | null = null;

const copy = async () => {
  copyFailed.value = false;
  try {
    await navigator.clipboard.writeText(snippet.value);
    copied.value = true;
    if (copiedTimer) clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => {
      copied.value = false;
      copiedTimer = null;
    }, 2000);
  } catch {
    copyFailed.value = true;
  }
};

onMounted(async () => {
  void load();
  // The panel opens from a button elsewhere on the page; move focus so keyboard users land in it.
  await nextTick();
  heading.value?.focus();
});

onBeforeUnmount(() => {
  if (copiedTimer) clearTimeout(copiedTimer);
});
</script>
