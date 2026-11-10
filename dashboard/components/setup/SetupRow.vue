<template>
  <li ref="rowEl" :data-status="displayStatus" :data-row-id="row.id">
    <article
      :class="[
        'rounded-xl border bg-background transition-shadow duration-200 motion-reduce:transition-none',
        expanded ? 'border-neutral-300 shadow-lg' : 'border-border shadow-sm',
      ]"
    >
      <!-- Status, question and reason, one action, the chevron: the same columns on every card -->
      <div
        class="grid cursor-pointer grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-x-3.5 gap-y-2 py-3.5 pl-4 pr-2.5 sm:grid-cols-[2rem_minmax(0,1fr)_auto_auto]"
        @click="onHeadClick"
      >
        <span
          :class="['grid h-8 w-8 place-items-center rounded-lg', tile.classes]"
          aria-hidden="true"
        >
          <component
            :is="tile.icon"
            :class="[
              'h-4 w-4',
              (displayStatus === 'checking' || displayStatus === 'reading_site') &&
                'animate-spin motion-reduce:animate-none',
            ]"
          />
        </span>
        <div class="min-w-0">
          <p class="font-medium text-neutral-900">{{ row.text }}</p>
          <p class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-neutral-muted">
            <Badge
              :key="displayStatus"
              :variant="badgeVariant"
              :class="['setup-settle', badgeClass]"
            >
              {{ $t(`setup.status.${displayStatus}`) }}
            </Badge>
            <span class="min-w-0">{{ why }}</span>
          </p>
        </div>
        <div
          class="flex items-center gap-1 empty:hidden max-sm:col-span-2 max-sm:col-start-2 max-sm:row-start-2 sm:justify-self-end"
        >
          <template v-if="displayStatus === 'ready'">
            <Button
              variant="ghost"
              size="sm"
              data-row-action="primary"
              class="max-md:min-h-11"
              :disabled="tryDisabled"
              :aria-label="$t('setup.action.tryItFor', { question: row.text })"
              @click="emit('try')"
            >
              <Play class="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              {{ $t("setup.action.tryIt") }}
            </Button>
          </template>
          <template v-else-if="displayStatus === 'missing' && !expanded">
            <button
              type="button"
              data-row-action="primary"
              :class="softLinkClass"
              :aria-expanded="expanded"
              :aria-label="$t('setup.action.addAnswerFor', { question: row.text })"
              @click="emit('toggle')"
            >
              {{ $t("setup.action.addAnswer") }}
            </button>
          </template>
          <template v-else-if="displayStatus === 'needs_connection'">
            <NuxtLink
              v-if="connectTo"
              :to="connectTo"
              data-row-action="primary"
              :class="softLinkClass"
              :aria-label="$t('setup.action.connectFor', { question: row.text })"
            >
              <Plug class="h-3.5 w-3.5" aria-hidden="true" />
              {{ connectLabel }}
            </NuxtLink>
            <button
              v-else-if="!row.plugin"
              type="button"
              data-row-action="primary"
              :class="softLinkClass"
              @click="emit('choosePlatform')"
            >
              {{ $t("setup.action.choosePlatform") }}
            </button>
          </template>
          <template v-else-if="displayStatus === 'playbook_off' && !expanded">
            <button
              type="button"
              data-row-action="primary"
              :class="softLinkClass"
              :aria-expanded="expanded"
              @click="emit('toggle')"
            >
              {{ $t("setup.action.review") }}
            </button>
          </template>
          <template v-else-if="displayStatus === 'playbook_missing'">
            <NuxtLink
              v-if="writeTo && row.generation !== 'pending'"
              :to="writeTo"
              :class="textLinkClass"
            >
              {{ $t("setup.action.writeOwn") }}
            </NuxtLink>
            <Button variant="ghost" size="sm" class="max-md:min-h-11" @click="emit('regenerate')">
              {{ $t("setup.action.retry") }}
            </Button>
          </template>
          <template v-else-if="displayStatus === 'check_failed'">
            <Button variant="ghost" size="sm" class="max-md:min-h-11" @click="emit('retry')">
              {{ $t("setup.action.retry") }}
            </Button>
          </template>
        </div>
        <div class="max-sm:col-start-3 max-sm:row-start-1">
          <SetupIconButton
            data-row-action="edit"
            :label="$t('setup.action.edit', { question: row.text })"
            :tooltip="$t(expanded ? 'setup.action.collapse' : 'setup.action.expand')"
            :aria-expanded="expanded"
            :aria-controls="expanded ? panelId : undefined"
            @click="emit('toggle')"
          >
            <ChevronDown
              :class="[
                'h-4 w-4 transition-transform duration-150 motion-reduce:transition-none',
                expanded && 'rotate-180',
              ]"
              aria-hidden="true"
            />
          </SetupIconButton>
        </div>
      </div>

      <!-- The platform's connect attempt failed: say so next to the row it would have unlocked -->
      <p
        v-if="connectFailure && displayStatus === 'needs_connection'"
        class="px-4 pb-3 text-sm text-destructive sm:pl-[3.875rem]"
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

      <!-- The panel. Each section edits in place; the rest of the card stays where it is. -->
      <form
        v-if="expanded"
        :id="panelId"
        class="setup-expand grid gap-5 border-t border-border px-4 pb-4 pt-5 sm:pl-[3.875rem]"
        data-testid="setup-panel"
        @submit.prevent="saveCompose"
        @keydown.esc="onEscape"
      >
        <div class="grid gap-1.5">
          <div class="flex min-h-8 items-center justify-between gap-2">
            <label :for="questionId" class="text-sm font-medium text-neutral-900">
              {{ $t("setup.panel.questionLabel") }}
            </label>
            <span v-if="panelKind !== 'compose' && textChanged" class="flex items-center gap-1">
              <Button type="button" variant="ghost" size="xs" @click="questionDraft = null">
                {{ $t("setup.answer.cancel") }}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                class="text-primary"
                data-testid="setup-save-question"
                :loading="savingSection === 'question'"
                :disabled="saving"
                @click="saveQuestion"
              >
                <Check class="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                {{ $t("setup.answer.save") }}
              </Button>
            </span>
          </div>
          <Input
            :id="questionId"
            :model-value="questionValue"
            maxlength="500"
            class="max-md:min-h-11"
            @update:model-value="questionDraft = String($event)"
          />
        </div>

        <!-- Writing an answer for a question that has none -->
        <template v-if="panelKind === 'compose'">
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
            <SetupDraftStatus
              :drafting="drafting"
              :failed="draftFailed"
              :no-answer="noAnswer"
              :pending-draft="pendingDraft !== null"
              :documents="editDocs"
              @replace="replaceWithDraft"
            />
          </div>
          <SetupDocumentList
            :documents="editDocs"
            mode="edit"
            :title="documentsTitle(editDocs, 'drafting')"
            :exclude-ids="ownExclude"
            @add="addComposeDocument"
            @remove="removeDocument"
          />
        </template>

        <!-- An answer that is already there: the customer's own, or one found in their documents -->
        <template v-else-if="panelKind === 'own' || panelKind === 'found'">
          <div class="grid gap-1.5" data-testid="setup-answer">
            <div
              v-if="storedPending"
              class="h-20 animate-pulse rounded-md bg-neutral-100 motion-reduce:animate-none"
              role="status"
              :aria-label="$t('setup.panel.loadingAnswer')"
            />
            <div v-else-if="stored.state === 'error'" class="grid gap-1" role="alert">
              <p class="text-sm text-destructive">{{ $t("setup.panel.answerLoadError") }}</p>
              <div>
                <Button type="button" variant="link" size="sm" @click="loadStored">
                  {{ $t("setup.action.retry") }}
                </Button>
              </div>
            </div>
            <template v-else>
              <div class="flex min-h-8 items-center justify-between gap-2">
                <label :for="answerId" class="text-sm font-medium text-neutral-900">
                  {{ $t("setup.panel.answerLabel") }}
                </label>
                <span v-if="editing === 'answer'" class="flex items-center gap-1">
                  <Button type="button" variant="ghost" size="xs" @click="cancelSection">
                    {{ $t("setup.answer.cancel") }}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    class="text-primary"
                    data-testid="setup-save-answer"
                    :loading="savingSection === 'answer'"
                    :disabled="!canSaveAnswer"
                    @click="saveAnswer"
                  >
                    <Check class="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                    {{ $t("setup.answer.save") }}
                  </Button>
                </span>
                <NuxtLink
                  v-else-if="readOnlyAnswer && documentTo"
                  :to="documentTo"
                  :class="textLinkClass"
                >
                  {{ $t("setup.panel.editInKnowledge") }}
                </NuxtLink>
                <Button
                  v-else-if="!readOnlyAnswer"
                  type="button"
                  variant="ghost"
                  size="xs"
                  class="text-primary"
                  data-testid="setup-edit-answer"
                  :disabled="editing !== null"
                  @click="startEdit('answer')"
                >
                  <PenLine class="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                  {{ $t("setup.panel.editAnswer") }}
                </Button>
              </div>
              <Textarea
                v-if="editing === 'answer'"
                :id="answerId"
                :model-value="answerValue"
                :rows="3"
                @update:model-value="typeAnswer"
              />
              <p
                v-else
                class="whitespace-pre-line rounded-md border border-border bg-background-secondary px-3 py-2.5 text-sm text-neutral-900"
              >
                {{ baseAnswer }}
              </p>
              <p v-if="readOnlyAnswer" class="text-sm text-neutral-muted">
                {{ $t("setup.panel.formatted") }}
              </p>
            </template>
          </div>

          <div class="grid gap-1.5">
            <SetupDocumentList
              ref="documentsEl"
              :documents="editing === 'documents' ? editDocs : currentDocs"
              :mode="editing === 'documents' ? 'edit' : 'read'"
              :title="documentsTitle(editing === 'documents' ? editDocs : currentDocs, 'based')"
              :can-open="canOpenDocuments"
              :exclude-ids="ownExclude"
              @add="addDocument"
              @remove="removeDocument"
            >
              <template #actions>
                <span v-if="editing === 'documents'" class="flex items-center gap-1">
                  <Button type="button" variant="ghost" size="xs" @click="cancelSection">
                    {{ $t("setup.answer.cancel") }}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    class="text-primary"
                    data-testid="setup-save-documents"
                    :loading="drafting || savingSection === 'documents'"
                    :disabled="!canSaveDocuments"
                    @click="saveDocuments"
                  >
                    <Check class="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                    {{ $t("setup.documents.done") }}
                  </Button>
                </span>
                <Button
                  v-else
                  type="button"
                  variant="ghost"
                  size="xs"
                  class="text-primary"
                  data-testid="setup-edit-documents"
                  :disabled="editing !== null || storedPending"
                  @click="startEdit('documents')"
                >
                  <PenLine class="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                  {{
                    $t(currentDocs.length ? "setup.documents.edit" : "setup.documents.addDocuments")
                  }}
                </Button>
              </template>
            </SetupDocumentList>
            <SetupDraftStatus
              v-if="editing === 'documents'"
              :drafting="drafting"
              :failed="draftFailed"
              :no-answer="noAnswer"
              :pending-draft="false"
              :documents="editDocs"
            />
            <p
              v-if="editing === 'documents' && panelKind === 'found'"
              class="text-sm text-neutral-muted"
            >
              {{ $t("setup.documents.redraftHint") }}
            </p>
          </div>
        </template>

        <!-- Playbook off: what it does, before the customer turns it on -->
        <div
          v-else-if="panelKind === 'playbook' && row.playbook"
          class="grid gap-3"
          data-testid="setup-playbook-review"
        >
          <div class="overflow-hidden rounded-lg border border-border bg-background-secondary">
            <div
              class="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-background px-3.5 py-2.5"
            >
              <span class="flex min-w-0 items-center gap-2 text-sm font-medium text-neutral-900">
                <Workflow class="h-4 w-4 shrink-0 text-neutral-muted" aria-hidden="true" />
                {{ $t("setup.playbook.whatItDoes", { playbook: row.playbook.title }) }}
              </span>
              <span v-if="row.plugin" class="text-xs text-neutral-muted">
                {{ $t("setup.playbook.writtenFrom", { plugin: row.plugin.name }) }}
              </span>
            </div>
            <ol
              v-if="row.playbook.steps.length"
              class="grid px-3.5 py-1.5 text-sm text-neutral-900"
              :aria-label="$t('setup.playbook.stepsLabel')"
            >
              <li
                v-for="(step, index) in row.playbook.steps"
                :key="index"
                class="grid grid-cols-[1.375rem_minmax(0,1fr)] gap-2.5 border-b border-dashed border-border py-2 leading-6 last:border-b-0"
              >
                <span
                  class="mt-0.5 grid h-5 w-5 place-items-center rounded-full border border-neutral-300 bg-background text-xs font-medium tabular-nums text-neutral-700"
                  aria-hidden="true"
                >
                  {{ index + 1 }}
                </span>
                <SetupPlaybookStep :step="step" />
              </li>
            </ol>
          </div>
          <p class="text-sm text-neutral-muted">{{ $t("setup.playbook.reviewHint") }}</p>
          <p v-if="turnOnError" class="text-sm text-destructive" role="alert">
            {{ $t("setup.playbook.turnOnError") }}
          </p>
        </div>

        <p v-if="error" class="text-sm text-destructive" role="alert">
          {{ $t("setup.answer.error") }}
        </p>

        <!-- One action bar per card: the main action, a way out, and Remove at the far end -->
        <div class="flex flex-wrap items-center gap-2">
          <template v-if="panelKind === 'compose'">
            <Button
              type="submit"
              class="max-md:min-h-11"
              :loading="savingSection === 'compose'"
              :disabled="!canSaveCompose"
            >
              {{ $t("setup.answer.saveAnswer") }}
            </Button>
            <Button type="button" variant="outline" class="max-md:min-h-11" @click="cancel">
              {{ $t("setup.answer.cancel") }}
            </Button>
          </template>
          <template v-else-if="panelKind === 'playbook'">
            <Button
              type="button"
              class="max-md:min-h-11"
              :loading="turningOn"
              @click="emit('turnOn')"
            >
              {{ $t("setup.playbook.turnOn") }}
            </Button>
            <Button type="button" variant="outline" class="max-md:min-h-11" @click="cancel">
              {{ $t("setup.playbook.close") }}
            </Button>
            <NuxtLink v-if="playbookTo" :to="playbookTo" :class="textLinkClass">
              {{ $t("setup.playbook.open") }}
            </NuxtLink>
          </template>
          <template v-else-if="displayStatus === 'needs_connection'">
            <NuxtLink v-if="connectTo" :to="connectTo" :class="buttonLinkClass">
              {{ connectLabel }}
            </NuxtLink>
            <Button
              v-else-if="!row.plugin"
              type="button"
              class="max-md:min-h-11"
              @click="emit('choosePlatform')"
            >
              {{ $t("setup.action.choosePlatform") }}
            </Button>
          </template>
          <template v-else-if="displayStatus === 'ready'">
            <Button
              type="button"
              class="max-md:min-h-11"
              :disabled="tryDisabled"
              @click="emit('try')"
            >
              <Play class="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              {{ $t("setup.action.tryInChat") }}
            </Button>
          </template>
          <Button
            type="button"
            variant="ghost"
            class="ml-auto text-destructive hover:text-destructive max-md:min-h-11"
            @click="emit('remove')"
          >
            <Trash2 class="mr-1.5 h-4 w-4" aria-hidden="true" />
            {{ $t("setup.panel.removeQuestion") }}
          </Button>
        </div>
      </form>
    </article>
  </li>
