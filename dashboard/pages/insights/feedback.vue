<template>
  <Page title="Feedback Insights" description="Analyze AI response quality through user feedback">
    <template #header>
      <div class="flex items-center gap-2">
        <Button variant="outline" :disabled="loading" @click="refreshData">
          <RefreshCw class="h-4 w-4 mr-2" :class="{ 'animate-spin': loading }" />
          Refresh
        </Button>
        <Button
          variant="outline"
          :disabled="exporting || filteredFeedback.length === 0"
          @click="exportToCSV"
        >
          <Download class="h-4 w-4 mr-2" />
          Export CSV
        </Button>
      </div>
    </template>

    <!-- Stats Overview -->
    <div class="grid gap-4 md:grid-cols-4 mb-6">
      <Card>
        <CardContent class="p-6">
          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm text-neutral-muted">Total Feedback</p>
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
              <p class="text-sm text-neutral-muted">Positive</p>
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
              <p class="text-sm text-neutral-muted">Negative</p>
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
              <p class="text-sm text-neutral-muted">Success Rate</p>
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
        <CardTitle>Filters</CardTitle>
      </CardHeader>
      <CardContent>
        <div class="grid gap-4 md:grid-cols-4">
          <Input
            v-model="filters.rating"
            type="select"
            label="Rating"
            :options="[
              { label: 'All Ratings', value: '' },
              { label: 'Good', value: 'good' },
              { label: 'Bad', value: 'bad' },
              { label: 'Neutral', value: 'neutral' },
            ]"
            @update:model-value="applyFilters"
          />

          <Input
            v-model="filters.source"
            type="select"
            label="Source"
            :options="sourceOptions"
            @update:model-value="applyFilters"
          />

          <Input
            v-model="filters.startDate"
            type="date"
            label="Start Date"
            @update:model-value="applyFilters"
          />

          <Input
            v-model="filters.endDate"
            type="date"
            label="End Date"
            @update:model-value="applyFilters"
          />
        </div>
      </CardContent>
    </Card>

    <!-- Feedback List -->
    <Card>
      <CardHeader>
        <CardTitle>Feedback History</CardTitle>
        <CardDescription> {{ filteredFeedback.length }} feedback entries </CardDescription>
      </CardHeader>
      <CardContent>
        <div v-if="loading" class="text-center py-12">
          <Loading label="Loading feedback..." />
        </div>

        <div v-else-if="filteredFeedback.length === 0" class="text-center py-12">
          <MessageSquare class="h-12 w-12 text-neutral-muted mx-auto mb-4" />
          <p class="text-neutral-muted">No feedback found with current filters</p>
        </div>

        <div v-else class="space-y-4">
          <div
            v-for="feedback in paginatedFeedback"
            :key="feedback.id"
            class="border rounded-lg p-4 hover:bg-neutral-50 transition-colors"
          >
            <div class="flex items-start justify-between">
              <div class="flex-1">
                <div class="flex items-center gap-2 mb-2">
                  <Badge :variant="getRatingVariant(feedback.rating)">
                    <ThumbsUp v-if="feedback.rating === 'good'" class="h-3 w-3 mr-1" />
                    <ThumbsDown v-if="feedback.rating === 'bad'" class="h-3 w-3 mr-1" />
                    {{ feedback.rating }}
                  </Badge>
                  <Badge variant="outline">
                    {{ getSourceName(feedback.message?.source?.id) }}
                  </Badge>
                  <span class="text-xs text-neutral-muted">
                    {{ formatDate(feedback.createdAt) }}
                  </span>
                </div>

                <p v-if="feedback.comment" class="text-sm mb-2">{{ feedback.comment }}</p>

                <div class="text-xs text-neutral-muted">
                  <span>Message ID: {{ feedback.messageId.slice(0, 8) }}</span>
                  <span class="mx-2">•</span>
                  <span>Reviewer: {{ feedback.reviewer?.email }}</span>
                </div>
              </div>

              <Button variant="ghost" size="sm" @click="viewMessage(feedback.messageId)">
                <ExternalLink class="h-4 w-4" />
              </Button>
            </div>
          </div>

          <!-- Pagination -->
          <div class="flex items-center justify-between pt-4 border-t">
            <p class="text-sm text-neutral-muted">
              Showing {{ (currentPage - 1) * pageSize + 1 }}-{{
                Math.min(currentPage * pageSize, filteredFeedback.length)
              }}
              of {{ filteredFeedback.length }}
            </p>
            <div class="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                :disabled="currentPage === 1"
                @click="currentPage--"
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                :disabled="currentPage === totalPages"
                @click="currentPage++"
              >
                Next
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
import { useSources } from "@/composables/useSources";
import { useRouter } from "vue-router";

const router = useRouter();
const { sources, loadSources } = useSources();

// State
const loading = ref(false);
const exporting = ref(false);
const feedback = ref<any[]>([]);
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

const sourceOptions = computed(() => {
  const options = [{ label: "All Sources", value: "" }];
  sources.value.forEach((source: any) => {
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

  if (filters.value.startDate) {
    const startDate = new Date(filters.value.startDate);
    result = result.filter((f) => new Date(f.createdAt) >= startDate);
  }

  if (filters.value.endDate) {
    const endDate = new Date(filters.value.endDate);
    endDate.setHours(23, 59, 59, 999);
    result = result.filter((f) => new Date(f.createdAt) <= endDate);
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
        good: (statsData.byRating as any).good || 0,
        bad: (statsData.byRating as any).bad || 0,
        neutral: (statsData.byRating as any).neutral || 0,
      },
      percentages: {
        good: (statsData.percentages as any).good || 0,
        bad: (statsData.percentages as any).bad || 0,
        neutral: (statsData.percentages as any).neutral || 0,
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
      rating: (filters.value.rating as any) || undefined,
      startDate: filters.value.startDate || undefined,
      endDate: filters.value.endDate || undefined,
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
  if (!sourceId) return "Unknown";
  const source = sources.value.find((s: any) => s.id === sourceId);
  return source?.name || sourceId;
};

const formatDate = (date: string | Date) => {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
};

const viewMessage = (messageId: string) => {
  // TODO: Navigate to conversation containing this message
  console.log("View message:", messageId);
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
  title: "Feedback Insights - Hay Dashboard",
});
</script>
