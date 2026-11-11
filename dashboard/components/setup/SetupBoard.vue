<template>
  <div class="mx-auto w-full max-w-[1220px] space-y-5">
    <header class="flex flex-wrap items-start justify-between gap-4">
      <div class="min-w-0">
        <h1 class="text-2xl font-medium text-neutral-900 md:text-3xl">
          {{ $t("setup.board.title") }}
        </h1>
        <ul
          class="mt-2 flex flex-wrap items-center gap-1.5"
          :aria-label="$t('setup.board.answers')"
        >
          <li
            v-for="tag in tags"
            :key="tag"
            class="rounded bg-background-tertiary px-2 py-0.5 text-sm text-neutral-700"
          >
            {{ tag }}
          </li>
          <li>
            <button type="button" :class="textLinkClass" @click="emit('changeAnswers')">
              {{ $t("setup.board.changeAnswers") }}
            </button>
          </li>
        </ul>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <Button
          v-if="canInstall"
          id="setup-install-trigger"
          variant="outline"
          :aria-expanded="installOpen"
          aria-controls="setup-install-panel"
          @click="toggleInstall"
        >
          {{ $t("setup.board.addToSite") }}
        </Button>
        <Button variant="outline" :loading="finishing" @click="finishLater">
          {{ $t("setup.board.finishLater") }}
        </Button>
      </div>
    </header>
    <p v-if="finishError" class="text-sm text-destructive" role="alert">
      {{ $t("setup.board.finishError") }}
    </p>

    <SetupUpNext
      :up-next="testing ? null : board.upNext"
      :checking="testing"
      :total="testingCount"
      :connect-to="connectTo"
      :can-install="canInstall"
      :write-to="writeTo"
      @open="openRow"
      @choose-platform="emit('choosePlatform')"
      @install="openInstall"
    />

    <SetupInstallPanel
      v-if="installOpen"
      :not-ready="board.totalCount - board.readyCount"
      :total="board.totalCount"
      :settings-to="canOpen('/settings/webchat') ? '/settings/webchat' : null"
      @close="closeInstall"
    />

    <div class="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(300px,360px)]">
      <section :aria-label="$t('setup.board.rowsLabel')" class="min-w-0">
        <div v-if="checkFailed" class="mb-3 flex flex-wrap items-center gap-3" role="alert">
          <div class="min-w-0 flex-1 basis-60">
            <p class="font-medium text-neutral-900">{{ $t("setup.board.checkErrorTitle") }}</p>
            <p class="text-sm text-neutral-muted">{{ $t("setup.board.checkErrorDescription") }}</p>
          </div>
          <Button variant="outline" :loading="checking" @click="emit('recheck')">
            {{ $t("setup.board.checkAgain") }}
          </Button>
        </div>

        <p
          v-if="board.site.partial"
          class="mb-3 text-sm text-neutral-700"
          role="status"
          data-testid="setup-partial-notice"
        >
          {{
            $t(`setup.board.partialNotice${board.site.processed === 1 ? "One" : "Other"}`, {
              count: board.site.processed,
            })
          }}
        </p>

        <div class="mb-4 grid gap-2.5">
          <div class="flex flex-wrap items-baseline justify-between gap-x-4 text-sm tabular-nums">
            <b class="font-medium text-neutral-900" aria-live="polite">
              {{ $t("setup.board.ready", { ready: readyShown, total: board.rows.length }) }}
            </b>
            <span class="text-neutral-muted">{{ needYouLabel }}</span>
          </div>
          <SetupProgressBar v-if="board.rows.length" :statuses="shownStatuses" />
          <div
            v-if="board.rows.length"
            class="flex flex-wrap gap-1.5"
            role="group"
            :aria-label="$t('setup.board.filtersLabel')"
          >
            <FilterPill
              v-for="option in filterOptions"
              :key="option.value"
              :pressed="filter === option.value"
              :count="option.count"
              @click="filter = option.value"
            >
              {{ option.label }}
            </FilterPill>
          </div>
        </div>

        <div v-if="board.rows.length" class="grid gap-6" data-testid="setup-rows">
          <section v-for="group in shownGroups" :key="group.key" class="grid gap-2.5">
            <h2
              class="flex items-baseline gap-2 px-1 font-primary text-sm font-medium text-neutral-700"
            >
              {{ $t(`setup.board.groups.${group.key}`) }}
              <span class="tabular-nums text-neutral-muted">{{ group.rows.length }}</span>
            </h2>
            <ul class="grid gap-2.5">
              <SetupRow
                v-for="{ row, index } in group.rows"
                :key="row.id"
                :row="row"
                :display-status="displayStatus(row, index)"
                :has-site="Boolean(board.website)"
                :expanded="openId === row.id"
                :saving="savingId === row.id"
                :error="errorId === row.id"
                :connect-to="rowConnectTo(row)"
                :playbook-to="rowPlaybookTo(row)"
                :site-partial="Boolean(board.site.partial)"
                :write-to="writeTo"
                :can-open-documents="canOpen('/documents')"
                :turning-on="turningOnId === row.id"
                :turn-on-error="turnOnErrorId === row.id"
                :connect-failure="rowConnectFailure(row)"
                :try-disabled="Boolean(chat?.busy)"
                @try="tryRow(row.text)"
                @toggle="toggleRow(row.id)"
                @remove="removeRow(row.id)"
                @retry="actions.retryRow(row.id)"
                @choose-platform="emit('choosePlatform')"
                @save="(changes, options) => saveRow(row.id, changes, options.keepOpen)"
                @turn-on="turnOn(row.id)"
                @regenerate="actions.generatePlaybook(row.id)"
              />
            </ul>
          </section>
          <p v-if="!shownGroups.length" class="px-1 text-sm text-neutral-muted" role="status">
            {{ $t("setup.board.filterEmpty") }}
          </p>
        </div>
        <EmptyState
          v-else
          :title="$t('setup.board.emptyTitle')"
          :description="$t('setup.board.emptyDescription')"
        />

        <form
          ref="addForm"
          class="mt-4 flex items-end gap-2 rounded-xl border border-dashed border-neutral-300 bg-background p-3"
          @submit.prevent="addQuestion"
        >
          <div class="min-w-0 flex-1">
            <Input
              v-model="newQuestion"
              type="text"
              :label="$t('setup.board.addLabel')"
              :placeholder="$t('setup.board.addPlaceholder')"
            />
          </div>
          <Button type="submit" variant="outline" :loading="adding" :disabled="!newQuestion.trim()">
            {{ $t("setup.board.add") }}
          </Button>
        </form>
        <p v-if="addFailed" class="mt-2 text-sm text-destructive" role="alert">
          {{ $t("setup.board.addError") }}
        </p>
        <p v-if="removeFailed" class="mt-2 text-sm text-destructive" role="alert">
          {{ $t("setup.board.removeError") }}
        </p>

        <SetupChannels
          v-if="board.channelRefs.length"
          class="mt-6"
          :channels="board.channelRefs"
          :can-install="canInstall"
          :install-open="installOpen"
          @install="openInstall"
        />

        <SetupReplay class="mt-6" />
      </section>

      <SetupTestChat ref="chat" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import type {
  SetupBoard,
  SetupRow as SetupRowData,
  SetupRowChanges,
  SetupRowStatus,
} from "@/stores/setup";
import { useSetupLinks } from "@/composables/useSetupLinks";
import SetupRow from "./SetupRow.vue";
import SetupUpNext from "./SetupUpNext.vue";
import SetupTestChat from "./SetupTestChat.vue";
import SetupInstallPanel from "./SetupInstallPanel.vue";
import SetupChannels from "./SetupChannels.vue";
import SetupReplay from "./SetupReplay.vue";
import SetupProgressBar from "./SetupProgressBar.vue";
import { STATUS_GROUP, type SetupGroup } from "./status";
import { textLinkClass } from "./styles";

