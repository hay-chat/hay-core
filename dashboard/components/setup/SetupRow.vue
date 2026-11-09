<template>
  <!-- Below 1360px a row stacks; from there the list is the grid and each row a subgrid of it, so
       pills and reasons line up between rows. -->
  <li
    ref="rowEl"
    class="border-b border-border min-[1360px]:col-span-full min-[1360px]:grid min-[1360px]:grid-cols-subgrid"
    :data-status="displayStatus"
    :data-row-id="row.id"
  >
    <div
      class="grid grid-cols-[minmax(0,1fr)_2.75rem] items-center gap-x-2 gap-y-1 py-3 min-[1360px]:col-span-full min-[1360px]:grid-cols-subgrid min-[1360px]:gap-x-3"
    >
      <span class="col-start-1 font-medium text-neutral-900">{{ row.text }}</span>
      <button
        type="button"
        data-row-action="edit"
        class="col-start-2 row-start-1 grid h-11 w-11 place-items-center justify-self-end rounded-md text-neutral-muted hover:bg-accent hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-[1360px]:col-start-5 min-[1360px]:h-8 min-[1360px]:w-8"
        :aria-expanded="expanded"
        :aria-controls="expanded ? panelId : undefined"
        :aria-label="$t('setup.action.edit', { question: row.text })"
        @click="emit('toggle')"
      >
        <ChevronDown
          :class="[
            'h-4 w-4 transition-transform duration-150 motion-reduce:transition-none',
            expanded && 'rotate-180',
          ]"
          aria-hidden="true"
        />
      </button>

      <span
        class="col-span-2 min-[1360px]:col-span-1 min-[1360px]:col-start-2 min-[1360px]:row-start-1"
      >
        <Badge :key="displayStatus" :variant="badgeVariant" :class="['setup-settle', badgeClass]">
          {{ $t(`setup.status.${displayStatus}`) }}
        </Badge>
      </span>

      <span
        class="col-span-2 text-sm text-neutral-muted min-[1360px]:col-span-1 min-[1360px]:col-start-3 min-[1360px]:row-start-1"
      >
        {{ why }}
      </span>

      <span
        class="col-span-2 min-[1360px]:col-span-1 min-[1360px]:col-start-4 min-[1360px]:row-start-1 min-[1360px]:text-right"
      >
        <template v-if="displayStatus === 'ready'">
          <Button
            variant="link"
            size="sm"
            data-row-action="primary"
            class="min-h-11 md:min-h-0"
            :disabled="tryDisabled"
            :aria-label="$t('setup.action.tryItFor', { question: row.text })"
            @click="emit('try')"
          >
            {{ $t("setup.action.tryIt") }}
          </Button>
        </template>
        <template v-else-if="displayStatus === 'missing'">
          <Button
            variant="link"
            size="sm"
            data-row-action="primary"
            class="min-h-11 md:min-h-0"
            :aria-expanded="expanded"
            :aria-label="$t('setup.action.addAnswerFor', { question: row.text })"
            @click="emit('toggle')"
          >
            {{ $t("setup.action.addAnswer") }}
          </Button>
        </template>
        <template v-else-if="displayStatus === 'needs_connection'">
          <NuxtLink
            v-if="connectTo"
            :to="connectTo"
            data-row-action="primary"
            :class="textLinkClass"
            :aria-label="$t('setup.action.connectFor', { question: row.text })"
          >
            {{ $t("setup.action.connect") }}
          </NuxtLink>
          <Button
            v-else-if="!row.plugin"
            variant="link"
            data-row-action="primary"
            size="sm"
            class="min-h-11 md:min-h-0"
            @click="emit('choosePlatform')"
          >
            {{ $t("setup.action.choosePlatform") }}
          </Button>
        </template>
        <template v-else-if="displayStatus === 'playbook_off'">
          <Button
            variant="link"
            size="sm"
            data-row-action="primary"
            class="min-h-11 md:min-h-0"
            :aria-expanded="expanded"
            @click="emit('toggle')"
          >
            {{ $t("setup.action.review") }}
          </Button>
        </template>
        <template v-else-if="displayStatus === 'playbook_missing'">
          <NuxtLink
            v-if="writeTo && row.generation !== 'pending'"
            :to="writeTo"
            :class="textLinkClass"
          >
            {{ $t("setup.action.writeOwn") }}
          </NuxtLink>
          <Button variant="link" size="sm" class="min-h-11 md:min-h-0" @click="emit('regenerate')">
            {{ $t("setup.action.retry") }}
          </Button>
        </template>
        <template v-else-if="displayStatus === 'check_failed'">
          <Button variant="link" size="sm" class="min-h-11 md:min-h-0" @click="emit('retry')">
            {{ $t("setup.action.retry") }}
          </Button>
        </template>
      </span>
    </div>

    <!-- The platform's connect attempt failed: say so next to the row it would have unlocked -->
    <p
      v-if="connectFailure && displayStatus === 'needs_connection'"
      class="pb-3 text-sm text-destructive min-[1360px]:col-span-full"
      role="alert"
      data-testid="setup-connect-error"
    >
      {{ $t("setup.connectError.message", { plugin: row.plugin?.name ?? "" }) }}
      <span v-if="connectFailure.detail" class="text-neutral-muted">
        {{
          $t("setup.connectError.detail", {
            plugin: row.plugin?.name ?? "",
            detail: connectFailure.detail,
          })
        }}
      </span>
    </p>

    <!-- The edit panel: the question, its answer and the document it is based on -->
    <form
      v-if="expanded"
      :id="panelId"
      class="setup-expand grid gap-4 pb-4 min-[1360px]:col-span-full"
      data-testid="setup-panel"
      @submit.prevent="save"
      @keydown.esc="closeIfClean"
    >
      <div class="grid gap-1.5">
        <label :for="questionId" class="text-sm font-medium text-neutral-900">
          {{ $t("setup.panel.questionLabel") }}
        </label>
        <Input
          :id="questionId"
          :model-value="questionValue"
          :label="$t('setup.panel.questionLabel')"
          maxlength="500"
          class="max-md:min-h-11"
          @update:model-value="questionDraft = String($event)"
        />
      </div>

      <!-- Ready on a page the assistant found: read-only until the person takes over -->
      <div v-if="panelKind === 'found'" class="grid gap-2" data-testid="setup-found">
        <p v-if="row.answer" class="whitespace-pre-line text-sm text-neutral-900">
          {{ row.answer }}
        </p>
        <p class="text-sm text-neutral-muted">{{ why }}</p>
        <div class="flex flex-wrap items-center gap-x-3">
          <Button
            type="button"
            variant="link"
            size="sm"
            class="min-h-11 md:min-h-0"
            @click="changeDocument"
          >
            {{ $t("setup.panel.changeDocument") }}
          </Button>
          <Button
            type="button"
            variant="link"
            size="sm"
            class="min-h-11 md:min-h-0"
            @click="writeMyOwn"
          >
            {{ $t("setup.panel.writeMyOwn") }}
          </Button>
        </div>
      </div>

      <!-- The answer the customer writes, saved as a document -->
      <div v-else-if="panelKind === 'answer'" class="grid gap-4">
        <div
          v-if="storedPending"
          class="h-20 animate-pulse rounded-md bg-neutral-100 motion-reduce:animate-none"
          role="status"
          :aria-label="$t('setup.panel.loadingAnswer')"
        />
        <div v-else-if="stored.state === 'error'" class="grid gap-1" role="alert">
          <p class="text-sm text-destructive">{{ $t("setup.panel.answerLoadError") }}</p>
          <div>
            <Button
              type="button"
              variant="link"
              size="sm"
              class="min-h-11 md:min-h-0"
              @click="loadStored"
            >
              {{ $t("setup.action.retry") }}
            </Button>
          </div>
        </div>
        <div v-else-if="readOnlyAnswer" class="grid gap-2" data-testid="setup-readonly-answer">
          <p class="whitespace-pre-line text-sm text-neutral-900">{{ stored.text }}</p>
          <p class="text-sm text-neutral-muted">{{ $t("setup.panel.formatted") }}</p>
          <div v-if="linkedDocument" class="text-sm text-neutral-muted">
            {{ basedOn }}
          </div>
          <div>
            <NuxtLink v-if="documentTo" :to="documentTo" :class="textLinkClass">
              {{ $t("setup.panel.editInKnowledge") }}
            </NuxtLink>
          </div>
        </div>
        <template v-else>
          <div class="grid gap-1.5">
            <label :for="answerId" class="text-sm font-medium text-neutral-900">
              {{ $t("setup.answer.label") }}
            </label>
            <Textarea
              :id="answerId"
              :model-value="answerValue"
              :rows="3"
              :placeholder="$t('setup.answer.placeholder')"
              @update:model-value="typeAnswer"
            />
          </div>

          <div class="grid gap-2" data-testid="setup-document">
            <template v-if="showSearch">
              <p class="text-sm font-medium text-neutral-900">
                {{ $t("setup.panel.useDocument") }}
              </p>
              <SetupDocumentSearch
                ref="searchEl"
                :exclude-id="row.answerDocumentId"
                @select="pickDocument"
              />
            </template>
            <div v-else-if="linkedDocument" class="flex flex-wrap items-center gap-x-3">
              <span class="text-sm text-neutral-muted">{{ basedOn }}</span>
              <Button
                type="button"
                variant="link"
                size="sm"
                class="min-h-11 md:min-h-0"
                @click="changeDocument"
              >
                {{ $t("setup.panel.changeDocument") }}
              </Button>
            </div>

            <p v-if="drafting" class="text-sm text-neutral-muted" role="status">
              {{ $t("setup.panel.drafting", { document: pageTitle(drafting.title) }) }}
            </p>
            <p v-else-if="draftFailed" class="text-sm text-destructive" role="alert">
              {{ $t("setup.panel.draftError", { document: pageTitle(draftFailed.title) }) }}
            </p>
            <p v-else-if="noAnswerFrom" class="text-sm text-neutral-900" role="status">
              {{ $t("setup.panel.noAnswer", { document: pageTitle(noAnswerFrom.title) }) }}
            </p>
            <div v-else-if="pendingDraft" class="flex flex-wrap items-center gap-x-3" role="status">
              <span class="text-sm text-neutral-muted">{{ $t("setup.panel.draftReady") }}</span>
              <Button
                type="button"
                variant="link"
                size="sm"
                class="min-h-11 md:min-h-0"
                @click="replaceWithDraft"
              >
                {{ $t("setup.panel.replaceDraft") }}
              </Button>
            </div>
          </div>
        </template>
      </div>

      <!-- Playbook off: what it does, before the customer turns it on -->
      <div
        v-else-if="panelKind === 'playbook' && row.playbook"
        class="grid gap-2"
        data-testid="setup-playbook-review"
      >
        <span class="text-sm font-medium text-neutral-900">
          {{ $t("setup.playbook.whatItDoes", { playbook: row.playbook.title }) }}
        </span>
        <ol
          v-if="row.playbook.steps.length"
          class="list-decimal space-y-1 pl-5 text-sm text-neutral-900"
          :aria-label="$t('setup.playbook.stepsLabel')"
        >
          <li v-for="(step, index) in row.playbook.steps" :key="index">{{ step }}</li>
        </ol>
        <p class="text-sm text-neutral-muted">{{ $t("setup.playbook.reviewHint") }}</p>
        <p v-if="turnOnError" class="text-sm text-destructive" role="alert">
          {{ $t("setup.playbook.turnOnError") }}
        </p>
      </div>

      <p v-if="error" class="text-sm text-destructive" role="alert">
        {{ $t("setup.answer.error") }}
      </p>

      <div class="flex flex-wrap items-center gap-2">
        <template v-if="panelKind === 'playbook'">
          <Button
            type="button"
            class="max-md:min-h-11"
            :loading="turningOn"
            @click="emit('turnOn')"
          >
            {{ $t("setup.playbook.turnOn") }}
          </Button>
          <Button
            v-if="textChanged"
            type="submit"
            variant="outline"
            class="max-md:min-h-11"
            :loading="saving"
            :disabled="!canSave"
          >
            {{ $t("setup.answer.save") }}
          </Button>
          <Button type="button" variant="outline" class="max-md:min-h-11" @click="cancel">
            {{ $t("setup.playbook.close") }}
          </Button>
          <NuxtLink v-if="playbookTo" :to="playbookTo" :class="textLinkClass">
            {{ $t("setup.playbook.open") }}
          </NuxtLink>
        </template>
        <template v-else>
          <Button type="submit" class="max-md:min-h-11" :loading="saving" :disabled="!canSave">
            {{ $t("setup.answer.save") }}
          </Button>
          <Button type="button" variant="outline" class="max-md:min-h-11" @click="cancel">
            {{ $t("setup.answer.cancel") }}
          </Button>
        </template>
        <Button
          type="button"
          variant="ghost"
          class="text-destructive hover:text-destructive max-md:min-h-11 sm:ml-auto"
          @click="emit('remove')"
        >
          {{ $t("setup.panel.removeQuestion") }}
        </Button>
      </div>
    </form>
  </li>
