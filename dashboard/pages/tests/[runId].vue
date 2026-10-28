<template>
  <Page :title="report?.run.label || $t('tests.report.title')">
    <template #header>
      <Button variant="outline" size="sm" @click="router.push('/tests')">
        {{ $t("tests.report.back") }}
      </Button>
      <Button
        v-if="report?.run.status === 'running'"
        variant="outline"
        size="sm"
        :loading="cancelling"
        @click="cancelRun"
      >
        {{ $t("tests.report.cancel") }}
      </Button>
    </template>

    <Loading v-if="!report" />

    <template v-else>
      <Card>
        <CardContent class="space-y-1 pt-6 text-sm" data-testid="tests-report-summary">
          <p class="font-medium">
            {{ $t("tests.report.estimated", { count: report.sampleSize }) }}
          </p>
          <p v-if="report.inProgress > 0" class="text-muted-foreground">
            {{ $t("tests.report.inProgress", { count: report.inProgress }) }}
          </p>
          <p v-if="report.notJudged > 0" class="text-muted-foreground">
            {{ $t("tests.report.notJudged", { count: report.notJudged }) }}
          </p>
          <p v-if="agreementTotal > 0" class="text-muted-foreground">
            {{ $t("tests.report.agreement", report.agreement) }}
          </p>
        </CardContent>
      </Card>

      <Card
        v-for="group in report.buckets"
        :key="group.bucket"
        :data-testid="`bucket-${group.bucket}`"
      >
        <CardHeader>
          <CardTitle class="flex items-center gap-2 text-base">
            {{ $t(`tests.report.buckets.${group.bucket}`) }}
            <Badge :variant="group.bucket === 'wrong_or_risky' ? 'destructive' : 'secondary'">
              {{ group.count }}
            </Badge>
          </CardTitle>
          <CardDescription>{{ $t(`tests.report.bucketHelp.${group.bucket}`) }}</CardDescription>
        </CardHeader>
        <CardContent class="space-y-4">
          <p v-if="group.count === 0" class="text-sm text-muted-foreground">
            {{ $t("tests.report.empty") }}
          </p>
          <p v-else-if="group.count > group.examples.length" class="text-xs text-muted-foreground">
            {{ $t("tests.report.showing", { shown: group.examples.length, count: group.count }) }}
          </p>

          <div
            v-for="example in group.examples"
            :key="example.itemId"
            class="space-y-3 rounded-md border border-border p-3"
          >
            <p v-if="example.title" class="text-xs font-medium text-muted-foreground">
              {{ example.title }}
            </p>
            <div class="grid gap-3 md:grid-cols-3">
              <div>
                <p class="mb-1 text-xs font-medium text-muted-foreground">
                  {{ $t("tests.report.customer") }}
                </p>
                <p class="whitespace-pre-wrap text-sm">{{ example.customerMessage }}</p>
              </div>
              <div>
                <p class="mb-1 text-xs font-medium text-muted-foreground">
                  {{ $t("tests.report.aiReply") }}
                </p>
                <p class="whitespace-pre-wrap text-sm">
                  {{ example.reply || $t("tests.report.noReply") }}
                </p>
              </div>
              <div>
                <p class="mb-1 text-xs font-medium text-muted-foreground">
                  {{
                    example.expectedOutcome
                      ? $t("tests.report.expected")
                      : $t("tests.report.humanReply")
                  }}
                </p>
                <p class="whitespace-pre-wrap text-sm">
                  {{
                    example.expectedOutcome ||
                    example.referenceReply ||
                    $t("tests.report.noHumanReply")
                  }}
                </p>
              </div>
            </div>

            <div v-if="example.mockedCalls.length > 0" class="text-xs">
              <span class="text-muted-foreground">{{ $t("tests.report.mockedCalls") }}</span>
              <Badge
                v-for="(call, index) in example.mockedCalls"
                :key="index"
                variant="tool"
                class="ml-1"
              >
                {{ call.name }}
              </Badge>
            </div>
            <p v-if="example.storeDataChanged" class="text-xs text-muted-foreground">
              {{ $t("tests.report.storeDataChanged") }}
            </p>
            <p v-if="example.reasoning" class="text-xs text-muted-foreground">
              <span class="font-medium">{{ $t("tests.report.judge") }}:</span>
              {{ example.reasoning }}
            </p>

            <div class="flex flex-wrap gap-2">
              <Button
                v-if="example.playbookId && example.conversationId"
                variant="outline"
                size="sm"
                @click="openPlaybookSuggest(example)"
              >
                {{ $t("tests.report.improvePlaybook") }}
              </Button>
              <Button
                v-if="example.conversationId"
                variant="outline"
                size="sm"
                @click="openKnowledgeSuggest(example)"
              >
                {{ $t("tests.report.improveKnowledge") }}
              </Button>
              <Button
                v-if="example.sourceConversationId"
                variant="link"
                size="sm"
                @click="router.push(`/conversations/${example.sourceConversationId}`)"
              >
                {{ $t("tests.report.viewConversation") }}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </template>

    <SuggestEditsDialog
      v-if="suggestTarget?.playbookId"
      v-model:open="showPlaybookSuggest"
      :playbook-id="suggestTarget.playbookId"
      :conversation-id="suggestTarget.conversationId"
      @applied="handlePlaybookApplied"
    />
    <SuggestKnowledgeDialog
      v-if="suggestTarget"
      v-model:open="showKnowledgeSuggest"
      :conversation-id="suggestTarget.conversationId"
      @applied="(documentId: string) => router.push(`/documents/${documentId}`)"
    />
  </Page>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from "vue";
