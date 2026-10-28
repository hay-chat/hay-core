<template>
  <Page :title="$t('tests.title')" :description="$t('tests.description')">
    <template #header>
      <span v-if="allowance" class="text-sm text-muted-foreground" data-testid="tests-allowance">
        {{ $t("tests.allowance", { remaining: allowance.remaining, limit: allowance.limit }) }}
      </span>
    </template>

    <Card v-if="draft">
      <CardContent class="flex flex-col gap-2 pt-6 md:flex-row md:items-center md:justify-between">
        <div>
          <p class="font-medium">{{ $t("tests.draft.title") }}</p>
          <p class="text-sm text-muted-foreground">
            {{ $t("tests.draft.description", { name: draftName || "…" }) }}
          </p>
        </div>
        <Button variant="link" size="sm" @click="clearDraft">
          {{ $t("tests.draft.clear") }}
        </Button>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle class="text-base">{{ $t("tests.replay.title") }}</CardTitle>
        <CardDescription>{{ $t("tests.replay.description") }}</CardDescription>
      </CardHeader>
      <CardContent class="space-y-4">
        <Input
          v-model="source"
          type="select"
          :label="$t('tests.replay.source')"
          :options="sourceOptions"
          data-testid="tests-source"
        />

        <Input
          v-if="source === 'recent'"
          v-model="recentCount"
          type="number"
          :label="$t('tests.replay.recentCount')"
          min="1"
          max="200"
        />

        <div v-else class="space-y-2">
          <div class="flex items-center justify-between gap-2">
            <p class="text-sm text-muted-foreground">
              {{
                $t(
                  "tests.replay.selectedTranscripts",
                  { count: selectedTranscripts.length },
                  selectedTranscripts.length,
                )
              }}
            </p>
            <Button variant="outline" size="sm" @click="showImport = true">
              <Upload class="mr-2 h-4 w-4" />
              {{ $t("tests.import.button") }}
            </Button>
          </div>
          <p v-if="transcripts.length === 0" class="text-sm text-muted-foreground">
            {{ $t("tests.replay.noTranscripts") }}
          </p>
          <ul v-else class="max-h-72 divide-y divide-border overflow-y-auto rounded-md border">
            <li v-for="transcript in transcripts" :key="transcript.id">
              <label class="flex cursor-pointer items-start gap-3 px-3 py-2">
                <input
                  v-model="selectedTranscripts"
                  type="checkbox"
                  class="mt-1"
                  :value="transcript.id"
                />
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-sm font-medium">
                    {{ transcript.title || transcript.preview }}
                  </span>
                  <span class="block text-xs text-muted-foreground">
                    {{ $t(`tests.import.formats.${transcript.source}`) }} ·
                    {{ formatDateTime(transcript.startedAt ?? transcript.createdAt) }}
                  </span>
                </span>
              </label>
            </li>
          </ul>
        </div>

        <div class="grid gap-4 md:grid-cols-2">
          <Input
            v-model="maxTurns"
            type="number"
            :label="$t('tests.replay.maxTurns')"
            min="1"
            max="50"
          />
          <Input v-model="label" :label="$t('tests.replay.label')" />
        </div>

        <Button
          :loading="starting"
          :disabled="!canStart"
          data-testid="tests-start"
          @click="startReplay"
        >
          {{ $t("tests.replay.start") }}
        </Button>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle class="text-base">{{ $t("tests.runs.title") }}</CardTitle>
      </CardHeader>
      <CardContent>
        <p v-if="runs.length === 0" class="text-sm text-muted-foreground">
          {{ $t("tests.runs.empty") }}
        </p>
        <ul v-else class="divide-y divide-border">
          <li
            v-for="run in runs"
            :key="run.id"
            class="flex flex-col gap-2 py-3 md:flex-row md:items-center md:gap-4"
          >
            <div class="min-w-0 flex-1">
              <p class="truncate font-medium">
                {{ run.label || $t(`tests.runs.kinds.${run.kind}`) }}
              </p>
              <p class="text-xs text-muted-foreground">
                {{ $t(`tests.runs.kinds.${run.kind}`) }} ·
                {{ $t(`tests.runs.status.${run.status}`) }} ·
                {{
                  $t("tests.runs.progress", {
                    done: run.completed_count + run.failed_count,
                    total: run.item_count,
                  })
                }}
                · {{ formatDateTime(run.created_at) }}
              </p>
            </div>
            <Button variant="outline" size="sm" @click="router.push(`/tests/${run.id}`)">
              {{ $t("tests.runs.open") }}
            </Button>
          </li>
        </ul>
      </CardContent>
    </Card>

    <TranscriptImportDialog v-model:open="showImport" @imported="loadTranscripts" />
  </Page>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { Upload } from "lucide-vue-next";