</template>

<script setup lang="ts">
import { pageTitle } from "@/utils/format";
import { computed, nextTick, ref, watch } from "vue";
import { ChevronDown } from "lucide-vue-next";
import { Hay } from "@/utils/api";
import type { SetupDocumentRef, SetupRow, SetupRowChanges, SetupRowStatus } from "@/stores/setup";
import { needsLabel } from "@/composables/useSetupCopy";
import SetupDocumentSearch from "./SetupDocumentSearch.vue";
import { textLinkClass } from "./styles";

type BadgeVariant = "secondary" | "success" | "warning" | "outline";

const BADGE_VARIANTS: Record<SetupRowStatus, BadgeVariant> = {
  checking: "secondary",
  reading_site: "secondary",
  ready: "success",
  missing: "warning",
  needs_connection: "secondary",
  playbook_off: "secondary",
  playbook_missing: "secondary",
  check_failed: "outline",
};

// Setup keeps one saturated colour, the blue: steps that need the customer are a quiet blue tint
// and in-progress states a quiet grey. `!` beats the Badge variant's own colours.
const BADGE_CLASSES: Partial<Record<SetupRowStatus, string>> = {
  checking: "!bg-background-tertiary !text-neutral-muted",
  reading_site: "!bg-background-tertiary !text-neutral-muted",
  needs_connection: "!bg-primary-50 !text-primary",
  playbook_off: "!bg-primary-50 !text-primary",
  playbook_missing: "!bg-primary-50 !text-primary",
};

