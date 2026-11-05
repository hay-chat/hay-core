<template>
  <div
    class="mx-auto grid w-full max-w-[1120px] gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(300px,420px)] lg:gap-14"
  >
    <section class="min-w-0" :aria-labelledby="headingId">
      <div
        class="mb-5 flex gap-1.5"
        role="img"
        :aria-label="$t('setup.questions.stepLabel', { current: step + 1, total: 3 })"
      >
        <i
          v-for="n in 3"
          :key="n"
          class="h-1 w-11 rounded-full"
          :class="n - 1 <= step ? 'bg-primary' : 'bg-neutral-200'"
        />
      </div>

      <!-- 1. Website and business type -->
      <div v-if="step === 0">
        <h1 :id="headingId" ref="heading" tabindex="-1" class="text-2xl outline-none md:text-3xl">
          {{ $t("setup.questions.type.title") }}
        </h1>
        <p class="mt-2 text-neutral-muted">{{ $t("setup.questions.type.description") }}</p>

        <div class="mt-5">
          <Input
            v-model="website"
            type="text"
            :label="$t('setup.questions.type.website')"
            :placeholder="$t('setup.questions.type.websitePlaceholder')"
            @blur="onWebsiteDone"
            @keydown.enter="onWebsiteDone"
          />
          <p v-if="inferring" class="mt-1.5 text-sm text-neutral-muted" role="status">
            {{ $t("setup.questions.type.inferring") }}
          </p>
        </div>

        <fieldset class="mt-5 grid gap-2">
          <legend class="sr-only">{{ $t("setup.questions.type.typeLabel") }}</legend>
          <label
            v-for="option in BUSINESS_TYPES"
            :key="option"
            class="flex cursor-pointer items-start gap-3 rounded-lg border p-3 focus-within:ring-2 focus-within:ring-ring"
            :class="
              type === option
                ? 'border-primary bg-primary-50'
                : 'border-input hover:border-neutral-400'
            "
          >
            <input
              type="radio"
              name="setup-business-type"
              class="mt-1 h-4 w-4 accent-primary"
              :value="option"
              :checked="type === option"
              @change="pickType(option)"
            />
            <span class="min-w-0">
              <span class="block font-medium text-neutral-900">
                {{ $t(`setup.types.${option}.name`) }}
                <span v-if="inferredType === option" class="font-normal text-neutral-muted">
                  ({{ $t("setup.questions.type.inferred") }})
                </span>
              </span>
              <span class="block text-sm text-neutral-muted">
                {{ $t(`setup.types.${option}.hint`) }}
              </span>
            </span>
          </label>
        </fieldset>
        <p v-if="!type" class="mt-2 text-sm text-neutral-muted">
          {{ $t("setup.questions.chooseTypeHint") }}
        </p>
      </div>

      <!-- 2. Tools and channels -->
      <div v-else-if="step === 1">
        <h1 :id="headingId" ref="heading" tabindex="-1" class="text-2xl outline-none md:text-3xl">
          {{ $t("setup.questions.tools.title") }}
        </h1>
        <p class="mt-2 text-neutral-muted">{{ $t("setup.questions.tools.description") }}</p>

        <p
          v-if="suggestionsLoading && !current"
          class="mt-5 text-sm text-neutral-muted"
          role="status"
        >
          {{ $t("setup.questions.tools.loading") }}
        </p>
        <div
          v-else-if="suggestionsError && !current"
          class="mt-5 flex flex-wrap items-center gap-3"
          role="alert"
        >
          <p class="text-sm text-destructive">{{ $t("setup.questions.tools.error") }}</p>
          <Button variant="outline" size="sm" @click="type && loadSuggestions(type)">
            {{ $t("setup.questions.tools.retry") }}
          </Button>
        </div>
        <template v-else-if="current">
          <fieldset v-for="group in pluginGroups" :key="group.group" class="mt-5">
            <legend class="mb-2 text-sm font-medium text-neutral-muted">
              {{ $t(`setup.groups.${group.group}`) }}
            </legend>
            <div class="flex flex-wrap gap-2">
              <label v-for="plugin in group.plugins" :key="plugin.id" class="cursor-pointer">
                <input
                  type="checkbox"
                  class="peer sr-only"
                  :checked="toolIds.includes(plugin.id)"
                  @change="toggle(toolIds, plugin.id)"
                />
                <span :class="chipClass(toolIds.includes(plugin.id))">{{ plugin.name }}</span>
              </label>
            </div>
          </fieldset>
          <p v-if="!pluginGroups.length" class="mt-5 text-sm text-neutral-muted">
            {{ $t("setup.questions.tools.none") }}
          </p>

          <fieldset v-if="current.channels.length" class="mt-5">
            <legend class="mb-2 text-sm font-medium text-neutral-muted">
              {{ $t("setup.questions.tools.channelsTitle") }}
            </legend>
            <div class="flex flex-wrap gap-2">
              <label v-for="channel in current.channels" :key="channel.id" class="cursor-pointer">
                <input
                  type="checkbox"
                  class="peer sr-only"
                  :checked="channelIds.includes(channel.id)"
                  @change="toggle(channelIds, channel.id)"
                />
                <span :class="chipClass(channelIds.includes(channel.id))">{{ channel.name }}</span>
              </label>
            </div>
          </fieldset>
        </template>
      </div>

      <!-- 3. Questions -->
      <div v-else>
        <h1 :id="headingId" ref="heading" tabindex="-1" class="text-2xl outline-none md:text-3xl">
          {{ $t("setup.questions.ask.title") }}
        </h1>
        <p class="mt-2 text-neutral-muted">{{ $t("setup.questions.ask.description") }}</p>

        <p
          v-if="suggestionsLoading && !current"
          class="mt-5 text-sm text-neutral-muted"
          role="status"
        >
          {{ $t("setup.questions.tools.loading") }}
        </p>
        <div
          v-else-if="suggestionsError && !current"
          class="mt-5 flex flex-wrap items-center gap-3"
          role="alert"
        >
          <p class="text-sm text-destructive">{{ $t("setup.questions.tools.error") }}</p>
          <Button variant="outline" size="sm" @click="type && loadSuggestions(type)">
            {{ $t("setup.questions.tools.retry") }}
          </Button>
        </div>
        <fieldset v-else class="mt-5 grid gap-2">
          <legend class="sr-only">{{ $t("setup.questions.ask.title") }}</legend>
          <label
            v-for="option in questionOptions"
            :key="option.key"
            class="flex cursor-pointer items-start gap-3 rounded-lg border p-3 focus-within:ring-2 focus-within:ring-ring"
            :class="
              selected.includes(option.key)
                ? 'border-primary bg-primary-50'
                : 'border-input hover:border-neutral-400'
            "
          >
            <input
              type="checkbox"
              class="mt-1 h-4 w-4 accent-primary"
              :checked="selected.includes(option.key)"
              @change="toggle(selected, option.key)"
            />
            <span class="min-w-0 text-neutral-900">{{ option.text }}</span>
          </label>
        </fieldset>

        <form class="mt-3 flex items-end gap-2" @submit.prevent="addCustom">
          <div class="min-w-0 flex-1">
            <Input
              v-model="addDraft"
              type="text"
              :label="$t('setup.questions.ask.addLabel')"
              :placeholder="$t('setup.questions.ask.addPlaceholder')"
            />
          </div>
          <Button
            type="submit"
            variant="outline"
            :disabled="!addDraft.trim() || questionOptions.length >= MAX_QUESTIONS"
          >
            {{ $t("setup.questions.ask.add") }}
          </Button>
        </form>
      </div>

      <p v-if="saveFailed" class="mt-4 text-sm text-destructive" role="alert">
        {{ $t("setup.questions.saveError") }}
      </p>

      <div class="mt-6 flex flex-wrap items-center justify-between gap-3">
        <Button variant="link" :disabled="saving" class="px-0" @click="skip">
          {{ editing ? $t("setup.questions.backToList") : $t("setup.questions.skip") }}
        </Button>
        <div class="flex gap-2">
          <Button v-if="step > 0" variant="outline" :disabled="saving" @click="step -= 1">
            {{ $t("setup.questions.back") }}
          </Button>
          <Button :loading="saving" :disabled="step === 0 && !type" @click="next">
            {{ step < 2 ? $t("setup.questions.continue") : $t("setup.questions.finish") }}
          </Button>
        </div>
      </div>
    </section>

    <SetupLiveList :items="liveItems" :site="site" :website="website" />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Hay } from "@/utils/api";
