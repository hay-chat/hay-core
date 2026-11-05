<template>
  <li class="border-b border-border" :data-status="displayStatus" :data-row-id="row.id">
    <div
      class="grid grid-cols-[minmax(0,1fr)_2.75rem] items-center gap-x-2 gap-y-1 py-3 md:grid-cols-[minmax(0,1.15fr)_9rem_minmax(0,1.3fr)_auto_2rem] md:gap-x-3"
    >
      <span class="col-start-1 font-medium text-neutral-900 md:col-start-1">{{ row.text }}</span>
      <button
        type="button"
        class="col-start-2 row-start-1 grid h-11 w-11 place-items-center justify-self-end rounded-md text-neutral-muted hover:bg-accent hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:col-start-5 md:h-8 md:w-8"
        :aria-label="$t('setup.board.remove', { question: row.text })"
        :title="$t('setup.board.removeTitle')"
        @click="emit('remove')"
      >
        <X class="h-4 w-4" aria-hidden="true" />
      </button>

      <span class="col-span-2 md:col-span-1 md:col-start-2 md:row-start-1">
        <Badge :key="displayStatus" :variant="badgeVariant" class="setup-settle">
          {{ $t(`setup.status.${displayStatus}`) }}
        </Badge>
      </span>

      <span
        class="col-span-2 text-sm text-neutral-muted md:col-span-1 md:col-start-3 md:row-start-1"
      >
        {{ why }}
      </span>

      <span class="col-span-2 md:col-span-1 md:col-start-4 md:row-start-1 md:text-right">
        <template v-if="displayStatus === 'ready'">
          <Button variant="link" size="sm" class="min-h-11 md:min-h-0" @click="emit('try')">
            {{ $t("setup.action.tryIt") }}
          </Button>
        </template>
        <template v-else-if="displayStatus === 'missing'">
          <Button
            variant="link"
            size="sm"
            class="min-h-11 md:min-h-0"
            :aria-expanded="expanded"
            @click="emit('toggle')"
          >
            {{ $t("setup.action.addAnswer") }}
          </Button>
        </template>
        <template v-else-if="displayStatus === 'needs_connection'">
          <NuxtLink v-if="connectTo" :to="connectTo" :class="textLinkClass">
            {{ $t("setup.action.connect") }}
          </NuxtLink>
          <Button
            v-else-if="!row.plugin"
            variant="link"
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
            class="min-h-11 md:min-h-0"
            :aria-expanded="expanded"
            @click="emit('toggle')"
          >
            {{ $t("setup.action.review") }}
          </Button>
        </template>
        <template v-else-if="displayStatus === 'check_failed'">
          <Button variant="link" size="sm" class="min-h-11 md:min-h-0" @click="emit('retry')">
            {{ $t("setup.action.retry") }}
          </Button>
        </template>
      </span>
    </div>

    <!-- Missing: the customer's own answer, saved as a document -->
    <form
      v-if="expanded && displayStatus === 'missing'"
      class="setup-expand grid gap-2 pb-4"
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

    <!-- Playbook off: what it does, before it is turned on (workstream C adds Turn on) -->
    <div
      v-if="expanded && displayStatus === 'playbook_off' && row.playbook"
      class="setup-expand grid gap-2 pb-4"
    >
      <span class="text-sm text-neutral-muted">
        {{ $t("setup.playbook.whatItDoes", { playbook: row.playbook.title }) }}
      </span>
      <ol class="list-decimal space-y-1 pl-5 text-sm text-neutral-900">
        <li v-for="step in row.playbook.steps" :key="step">{{ step }}</li>
      </ol>
      <div class="flex flex-wrap items-center gap-2">
        <NuxtLink v-if="playbookTo" :to="playbookTo" :class="outlineLinkClass">
          {{ $t("setup.playbook.open") }}
        </NuxtLink>
        <Button type="button" variant="outline" @click="emit('toggle')">
          {{ $t("setup.playbook.close") }}
        </Button>
      </div>
    </div>
  </li>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { X } from "lucide-vue-next";
import type { SetupRow, SetupRowStatus } from "@/stores/setup";
import { needsLabel } from "@/composables/useSetupCopy";
import { textLinkClass, outlineLinkClass } from "./styles";

type BadgeVariant = "secondary" | "success" | "warning" | "tool" | "outline";

const BADGE_VARIANTS: Record<SetupRowStatus, BadgeVariant> = {
  checking: "secondary",
  reading_site: "secondary",
  ready: "success",
  missing: "warning",
  needs_connection: "tool",
  playbook_off: "tool",
  check_failed: "outline",
};

const props = defineProps<{
  row: SetupRow;
  /** What to show now: `checking` until the real status has been revealed. */
  displayStatus: SetupRowStatus;
  /** Whether the organization has a website, which changes how "missing" reads. */
  hasSite: boolean;
  expanded: boolean;
  saving: boolean;
  error: boolean;
  /** Link to connect the row's platform, or null when the role cannot open it. */
  connectTo: string | null;
  playbookTo: string | null;
}>();

const emit = defineEmits<{
  try: [];
  toggle: [];
  remove: [];
  retry: [];
  choosePlatform: [];
  save: [answer: string];
}>();

const { t } = useI18n();

const draft = ref("");
const answerId = computed(() => `setup-answer-${props.row.id}`);
const badgeVariant = computed(() => BADGE_VARIANTS[props.displayStatus]);

const why = computed(() => {
  const { row } = props;
  switch (props.displayStatus) {
    case "checking":
      return t("setup.why.checking");
    case "reading_site":
      return t("setup.why.readingSite");
    case "ready": {
      const source = row.sources[0];
      if (source) return t("setup.why.readyFound", { source: source.title });
      if (row.plugin && row.playbook) {
        return t("setup.why.readyTool", { plugin: row.plugin.name, playbook: row.playbook.title });
      }
      return t("setup.why.readyGeneric");
    }
    case "missing":
      return t(props.hasSite ? "setup.why.missingSite" : "setup.why.missingNoSite");
    case "needs_connection": {
      const capability = needsLabel(t, row.needs);
      return row.plugin
        ? t("setup.why.connect", { plugin: row.plugin.name, capability })
        : t("setup.why.connectAny", { capability });
    }
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

// Move focus into the field when the row opens, like a dialog would.
watch(
  () => props.expanded,
  async (open) => {
    if (!open) {
      draft.value = "";
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