const props = withDefaults(
  defineProps<{
    row: SetupRow;
    /** What to show now: `checking` until the real status has been revealed. */
    displayStatus: SetupRowStatus;
    /** Whether the organization has a website, which changes how "missing" reads. */
    hasSite: boolean;
    /** The site was only partly read, so "missing" means "not in the pages read so far". */
    sitePartial?: boolean;
    expanded: boolean;
    saving: boolean;
    error: boolean;
    /** Link to connect the row's platform, or null when the role cannot open it. */
    connectTo: string | null;
    playbookTo: string | null;
    /** Where "write your own" leads, or null when the role cannot open it. */
    writeTo?: string | null;
    /** Whether the role can open a document in Knowledge. */
    canOpenDocuments?: boolean;
    /** Turning the playbook on is in flight. */
    turningOn?: boolean;
    turnOnError?: boolean;
    /** The platform's connect attempt failed; `detail` is what the provider said, if anything. */
    connectFailure?: { detail?: string } | null;
    /** The test chat is answering, so a new question would be dropped. */
    tryDisabled?: boolean;
  }>(),
  {
    writeTo: null,
    canOpenDocuments: false,
    turningOn: false,
    turnOnError: false,
    connectFailure: null,
    tryDisabled: false,
  },
);

const emit = defineEmits<{
  try: [];
  toggle: [];
  remove: [];
  retry: [];
  choosePlatform: [];
  save: [changes: SetupRowChanges];
  turnOn: [];
  regenerate: [];
}>();

