<template>
  <section
    class="border-t border-border pt-5"
    :aria-labelledby="headingId"
    data-testid="setup-replay"
  >
    <h2 :id="headingId" class="text-base">{{ $t("setup.replay.title") }}</h2>
    <p class="mt-1 text-sm text-neutral-muted">{{ $t("setup.replay.description") }}</p>

    <p v-if="loading" class="mt-3 text-sm text-neutral-muted" role="status">
      {{ $t("setup.replay.loading") }}
    </p>

    <div v-else-if="loadFailed" class="mt-3 flex flex-wrap items-center gap-3" role="alert">
      <p class="text-sm text-destructive">{{ $t("setup.replay.loadError") }}</p>
      <Button variant="outline" size="sm" @click="load">{{ $t("setup.replay.retry") }}</Button>
    </div>

    <template v-else>
      <p v-if="running" class="mt-3 text-sm text-neutral-900" role="status">
        {{ $t("setup.replay.running", { done: judged, total: replayTotal }) }}
      </p>

      <template v-if="report && report.sampleSize + report.notJudged > 0">
        <p class="mt-3 text-sm text-neutral-muted">
          {{
            $t(`setup.replay.sample${report.sampleSize === 1 ? "One" : "Other"}`, {
              count: report.sampleSize,
            })
          }}
        </p>
        <ul class="mt-2" :aria-label="$t('setup.replay.resultsLabel')" data-testid="replay-counts">
          <li
            v-for="line in lines"
            :key="line.bucket"
            class="flex justify-between gap-3 border-t border-border py-2 text-neutral-900"
          >
            <span>{{ $t(`setup.replay.buckets.${line.bucket}`) }}</span>
            <span class="font-medium tabular-nums">{{ line.count }}</span>
          </li>
        </ul>
        <p v-if="report.notJudged > 0" class="mt-2 text-sm text-neutral-muted">
          {{ $t("setup.replay.notJudged", { count: report.notJudged }) }}
        </p>
        <p v-if="report.run.status === 'capped'" class="mt-2 text-sm text-neutral-muted">
          {{ $t("setup.replay.capped") }}
        </p>
        <p v-else-if="report.run.status === 'cancelled'" class="mt-2 text-sm text-neutral-muted">
          {{ $t("setup.replay.cancelled") }}
        </p>
      </template>
      <p
        v-else-if="report && !running"
        class="mt-3 text-sm text-neutral-muted"
        data-testid="replay-empty"
      >
        {{ $t("setup.replay.nothingJudged") }}
      </p>

      <p v-if="!running" class="mt-3 text-sm text-neutral-muted" data-testid="replay-cost">
        {{ costLine }}
      </p>
      <p v-if="startError" class="mt-2 text-sm text-destructive" role="alert">
        {{
          startError === "allowance"
            ? $t("setup.replay.allowanceUsed")
            : $t("setup.replay.startError")
        }}
      </p>

      <div class="mt-3 flex flex-wrap items-center gap-2">
        <Button
          v-if="canReplay"
          :variant="report ? 'outline' : 'default'"
          :loading="starting"
          :disabled="outOfAllowance"
          @click="start"
        >
          {{ report ? $t("setup.replay.again") : $t("setup.replay.run", { count: replayCount }) }}
        </Button>
        <Button
          v-if="canImport"
          :variant="canReplay ? 'outline' : 'default'"
          @click="showImport = true"
        >
          {{ imported > 0 ? $t("setup.replay.importMore") : $t("setup.replay.import") }}
        </Button>
        <NuxtLink
          v-if="report && canOpenTests"
          :to="`/tests/${report.run.id}`"
          :class="textLinkClass"
        >
          {{ $t("setup.replay.openReport") }}
        </NuxtLink>
      </div>
    </template>

    <TranscriptImportDialog v-model:open="showImport" @imported="load" />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import TranscriptImportDialog from "@/components/tests/TranscriptImportDialog.vue";
import { REPLAY_SAMPLE_CONVERSATIONS, useSetupReplay } from "@/composables/useSetupReplay";
import { useSetupLinks } from "@/composables/useSetupLinks";
import { textLinkClass } from "./styles";

const headingId = "setup-replay-heading";
const { t } = useI18n();
const { canOpen } = useSetupLinks();

const {
  loading,
  loadFailed,
  imported,
  allowance,
  report,
  running,
  starting,
  startError,
  load,
  start,
} = useSetupReplay();

const showImport = ref(false);

// Importing and replaying are both playbook-scoped on the server, like the Tests page.
const canImport = computed(() => canOpen("/tests"));
const canOpenTests = computed(() => canOpen("/tests"));

const replayCount = computed(() => Math.min(imported.value, REPLAY_SAMPLE_CONVERSATIONS));
const canReplay = computed(() => canImport.value && imported.value > 0 && !running.value);
const outOfAllowance = computed(() => (allowance.value?.remaining ?? 1) <= 0);

const judged = computed(() => (report.value?.sampleSize ?? 0) + (report.value?.notJudged ?? 0));
const replayTotal = computed(() => judged.value + (report.value?.inProgress ?? 0));

/** The three buckets setup is about always show; the others only when something landed in them. */
const ALWAYS = ["answered", "handed_off", "knowledge_missing"];
const lines = computed(() =>
  (report.value?.buckets ?? []).filter((b) => ALWAYS.includes(b.bucket) || b.count > 0),
);

const costLine = computed(() => {
  if (outOfAllowance.value) return t("setup.replay.allowanceUsed");
  const a = allowance.value;
  return t("setup.replay.cost", { remaining: a?.remaining ?? 0, limit: a?.limit ?? 0 });
});

onMounted(load);
</script>
