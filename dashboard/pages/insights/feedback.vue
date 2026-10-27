<template>
  <Page :title="$t('insights.feedback.title')" :description="$t('insights.feedback.description')">
    <template #header>
      <div class="flex items-center gap-2">
        <Button variant="outline" :disabled="loading" @click="refreshData">
          <RefreshCw class="h-4 w-4 mr-2" :class="{ 'animate-spin': loading }" />
          {{ $t("insights.feedback.refresh") }}
        </Button>
        <Button
          variant="outline"
          :disabled="exporting || filteredFeedback.length === 0"
          @click="exportToCSV"
        >
          <Download class="h-4 w-4 mr-2" />
          {{ $t("insights.feedback.exportCsv") }}
        </Button>
      </div>
    </template>

    <!-- Stats Overview -->
    <div class="grid gap-4 md:grid-cols-4 mb-6">
      <Card>
        <CardContent class="p-6">
          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm text-neutral-muted">{{ $t("insights.feedback.stats.total") }}</p>
              <p class="text-2xl font-bold">{{ stats.total }}</p>
            </div>
            <MessageSquare class="h-8 w-8 text-neutral-muted" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent class="p-6">
          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm text-neutral-muted">{{ $t("insights.feedback.stats.positive") }}</p>
              <p class="text-2xl font-bold text-green-600">
                {{ stats.byRating.good }} ({{ stats.percentages.good || 0 }}%)
              </p>
            </div>
            <ThumbsUp class="h-8 w-8 text-green-600" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent class="p-6">
          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm text-neutral-muted">{{ $t("insights.feedback.stats.negative") }}</p>
              <p class="text-2xl font-bold text-red-600">
                {{ stats.byRating.bad }} ({{ stats.percentages.bad || 0 }}%)
              </p>
            </div>
            <ThumbsDown class="h-8 w-8 text-red-600" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent class="p-6">
          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm text-neutral-muted">
                {{ $t("insights.feedback.stats.positiveRate") }}
              </p>
              <p class="text-2xl font-bold" :class="successRateColor">{{ successRate }}%</p>
            </div>
            <TrendingUp class="h-8 w-8" :class="successRateColor" />
          </div>
        </CardContent>
      </Card>
    </div>

    <!-- Filters -->
    <Card class="mb-6">
      <CardHeader>
        <CardTitle>{{ $t("insights.feedback.filters.title") }}</CardTitle>
      </CardHeader>
      <CardContent>
        <div class="grid gap-4 md:grid-cols-4">
          <Input
            v-model="filters.rating"
            type="select"
            :label="$t('insights.feedback.filters.rating')"
            :options="ratingOptions"
            @update:model-value="applyFilters"
          />

          <Input
            v-model="filters.source"
            type="select"
            :label="$t('insights.feedback.filters.source')"
            :options="sourceOptions"
            @update:model-value="applyFilters"
          />

          <Input
            v-model="filters.startDate"
            type="date"
            :label="$t('insights.feedback.filters.startDate')"
            @update:model-value="applyFilters"
          />

          <Input
            v-model="filters.endDate"
            type="date"
            :label="$t('insights.feedback.filters.endDate')"
            @update:model-value="applyFilters"
          />
        </div>
      </CardContent>
    </Card>

    <!-- Feedback List -->
    <Card>
      <CardHeader>
        <CardTitle>{{ $t("insights.feedback.list.title") }}</CardTitle>
        <CardDescription>
          {{ $t("insights.feedback.list.count", { count: filteredFeedback.length }) }}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div v-if="loading" class="text-center py-12">
          <Loading :label="$t('insights.feedback.list.loading')" />
        </div>

        <div v-else-if="filteredFeedback.length === 0" class="text-center py-12">
          <MessageSquare class="h-12 w-12 text-neutral-muted mx-auto mb-4" />
          <p class="text-neutral-muted">{{ $t("insights.feedback.list.empty") }}</p>
        </div>

        <div v-else class="space-y-4">
          <div
            v-for="entry in paginatedFeedback"
            :key="entry.id"
            class="border rounded-lg p-4 hover:bg-neutral-50 transition-colors"
          >
            <div class="flex items-start justify-between">
              <div class="flex-1">
                <div class="flex items-center gap-2 mb-2">
                  <Badge :variant="getRatingVariant(entry.rating)">
                    <ThumbsUp v-if="entry.rating === 'good'" class="h-3 w-3 mr-1" />
                    <ThumbsDown v-if="entry.rating === 'bad'" class="h-3 w-3 mr-1" />
                    {{ $t(`insights.feedback.ratings.${entry.rating}`) }}
                  </Badge>
                  <Badge variant="outline">
                    {{ getSourceName(entry.message?.source?.id) }}
                  </Badge>
                  <span class="text-xs text-neutral-muted">
                    {{ formatDateTime(entry.createdAt) }}
                  </span>
                </div>

                <p
                  v-if="entry.message?.content"
                  class="text-sm text-neutral-muted line-clamp-2 mb-2 border-l-2 pl-2"
                >
                  {{ entry.message.content }}
                </p>

                <p v-if="entry.comment" class="text-sm mb-2">{{ entry.comment }}</p>

                <div v-if="entry.reviewer?.email" class="text-xs text-neutral-muted">
                  {{ $t("insights.feedback.list.reviewer", { email: entry.reviewer.email }) }}
                </div>
              </div>

              <Button
                variant="outline"
                size="sm"
                :disabled="!entry.message?.conversation_id"
                @click="viewMessage(entry)"
              >
                {{ $t("insights.feedback.list.openConversation") }}
                <ExternalLink class="h-4 w-4 ml-2" />
              </Button>
            </div>
          </div>

          <!-- Pagination -->
          <div class="flex items-center justify-between pt-4 border-t">
            <p class="text-sm text-neutral-muted">
              {{
                $t("insights.feedback.list.showing", {
                  from: (currentPage - 1) * pageSize + 1,
                  to: Math.min(currentPage * pageSize, filteredFeedback.length),
                  total: filteredFeedback.length,
                })
              }}
            </p>
            <div class="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                :disabled="currentPage === 1"
                @click="currentPage--"
              >
                {{ $t("insights.feedback.list.previous") }}
              </Button>
              <Button
                variant="outline"
                size="sm"
                :disabled="currentPage === totalPages"
                @click="currentPage++"
              >
                {{ $t("insights.feedback.list.next") }}
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  </Page>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import {
  RefreshCw,
  Download,
  MessageSquare,
  ThumbsUp,
  ThumbsDown,
  TrendingUp,
  ExternalLink,
} from "lucide-vue-next";
import { HayApi } from "@/utils/api";
import { toISODateRange } from "@/utils/date";
import type { RouterInputs, RouterOutputs } from "@/types/trpc";
import { useSources } from "@/composables/useSources";