import { readableWebsite } from "@/utils/setup-website";
import type { RouterInputs } from "@/types/trpc";
import type { SetupBoard, SetupSuggestions } from "@/stores/setup";
import SetupLiveList, { type LiveItem } from "./SetupLiveList.vue";

type BusinessType = RouterInputs["setup"]["suggestions"]["businessType"];

/** One selectable question. `id` is absent for questions typed here and not saved yet. */
interface QuestionOption {
  key: string;
  id?: string;
  text: string;
  needs?: SetupSuggestions["questions"][number]["needs"];
  custom: boolean;
}

const BUSINESS_TYPES: BusinessType[] = ["store", "saas", "service", "other"];
// Matches the server's cap on a saved list.
const MAX_QUESTIONS = 30;

const props = defineProps<{
  /** The saved board, when answers exist or the website is already known. */
  board: SetupBoard | null;
  /** Answers were saved before, so this edits them instead of starting. */
  editing: boolean;
  startStep?: number;
}>();

const emit = defineEmits<{
  /** Reading the site started (or was already under way); this is the board as it stands. */
  reading: [board: SetupBoard];
  saved: [board: SetupBoard];
  cancel: [];
}>();

const { t } = useI18n();
const headingId = "setup-question-heading";
const heading = ref<HTMLElement | null>(null);

