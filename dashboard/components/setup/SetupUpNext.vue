<template>
  <div
    class="flex flex-wrap items-center justify-between gap-4 rounded-lg px-4 py-3"
    :class="done ? 'border border-border bg-background-secondary' : 'bg-primary-50'"
    data-testid="setup-up-next"
  >
    <div
      v-if="thumbnailUrl"
      class="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-background"
    >
      <img
        :src="thumbnailUrl"
        alt=""
        class="h-7 w-7 object-contain"
        data-testid="setup-up-next-thumbnail"
        @error="thumbnailFailed = true"
      />
    </div>
    <div class="min-w-0 flex-1 basis-64">
      <template v-if="checking">
        <p class="text-lg font-medium text-neutral-900">
          {{ requestsCount($t, "setup.board.testing", total) }}
        </p>
        <p class="text-sm text-neutral-700">{{ $t("setup.board.testingHint") }}</p>
      </template>
      <template v-else-if="copy">
        <p class="flex flex-wrap items-center gap-2 text-lg font-medium text-neutral-900">
          <Badge v-if="done" variant="success">{{ $t("setup.status.ready") }}</Badge>
          {{ copy.title }}
        </p>
        <p class="text-sm text-neutral-700">{{ copy.why }}</p>
      </template>
    </div>

    <template v-if="!checking && upNext && copy">
      <NuxtLink v-if="connectTo" :to="connectTo" :class="buttonLinkClass" class="max-md:w-full">
        {{ copy.label }}
      </NuxtLink>
      <NuxtLink
        v-else-if="writeTo && upNext.kind === 'write_playbook'"
        :to="writeTo"
        :class="buttonLinkClass"
        class="max-md:w-full"
      >
        {{ copy.label }}
      </NuxtLink>
      <Button
        v-else-if="upNext.kind === 'done' && canInstall"
        class="max-md:w-full"
        @click="emit('install')"
      >
        {{ copy.label }}
      </Button>
      <Button
        v-else-if="upNext.kind === 'choose_platform'"
        class="max-md:w-full"
        @click="emit('choosePlatform')"
      >
        {{ copy.label }}
      </Button>
      <Button
        v-else-if="upNext.kind === 'answer' || upNext.kind === 'playbook'"
        class="max-md:w-full"
        @click="emit('open', upNext.questionId)"
      >
        {{ copy.label }}
      </Button>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { SetupUpNext } from "@/stores/setup";
import { useDomain } from "@/composables/useDomain";
import { describeUpNext, requestsCount } from "@/composables/useSetupCopy";
import { buttonLinkClass } from "./styles";

const props = withDefaults(
  defineProps<{
    upNext: SetupUpNext | null;
    /** The first round of checks is still running, so no step can be named yet. */
    checking: boolean;
    total: number;
    /** Where "connect" leads, or null when the role cannot open it. */
    connectTo: string | null;
    /** Whether "done" can open the install panel (adding the assistant to the site). */
    canInstall: boolean;
    /** Where "write your own playbook" leads, or null when the role cannot open it. */
    writeTo?: string | null;
  }>(),
  { writeTo: null },
);

const { getApiUrl } = useDomain();
const thumbnailFailed = ref(false);
const connectPluginId = computed(() =>
  props.upNext?.kind === "connect" ? props.upNext.plugin.id : null,
);
watch(connectPluginId, () => (thumbnailFailed.value = false));
const thumbnailUrl = computed(() =>
  connectPluginId.value && !props.checking && !thumbnailFailed.value
    ? getApiUrl(`/plugins/thumbnails/${encodeURIComponent(connectPluginId.value)}`)
    : null,
);

const emit = defineEmits<{
  open: [questionId: string];
  choosePlatform: [];
  install: [];
}>();

const { t } = useI18n();

const copy = computed(() => (props.upNext ? describeUpNext(t, props.upNext) : null));
const done = computed(() => props.upNext?.kind === "done" && !props.checking);
</script>