const { t } = useI18n();

const panelId = computed(() => `setup-panel-${props.row.id}`);
const questionId = computed(() => `setup-question-${props.row.id}`);
const answerId = computed(() => `setup-answer-${props.row.id}`);
const badgeVariant = computed(() => BADGE_VARIANTS[props.displayStatus]);
const badgeClass = computed(() => BADGE_CLASSES[props.displayStatus]);

const linkedTitle = computed(() =>
  props.row.linkedDocument ? pageTitle(props.row.linkedDocument.title) : "",
);

const why = computed(() => {
  const { row } = props;
  switch (props.displayStatus) {
    case "checking":
      return t("setup.why.checking");
    case "reading_site":
      return t("setup.why.readingSite");
    case "ready": {
      const source = row.sources[0];
      if (source?.own) {
        return row.linkedDocument
          ? t("setup.why.readyLinked", { document: linkedTitle.value })
          : t("setup.why.readyOwn");
      }
      if (source) return t("setup.why.readyFound", { source: pageTitle(source.title) });
      if (row.plugin && row.playbook) {
        return t("setup.why.readyTool", { plugin: row.plugin.name, playbook: row.playbook.title });
      }
      return t("setup.why.readyGeneric");
    }
    case "missing":
      if (row.handedOff) return t("setup.why.missingHandedOff");
      if (props.hasSite && props.sitePartial) return t("setup.why.missingPartial");
      return t(props.hasSite ? "setup.why.missingSite" : "setup.why.missingNoSite");
    case "needs_connection": {
      const capability = needsLabel(t, row.needs);
      return row.plugin
        ? t("setup.why.connect", { plugin: row.plugin.name, capability })
        : t("setup.why.connectAny", { capability });
    }
    case "playbook_missing":
      if (row.generation === "no_tool") {
        return t("setup.why.playbookNoTool", { plugin: row.plugin?.name ?? "" });
      }
      return row.generation === "failed"
        ? t("setup.why.playbookFailed")
        : t("setup.why.playbookWriting", { plugin: row.plugin?.name ?? "" });
    case "playbook_off":
      return row.playbook
        ? t("setup.why.playbook", { playbook: row.playbook.title })
        : t("setup.why.playbookAny");
    default:
      return t("setup.why.failed");
  }
});

