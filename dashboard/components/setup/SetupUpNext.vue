<template>
  <div
    class="flex flex-wrap items-center justify-between gap-4 rounded-lg px-4 py-3"
    :class="done ? 'border border-border bg-background-secondary' : 'bg-primary-50'"
    data-testid="setup-up-next"
  >
    <div class="min-w-0 flex-1 basis-64">
      <template v-if="checking">
        <p class="text-lg font-medium text-neutral-900">
          {{ requestsCount($t, "setup.board.testing", total) }}
        </p>
        <p class="text-sm text-neutral-muted">{{ $t("setup.board.testingHint") }}</p>
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
      <NuxtLink v-else-if="doneTo" :to="doneTo" :class="buttonLinkClass" class="max-md:w-full">
        {{ copy.label }}
      </NuxtLink>
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
import { computed } from "vue";
import type { SetupUpNext } from "@/stores/setup";
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
    /** Where "done" leads (adding the assistant to the site), or null when not allowed. */
    doneTo: string | null;
    /** Where "write your own playbook" leads, or null when the role cannot open it. */
    writeTo?: string | null;
  }>(),
  { writeTo: null },
);

const emit = defineEmits<{
  open: [questionId: string];
  choosePlatform: [];
}>();

const { t } = useI18n();

const copy = computed(() => (props.upNext ? describeUpNext(t, props.upNext) : null));
const done = computed(() => props.upNext?.kind === "done" && !props.checking);
</script>