// --- Draft answers. They live here, so going back keeps them.
const step = ref(Math.min(Math.max(props.startStep ?? 0, 0), 2));
// Sign-up may have created the website source already; its address is the starting point.
const website = ref(props.board?.website ?? props.board?.site.website ?? "");
const type = ref<BusinessType | null>(props.board?.businessType ?? null);
const toolIds = ref<string[]>([...(props.board?.toolPluginIds ?? [])]);
const channelIds = ref<string[]>([...(props.board?.channels ?? [])]);
const extras = ref<QuestionOption[]>(
  (props.board?.rows ?? []).map((row) => ({
    key: row.id,
    id: row.id,
    text: row.text,
    needs: row.needs,
    custom: row.source === "custom",
  })),
);
const selected = ref<string[]>((props.board?.rows ?? []).map((row) => row.id));
const addDraft = ref("");
const saving = ref(false);
const saveFailed = ref(false);
let customCounter = 0;
// Suggested questions start selected on a first run and again after the type changes.
let selectDefaults = !props.editing;
// Once the person picks a type, inference never overrides it.
let typePicked = Boolean(props.board?.businessType);

const site = computed(() => props.board?.site ?? null);

// --- Suggestions per business type, never named in the UI code.
const suggestions = ref<Partial<Record<BusinessType, SetupSuggestions>>>({});
const suggestionsLoading = ref(false);
const suggestionsError = ref(false);
const current = computed(() => (type.value ? (suggestions.value[type.value] ?? null) : null));

const loadSuggestions = async (businessType: BusinessType): Promise<SetupSuggestions | null> => {
  const cached = suggestions.value[businessType];
  if (cached) return cached;
  suggestionsLoading.value = true;
  suggestionsError.value = false;
  try {
    const result = await Hay.setup.suggestions.query({ businessType });
    suggestions.value[businessType] = result;
    if (type.value === businessType) applySuggestions(result);
    return result;
  } catch {
    suggestionsError.value = true;
    return null;
  } finally {
    suggestionsLoading.value = false;
  }
};

const applySuggestions = (result: SetupSuggestions) => {
  if (selectDefaults) {
    const typed = selected.value.filter((key) =>
      extras.value.some((e) => e.key === key && e.custom),
    );
    selected.value = [...typed, ...result.questions.map((q) => q.id)];
    selectDefaults = false;
  }
};

watch(
  type,
  (value) => {
    if (value) void loadSuggestions(value);
  },
  { immediate: true },
);

const questionOptions = computed<QuestionOption[]>(() => {
  const suggested: QuestionOption[] = (current.value?.questions ?? []).map((q) => ({
    key: q.id,
    id: q.id,
    text: q.text,
    needs: q.needs,
    custom: false,
  }));
  const suggestedIds = new Set(suggested.map((q) => q.id));
  return [...suggested, ...extras.value.filter((q) => !q.id || !suggestedIds.has(q.id))];
});

const pluginGroups = computed(() => {
  const groups: { group: string; plugins: SetupSuggestions["plugins"] }[] = [];
  for (const plugin of current.value?.plugins ?? []) {
    let entry = groups.find((g) => g.group === plugin.group);
    if (!entry) {
      entry = { group: plugin.group, plugins: [] };
      groups.push(entry);
    }
    entry.plugins.push(plugin);
  }
  return groups;
});

const chipClass = (on: boolean) => [
  "inline-block rounded-full border px-3.5 py-1.5 text-sm transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2",
  on
    ? "border-primary bg-primary-50 font-medium text-primary"
    : "border-input bg-background text-neutral-900 hover:border-neutral-400",
];

const toggle = (list: string[], value: string) => {
  const index = list.indexOf(value);
  if (index === -1) list.push(value);
  else list.splice(index, 1);
};

