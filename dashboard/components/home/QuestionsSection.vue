<template>
  <section
    v-if="items.length > 0"
    aria-labelledby="home-questions-heading"
    data-testid="home-questions"
  >
    <h2 id="home-questions-heading" class="mb-1 flex items-baseline gap-2 text-sm font-semibold">
      {{ $t("home.questions.title") }}
      <span class="tabular-nums text-neutral-muted">{{ items.length }}</span>
    </h2>
    <p class="mb-2 text-sm text-neutral-muted">{{ $t("home.questions.description") }}</p>

    <ul class="divide-y divide-border rounded-xl border border-border bg-background shadow-sm">
      <li
        v-for="item in items"
        :id="`question-${item.id}`"
        :key="item.id"
        class="flex flex-col gap-3 p-4"
        :class="{ 'bg-primary/5': item.id === highlightedId }"
        :data-testid="`question-${item.id}`"
      >
        <div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <NuxtLink
            :to="`/conversations/${item.conversationId}`"
            class="inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline sm:min-h-0"
          >
            {{ item.customerName || item.conversationTitle || $t("home.questions.untitled") }}
          </NuxtLink>
          <span class="text-xs text-neutral-muted">
            {{ $t("home.questions.asked", { time: age(item.askedAt) }) }}
          </span>
        </div>

        <p
          class="text-xs font-medium"
          :class="item.status === 'open' ? 'text-primary' : 'text-neutral-muted'"
        >
          {{
            item.status === "open"
              ? $t("home.questions.statusOpen")
              : $t("home.questions.statusTimedOut")
          }}
        </p>

        <!-- Untrusted shopper/AI text: plain interpolation only -->
        <blockquote class="whitespace-pre-line border-l-2 border-border pl-3 text-sm">
          {{ item.question }}
        </blockquote>
        <p
          v-if="item.customerMessage && item.customerMessage !== item.question"
          class="whitespace-pre-line text-xs text-neutral-muted"
        >
          {{ $t("home.questions.customerSaid", { message: item.customerMessage }) }}
        </p>

        <div class="space-y-3">
          <Input
            v-model="drafts[item.id]"
            type="textarea"
            :label="$t('home.questions.answerLabel')"
            :placeholder="$t('home.questions.answerPlaceholder')"
            :disabled="busyId === item.id"
            :data-testid="`question-answer-${item.id}`"
          />
          <div class="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-6">
            <Input
              :model-value="!!asWritten[item.id]"
              type="switch"
              :label="$t('home.questions.sendAsWritten')"
              @update:model-value="(value: unknown) => (asWritten[item.id] = !!value)"
            />
            <Input
              :model-value="saveToKnowledge[item.id] !== false"
              type="checkbox"
              :label="$t('home.questions.saveToKnowledge')"
              @update:model-value="(value: unknown) => (saveToKnowledge[item.id] = !!value)"
            />
          </div>
          <p class="text-xs text-neutral-muted">
            {{
              asWritten[item.id]
                ? $t("home.questions.asWrittenHelp")
                : $t("home.questions.rephraseHelp")
            }}
          </p>
        </div>

        <div class="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button
            class="min-h-11 sm:min-h-0"
            :loading="busyId === item.id && action === 'answer'"
            :disabled="!drafts[item.id]?.trim() || (busyId !== null && busyId !== item.id)"
            :data-testid="`question-send-${item.id}`"
            @click="answer(item)"
          >
            {{ $t("home.questions.send") }}
          </Button>
          <Button
            variant="ghost"
            class="min-h-11 sm:min-h-0"
            :loading="busyId === item.id && action === 'dismiss'"
            :disabled="busyId !== null && busyId !== item.id"
            :data-testid="`question-dismiss-${item.id}`"
            @click="dismiss(item)"
          >
            {{ $t("home.questions.dismiss") }}
          </Button>
        </div>
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted, nextTick } from "vue";
import { Hay } from "@/utils/api";
import { useToast } from "@/composables/useToast";
import { useWebSocket } from "@/composables/useWebSocket";
import { useNow } from "@/composables/useNow";
import { formatWaitTime } from "@/utils/conversation";

/**
 * Quick checks with the team (D19-3): facts the AI asked the team about
 * without handing the chat off. Answer here (the AI passes it on, rephrased
 * or as written) or dismiss; taking the conversation over cancels it.
 */
interface QuestionItem {
  id: string;
  conversationId: string;
  question: string;
  customerMessage: string | null;
  status: "open" | "timed_out" | "answered" | "dismissed" | "cancelled";
  askedAt: string;
  customerName: string | null;
  conversationTitle: string | null;
}

const emit = defineEmits<{ changed: [] }>();
const { t } = useI18n();
const route = useRoute();
const toast = useToast();
const websocket = useWebSocket();
const now = useNow();

const items = ref<QuestionItem[]>([]);
const drafts = reactive<Record<string, string>>({});
const asWritten = reactive<Record<string, boolean>>({});
const saveToKnowledge = reactive<Record<string, boolean>>({});
const busyId = ref<string | null>(null);
const action = ref<"answer" | "dismiss" | null>(null);
const highlightedId = ref<string | null>(null);

function age(askedAt: string): string {
  return formatWaitTime((now.value.getTime() - new Date(askedAt).getTime()) / 1000);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : t("home.questions.failed");
}

async function load() {
  try {
    items.value = (await Hay.teamQuestions.list.query()) as QuestionItem[];
  } catch {
    // The Inbox still works without this card; the next refresh retries.
  }
}

async function answer(item: QuestionItem) {
  busyId.value = item.id;
  action.value = "answer";
  try {
    await Hay.teamQuestions.answer.mutate({
      questionId: item.id,
      answer: drafts[item.id] ?? "",
      sendAsWritten: !!asWritten[item.id],
      saveToKnowledge: saveToKnowledge[item.id] !== false,
    });
    toast.success(t("home.questions.sent"));
    delete drafts[item.id];
    await load();
    emit("changed");
  } catch (error) {
    toast.error(errorMessage(error));
    await load();
  } finally {
    busyId.value = null;
    action.value = null;
  }
}

async function dismiss(item: QuestionItem) {
  busyId.value = item.id;
  action.value = "dismiss";
  try {
    await Hay.teamQuestions.dismiss.mutate({ questionId: item.id });
    toast.info(
      item.status === "open" ? t("home.questions.dismissedOpen") : t("home.questions.dismissed"),
    );
    await load();
    emit("changed");
  } catch (error) {
    toast.error(errorMessage(error));
    await load();
  } finally {
    busyId.value = null;
    action.value = null;
  }
}

// A push notification opens /inbox?question=<id>: bring that question into view.
async function focusFromRoute() {
  const id = typeof route.query.question === "string" ? route.query.question : null;
  if (!id || !items.value.some((item) => item.id === id)) return;
  highlightedId.value = id;
  await nextTick();
  document.getElementById(`question-${id}`)?.scrollIntoView({ block: "center" });
}

let refreshTimer: ReturnType<typeof setTimeout> | null = null;
const scheduleRefresh = () => {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => void load(), 300);
};
const unsubscribers: Array<() => void> = [];

onMounted(async () => {
  await load();
  await focusFromRoute();
  for (const event of ["team_question_changed", "conversation_taken_over"]) {
    unsubscribers.push(websocket.on(event, scheduleRefresh));
  }
});

onUnmounted(() => {
  unsubscribers.forEach((off) => off());
  if (refreshTimer) clearTimeout(refreshTimer);
});

defineExpose({ load });
</script>