</template>

<script setup lang="ts">
import { pageTitle } from "@/utils/format";
import { computed, nextTick, ref, watch } from "vue";
import { Check, ChevronDown, PenLine, Play, Plug, Trash2, Workflow } from "lucide-vue-next";
import { Hay } from "@/utils/api";
import type { SetupDocumentRef, SetupRow, SetupRowChanges, SetupRowStatus } from "@/stores/setup";
import { needsLabel } from "@/composables/useSetupCopy";
import SetupDocumentList from "./SetupDocumentList.vue";
import SetupDraftStatus from "./SetupDraftStatus.vue";
import SetupIconButton from "./SetupIconButton.vue";
import SetupPlaybookStep from "./SetupPlaybookStep.vue";
import { BADGE_CLASSES, BADGE_VARIANTS, STATUS_TILES } from "./status";
import { buttonLinkClass, softLinkClass, textLinkClass } from "./styles";

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
    sitePartial: false,
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
  /** `keepOpen`: a section of an open card was saved, so the card stays open. */
  save: [changes: SetupRowChanges, options: { keepOpen: boolean }];
  turnOn: [];
  regenerate: [];
}>();

const { t } = useI18n();

const panelId = computed(() => `setup-panel-${props.row.id}`);
const questionId = computed(() => `setup-question-${props.row.id}`);
const answerId = computed(() => `setup-answer-${props.row.id}`);
const badgeVariant = computed(() => BADGE_VARIANTS[props.displayStatus]);
const badgeClass = computed(() => BADGE_CLASSES[props.displayStatus]);
const tile = computed(() => STATUS_TILES[props.displayStatus]);
const connectLabel = computed(() =>
  props.row.plugin
    ? t("setup.action.connectPlugin", { plugin: props.row.plugin.name })
    : t("setup.action.connect"),
);

