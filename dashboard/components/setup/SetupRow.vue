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
        data-row-action="remove"
        class="col-start-2 row-start-1 grid h-11 w-11 place-items-center justify-self-end rounded-md text-neutral-muted hover:bg-accent hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-[1360px]:col-start-5 min-[1360px]:h-8 min-[1360px]:w-8"
        :aria-label="$t('setup.board.remove', { question: row.text })"
        :title="$t('setup.board.removeTitle')"
        @click="emit('remove')"
      >
        <X class="h-4 w-4" aria-hidden="true" />
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

    <!-- Missing: the customer's own answer, saved as a document -->
    <form
      v-if="expanded && displayStatus === 'missing'"
      class="setup-expand grid gap-2 pb-4 min-[1360px]:col-span-full"
      @submit.prevent="save"
    >
      <label class="text-sm text-neutral-muted" :for="answerId">
        {{ $t("setup.answer.label") }}
      </label>
      <Textarea
        :id="answerId"
        v-model="draft"
        :rows="3"
        :placeholder="$t('setup.answer.placeholder')"
      />
      <p v-if="error" class="text-sm text-destructive" role="alert">
        {{ $t("setup.answer.error") }}
      </p>
      <div class="flex flex-wrap gap-2">
        <Button type="submit" :loading="saving" :disabled="!draft.trim()">
          {{ $t("setup.answer.save") }}
        </Button>
        <Button type="button" variant="outline" @click="emit('toggle')">
          {{ $t("setup.answer.cancel") }}
        </Button>
      </div>
    </form>

    <!-- Playbook off: what it does, before the customer turns it on -->
    <div
      v-if="expanded && displayStatus === 'playbook_off' && row.playbook"
      class="setup-expand grid gap-2 pb-4 min-[1360px]:col-span-full"
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
      <div class="flex flex-wrap items-center gap-2">
        <Button type="button" :loading="turningOn" @click="emit('turnOn')">
          {{ $t("setup.playbook.turnOn") }}
        </Button>
        <Button type="button" variant="outline" @click="emit('toggle')">
          {{ $t("setup.playbook.close") }}
        </Button>
        <NuxtLink v-if="playbookTo" :to="playbookTo" :class="textLinkClass">
          {{ $t("setup.playbook.open") }}
        </NuxtLink>
      </div>
    </div>
  </li>
</template>

<script setup lang="ts">
import { pageTitle } from "@/utils/format";
import { computed, nextTick, ref, watch } from "vue";
import { X } from "lucide-vue-next";
import type { SetupRow, SetupRowStatus } from "@/stores/setup";
import { needsLabel } from "@/composables/useSetupCopy";
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
    /** Turning the playbook on is in flight. */
    turningOn?: boolean;
    turnOnError?: boolean;
    /** The platform's connect attempt failed; `detail` is what the provider said, if anything. */
    connectFailure?: { detail?: string } | null;
    /** The test chat is answering, so a new question would be dropped. */
    tryDisabled?: boolean;
  }>(),
  { writeTo: null, turningOn: false, turnOnError: false, connectFailure: null, tryDisabled: false },
);

const emit = defineEmits<{
  try: [];
  toggle: [];
  remove: [];
  retry: [];
  choosePlatform: [];
  save: [answer: string];
  turnOn: [];
  regenerate: [];
}>();

const { t } = useI18n();

const draft = ref("");
const answerId = computed(() => `setup-answer-${props.row.id}`);
const badgeVariant = computed(() => BADGE_VARIANTS[props.displayStatus]);
const badgeClass = computed(() => BADGE_CLASSES[props.displayStatus]);

const why = computed(() => {
  const { row } = props;
  switch (props.displayStatus) {
    case "checking":
      return t("setup.why.checking");
    case "reading_site":
      return t("setup.why.readingSite");
    case "ready": {
      const source = row.sources[0];
      if (source?.own) return t("setup.why.readyOwn");
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

const save = () => {
  const answer = draft.value.trim();
  if (answer) emit("save", answer);
};

const rowEl = ref<HTMLElement | null>(null);

// Move focus into the field when the row opens, like a dialog would. When it closes, the
// focused control (Cancel, Save, Turn on) is gone: hand focus back to the row's action.
watch(
  () => props.expanded,
  async (open) => {
    if (!open) {
      draft.value = "";
      await nextTick();
      const active = document.activeElement;
      if (!active || active === document.body) {
        rowEl.value?.querySelector<HTMLElement>('[data-row-action="primary"]')?.focus();
      }
      return;
    }
    if (props.displayStatus !== "missing") return;
    await nextTick();
    document.getElementById(answerId.value)?.focus();
  },
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