export interface SetupBoardActions {
  /** Resolves true when the question was added. */
  addQuestion: (text: string) => Promise<boolean>;
  removeQuestion: (questionId: string) => Promise<boolean>;
  /** Puts a removed question back where it was. Resolves true when it is back. */
  restoreQuestion: (questionId: string) => Promise<boolean>;
  /** Resolves true when the row's changes were saved. */
  saveRow: (questionId: string, changes: SetupRowChanges) => Promise<boolean>;
  retryRow: (questionId: string) => Promise<void>;
  /** Resolves true when the playbook is now on. */
  turnOnPlaybook: (questionId: string) => Promise<boolean>;
  /** Drafts the playbook again for a request whose first attempt found no tool or failed. */
  generatePlaybook: (questionId: string) => Promise<void>;
  /** Resolves true when setup was set aside, so the page can leave. */
  finishLater: () => Promise<boolean>;
}

const props = withDefaults(
  defineProps<{
    board: SetupBoard;
    /** The readiness check is running. Rows show "checking" until the first result. */
    checking: boolean;
    checkFailed: boolean;
    /** Rows with a check or save in flight, shown as checking again. */
    busyRowIds: string[];
    actions: SetupBoardActions;
    /** The connect attempt that just failed, shown next to the rows that platform would unlock. */
    connectError?: { pluginId: string; detail?: string } | null;
  }>(),
  { connectError: null },
);

const emit = defineEmits<{
  changeAnswers: [];
  choosePlatform: [];
  recheck: [];
}>();

