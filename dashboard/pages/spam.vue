<template>
  <Page :title="$t('home.spam.title')" :description="$t('home.spam.description')">
    <template #header>
      <Button variant="outline" size="icon" :aria-label="$t('common.refresh')" @click="load(true)">
        <RefreshCw class="h-4 w-4" :class="{ 'animate-spin': loading }" />
      </Button>
    </template>

    <div v-if="error" class="rounded-xl border border-destructive-200 bg-destructive-50 p-4">
      <p class="font-medium text-destructive-800">{{ $t("home.spam.error") }}</p>
      <p class="mt-1 text-sm text-destructive-700">{{ error }}</p>
      <Button variant="outline" size="sm" class="mt-3" @click="load(true)">
        {{ $t("home.error.retry") }}
      </Button>
    </div>

    <ul
      v-if="loading && items.length === 0"
      class="divide-y divide-border rounded-xl border border-border bg-background"
      aria-busy="true"
    >
      <li v-for="i in 3" :key="i" class="space-y-2 p-4">
        <span class="block h-4 w-2/5 animate-pulse rounded bg-background-tertiary" />
        <span class="block h-3 w-4/5 animate-pulse rounded bg-background-tertiary" />
      </li>
    </ul>

    <ul
      v-else-if="items.length > 0"
      class="divide-y divide-border rounded-xl border border-border bg-background shadow-sm"
      data-testid="spam-list"
    >
      <li
        v-for="item in items"
        :key="item.id"
        class="flex flex-col gap-3 p-4 sm:flex-row sm:items-start"
        data-testid="spam-row"
      >
        <div class="min-w-0 flex-1 space-y-1">
          <p class="flex flex-wrap items-baseline gap-x-2 text-sm font-medium text-foreground">
            <span class="truncate">{{ item.customerName || $t("home.spam.unknownCustomer") }}</span>
            <span class="text-xs font-normal text-neutral-muted">
              {{ $t("home.spam.flagged", { time: since(item.flaggedAt) }) }}
            </span>
          </p>
          <p class="line-clamp-2 break-words text-sm text-neutral-muted">
            {{ item.preview || $t("home.spam.noPreview") }}
          </p>
          <div class="flex flex-wrap gap-1 pt-1">
            <Badge
              v-for="key in spamReasonKeys(item.source, item.signals)"
              :key="key"
              variant="outline"
            >
              {{ $t(key) }}
            </Badge>
          </div>
          <p v-if="item.classifierReason" class="text-xs text-neutral-muted">
            {{ $t("home.spam.classifier", { reason: item.classifierReason }) }}
          </p>
        </div>
        <div class="flex shrink-0 gap-2">
          <Button variant="outline" size="sm" @click="open(item.id)">
            {{ $t("home.spam.open") }}
          </Button>
          <Button size="sm" :loading="clearing === item.id" @click="notSpam(item.id)">
            {{ $t("home.spam.notSpam") }}
          </Button>
        </div>
      </li>
    </ul>

    <div
      v-else-if="!error"
      class="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border px-6 py-10 text-center"
      data-testid="spam-empty"
    >
      <ShieldCheck class="h-8 w-8 text-green-600" />
      <p class="font-medium text-foreground">{{ $t("home.spam.empty.title") }}</p>
      <p class="max-w-prose text-sm text-neutral-muted">{{ $t("home.spam.empty.description") }}</p>
    </div>
  </Page>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { RefreshCw, ShieldCheck } from "lucide-vue-next";
import { Hay } from "@/utils/api";
import type { RouterOutputs } from "@/types/trpc";
import { useToast } from "@/composables/useToast";
import { useNow } from "@/composables/useNow";
import { formatWaitTime } from "@/utils/conversation";
import { spamReasonKeys } from "@/utils/spam";

type SpamItem = RouterOutputs["conversations"]["spam"][number];

const { t } = useI18n();
const router = useRouter();
const toast = useToast();
const now = useNow();

const loading = ref(true);
const error = ref<string | null>(null);
const clearing = ref<string | null>(null);
const items = ref<SpamItem[]>([]);

const load = async (showSpinner = false) => {
  if (showSpinner) loading.value = true;
  try {
    items.value = await Hay.conversations.spam.query();
    error.value = null;
  } catch (err) {
    error.value = err instanceof Error ? err.message : t("home.spam.error");
  } finally {
    loading.value = false;
  }
};

const since = (iso: string) =>
  formatWaitTime(Math.max(0, Math.floor((now.value.getTime() - new Date(iso).getTime()) / 1000)));

const open = (id: string) => {
  router.push(`/conversations/${id}`);
};

const notSpam = async (id: string) => {
  clearing.value = id;
  try {
    const { reengaged } = await Hay.conversations.notSpam.mutate({ conversationId: id });
    items.value = items.value.filter((item) => item.id !== id);
    toast.success(reengaged ? t("home.spam.notSpamReengaged") : t("home.spam.notSpamDone"));
  } catch {
    toast.error(t("home.spam.actionFailed"));
  } finally {
    clearing.value = null;
  }
};

onMounted(() => load(true));

useHead({ title: t("home.spam.headTitle") });
</script>