import { Hay } from "@/utils/api";
import { useToast } from "@/composables/useToast";
import type { RouterOutputs } from "@/types/trpc";

/**
 * Replay report (D7-11): judged turns in buckets with examples next to what
 * the team really sent, the sample size, and "Improve from conversation".
 * Deliberately no headline percentage.
 */
type Report = RouterOutputs["replays"]["report"];
type Example = Report["buckets"][number]["examples"][number];

const POLL_MS = 4000;

const { t } = useI18n();
const toast = useToast();
const route = useRoute();
const router = useRouter();

useHead({ title: t("tests.report.headTitle") });

const runId = computed(() => String(route.params.runId));
const report = ref<Report | null>(null);
const cancelling = ref(false);
const suggestTarget = ref<{ playbookId: string | null; conversationId: string } | null>(null);
const showPlaybookSuggest = ref(false);
const showKnowledgeSuggest = ref(false);
let timer: ReturnType<typeof setTimeout> | null = null;

const agreementTotal = computed(() => {
  const value = report.value?.agreement;
  return value ? value.same + value.partial + value.different : 0;
});

function openPlaybookSuggest(example: Example) {
  suggestTarget.value = { playbookId: example.playbookId, conversationId: example.conversationId! };
  showPlaybookSuggest.value = true;
}

function openKnowledgeSuggest(example: Example) {
  suggestTarget.value = { playbookId: example.playbookId, conversationId: example.conversationId! };
  showKnowledgeSuggest.value = true;
}

function handlePlaybookApplied() {
  toast.success(t("suggest.appliedToast"));
  if (suggestTarget.value?.playbookId) router.push(`/playbooks/${suggestTarget.value.playbookId}`);
}

async function load() {
  try {
    report.value = await Hay.replays.report.query({ runId: runId.value });
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error));
    return;
  }
  if (report.value.inProgress > 0 && report.value.run.status === "running") {
    timer = setTimeout(load, POLL_MS);
  }
}

async function cancelRun() {
  cancelling.value = true;
  try {
    await Hay.simulations.cancel.mutate({ runId: runId.value });
    if (timer) clearTimeout(timer);
    await load();
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error));
  } finally {
    cancelling.value = false;
  }
}

onMounted(load);
onBeforeUnmount(() => {
  if (timer) clearTimeout(timer);
});
</script>