const { canOpen, connectPath, playbookPath, writePlaybookPath } = useSetupLinks();

const chat = ref<InstanceType<typeof SetupTestChat> | null>(null);

// --- The one-time settle: rows read "checking", then reveal their real status.
const revealed = ref(0);
const settledOnce = ref(false);

/** "Try it" asks the question. The chat sits below the rows on phones, so bring it into view. */
const tryRow = (text: string) => {
  const target = chat.value;
  if (!target) return;
  void target.ask(text);
  if (window.matchMedia?.("(min-width: 1024px)").matches) return;
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  (target.$el as HTMLElement | undefined)?.scrollIntoView?.({
    behavior: reduceMotion ? "auto" : "smooth",
    block: "start",
  });
};
let revealTimer: ReturnType<typeof setInterval> | null = null;

const clearReveal = () => {
  if (revealTimer) clearInterval(revealTimer);
  revealTimer = null;
};

const finishSettle = () => {
  clearReveal();
  revealed.value = props.board.rows.length;
  settledOnce.value = true;
};

const settle = () => {
  if (settledOnce.value || revealTimer) return;
  const reduceMotion =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (reduceMotion || props.board.rows.length === 0) {
    finishSettle();
    return;
  }
  revealTimer = setInterval(() => {
    revealed.value += 1;
    if (revealed.value >= props.board.rows.length) finishSettle();
  }, 80);
};

// Coming back to the board with no check in flight shows the result at once, without the band.
if (!props.checking) finishSettle();

watch(
  () => props.checking,
  (checking) => {
    if (!checking) settle();
  },
);

onBeforeUnmount(clearReveal);

const firstCheckPending = computed(() => !settledOnce.value);

// The band stays up while any row is still being tested for real (a test turn takes a while),
// and then counts only those rows.
const checkingRows = computed(() => props.board.rows.filter((row) => row.status === "checking"));
const testing = computed(() => firstCheckPending.value || checkingRows.value.length > 0);
const testingCount = computed(() =>
  firstCheckPending.value ? props.board.rows.length : checkingRows.value.length,
);

const displayStatus = (row: SetupRowData, index: number): SetupRowStatus => {
  if (props.busyRowIds.includes(row.id) || savingId.value === row.id) return "checking";
  return settledOnce.value || index < revealed.value ? row.status : "checking";
};

const shownStatuses = computed(() =>
  props.board.rows.map((row, index) => displayStatus(row, index)),
);
const readyShown = computed(() => shownStatuses.value.filter((s) => s === "ready").length);
const needYouShown = computed(
  () => shownStatuses.value.filter((s) => STATUS_GROUP[s] === "needs_you").length,
);
const needYouLabel = computed(() => {
  const count = needYouShown.value;
  if (count === 0)
    return readyShown.value === props.board.rows.length ? t("setup.board.allSet") : "";
  return count === 1 ? t("setup.board.needYouOne") : t("setup.board.needYouOther", { count });
});

// --- Groups and filter. Rows are grouped by their real status, not the one shown during the
// first reveal, so cards don't jump between groups while their badges settle.
type Filter = "all" | "needs_you" | "ready";
const filter = ref<Filter>("all");
const GROUP_ORDER: SetupGroup[] = ["needs_you", "checking", "ready"];
const indexedRows = computed(() => props.board.rows.map((row, index) => ({ row, index })));
const groupCount = (group: SetupGroup) =>
  props.board.rows.filter((row) => STATUS_GROUP[row.status] === group).length;
const filterOptions = computed(() => [
  { value: "all" as const, label: t("setup.board.filterAll"), count: props.board.rows.length },
  {
    value: "needs_you" as const,
    label: t("setup.board.filterNeedsYou"),
    count: groupCount("needs_you"),
  },
  { value: "ready" as const, label: t("setup.board.filterReady"), count: groupCount("ready") },
]);
const shownGroups = computed(() =>
  GROUP_ORDER.filter((key) => filter.value === "all" || filter.value === key)
    .map((key) => ({
      key,
      rows: indexedRows.value.filter(({ row }) => STATUS_GROUP[row.status] === key),
    }))
    .filter((group) => group.rows.length > 0),
);

// --- Header tags: business type, a few tools and the website.
const { t } = useI18n();

