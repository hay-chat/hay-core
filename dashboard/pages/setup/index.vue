<template>
  <!-- relative: keeps screen-reader-only elements inside the scrolling main, or phones get blank scroll -->
  <Page class="relative">
    <div
      v-if="deciding"
      class="mx-auto w-full max-w-[1120px] animate-pulse space-y-4 motion-reduce:animate-none"
      role="status"
      :aria-label="$t('setup.state.loadingLabel')"
    >
      <div class="h-8 w-2/3 rounded bg-neutral-200" />
      <div class="h-5 w-1/2 rounded bg-neutral-100" />
      <div class="h-64 rounded-xl bg-neutral-100" />
    </div>

    <div v-else-if="store.status === 'forbidden'" class="mx-auto max-w-lg">
      <EmptyState
        :title="$t('setup.state.forbiddenTitle')"
        :description="$t('setup.state.forbiddenDescription')"
        :action="$t('setup.state.goHome')"
        @click="router.push('/')"
      />
    </div>

    <div v-else-if="!store.board" class="mx-auto max-w-lg" role="alert">
      <EmptyState
        :title="$t('setup.state.errorTitle')"
        :description="$t('setup.state.errorDescription')"
        :action="$t('setup.state.retry')"
        @click="start"
      />
    </div>

    <SetupQuestions
      v-else-if="mode === 'questions'"
      :board="store.board"
      :editing="Boolean(store.board.answeredAt)"
      :start-step="startStep"
      @reading="onReading"
      @saved="onSaved"
      @cancel="mode = 'board'"
    />

    <SetupBoard
      v-else
      :board="store.board"
      :checking="checking"
      :check-failed="checkFailed"
      :busy-row-ids="busyRowIds"
      :actions="actions"
      :connect-error="connectError"
      @change-answers="openQuestions(0)"
      @choose-platform="openQuestions(1)"
      @recheck="runCheck()"
    />
  </Page>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { Hay } from "@/utils/api";
import { useSetupStore, type SetupBoard as SetupBoardData } from "@/stores/setup";
import { useUserStore } from "@/stores/user";
import { useSetupSitePolling } from "@/composables/useSetupSitePolling";
import { useSetupTurnPolling } from "@/composables/useSetupTurnPolling";
import SetupQuestions from "@/components/setup/SetupQuestions.vue";
import SetupBoard, { type SetupBoardActions } from "@/components/setup/SetupBoard.vue";

const router = useRouter();
const route = useRoute();
const store = useSetupStore();

// A board this browser already holds (from the sidebar, `/`, or the last visit) that has answers
// can open right away: answers are never un-saved. Without answers the server decides, because
// they may have been saved elsewhere, so the questions never show until it has replied.
const openBoardNow =
  Boolean(store.board?.answeredAt) && store.organizationId === useUserStore().activeOrganizationId;

const mode = ref<"questions" | "board" | null>(openBoardNow ? "board" : null);
const startStep = ref(0);
// Rows read "checking" from the first render, instead of flashing their saved statuses.
const checking = ref(openBoardNow && Boolean(store.board?.rows.length));
const checkFailed = ref(false);
/** Nothing to show yet: a skeleton, never a guess at which screen is right. */
const deciding = computed(
  () =>
    store.status === "idle" ||
    store.status === "loading" ||
    (Boolean(store.board) && mode.value === null),
);
const busyRowIds = ref<string[]>([]);
/** The connect attempt that failed on the way back, shown next to the rows it would unlock. */
const connectError = ref<{ pluginId: string; detail?: string } | null>(null);

/** Ask the server to check every row that needs it. Rows read "checking" until it answers. */
const runCheck = async (questionIds?: string[]) => {
  checking.value = true;
  checkFailed.value = false;
  try {
    store.apply(await Hay.setup.checkQuestions.mutate(questionIds ? { questionIds } : {}));
  } catch {
    checkFailed.value = true;
  } finally {
    checking.value = false;
  }
  void generatePlaybooks();
};

/** Rows whose platform is connected and whose playbook has not been drafted yet. */
const pendingPlaybookIds = (): string[] =>
  store.board?.rows
    .filter((r) => r.status === "playbook_missing" && r.generation === "pending")
    .map((r) => r.id) ?? [];

let generating = false;

/**
 * Draft playbooks from the connected platform's real tools. Without ids it only covers rows that
 * have not been tried; naming a row retries it. Those rows read "checking" meanwhile.
 */
const generatePlaybooks = async (questionIds?: string[]) => {
  const ids = questionIds ?? pendingPlaybookIds();
  if (generating || ids.length === 0) return;
  generating = true;
  busyRowIds.value = [...new Set([...busyRowIds.value, ...ids])];
  try {
    store.apply(await Hay.setup.generatePlaybooks.mutate(questionIds ? { questionIds } : {}));
  } catch {
    toast.error(t("setup.playbook.generateError"));
  } finally {
    busyRowIds.value = busyRowIds.value.filter((id) => !ids.includes(id));
    generating = false;
  }
};