type FeedbackEntry = RouterOutputs["messageFeedback"]["list"][number];

const { t } = useI18n();
const router = useRouter();
const { sources, loadSources } = useSources();
const { formatDateTime } = useOrgDateTime();

// State
const loading = ref(false);
const exporting = ref(false);
const feedback = ref<FeedbackEntry[]>([]);
const stats = ref({
  total: 0,
  byRating: { good: 0, bad: 0, neutral: 0 },
  percentages: { good: 0, bad: 0, neutral: 0 },
});

// Filters
const filters = ref({
  rating: "",
  source: "",
  startDate: "",
  endDate: "",
});

// Pagination
const currentPage = ref(1);
const pageSize = 20;

// Computed
const successRate = computed(() => {
  const total = stats.value.total;
  if (total === 0) return 0;
  return Math.round((stats.value.byRating.good / total) * 100);
});

const successRateColor = computed(() => {
  const rate = successRate.value;
  if (rate >= 80) return "text-green-600";
  if (rate >= 60) return "text-yellow-600";
  return "text-red-600";
});

const ratingOptions = computed(() => [
  { label: t("insights.feedback.filters.allRatings"), value: "" },
  { label: t("insights.feedback.ratings.good"), value: "good" },
  { label: t("insights.feedback.ratings.bad"), value: "bad" },
  { label: t("insights.feedback.ratings.neutral"), value: "neutral" },
]);

