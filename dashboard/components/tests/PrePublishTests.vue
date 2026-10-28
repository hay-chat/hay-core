<template>
  <div class="rounded-md border border-border p-3 text-sm" data-testid="pre-publish-tests">
    <p class="font-medium">{{ $t("tests.regression.title") }}</p>

    <p v-if="state === 'loading'" class="mt-1 text-muted-foreground">
      {{ $t("tests.regression.checking") }}
    </p>
    <p v-else-if="state === 'none'" class="mt-1 text-muted-foreground">
      {{ $t("tests.regression.none") }}
    </p>
    <p v-else-if="state === 'error'" class="mt-1 text-muted-foreground">
      {{ errorMessage }}
    </p>

    <template v-else-if="results">
      <p v-if="results.inProgress > 0" class="mt-1 text-muted-foreground">
        {{
          $t("tests.regression.running", {
            done: results.cases.length - results.inProgress,
            total: results.cases.length,
          })
        }}
      </p>
      <p v-else-if="results.failing === 0" class="mt-1 text-muted-foreground">
        {{ $t("tests.regression.allPassed", { count: results.cases.length }) }}
      </p>
      <template v-else>
        <p class="mt-1 text-destructive">
          {{
            $t("tests.regression.failing", {
              failing: results.failing,
              total: results.cases.length,
            })
          }}
          <span v-if="results.newFailures > 0">
            {{ $t("tests.regression.newFailures", { count: results.newFailures }) }}
          </span>
        </p>
        <ul class="mt-2 list-disc space-y-1 pl-5">
          <li v-for="failed in failingCases" :key="failed.conversationId ?? failed.title">
            {{ failed.title }}
            <span v-if="failed.newFailure" class="text-xs text-destructive">
              ({{ $t("tests.regression.passedBefore") }})
            </span>
          </li>
        </ul>
        <p class="mt-2 text-xs text-muted-foreground">{{ $t("tests.regression.warnOnly") }}</p>
      </template>
      <Button
        variant="link"
        size="sm"
        class="px-0"
        @click="router.push(`/tests/${results.run.id}`)"
      >
        {{ $t("tests.regression.openReport") }}
      </Button>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from "vue";
import { Hay } from "@/utils/api";
import type { RouterOutputs } from "@/types/trpc";

/**
 * Pre-publish regression (D7-12): runs the playbook's saved test cases against
 * the draft when the publish dialog opens and warns about failures, especially
 * cases that passed before. It never blocks publishing.
 */
type Results = NonNullable<RouterOutputs["testCases"]["results"]>;

const POLL_MS = 4000;

const props = defineProps<{ playbookId: string; versionId: string }>();

const router = useRouter();

const state = ref<"loading" | "none" | "running" | "error">("loading");
const results = ref<Results | null>(null);
const errorMessage = ref("");
let timer: ReturnType<typeof setTimeout> | null = null;

const failingCases = computed(() => results.value?.cases.filter((c) => c.passed === false) ?? []);

async function poll(runId: string) {
  const next = await Hay.testCases.results.query({ runId });
  results.value = next ?? null;
  if (next && next.inProgress > 0 && next.run.status === "running") {
    timer = setTimeout(() => poll(runId), POLL_MS);
  }
}

onMounted(async () => {
  try {
    const cases = await Hay.testCases.list.query({ playbookId: props.playbookId });
    if (cases.length === 0) {
      state.value = "none";
      return;
    }
    const run = await Hay.testCases.startRegression.mutate({
      playbookId: props.playbookId,
      playbookVersionOverride: { playbookId: props.playbookId, versionId: props.versionId },
    });
    if (!run) return;
    state.value = "running";
    await poll(run.id);
  } catch (error) {
    state.value = "error";
    errorMessage.value = error instanceof Error ? error.message : String(error);
  }
});

onBeforeUnmount(() => {
  if (timer) clearTimeout(timer);
});
</script>
