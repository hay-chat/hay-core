<template>
  <Page :title="$t('aiActions.log.title')" :description="$t('aiActions.log.description')">
    <template #header>
      <Button variant="outline" :disabled="loading" @click="load">
        <RefreshCw class="mr-2 h-4 w-4" :class="{ 'animate-spin': loading }" />
        {{ $t("aiActions.log.refresh") }}
      </Button>
    </template>

    <Card>
      <CardContent class="grid gap-4 pt-6 md:grid-cols-3">
        <Input
          v-model="filters.toolName"
          type="select"
          :label="$t('aiActions.log.filters.tool')"
          :options="toolOptions"
          data-testid="action-log-tool"
        />
        <Input
          v-model="filters.pluginId"
          type="select"
          :label="$t('aiActions.log.filters.platform')"
          :options="platformOptions"
          data-testid="action-log-platform"
        />
        <Input
          v-model="filters.outcome"
          type="select"
          :label="$t('aiActions.log.filters.outcome')"
          :options="outcomeOptions"
          data-testid="action-log-outcome"
        />
      </CardContent>
    </Card>

    <Card>
      <CardContent class="pt-6">
        <Loading v-if="loading && items.length === 0" />

        <p v-else-if="items.length === 0" class="py-12 text-center text-sm text-muted-foreground">
          {{ hasFilters ? $t("aiActions.log.emptyFiltered") : $t("aiActions.log.empty") }}
        </p>

        <ul v-else class="divide-y divide-border">
          <li
            v-for="item in items"
            :key="item.id"
            class="flex flex-col gap-2 py-3 md:flex-row md:items-center md:gap-4"
            data-testid="action-log-row"
          >
            <div class="min-w-0 flex-1 space-y-1">
              <div class="flex flex-wrap items-center gap-2">
                <span class="break-all font-mono text-sm">{{ item.tool_name }}</span>
                <Badge :variant="OUTCOME_VARIANT[item.outcome] ?? 'outline'">
                  {{ outcomeLabel(item.outcome) }}
                </Badge>
              </div>
              <p class="text-xs text-muted-foreground">
                {{ formatDateTime(item.created_at) }} · {{ platformLabel(item.plugin_id) }}
                <template v-if="item.category"> · {{ categoryLabel(item.category) }} </template>
                <template v-if="item.read_only"> · {{ $t("aiActions.log.readOnly") }} </template>
              </p>
              <p v-if="item.outcome === 'error'" class="text-sm text-destructive">
                {{ errorLabel(item.error_code) }}
              </p>
            </div>
            <NuxtLink
              :to="`/conversations/${item.conversation_id}`"
              class="inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline"
            >
              {{ $t("aiActions.log.openConversation") }}
            </NuxtLink>
          </li>
        </ul>

        <div
          v-if="total > PAGE_SIZE"
          class="mt-4 flex items-center justify-between gap-2 border-t border-border pt-4"
        >
          <Button variant="outline" :disabled="page <= 1 || loading" @click="page--">
            {{ $t("aiActions.log.previous") }}
          </Button>
          <span class="text-sm text-muted-foreground">
            {{ $t("aiActions.log.pageOf", { page, pages: pageCount }) }}
          </span>
          <Button variant="outline" :disabled="page >= pageCount || loading" @click="page++">
            {{ $t("aiActions.log.next") }}
          </Button>
        </div>
      </CardContent>
    </Card>
  </Page>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted } from "vue";
import { RefreshCw } from "lucide-vue-next";
import { Hay } from "@/utils/api";
import { useAppStore } from "@/stores/app";
import { useToast } from "@/composables/useToast";
import type { RouterOutputs } from "@/types/trpc";

/**
 * Action log (D6-7): every tool call the AI made, newest first, from
 * action_log. Filter by tool, platform (plugin, or built-in) and outcome;
 * each row links to its conversation.
 */
type LogItem = RouterOutputs["actions"]["log"]["items"][number];
type Outcome = "success" | "error" | "simulated" | "held" | "confirming";

const OUTCOMES: Outcome[] = ["success", "error", "simulated", "held", "confirming"];
const OUTCOME_VARIANT: Record<string, "success" | "destructive" | "secondary" | "warning"> = {
  success: "success",
  error: "destructive",
  simulated: "secondary",
  held: "warning",
  confirming: "secondary",
};
/** Matches the server's filter value for actions without a plugin. */
const CORE_PLUGIN = "core";
const PAGE_SIZE = 25;

const { t, te } = useI18n();
const toast = useToast();
const appStore = useAppStore();
const { formatDateTime } = useOrgDateTime();

const loading = ref(false);
const items = ref<LogItem[]>([]);
const total = ref(0);
const page = ref(1);
const filterValues = ref<{ tools: string[]; plugins: string[] }>({ tools: [], plugins: [] });
const filters = reactive({ toolName: "", pluginId: "", outcome: "" });

const pageCount = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)));
const hasFilters = computed(() => Boolean(filters.toolName || filters.pluginId || filters.outcome));

function platformLabel(pluginId: string | null): string {
  if (!pluginId || pluginId === CORE_PLUGIN) return t("aiActions.log.builtIn");
  return appStore.getPluginById(pluginId)?.name ?? pluginId;
}
const outcomeLabel = (outcome: string) =>
  te(`aiActions.log.outcomes.${outcome}`) ? t(`aiActions.log.outcomes.${outcome}`) : outcome;
const categoryLabel = (category: string) =>
  te(`aiActions.categories.${category}`) ? t(`aiActions.categories.${category}`) : category;
const errorLabel = (code: string | null) =>
  code && te(`aiActions.toolErrors.codes.${code}`)
    ? t(`aiActions.toolErrors.codes.${code}`)
    : t("aiActions.toolErrors.generic");

const all = computed(() => ({ label: t("aiActions.log.filters.all"), value: "" }));
const toolOptions = computed(() => [
  all.value,
  ...filterValues.value.tools.map((tool) => ({ label: tool, value: tool })),
]);
const platformOptions = computed(() => [
  all.value,
  ...filterValues.value.plugins.map((id) => ({ label: platformLabel(id), value: id })),
]);
const outcomeOptions = computed(() => [
  all.value,
  ...OUTCOMES.map((outcome) => ({ label: outcomeLabel(outcome), value: outcome })),
]);

async function load() {
  loading.value = true;
  try {
    const result = await Hay.actions.log.query({
      toolName: filters.toolName || undefined,
      pluginId: filters.pluginId || undefined,
      outcome: (filters.outcome as Outcome) || undefined,
      page: page.value,
      pageSize: PAGE_SIZE,
    });
    items.value = result.items;
    total.value = result.total;
  } catch (error) {
    toast.error(t("aiActions.log.loadFailed"), error instanceof Error ? error.message : undefined);
  } finally {
    loading.value = false;
  }
}

watch(filters, () => {
  if (page.value === 1) void load();
  else page.value = 1;
});
watch(page, () => void load());

onMounted(async () => {
  void load();
  try {
    filterValues.value = await Hay.actions.logFilters.query();
  } catch {
    // Filters stay at "All"; the list itself still loads.
  }
  // Plugin names for the platform column; ids are shown until they load.
  void appStore.getPlugins().catch(() => undefined);
});

useHead({ title: t("aiActions.log.headTitle") });
</script>