// --- The panel's draft. The row stays mounted while closed, so the draft lives here and only
// Cancel or a successful Save clears it. A board poll replaces `row` and leaves it alone.
// `null` / `undefined` mean "untouched": the panel then shows what the row holds.
const questionDraft = ref<string | null>(null);
const answerDraft = ref<string | null>(null);
/** The answer text came from a drafted answer and has not been typed over since. */
const answerIsDraft = ref(false);
const chosenDocument = ref<SetupDocumentRef | undefined>(undefined);
/** A found-on-a-page answer was taken over by the person. */
const takenOver = ref(false);
/** Showing the search even though a document is already linked. */
const searching = ref(false);

const drafting = ref<SetupDocumentRef | null>(null);
const pendingDraft = ref<string | null>(null);
const noAnswerFrom = ref<SetupDocumentRef | null>(null);
const draftFailed = ref<SetupDocumentRef | null>(null);

type StoredAnswer = {
  state: "idle" | "loading" | "ready" | "error";
  text: string;
  editable: boolean;
};
const stored = ref<StoredAnswer>({ state: "idle", text: "", editable: true });

let draftToken = 0;
let loadToken = 0;
let storedLoad: Promise<void> | null = null;

const hasStored = computed(() => Boolean(props.row.answerDocumentId));
const storedPending = computed(
  () => hasStored.value && (stored.value.state === "idle" || stored.value.state === "loading"),
);
const readOnlyAnswer = computed(
  () => hasStored.value && stored.value.state === "ready" && !stored.value.editable,
);

