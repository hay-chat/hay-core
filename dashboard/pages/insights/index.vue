<template>
  <Page :title="$t('insights.page.title')" :description="$t('insights.page.description')">
    <template #header>
      <Button variant="outline" :disabled="loading" @click="load">
        <RefreshCw class="h-4 w-4 mr-2" :class="{ 'animate-spin': loading }" />
        {{ $t("insights.page.refresh") }}
      </Button>
    </template>

    <div class="grid gap-4 grid-cols-2 md:grid-cols-4 mb-6">
      <Card v-for="stat in statCards" :key="stat.key">
        <CardContent class="p-6">
          <p class="text-sm text-neutral-muted">{{ stat.label }}</p>
          <p class="text-2xl font-bold">{{ stat.value }}</p>
        </CardContent>
      </Card>
    </div>

    <Card class="mb-6">
      <CardContent class="p-6">
        <div class="grid gap-4 md:grid-cols-5">
          <Input
            v-model="filters.polarity"
            type="select"
            :label="$t('insights.page.filters.polarity')"
            :options="polarityOptions"
            @update:model-value="load"
          />
          <Input
            v-model="filters.state"
            type="select"
            :label="$t('insights.page.filters.state')"
            :options="stateOptions"
            @update:model-value="load"
          />
          <Input
            v-model="filters.actionType"
            type="select"
            :label="$t('insights.page.filters.actionType')"
            :options="actionTypeOptions"
            @update:model-value="load"
          />
          <Input
            v-model="filters.days"
            type="select"
            :label="$t('insights.page.filters.window')"
            :options="windowOptions"
            @update:model-value="load"
          />
          <Input
            v-model="filters.minSize"
            type="select"
            :label="$t('insights.page.filters.minSize')"
            :options="minSizeOptions"
            @update:model-value="load"
          />
        </div>
      </CardContent>
    </Card>

    <div v-if="loading && !items.length" class="text-center py-12">
      <Loading />
    </div>

    <EmptyState
      v-else-if="!items.length"
      :title="$t('insights.page.list.empty')"
      :description="$t('insights.page.list.emptyDescription', { min: minClusterSize })"
    />

    <div v-else class="space-y-3">
      <p class="text-sm text-neutral-muted">
        {{ $t("insights.page.list.count", { count: items.length }) }}
      </p>
      <Card
        v-for="item in items"
        :key="item.id"
        class="cursor-pointer hover:bg-neutral-50 transition-colors"
        role="link"
        tabindex="0"
        @click="open(item.id)"
        @keydown.enter="open(item.id)"
      >
        <CardContent class="p-4">
          <div class="flex items-start justify-between gap-4">
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2 mb-2">
                <Badge :variant="polarityVariant(item.polarity)">
                  {{ $t(`insights.page.polarity.${item.polarity}`) }}
                </Badge>
                <Badge variant="outline">{{ $t(`insights.page.states.${item.state}`) }}</Badge>
                <Badge variant="secondary">
                  {{ $t(`insights.page.actionTypes.${item.actionType}`) }}
                </Badge>
                <Badge v-if="item.origin === 'docs_audit'" variant="tool">
                  {{ $t("insights.page.list.docsAudit") }}
                </Badge>
                <Badge v-if="item.recurredAt" variant="warning">
                  {{ $t("insights.page.list.recurring") }}
                </Badge>
              </div>
              <p class="font-medium">{{ item.title || $t("insights.page.list.untitled") }}</p>
              <p v-if="item.summary" class="text-sm text-neutral-muted line-clamp-2 mt-1">
                {{ item.summary }}
              </p>
            </div>
            <div class="text-right shrink-0 text-sm">
              <p class="font-semibold">
                {{ $t("insights.page.list.periodSize", { count: item.periodSize }) }}
              </p>
              <p class="text-neutral-muted">
                {{ $t("insights.page.list.lastSeen", { date: formatDate(item.lastSeenAt) }) }}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  </Page>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { RefreshCw } from "lucide-vue-next";
import { HayApi } from "@/utils/api";
import type { RouterInputs, RouterOutputs } from "@/types/trpc";

type ListOutput = RouterOutputs["insights"]["list"];
type ListInput = RouterInputs["insights"]["list"];

const POLARITIES = ["negative", "positive", "neutral"] as const;
const STATES = ["new", "acknowledged", "in_progress", "addressed", "rejected", "archived"] as const;
const ACTION_TYPES = [
  "playbook_edit",
  "new_playbook",
  "knowledge_edit",
  "knowledge_add",
  "setup",
  "policy_ambiguity",
  "product_bug",
  "ux_confusion",
  "support_training",
  "none",
] as const;

const { t } = useI18n();
const router = useRouter();
const toast = useToast();
const { formatDate } = useOrgDateTime();

const loading = ref(false);
const items = ref<ListOutput["items"]>([]);
const counts = ref<ListOutput["counts"]>({ open: 0, new: 0, positive: 0, addressed: 0 });
// Owner-tunable minimum; the server default is 5 (INSIGHTS_MIN_CLUSTER_SIZE).
const minClusterSize = ref(5);

const filters = ref({ polarity: "", state: "open", actionType: "", days: "30", minSize: "" });

const statCards = computed(() => [
  { key: "open", label: t("insights.page.counts.open"), value: counts.value.open },
  { key: "new", label: t("insights.page.counts.new"), value: counts.value.new },
  { key: "positive", label: t("insights.page.counts.positive"), value: counts.value.positive },
  { key: "addressed", label: t("insights.page.counts.addressed"), value: counts.value.addressed },
]);

const polarityOptions = computed(() => [
  { label: t("insights.page.filters.all"), value: "" },
  ...POLARITIES.map((p) => ({ label: t(`insights.page.polarity.${p}`), value: p })),
]);
const stateOptions = computed(() => [
  { label: t("insights.page.filters.open"), value: "open" },
  { label: t("insights.page.filters.allStates"), value: "all" },
  ...STATES.map((s) => ({ label: t(`insights.page.states.${s}`), value: s })),
]);
const actionTypeOptions = computed(() => [
  { label: t("insights.page.filters.all"), value: "" },
  ...ACTION_TYPES.map((a) => ({ label: t(`insights.page.actionTypes.${a}`), value: a })),
]);
const windowOptions = computed(() =>
  [7, 30, 90].map((days) => ({
    label: t("insights.page.filters.days", { days }),
    value: String(days),
  })),
);
const minSizeOptions = computed(() => [
  { label: t("insights.page.filters.all"), value: "" },
  ...[5, 10, 20, 50].map((n) => ({ label: `${n}+`, value: String(n) })),
]);

const polarityVariant = (polarity: string) => {
  if (polarity === "negative") return "destructive";
  if (polarity === "positive") return "success";
  return "secondary";
};

const load = async () => {
  loading.value = true;
  try {
    const result = await HayApi.insights.list.query({
      polarity: (filters.value.polarity || undefined) as ListInput["polarity"],
      state: filters.value.state as ListInput["state"],
      actionType: (filters.value.actionType || undefined) as ListInput["actionType"],
      days: Number(filters.value.days),
      minSize: filters.value.minSize ? Number(filters.value.minSize) : undefined,
    });
    items.value = result.items;
    counts.value = result.counts;
  } catch (error) {
    console.error("Failed to load insights:", error);
    toast.error(t("insights.page.list.loadError"));
  } finally {
    loading.value = false;
  }
};

const open = (id: string) => router.push(`/insights/${id}`);

onMounted(load);

definePageMeta({ layout: "default" });

useHead({ title: t("insights.page.seoTitle") });
</script>