// --- Question 1: type, with the site read as a hint only.
const inferring = ref(false);
const inferredType = ref<BusinessType | null>(null);
let inferredFor = "";
let inferToken = 0;

const pickType = (value: BusinessType) => {
  typePicked = true;
  setType(value);
};

const setType = (value: BusinessType) => {
  if (type.value === value) return;
  type.value = value;
  toolIds.value = [];
  selectDefaults = true;
  // Suggested questions of the old type go; the ones the person typed stay.
  extras.value = extras.value.filter((extra) => extra.custom);
  const cached = suggestions.value[value];
  if (cached) applySuggestions(cached);
};

const infer = async () => {
  const address = website.value.trim();
  if (!address || typePicked || address === inferredFor) return;
  inferredFor = address;
  const token = ++inferToken;
  inferring.value = true;
  try {
    const result = await Hay.setup.inferBusinessType.mutate({ website: address });
    if (token !== inferToken || typePicked || !result.businessType) return;
    inferredType.value = result.businessType;
    setType(result.businessType);
  } catch {
    // Nothing is preselected when the site can't be read; the person chooses.
  } finally {
    if (token === inferToken) inferring.value = false;
  }
};

// --- Reading the site while this question is open, so answers can appear within minutes.
const READ_DEBOUNCE_MS = 700;
let readTimer: ReturnType<typeof setTimeout> | null = null;
let readFor = "";

const clearReadTimer = () => {
  if (readTimer) clearTimeout(readTimer);
  readTimer = null;
};

const startReading = async (address: string) => {
  readFor = address;
  try {
    emit("reading", await Hay.setup.startReading.mutate({ website: address }));
  } catch {
    // Allow another try on the next blur or Continue; the board still shows no progress.
    readFor = "";
  }
};

/** Starts reading once what is typed is a whole address. `now` skips the short wait. */
const beginReading = (now = false) => {
  clearReadTimer();
  const address = readableWebsite(website.value);
  if (!address || address === readFor) return;
  if (now) void startReading(address);
  else readTimer = setTimeout(() => void startReading(address), READ_DEBOUNCE_MS);
};

const onWebsiteDone = () => {
  void infer();
  beginReading();
};

onMounted(() => {
  if (!props.editing) {
    void infer();
    // An account that already has a website source starts (or resumes) its read on arrival.
    if (props.board && props.board.site.state !== "none") beginReading(true);
  }
  focusHeading();
});

onBeforeUnmount(clearReadTimer);

// --- Question 3: add your own.
const addCustom = () => {
  const text = addDraft.value.trim();
  if (!text || questionOptions.value.length >= MAX_QUESTIONS) return;
  const key = `new-${customCounter++}`;
  extras.value.push({ key, text, custom: true });
  selected.value.push(key);
  addDraft.value = "";
};

// --- The live list beside the question.
const platformFor = (needs: QuestionOption["needs"]): string => {
  const chosen = (current.value?.plugins ?? []).filter((p) => toolIds.value.includes(p.id));
  const match = needs ? chosen.find((p) => p.handles.includes(needs)) : undefined;
  return (match ?? chosen[0])?.name ?? t("setup.live.platform");
};

const liveItems = computed<LiveItem[]>(() =>
  questionOptions.value
    .filter((option) => selected.value.includes(option.key))
    .map((option) => ({
      key: option.key,
      text: option.text,
      tag: option.custom
        ? t("setup.live.yours")
        : option.needs
          ? platformFor(option.needs)
          : t("setup.live.site"),
    })),
);

// --- Moving on and saving.
const focusHeading = async () => {
  await nextTick();
  heading.value?.focus();
};
watch(step, focusHeading);

const save = async () => {
  saving.value = true;
  saveFailed.value = false;
  try {
    // A skip can happen before suggestions load; wait so the default list is real.
    const businessType = type.value ?? "other";
    if (!type.value) setType(businessType);
    await loadSuggestions(businessType);

    const board = await Hay.setup.saveAnswers.mutate({
      businessType,
      website: website.value.trim() || undefined,
      toolPluginIds: toolIds.value,
      channels: channelIds.value,
      questions: questionOptions.value
        .filter((option) => selected.value.includes(option.key))
        .map((option) => ({ id: option.id, text: option.text })),
    });
    emit("saved", board);
  } catch {
    saveFailed.value = true;
  } finally {
    saving.value = false;
  }
};

const next = () => {
  if (step.value === 0) beginReading(true);
  if (step.value < 2) step.value += 1;
  else void save();
};

const skip = () => {
  if (props.editing) emit("cancel");
  else void save();
};
</script>