type PanelKind = "answer" | "found" | "playbook" | "question";
const panelKind = computed<PanelKind>(() => {
  const { status, answerDocumentId, sources, playbook } = props.row;
  if (status === "missing" || status === "check_failed") return "answer";
  if (status === "ready") {
    if (answerDocumentId) return "answer";
    if (sources.length > 0) return takenOver.value ? "answer" : "found";
  }
  if (status === "playbook_off" && playbook) return "playbook";
  return "question";
});

const questionValue = computed(() => questionDraft.value ?? props.row.text);
const storedText = computed(() => (stored.value.state === "ready" ? stored.value.text : ""));
const answerValue = computed(() => answerDraft.value ?? storedText.value);

const linkedDocument = computed(() => chosenDocument.value ?? props.row.linkedDocument);
const basedOn = computed(() =>
  linkedDocument.value
    ? t("setup.panel.basedOn", { document: pageTitle(linkedDocument.value.title) })
    : "",
);
const showSearch = computed(() => !linkedDocument.value || searching.value);
const documentTo = computed(() =>
  props.canOpenDocuments && props.row.answerDocumentId
    ? `/documents/${props.row.answerDocumentId}`
    : null,
);

// What changed against the row. Only these are sent.
const textChanged = computed(
  () => questionDraft.value !== null && questionDraft.value.trim() !== props.row.text,
);
const answerEditable = computed(
  () =>
    panelKind.value === "answer" &&
    !storedPending.value &&
    stored.value.state !== "error" &&
    !readOnlyAnswer.value,
);
const answerChanged = computed(
  () =>
    answerEditable.value &&
    answerDraft.value !== null &&
    answerDraft.value.trim() !== storedText.value.trim(),
);
const linkChanged = computed(
  () =>
    answerEditable.value &&
    chosenDocument.value !== undefined &&
    chosenDocument.value.id !== props.row.linkedDocument?.id,
);
const dirty = computed(() => textChanged.value || answerChanged.value || linkChanged.value);

const answerEmptied = computed(
  () => answerChanged.value && !answerValue.value.trim() && Boolean(storedText.value.trim()),
);
const canSave = computed(
  () => dirty.value && !props.saving && !answerEmptied.value && Boolean(questionValue.value.trim()),
);

const save = () => {
  if (!canSave.value) return;
  const changes: SetupRowChanges = {};
  if (textChanged.value) changes.text = questionValue.value.trim();
  if (answerChanged.value) changes.answer = answerValue.value.trim();
  if (linkChanged.value && chosenDocument.value) changes.linkedDocumentId = chosenDocument.value.id;
  emit("save", changes);
};

const reset = () => {
  draftToken++;
  loadToken++;
  storedLoad = null;
  questionDraft.value = null;
  answerDraft.value = null;
  answerIsDraft.value = false;
  chosenDocument.value = undefined;
  takenOver.value = false;
  searching.value = false;
  drafting.value = null;
  pendingDraft.value = null;
  noAnswerFrom.value = null;
  draftFailed.value = null;
  stored.value = { state: "idle", text: "", editable: true };
};

const cancel = () => {
  reset();
  emit("toggle");
};

// Escape closes the panel only when nothing would be lost.
const closeIfClean = () => {
  if (!dirty.value) emit("toggle");
};

const typeAnswer = (value: string) => {
  answerDraft.value = value;
  answerIsDraft.value = false;
};

