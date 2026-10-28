<template>
  <Page
    :title="insight?.title || $t('insights.page.list.untitled')"
    :description="insight?.summary || ''"
  >
    <template #header>
      <Button variant="outline" @click="router.push('/insights')">
        <ArrowLeft class="h-4 w-4 mr-2" />
        {{ $t("insights.page.detail.back") }}
      </Button>
    </template>

    <div v-if="loading && !insight" class="text-center py-12">
      <Loading />
    </div>

    <EmptyState
      v-else-if="!insight"
      :title="$t('insights.page.detail.loadError')"
      description=""
      :action="$t('insights.page.detail.back')"
      @click="router.push('/insights')"
    />

    <div v-else class="grid gap-6 lg:grid-cols-3">
      <div class="space-y-6 lg:col-span-2">
        <div class="flex flex-wrap items-center gap-2">
          <Badge :variant="polarityVariant(insight.polarity)">
            {{ $t(`insights.page.polarity.${insight.polarity}`) }}
          </Badge>
          <Badge variant="outline">{{ $t(`insights.page.states.${insight.state}`) }}</Badge>
          <Badge variant="secondary">
            {{ $t(`insights.page.actionTypes.${insight.actionType}`) }}
          </Badge>
          <Badge v-if="insight.origin === 'docs_audit'" variant="tool">
            {{ $t("insights.page.list.docsAudit") }}
          </Badge>
          <Badge v-if="insight.recurredAt" variant="warning">
            {{ $t("insights.page.list.recurring") }}
          </Badge>
        </div>

        <Card v-if="insight.hypothesis">
          <CardHeader>
            <CardTitle class="text-base">{{ $t("insights.page.detail.hypothesis") }}</CardTitle>
          </CardHeader>
          <CardContent>
            <p class="text-sm">{{ insight.hypothesis }}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle class="text-base">{{ $t("insights.page.detail.evidence") }}</CardTitle>
            <CardDescription>{{ $t("insights.page.detail.evidenceHint") }}</CardDescription>
          </CardHeader>
          <CardContent class="space-y-3">
            <div
              v-for="snippet in insight.snippets"
              :key="snippet.issueId"
              class="border rounded-lg p-3"
            >
              <div class="flex items-center justify-between gap-2 mb-1">
                <Badge variant="outline">
                  {{ $t(`insights.page.sources.${snippet.source}`) }}
                </Badge>
                <Button
                  v-if="snippet.conversationId"
                  variant="ghost"
                  size="sm"
                  @click="openConversation(snippet.conversationId)"
                >
                  {{ $t("insights.page.detail.openConversation") }}
                  <ExternalLink class="h-4 w-4 ml-2" />
                </Button>
                <span v-else class="text-xs text-neutral-muted">
                  {{ $t("insights.page.detail.conversationGone") }}
                </span>
              </div>
              <p class="text-sm border-l-2 pl-2 text-neutral-muted">{{ snippet.text }}</p>
            </div>

            <div v-if="insight.paraphrases.length" class="pt-2">
              <p class="text-sm font-medium mb-2">{{ $t("insights.page.detail.paraphrases") }}</p>
              <ul class="list-disc pl-5 text-sm space-y-1">
                <li v-for="(p, i) in insight.paraphrases" :key="i">{{ p }}</li>
              </ul>
            </div>
          </CardContent>
        </Card>

        <Card v-if="insight.members.length">
          <CardHeader>
            <CardTitle class="text-base">{{ $t("insights.page.detail.recent") }}</CardTitle>
          </CardHeader>
          <CardContent class="divide-y">
            <div
              v-for="member in insight.members"
              :key="member.id"
              class="flex items-center justify-between gap-4 py-2 text-sm"
            >
              <div class="min-w-0">
                <p class="truncate">
                  {{ member.conversationTitle || $t("insights.page.detail.untitledConversation") }}
                </p>
                <p class="text-xs text-neutral-muted">
                  {{ $t(`insights.page.sources.${member.source}`) }} ·
                  {{ formatDateTime(member.createdAt) }}
                </p>
              </div>
              <Button
                v-if="member.conversationId"
                variant="ghost"
                size="sm"
                @click="openConversation(member.conversationId)"
              >
                <ExternalLink class="h-4 w-4" />
                <span class="sr-only">{{ $t("insights.page.detail.openConversation") }}</span>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <div class="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle class="text-base">{{ $t("insights.page.detail.lifecycle") }}</CardTitle>
          </CardHeader>
          <CardContent class="flex flex-col gap-2">
            <Button
              v-for="state in insight.allowedTransitions"
              :key="state"
              :variant="state === 'rejected' ? 'outline' : 'secondary'"
              :loading="changing === state"
              :disabled="!!changing"
              @click="requestState(state)"
            >
              {{ $t(`insights.page.detail.actions.${state}`) }}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardContent class="p-6 space-y-2 text-sm">
            <div v-for="row in statRows" :key="row.label" class="flex justify-between gap-4">
              <span class="text-neutral-muted">{{ row.label }}</span>
              <span class="font-medium">{{ row.value }}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent class="p-6 space-y-4 text-sm">
            <div v-for="group in breakdownGroups" :key="group.key">
              <p class="font-medium mb-1">{{ group.label }}</p>
              <div
                v-for="entry in group.entries"
                :key="entry.key"
                class="flex justify-between gap-4"
              >
                <span class="text-neutral-muted">{{ entry.label }}</span>
                <span>{{ entry.count }}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle class="text-base">{{ $t("insights.page.detail.audit") }}</CardTitle>
          </CardHeader>
          <CardContent class="space-y-3 text-sm">
            <p v-if="!insight.audit.length" class="text-neutral-muted">
              {{ $t("insights.page.detail.auditEmpty") }}
            </p>
            <div v-for="entry in insight.audit" :key="entry.id">
              <p>
                <span v-if="entry.fromState">
                  {{ $t(`insights.page.states.${entry.fromState}`) }} →
                </span>
                {{ $t(`insights.page.states.${entry.toState}`) }}
              </p>
              <p class="text-xs text-neutral-muted">
                {{ entry.user || $t("insights.page.detail.auditSystem") }} ·
                {{ formatDateTime(entry.createdAt) }}
              </p>
              <p v-if="auditReason(entry.reason)" class="text-xs mt-1">
                {{ auditReason(entry.reason) }}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>

    <Dialog v-model:open="rejectOpen">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{{ $t("insights.page.detail.rejectTitle") }}</DialogTitle>
          <DialogDescription>{{ $t("insights.page.detail.rejectDescription") }}</DialogDescription>
        </DialogHeader>
        <div>
          <Label for="reject-reason">{{ $t("insights.page.detail.rejectReason") }}</Label>
          <Textarea id="reject-reason" v-model="rejectReason" :rows="3" class="mt-1" />
        </div>
        <DialogFooter>
          <Button variant="outline" @click="rejectOpen = false">{{ $t("common.cancel") }}</Button>
          <Button
            variant="destructive"
            :loading="changing === 'rejected'"
            @click="changeState('rejected', rejectReason)"
          >
            {{ $t("insights.page.detail.rejectConfirm") }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </Page>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { ArrowLeft, ExternalLink } from "lucide-vue-next";
import { HayApi } from "@/utils/api";
import type { RouterInputs, RouterOutputs } from "@/types/trpc";

type Insight = RouterOutputs["insights"]["get"];
type InsightState = RouterInputs["insights"]["setState"]["state"];

const { t, te } = useI18n();
const route = useRoute();
const router = useRouter();
const toast = useToast();
const { formatDate, formatDateTime } = useOrgDateTime();

const id = computed(() => String(route.params.id));
const loading = ref(false);
const insight = ref<Insight | null>(null);
const changing = ref<InsightState | null>(null);
const rejectOpen = ref(false);
const rejectReason = ref("");

const polarityVariant = (polarity: string) => {
  if (polarity === "negative") return "destructive";
  if (polarity === "positive") return "success";
  return "secondary";
};

const statRows = computed(() => {
  const i = insight.value;
  if (!i) return [];
  return [
    { label: t("insights.page.detail.stats.periodSize"), value: i.periodSize },
    { label: t("insights.page.detail.stats.total"), value: i.size },
    { label: t("insights.page.detail.stats.conversations"), value: i.conversationCount },
    { label: t("insights.page.detail.stats.takeovers"), value: i.handedOffCount },
    { label: t("insights.page.detail.stats.firstSeen"), value: formatDate(i.firstSeenAt) },
    { label: t("insights.page.detail.stats.lastSeen"), value: formatDate(i.lastSeenAt) },
  ];
});

const labelFor = (prefix: string, key: string) =>
  te(`${prefix}.${key}`) ? t(`${prefix}.${key}`) : key;

const breakdownGroups = computed(() => {
  const b = insight.value?.breakdown;
  if (!b) return [];
  return [
    {
      key: "channels",
      label: t("insights.page.detail.breakdown.channels"),
      entries: b.channels.map((e) => ({ ...e, label: e.key })),
    },
    {
      key: "sources",
      label: t("insights.page.detail.breakdown.sources"),
      entries: b.sources.map((e) => ({ ...e, label: labelFor("insights.page.sources", e.key) })),
    },
    {
      key: "polarity",
      label: t("insights.page.detail.breakdown.polarity"),
      entries: b.polarities.map((e) => ({
        ...e,
        label: labelFor("insights.page.polarity", e.key),
      })),
    },
  ].filter((g) => g.entries.length);
});

// System reasons are codes ("recurred", "merged:<id>"); user reasons are free text.
const auditReason = (reason: string | null) => {
  if (!reason) return "";
  if (reason === "recurred") return t("insights.page.detail.auditRecurred");
  if (reason.startsWith("merged:")) return t("insights.page.detail.auditMerged");
  return reason;
};

const load = async () => {
  loading.value = true;
  try {
    insight.value = await HayApi.insights.get.query({ id: id.value });
  } catch (error) {
    console.error("Failed to load insight:", error);
    insight.value = null;
  } finally {
    loading.value = false;
  }
};

const requestState = (state: InsightState) => {
  if (state === "rejected") {
    rejectReason.value = "";
    rejectOpen.value = true;
    return;
  }
  void changeState(state);
};

const changeState = async (state: InsightState, reason?: string) => {
  changing.value = state;
  try {
    await HayApi.insights.setState.mutate({ id: id.value, state, reason: reason || undefined });
    rejectOpen.value = false;
    toast.success(t("insights.page.detail.stateChanged"));
    await load();
  } catch (error) {
    console.error("Failed to update insight:", error);
    toast.error(t("insights.page.detail.stateError"));
  } finally {
    changing.value = null;
  }
};

const openConversation = (conversationId: string) =>
  router.push(`/conversations/${conversationId}`);

onMounted(load);

definePageMeta({ layout: "default" });

useHead({ title: t("insights.page.seoTitle") });
</script>