const sourceOptions = computed(() => {
  const options = [{ label: t("insights.feedback.filters.allSources"), value: "" }];
  sources.value.forEach((source) => {
    options.push({ label: source.name, value: source.id });
  });
  return options;
});

const filteredFeedback = computed(() => {
  let result = feedback.value;

  if (filters.value.rating) {
    result = result.filter((f) => f.rating === filters.value.rating);
  }

  if (filters.value.source) {
    result = result.filter((f) => f.message?.source?.id === filters.value.source);
  }

  const { startDate, endDate } = toISODateRange(filters.value);
  if (startDate) {
    result = result.filter((f) => new Date(f.createdAt) >= new Date(startDate));
  }

  if (endDate) {
    result = result.filter((f) => new Date(f.createdAt) <= new Date(endDate));
  }

  return result;
});

const totalPages = computed(() => Math.ceil(filteredFeedback.value.length / pageSize));

const paginatedFeedback = computed(() => {
  const start = (currentPage.value - 1) * pageSize;
  const end = start + pageSize;
  return filteredFeedback.value.slice(start, end);
});

// Methods
const loadFeedback = async () => {
  loading.value = true;
  try {
    const [feedbackData, statsData] = await Promise.all([
      HayApi.messageFeedback.list.query({}),
      HayApi.messageFeedback.stats.query(),
    ]);

    feedback.value = feedbackData;
    stats.value = {
      total: statsData.total,
      byRating: {
        good: statsData.byRating.good || 0,
        bad: statsData.byRating.bad || 0,
        neutral: statsData.byRating.neutral || 0,
      },
      percentages: {
        good: statsData.percentages.good || 0,
        bad: statsData.percentages.bad || 0,
        neutral: statsData.percentages.neutral || 0,
      },
    };
  } catch (error) {
    console.error("Failed to load feedback:", error);
  } finally {
    loading.value = false;
  }
};

const refreshData = async () => {
  await loadFeedback();
};

const applyFilters = () => {
  currentPage.value = 1; // Reset to first page when filters change
};

const exportToCSV = async () => {
  exporting.value = true;
  try {
    const result = await HayApi.messageFeedback.export.query({
      rating:
        (filters.value.rating as RouterInputs["messageFeedback"]["export"]["rating"]) || undefined,
      // The API wants ISO datetimes; send whole local days.
      ...toISODateRange(filters.value),
    });

    // Create and download CSV
    const blob = new Blob([result.csv], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `feedback-export-${new Date().toISOString().split("T")[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  } catch (error) {
    console.error("Failed to export feedback:", error);
  } finally {
    exporting.value = false;
  }
};

const getRatingVariant = (rating: string) => {
  if (rating === "good") return "default";
  if (rating === "bad") return "destructive";
  return "secondary";
};

const getSourceName = (sourceId: string | undefined) => {
  if (!sourceId) return t("insights.feedback.unknownSource");
  const source = sources.value.find((s) => s.id === sourceId);
  return source?.name || sourceId;
};

// Opens the conversation scrolled to (and highlighting) the rated message.
const viewMessage = (entry: FeedbackEntry) => {
  const conversationId = entry.message?.conversation_id;
  if (!conversationId) return;
  router.push({ path: `/conversations/${conversationId}`, query: { message: entry.messageId } });
};

// Lifecycle
onMounted(async () => {
  await Promise.all([loadSources(), loadFeedback()]);
});

// Page meta
definePageMeta({
  layout: "default",
});

// Head
useHead({
  title: t("insights.feedback.seoTitle"),
});
</script>