const websiteHost = (website: string): string => {
  try {
    return new URL(/^[a-z]+:\/\//i.test(website) ? website : `https://${website}`).host;
  } catch {
    return website;
  }
};

const tags = computed(() => {
  const list: string[] = [];
  if (props.board.businessType) list.push(t(`setup.types.${props.board.businessType}.name`));
  for (const plugin of props.board.toolPlugins.slice(0, 3)) list.push(plugin.name);
  if (props.board.website) list.push(websiteHost(props.board.website));
  return list;
});

// --- Links, filtered by role.
const connectTo = computed(() => {
  const next = props.board.upNext;
  return next.kind === "connect" && canOpen("/integrations/plugins")
    ? connectPath(next.plugin.id)
    : null;
});

// --- Add to your site: an inline panel, available whatever the state of the list.
const canInstall = computed(() => canOpen("/settings/webchat"));
const installOpen = ref(false);
const openInstall = () => {
  installOpen.value = true;
};
const closeInstall = async () => {
  installOpen.value = false;
  // The panel held focus; give it back to the button that opened it.
  await nextTick();
  document.getElementById("setup-install-trigger")?.focus();
};
const toggleInstall = () => {
  installOpen.value = !installOpen.value;
};
const writeTo = computed(() => (canOpen("/playbooks") ? writePlaybookPath : null));
const rowConnectFailure = (row: SetupRowData) =>
  props.connectError && row.plugin?.id === props.connectError.pluginId
    ? { detail: props.connectError.detail }
    : null;
const rowConnectTo = (row: SetupRowData): string | null =>
  row.plugin && canOpen("/integrations/plugins") ? connectPath(row.plugin.id) : null;
const rowPlaybookTo = (row: SetupRowData): string | null =>
  row.playbook && canOpen("/playbooks") ? playbookPath(row.playbook.id) : null;

// --- Row interactions.
const openId = ref<string | null>(null);
const savingId = ref<string | null>(null);
const errorId = ref<string | null>(null);

const toggleRow = (id: string) => {
  errorId.value = null;
  turnOnErrorId.value = null;
  openId.value = openId.value === id ? null : id;
};

const openRow = async (id: string) => {
  openId.value = id;
  await nextTick();
  document.querySelector(`[data-row-id="${id}"]`)?.scrollIntoView?.({ block: "nearest" });
};

const turningOnId = ref<string | null>(null);
const turnOnErrorId = ref<string | null>(null);

const turnOn = async (id: string) => {
  turningOnId.value = id;
  turnOnErrorId.value = null;
  const on = await props.actions.turnOnPlaybook(id);
  turningOnId.value = null;
  if (on) openId.value = null;
  else turnOnErrorId.value = id;
};

/** `keepOpen`: one section of an open card was saved, so the card stays open. */
const saveRow = async (id: string, changes: SetupRowChanges, keepOpen = false) => {
  savingId.value = id;
  errorId.value = null;
  const saved = await props.actions.saveRow(id, changes);
  savingId.value = null;
  if (!saved) errorId.value = id;
  else if (!keepOpen && openId.value === id) openId.value = null;
};

const addForm = ref<HTMLFormElement | null>(null);
const removeFailed = ref(false);

const focusChevron = (id: string): boolean => {
  const chevron = document.querySelector<HTMLElement>(
    `[data-row-id="${id}"] [data-row-action="edit"]`,
  );
  chevron?.focus();
  return Boolean(chevron);
};

const UNDO_MS = 8000;
const toast = useToast();

const undoRemove = async (id: string) => {
  const restored = await props.actions.restoreQuestion(id);
  if (!restored) {
    toast.error(t("setup.board.undoError"));
    return;
  }
  await nextTick();
  focusChevron(id);
};

const removeRow = async (id: string) => {
  removeFailed.value = false;
  if (openId.value === id) openId.value = null;
  // The chevron goes with its row: focus the next row's, else the previous one's.
  const index = props.board.rows.findIndex((r) => r.id === id);
  const neighbour = props.board.rows[index + 1] ?? props.board.rows[index - 1];
  removeFailed.value = !(await props.actions.removeQuestion(id));
  if (removeFailed.value) return;
  toast.show({
    type: "info",
    title: t("setup.board.removed"),
    duration: UNDO_MS,
    action: { label: t("setup.board.undo"), onClick: () => void undoRemove(id) },
  });
  await nextTick();
  if (neighbour && focusChevron(neighbour.id)) return;
  addForm.value?.querySelector("input")?.focus();
};

const newQuestion = ref("");
const adding = ref(false);
const addFailed = ref(false);
const addQuestion = async () => {
  const text = newQuestion.value.trim();
  if (!text || adding.value) return;
  adding.value = true;
  addFailed.value = false;
  const added = await props.actions.addQuestion(text);
  adding.value = false;
  if (added) newQuestion.value = "";
  else addFailed.value = true;
};

const finishing = ref(false);
const finishError = ref(false);
const finishLater = async () => {
  finishing.value = true;
  finishError.value = false;
  const done = await props.actions.finishLater();
  finishing.value = false;
  finishError.value = !done;
};
</script>
