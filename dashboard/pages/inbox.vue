<template>
  <Page :description="subline">
    <template #title>
      <span data-testid="home-headline">{{ headline }}</span>
    </template>
    <template #header>
      <PushAlertsToggle variant="compact" />
      <Button variant="outline" size="icon" :aria-label="$t('common.refresh')" @click="load(true)">
        <RefreshCw class="h-4 w-4" :class="{ 'animate-spin': loading }" />
      </Button>
    </template>

    <!-- Error -->
    <div v-if="error" class="rounded-xl border border-destructive-200 bg-destructive-50 p-4">
      <p class="font-medium text-destructive-800">{{ $t("home.error.title") }}</p>
      <p class="mt-1 text-sm text-destructive-700">{{ error }}</p>
      <Button variant="outline" size="sm" class="mt-3" @click="load(true)">
        {{ $t("home.error.retry") }}
      </Button>
    </div>

    <!-- iPhone in a browser tab: how to get alerts (D11-12) -->
    <InstallAppGuide dismissible />

    <!-- AI actions waiting for an approver (D4-6); hidden when none or not an approver -->
    <ApprovalsSection @changed="load()" />

    <!-- Waiting for a human: the only thing that must be seen first -->
    <section aria-labelledby="home-waiting-heading">
      <h2 id="home-waiting-heading" class="mb-2 flex items-baseline gap-2 text-sm font-semibold">
        {{ $t("home.sections.waiting") }}
        <span class="tabular-nums text-neutral-muted">{{ pending.length }}</span>
      </h2>

      <ul
        v-if="loading && pending.length === 0"
        class="divide-y divide-border rounded-xl border border-border bg-background"
        aria-busy="true"
      >
        <li v-for="i in 3" :key="i" class="flex items-center gap-3 p-4">
          <span class="h-10 w-10 animate-pulse rounded-full bg-background-tertiary" />
          <span class="flex-1 space-y-2">
            <span class="block h-4 w-2/5 animate-pulse rounded bg-background-tertiary" />
            <span class="block h-3 w-4/5 animate-pulse rounded bg-background-tertiary" />
          </span>
        </li>
      </ul>

      <ul
        v-else-if="pending.length > 0"
        class="divide-y divide-border rounded-xl border border-border bg-background shadow-sm"
        data-testid="home-waiting-list"
      >
        <ConversationAttentionRow
          v-for="conversation in pending"
          :key="conversation.id"
          :conversation="conversation"
          mode="pending"
          :busy="takingOver === conversation.id"
          @open="open"
          @takeover="takeOver"
        />
      </ul>

      <div
        v-else
        class="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border px-6 py-10 text-center"
        data-testid="home-empty"
      >
        <CheckCircle2 class="h-8 w-8 text-green-600" />
        <p class="font-medium text-foreground">{{ $t("home.empty.title") }}</p>
        <p class="max-w-prose text-sm text-neutral-muted">{{ $t("home.empty.description") }}</p>
      </div>
    </section>

    <!-- Mine -->
    <section v-if="mine.length > 0" aria-labelledby="home-mine-heading">
      <h2 id="home-mine-heading" class="mb-2 flex items-baseline gap-2 text-sm font-semibold">
        {{ $t("home.sections.mine") }}
        <span class="tabular-nums text-neutral-muted">{{ mine.length }}</span>
      </h2>
      <ul
        class="divide-y divide-border rounded-xl border border-border bg-background"
        data-testid="home-mine-list"
      >
        <ConversationAttentionRow
          v-for="conversation in mine"
          :key="conversation.id"
          :conversation="conversation"
          mode="mine"
          @open="open"
        />
      </ul>
    </section>

    <!-- Teammates -->
    <section v-if="team.length > 0" aria-labelledby="home-team-heading">
      <h2 id="home-team-heading" class="mb-2 flex items-baseline gap-2 text-sm font-semibold">
        {{ $t("home.sections.team") }}
        <span class="tabular-nums text-neutral-muted">{{ team.length }}</span>
      </h2>
      <ul class="divide-y divide-border rounded-xl border border-border bg-background">
        <ConversationAttentionRow
          v-for="conversation in team"
          :key="conversation.id"
          :conversation="conversation"
          mode="team"
          @open="open"
        />
      </ul>
    </section>

    <!-- The off switch, one tap from the phone (D11-9) -->
    <AiPauseCard />

    <!-- Everything else is one tap away, not on this screen -->
    <nav class="flex flex-wrap gap-x-6 gap-y-2 pt-2 text-sm">
      <NuxtLink
        to="/conversations"
        class="inline-flex min-h-11 items-center gap-1 text-primary hover:underline sm:min-h-0"
      >
        {{ $t("nav.conversations") }}
        <ChevronRight class="h-4 w-4" />
      </NuxtLink>
      <NuxtLink
        to="/dashboard"
        class="inline-flex min-h-11 items-center gap-1 text-primary hover:underline sm:min-h-0"
      >
        {{ $t("home.metrics") }}
        <ChevronRight class="h-4 w-4" />
      </NuxtLink>
    </nav>
  </Page>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import { RefreshCw, CheckCircle2, ChevronRight } from "lucide-vue-next";