import { Hay } from "@/utils/api";
import { useToast } from "@/composables/useToast";
import type { RouterOutputs } from "@/types/trpc";

/**
 * Tests (D7-11): replay past conversations (recent Hay.chat ones or imported
 * transcripts) against the agent, optionally a playbook draft, and open the
 * report. Runs are dry, never delivered and never billed.
 */
type Run = RouterOutputs["simulations"]["list"][number];
type Transcript = RouterOutputs["testTranscripts"]["list"]["items"][number];

/** Run kinds this page lists: replays and test-case regressions. */
const LISTED_KINDS = ["replay", "test_cases"];

const { t } = useI18n();
const toast = useToast();
const route = useRoute();
const router = useRouter();
const { formatDateTime } = useOrgDateTime();

useHead({ title: t("tests.headTitle") });

const allowance = ref<RouterOutputs["simulations"]["allowance"] | null>(null);
const runs = ref<Run[]>([]);
const transcripts = ref<Transcript[]>([]);
const source = ref<"recent" | "transcripts">("recent");
const recentCount = ref<number | string>(20);
const maxTurns = ref<number | string>(5);
const label = ref("");
const selectedTranscripts = ref<string[]>([]);
const starting = ref(false);
const showImport = ref(false);
const draftName = ref("");

const draft = computed(() => {
  const { playbookId, versionId } = route.query;
  return typeof playbookId === "string" && typeof versionId === "string"
    ? { playbookId, versionId }
    : null;
});

const sourceOptions = computed(() => [
  { value: "recent", label: t("tests.replay.sources.recent") },
  { value: "transcripts", label: t("tests.replay.sources.transcripts") },
]);

const canStart = computed(() =>
  source.value === "recent" ? Number(recentCount.value) > 0 : selectedTranscripts.value.length > 0,
);

function clearDraft() {
  router.push({ path: "/tests" });
}

async function startReplay() {
  starting.value = true;
  try {
    const run = await Hay.replays.start.mutate({
      label: label.value.trim() || undefined,
      playbookVersionOverride: draft.value ?? undefined,
      recentConversations: source.value === "recent" ? Number(recentCount.value) : undefined,
      transcriptIds: source.value === "transcripts" ? selectedTranscripts.value : undefined,
      maxTurnsPerConversation: Number(maxTurns.value) || undefined,
    });
    toast.success(t("tests.replay.started"));
    if (run) router.push(`/tests/${run.id}`);
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error));
  } finally {
    starting.value = false;
  }
}

async function loadTranscripts() {
  const result = await Hay.testTranscripts.list.query({ limit: 100 });
  transcripts.value = result.items;
}

async function load() {
  try {
    const [allowanceResult, runList] = await Promise.all([
      Hay.simulations.allowance.query(),
      Hay.simulations.list.query({ limit: 50 }),
      loadTranscripts(),
    ]);
    allowance.value = allowanceResult;
    runs.value = runList.filter((run) => LISTED_KINDS.includes(run.kind));
    if (draft.value) {
      const playbook = await Hay.playbooks.get.query({ id: draft.value.playbookId });
      draftName.value = playbook.title;
    }
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error));
  }
}

onMounted(load);
</script>