// --- The saved answer, read when the panel opens for a row that has one.
const loadStored = () => {
  const token = ++loadToken;
  stored.value = { state: "loading", text: "", editable: true };
  const run = (async () => {
    try {
      const result = await Hay.setup.getAnswer.query({ questionId: props.row.id });
      if (token !== loadToken) return;
      stored.value = {
        state: "ready",
        text: result?.text ?? "",
        editable: result?.editable ?? true,
      };
    } catch {
      if (token === loadToken) stored.value = { state: "error", text: "", editable: true };
    }
  })();
  storedLoad = run;
  return run;
};

const loadStoredOnce = () => {
  if (hasStored.value && stored.value.state === "idle") void loadStored();
};

// --- Drafting an answer from a document.
const searchEl = ref<InstanceType<typeof SetupDocumentSearch> | null>(null);

const applyDraft = (answer: string) => {
  const current = answerValue.value.trim();
  // Text the person typed is never overwritten without "Replace with draft".
  if (!current || answerIsDraft.value) {
    answerDraft.value = answer;
    answerIsDraft.value = true;
    pendingDraft.value = null;
  } else {
    pendingDraft.value = answer;
  }
};

const pickDocument = async (picked: SetupDocumentRef) => {
  const token = ++draftToken;
  chosenDocument.value = picked;
  takenOver.value = true;
  searching.value = false;
  pendingDraft.value = null;
  noAnswerFrom.value = null;
  draftFailed.value = null;
  drafting.value = picked;
  // The saved answer must be known before deciding whether a draft may fill the field.
  if (storedLoad) await storedLoad;
  if (token !== draftToken) return;
  try {
    const { answer } = await Hay.setup.draftAnswer.mutate({
      questionId: props.row.id,
      documentId: picked.id,
    });
    if (token !== draftToken) return;
    drafting.value = null;
    if (answer === null) noAnswerFrom.value = picked;
    else applyDraft(answer);
  } catch {
    if (token !== draftToken) return;
    drafting.value = null;
    draftFailed.value = picked;
  }
};

const replaceWithDraft = async () => {
  if (pendingDraft.value === null) return;
  answerDraft.value = pendingDraft.value;
  answerIsDraft.value = true;
  pendingDraft.value = null;
  await nextTick();
  document.getElementById(answerId.value)?.focus();
};

const changeDocument = async () => {
  takenOver.value = true;
  searching.value = true;
  await nextTick();
  searchEl.value?.focus();
};

const writeMyOwn = async () => {
  takenOver.value = true;
  await nextTick();
  document.getElementById(answerId.value)?.focus();
};

// --- Saving. A save that ends without an error is done: the draft is spent.
watch(
  () => props.saving,
  (now, was) => {
    if (was && !now && !props.error) reset();
  },
);

watch(
  () => props.row.answerDocumentId,
  () => {
    if (props.expanded && !props.saving) loadStoredOnce();
  },
);

const rowEl = ref<HTMLElement | null>(null);

// Move focus into the panel when it opens, like a dialog would. When it closes, the focused
// control (Cancel, Save, Turn on) is gone: hand focus back to the row's chevron.
watch(
  () => props.expanded,
  async (open, wasOpen) => {
    if (!open) {
      if (!wasOpen) return;
      await nextTick();
      const active = document.activeElement;
      if (!active || active === document.body) {
        rowEl.value?.querySelector<HTMLElement>('[data-row-action="edit"]')?.focus();
      }
      return;
    }
    loadStoredOnce();
    await nextTick();
    const wantsAnswer = props.row.status === "missing" || props.row.status === "check_failed";
    const target =
      (wantsAnswer ? document.getElementById(answerId.value) : null) ??
      document.getElementById(questionId.value);
    target?.focus();
  },
  { immediate: true },
);
</script>

<style scoped>
.setup-settle {
  animation: setup-settle 0.45s cubic-bezier(0.16, 1, 0.3, 1);
}
.setup-expand {
  animation: setup-settle 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}
@keyframes setup-settle {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  .setup-settle,
  .setup-expand {
    animation: none;
  }
}
</style>
