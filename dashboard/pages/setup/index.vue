<template>
  <Page>
    <div
      v-if="store.status === 'idle' || store.status === 'loading'"
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
      @change-answers="openQuestions(0)"
      @choose-platform="openQuestions(1)"
      @recheck="runCheck()"
    />
  </Page>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { Hay } from "@/utils/api";
import { useSetupStore, type SetupBoard as SetupBoardData } from "@/stores/setup";
import { useSetupSitePolling } from "@/composables/useSetupSitePolling";
import SetupQuestions from "@/components/setup/SetupQuestions.vue";
import SetupBoard, { type SetupBoardActions } from "@/components/setup/SetupBoard.vue";

const router = useRouter();
const store = useSetupStore();

const mode = ref<"questions" | "board">("questions");
const startStep = ref(0);
const checking = ref(false);
const checkFailed = ref(false);
const busyRowIds = ref<string[]>([]);

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
};

const showBoard = () => {
  // Set before the board mounts, so its rows start as "checking" instead of flashing statuses.
  checking.value = Boolean(store.board?.rows.length);
  mode.value = "board";
  if (checking.value) void runCheck();
};

const start = async () => {
  await store.load({ force: true });
  if (!store.board) return;
  if (store.board.answeredAt) showBoard();
  else mode.value = "questions";
};

const openQuestions = (step: number) => {
  startStep.value = step;
  mode.value = "questions";
};

const onSaved = (board: SetupBoardData) => {
  store.apply(board);
  showBoard();
};

// While the website is being read, poll; check the rows once it has finished.
useSetupSitePolling(() => {
  if (mode.value === "board") void runCheck();
});

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
  finishLater: async () => {
    const dismissed = await applyBoard(Hay.setup.dismiss.mutate());
    if (dismissed) await router.push("/");
    return dismissed;
  },
};

onMounted(start);
</script>