const showBoard = () => {
  // Set before the board mounts, so its rows start as "checking" instead of flashing statuses.
  checking.value = Boolean(store.board?.rows.length);
  mode.value = "board";
  if (checking.value) void runCheck();
};

let unmounted = false;
onBeforeUnmount(() => {
  unmounted = true;
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Plugins whose tools are still being discovered right after OAuth need a moment. */
const CONNECT_SETTLE_TRIES = 3;
const CONNECT_SETTLE_MS = 2000;

const stillNeedsConnection = (pluginId: string): boolean =>
  Boolean(
    store.board?.rows.some((r) => r.status === "needs_connection" && r.plugin?.id === pluginId),
  );

/**
 * Coming back from a platform's connect page: `hay_connect=success` refreshes the board and
 * drafts playbooks, `hay_connect=error` shows what went wrong next to the platform's rows.
 */
const settleConnectReturn = async (pluginId: string) => {
  for (let i = 0; i < CONNECT_SETTLE_TRIES && !unmounted && stillNeedsConnection(pluginId); i++) {
    await sleep(CONNECT_SETTLE_MS);
    if (unmounted) return;
    await store.load({ force: true });
  }
  if (!unmounted) await generatePlaybooks();
};

const readConnectReturn = (): { status: string; pluginId: string } | null => {
  const status = route.query.hay_connect;
  if (typeof status !== "string") return null;
  const pluginId = typeof route.query.plugin === "string" ? route.query.plugin : "";
  if (status === "error") {
    const detail = route.query.hay_connect_error;
    connectError.value = { pluginId, ...(typeof detail === "string" ? { detail } : {}) };
  }
  return { status, pluginId };
};

const start = async () => {
  const returned = readConnectReturn();
  if (returned) await router.replace({ path: "/setup" });
  await store.load({ force: true });
  if (!store.board) return;
  if (!store.board.answeredAt) mode.value = "questions";
  // "Change answers" was opened from the held board while this loaded: don't pull them out of it.
  else if (mode.value === "questions") checking.value = false;
  else showBoard();
  if (returned?.status === "success") void settleConnectReturn(returned.pluginId);
};

const openQuestions = (step: number) => {
  startStep.value = step;
  mode.value = "questions";
};

// A read started from question 1 can answer after the person has already moved on to the board;
// the saved board is newer then, so the late one is dropped.
const onReading = (board: SetupBoardData) => {
  if (mode.value === "questions") store.apply(board);
};

const onSaved = (board: SetupBoardData) => {
  store.apply(board);
  showBoard();
};

// While the website is being read, poll; check the rows once it has finished.
useSetupSitePolling(() => {
  if (mode.value === "board") void runCheck();
});

// Rows the check found answers for stay "checking" while a real test turn runs; poll until the
// server reports each turn's result.
useSetupTurnPolling(
  () =>
    mode.value === "board" &&
    !checking.value &&
    !checkFailed.value &&
    store.board?.site.state !== "reading" &&
    Boolean(store.board?.rows.some((r) => r.status === "checking")),
);

const toast = useToast();
const { t } = useI18n();

const applyBoard = async (request: Promise<SetupBoardData>): Promise<boolean> => {
  try {
    store.apply(await request);
    return true;
  } catch {
    return false;
  }
};

const actions: SetupBoardActions = {
  addQuestion: async (text) => {
    const added = await applyBoard(Hay.setup.addQuestion.mutate({ text }));
    if (added) void runCheck();
    return added;
  },
  removeQuestion: (questionId) => applyBoard(Hay.setup.removeQuestion.mutate({ questionId })),
  saveAnswer: (questionId, answer) =>
    applyBoard(Hay.setup.addAnswer.mutate({ questionId, answer })),
  retryRow: async (questionId) => {
    busyRowIds.value = [...busyRowIds.value, questionId];
    const checked = await applyBoard(
      Hay.setup.checkQuestions.mutate({ questionIds: [questionId] }),
    );
    busyRowIds.value = busyRowIds.value.filter((id) => id !== questionId);
    if (!checked) toast.error(t("setup.state.errorTitle"), t("setup.state.errorDescription"));
  },
  turnOnPlaybook: (questionId) => applyBoard(Hay.setup.turnOnPlaybook.mutate({ questionId })),
  generatePlaybook: (questionId) => generatePlaybooks([questionId]),
  finishLater: async () => {
    const dismissed = await applyBoard(Hay.setup.dismiss.mutate());
    if (dismissed) await router.push("/");
    return dismissed;
  },
};

onMounted(start);
</script>