import { Hay } from "@/utils/api";
import { useAppStore } from "@/stores/app";
import { useUserStore } from "@/stores/user";
import { useWebSocket } from "@/composables/useWebSocket";
import { useConversationTakeover } from "@/composables/useConversationTakeover";
import { useToast } from "@/composables/useToast";
import { useNow } from "@/composables/useNow";
import { formatWaitTime } from "@/utils/conversation";
import type { AttentionConversation } from "@/components/home/ConversationAttentionRow.vue";

const { t } = useI18n();
const router = useRouter();
const appStore = useAppStore();
const userStore = useUserStore();
const websocket = useWebSocket();
const takeoverApi = useConversationTakeover();
const toast = useToast();
const now = useNow();

const loading = ref(true);
const error = ref<string | null>(null);
const takingOver = ref<string | null>(null);
const pending = ref<AttentionConversation[]>([]);
const handled = ref<AttentionConversation[]>([]);

const load = async (showSpinner = false) => {
  if (showSpinner) loading.value = true;
  try {
    const result = await Hay.conversations.attention.query();
    pending.value = result.waiting;
    handled.value = result.handling;
    appStore.pendingHumanCount = result.waiting.length;
    error.value = null;
  } catch (err) {
    error.value = err instanceof Error ? err.message : t("home.error.title");
  } finally {
    loading.value = false;
  }
};

const myId = computed(() => userStore.user?.id);
const mine = computed(() => handled.value.filter((c) => c.assignedUserId === myId.value));
const team = computed(() => handled.value.filter((c) => c.assignedUserId !== myId.value));

const longestWaitSeconds = computed(() => {
  const first = pending.value[0];
  if (!first) return 0;
  return Math.max(
    0,
    Math.floor((now.value.getTime() - new Date(first.waitingSince).getTime()) / 1000),
  );
});

const headline = computed(() => {
  if (loading.value && pending.value.length === 0) return t("home.headline.loading");
  return t("home.headline.waiting", pending.value.length);
});

const subline = computed(() => {
  if (loading.value && pending.value.length === 0) return "";
  if (pending.value.length > 0) {
    return t("home.subline.longestWait", { time: formatWaitTime(longestWaitSeconds.value) });
  }
  const open = appStore.openConversationsCount;
  return open > 0 ? t("home.subline.aiHandling", open) : t("home.subline.allQuiet");
});

const open = (id: string) => {
  router.push(`/conversations/${id}`);
};

const takeOver = async (id: string) => {
  takingOver.value = id;
  try {
    const ok = await takeoverApi.takeover(id);
    if (ok) {
      router.push(`/conversations/${id}`);
      return;
    }
    const owner = takeoverApi.currentOwner.value;
    if (owner) {
      toast.info(t("home.row.handledBy", { name: owner.name }));
      takeoverApi.cancelTakeover();
    }
    await load();
  } finally {
    takingOver.value = null;
  }
};

// Live updates: any status change, takeover or release re-reads both lists.
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
const scheduleRefresh = () => {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => void load(), 300);
};
const unsubscribers: Array<() => void> = [];

onMounted(async () => {
  await Promise.all([load(true), appStore.getOpenConversationsCount()]);
  for (const event of [
    "conversation_status_changed",
    "conversation_updated",
    "conversation_taken_over",
    "conversation_released",
    "conversation_created",
  ]) {
    unsubscribers.push(websocket.on(event, scheduleRefresh));
  }
});

onUnmounted(() => {
  unsubscribers.forEach((off) => off());
  if (refreshTimer) clearTimeout(refreshTimer);
});

useHead({ title: t("home.headTitle") });
</script>