/** Pages of the customer's documents the check found the answer on (not their own answer). */
const sourceDocs = computed<SetupDocumentRef[]>(() =>
  props.row.sources.filter((s) => !s.own).map((s) => ({ id: s.documentId, title: s.title })),
);
const linkedDocs = computed<SetupDocumentRef[]>(() => props.row.linkedDocuments ?? []);

/** "{first}", or "{first} and N more documents". */
const firstAndMore = (prefix: string, docs: SetupDocumentRef[], key: string): string => {
  const first = pageTitle(docs[0].title);
  if (docs.length === 1) return t(prefix, { [key]: first });
  const count = docs.length - 1;
  return t(`${prefix}More${count === 1 ? "One" : "Other"}`, { [key]: first, count });
};

const why = computed(() => {
  const { row } = props;
  switch (props.displayStatus) {
    case "checking":
      return t("setup.why.checking");
    case "reading_site":
      return t("setup.why.readingSite");
    case "ready": {
      if (row.sources[0]?.own || row.answerDocumentId) {
        return linkedDocs.value.length
          ? firstAndMore("setup.why.readyLinked", linkedDocs.value, "document")
          : t("setup.why.readyOwn");
      }
      if (sourceDocs.value.length) {
        return firstAndMore("setup.why.readyFound", sourceDocs.value, "source");
      }
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

// --- The saved own answer, read when the panel opens for a row that has one.
type StoredAnswer = {
  state: "idle" | "loading" | "ready" | "error";
  text: string;
  editable: boolean;
};
const stored = ref<StoredAnswer>({ state: "idle", text: "", editable: true });
let loadToken = 0;

const hasStored = computed(() => Boolean(props.row.answerDocumentId));
const storedPending = computed(
  () => hasStored.value && (stored.value.state === "idle" || stored.value.state === "loading"),
);
const readOnlyAnswer = computed(
  () => hasStored.value && stored.value.state === "ready" && !stored.value.editable,
);

const loadStored = async () => {
  const token = ++loadToken;
  stored.value = { state: "loading", text: "", editable: true };
  try {
    const result = await Hay.setup.getAnswer.query({ questionId: props.row.id });
    if (token !== loadToken) return;
    stored.value = { state: "ready", text: result?.text ?? "", editable: result?.editable ?? true };
  } catch {
    if (token === loadToken) stored.value = { state: "error", text: "", editable: true };
  }
};
const loadStoredOnce = () => {
  if (hasStored.value && stored.value.state === "idle") void loadStored();
};

/**
 * - compose: no answer yet; write one, optionally drafted from documents.
 * - own: the customer's saved answer and the documents it is based on.
 * - found: an answer the check found in the customer's documents.
 * - playbook: a platform request whose playbook is off, to review.
 * - question: nothing to edit but the wording.
 */
type PanelKind = "compose" | "own" | "found" | "playbook" | "question";
const panelKind = computed<PanelKind>(() => {
  const { row } = props;
  if (row.status === "playbook_off" && row.playbook) return "playbook";
  if (row.needs) return "question";
  if (hasStored.value) return "own";
  if (row.status === "ready" && sourceDocs.value.length) return "found";
  if (row.status === "missing" || row.status === "check_failed") return "compose";
  return "question";
});

// --- Drafts. The row stays mounted while closed, so drafts live here; only Cancel or a
// successful Save clears them. `null` means "untouched": the panel shows what the row holds.
const questionDraft = ref<string | null>(null);
const answerDraft = ref<string | null>(null);
/** The answer text came from a drafted answer and has not been typed over since. */
const answerIsDraft = ref(false);
const docsDraft = ref<SetupDocumentRef[] | null>(null);
/** The section of an existing answer being edited, if any. */
const editing = ref<"answer" | "documents" | null>(null);
/** Which save is in flight, for its button's spinner. */
const savingSection = ref<"question" | "answer" | "documents" | "compose" | null>(null);

const drafting = ref(false);
const draftFailed = ref(false);
const noAnswer = ref(false);
const pendingDraft = ref<string | null>(null);
let draftToken = 0;

const questionValue = computed(() => questionDraft.value ?? props.row.text);
const textChanged = computed(
  () =>
    questionDraft.value !== null &&
    Boolean(questionDraft.value.trim()) &&
    questionDraft.value.trim() !== props.row.text,
);

const baseAnswer = computed(() =>
  panelKind.value === "own"
    ? stored.value.state === "ready"
      ? stored.value.text
      : ""
    : panelKind.value === "found"
      ? (props.row.answer ?? "")
      : "",
);
const answerValue = computed(() => answerDraft.value ?? baseAnswer.value);

const currentDocs = computed(() =>
  panelKind.value === "found" ? sourceDocs.value : linkedDocs.value,
);
const editDocs = computed(
  () => docsDraft.value ?? (panelKind.value === "compose" ? [] : currentDocs.value),
);
const ownExclude = computed(() => (props.row.answerDocumentId ? [props.row.answerDocumentId] : []));

const documentsTitle = (docs: SetupDocumentRef[], kind: "based" | "drafting"): string => {
  if (!docs.length) {
    return t(kind === "drafting" ? "setup.documents.startFrom" : "setup.documents.none");
  }
  const one = docs.length === 1 ? "One" : "Other";
  return t(
    kind === "drafting" ? `setup.documents.draftingFrom${one}` : `setup.documents.basedOn${one}`,
    {
      count: docs.length,
    },
  );
};

const sameDocs = (a: SetupDocumentRef[], b: SetupDocumentRef[]) =>
  a.length === b.length && a.every((doc, index) => doc.id === b[index].id);

const canSaveAnswer = computed(
  () =>
    !props.saving &&
    Boolean(answerValue.value.trim()) &&
    answerValue.value.trim() !== baseAnswer.value.trim(),
);
const canSaveDocuments = computed(() => {
  if (props.saving || drafting.value) return false;
  // A found answer is redrafted from the documents, so it needs at least one.
  if (panelKind.value === "found") return editDocs.value.length > 0;
  return !sameDocs(editDocs.value, currentDocs.value);
});
const canSaveCompose = computed(
  () => !props.saving && Boolean(answerValue.value.trim()) && Boolean(questionValue.value.trim()),
);

const dirty = computed(
  () =>
    textChanged.value ||
    editing.value !== null ||
    (panelKind.value === "compose" &&
      (Boolean(answerValue.value.trim()) || editDocs.value.length > 0)),
);

const resetDraftStatus = () => {
  draftToken++;
  drafting.value = false;
  draftFailed.value = false;
  noAnswer.value = false;
  pendingDraft.value = null;
};

const reset = () => {
  loadToken++;
  questionDraft.value = null;
  answerDraft.value = null;
  answerIsDraft.value = false;
  docsDraft.value = null;
  editing.value = null;
  savingSection.value = null;
  resetDraftStatus();
  stored.value = { state: "idle", text: "", editable: true };
};

const cancel = () => {
  reset();
  emit("toggle");
};

const cancelSection = () => {
  editing.value = null;
  answerDraft.value = null;
  answerIsDraft.value = false;
  docsDraft.value = null;
  resetDraftStatus();
};

// Escape steps out of a section being edited; on the card, it closes only when nothing is lost.
const onEscape = () => {
  if (editing.value) cancelSection();
  else if (!dirty.value) emit("toggle");
};

const documentsEl = ref<InstanceType<typeof SetupDocumentList> | null>(null);

const startEdit = async (section: "answer" | "documents") => {
  cancelSection();
  editing.value = section;
  if (section === "documents") docsDraft.value = [...currentDocs.value];
  await nextTick();
  if (section === "answer") {
    const field = document.getElementById(answerId.value) as HTMLTextAreaElement | null;
    field?.focus();
    field?.setSelectionRange?.(field.value.length, field.value.length);
  } else {
    documentsEl.value?.focus();
  }
};

const typeAnswer = (value: string) => {
  answerDraft.value = value;
  answerIsDraft.value = false;
};

const addDocument = (doc: SetupDocumentRef) => {
  docsDraft.value = [...editDocs.value, doc];
  noAnswer.value = false;
  draftFailed.value = false;
};
const removeDocument = (id: string) => {
  docsDraft.value = editDocs.value.filter((doc) => doc.id !== id);
};

/** Drafts from the documents together. Resolves the answer, null when they don't say, or undefined on failure. */
const draftFrom = async (docs: SetupDocumentRef[]): Promise<string | null | undefined> => {
  const token = ++draftToken;
  drafting.value = true;
  draftFailed.value = false;
  noAnswer.value = false;
  try {
    const { answer } = await Hay.setup.draftAnswer.mutate({
      questionId: props.row.id,
      documentIds: docs.map((d) => d.id),
    });
    if (token !== draftToken) return undefined;
    drafting.value = false;
    noAnswer.value = answer === null;
    return answer;
  } catch {
    if (token === draftToken) {
      drafting.value = false;
      draftFailed.value = true;
    }
    return undefined;
  }
};

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

/** Writing a new answer: each document picked joins the list and the draft is redone from all. */
const addComposeDocument = async (doc: SetupDocumentRef) => {
  addDocument(doc);
  pendingDraft.value = null;
  const answer = await draftFrom(editDocs.value);
  if (answer) applyDraft(answer);
};

const replaceWithDraft = async () => {
  if (pendingDraft.value === null) return;
  answerDraft.value = pendingDraft.value;
  answerIsDraft.value = true;
  pendingDraft.value = null;
  await nextTick();
  document.getElementById(answerId.value)?.focus();
};

// --- Saving. Inline sections keep the card open; the footer's Save closes it.
const emitSave = (
  section: NonNullable<typeof savingSection.value>,
  changes: SetupRowChanges,
  keepOpen: boolean,
) => {
  savingSection.value = section;
  emit("save", changes, { keepOpen });
};

const saveQuestion = () => {
  if (!textChanged.value || props.saving) return;
  emitSave("question", { text: questionValue.value.trim() }, true);
};

const withText = (changes: SetupRowChanges): SetupRowChanges =>
  textChanged.value ? { ...changes, text: questionValue.value.trim() } : changes;

const saveAnswer = () => {
  if (!canSaveAnswer.value) return;
  const changes: SetupRowChanges = { answer: answerValue.value.trim() };
  // A found answer the customer rewrites becomes their own, based on the pages it was found on.
  if (panelKind.value === "found") changes.linkedDocumentIds = sourceDocs.value.map((d) => d.id);
  emitSave("answer", withText(changes), true);
};

const saveDocuments = async () => {
  if (!canSaveDocuments.value) return;
  const docs = editDocs.value;
  const linkedDocumentIds = docs.map((d) => d.id);
  if (panelKind.value === "own") {
    emitSave("documents", withText({ linkedDocumentIds }), true);
    return;
  }
  // A found answer is redrafted from the chosen documents and saved as the customer's own.
  const answer = await draftFrom(docs);
  if (answer) emitSave("documents", withText({ answer, linkedDocumentIds }), true);
};

const saveCompose = () => {
  if (panelKind.value !== "compose" || !canSaveCompose.value) return;
  const changes: SetupRowChanges = { answer: answerValue.value.trim() };
  if (editDocs.value.length) changes.linkedDocumentIds = editDocs.value.map((d) => d.id);
  emitSave("compose", withText(changes), false);
};

// A save that ends without an error is done: the draft is spent.
watch(
  () => props.saving,
  (now, was) => {
    if (!was || now) return;
    if (props.error) savingSection.value = null;
    else reset();
  },
);

watch(
  () => props.row.answerDocumentId,
  () => {
    if (props.expanded && !props.saving) loadStoredOnce();
  },
);

// The card's head opens and closes it; its own buttons and links keep their meaning.
const onHeadClick = (event: MouseEvent) => {
  if ((event.target as HTMLElement).closest("a, button")) return;
  emit("toggle");
};

const rowEl = ref<HTMLElement | null>(null);
const documentTo = computed(() =>
  props.canOpenDocuments && props.row.answerDocumentId
    ? `/documents/${props.row.answerDocumentId}`
    : null,
);

// Move focus into the panel when it opens, like a dialog would. When it closes, the focused
// control is gone: hand focus back to the card's chevron.
watch(
  () => props.expanded,
  async (open, wasOpen) => {
    if (!open) {
      if (!wasOpen) return;
      // A section edit ends with the card; an answer being written stays for when it reopens.
      if (editing.value) cancelSection();
      await nextTick();
      const active = document.activeElement;
      if (!active || active === document.body) {
        rowEl.value?.querySelector<HTMLElement>('[data-row-action="edit"]')?.focus();
      }
      return;
    }
    loadStoredOnce();
    await nextTick();
    const target =
      (panelKind.value === "compose" ? document.getElementById(answerId.value) : null) ??
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
