<template>
  <Page :title="$t('evidence.title')" :description="$t('evidence.description')">
    <Card>
      <CardContent class="pt-6">
        <div v-if="context" class="flex flex-wrap items-center justify-between gap-2">
          <p class="text-sm font-medium">
            {{
              context.kind === "conversation"
                ? $t("evidence.search.forConversation")
                : $t("evidence.search.forCustomer")
            }}
          </p>
          <Button
            variant="link"
            size="sm"
            data-testid="evidence-clear-context"
            @click="clearContext"
          >
            {{ $t("evidence.search.clear") }}
          </Button>
        </div>
        <form v-else class="flex flex-col gap-3 md:flex-row md:items-end" @submit.prevent="search">
          <Input
            v-model="query"
            type="search"
            class="md:flex-1"
            :label="$t('evidence.search.label')"
            :placeholder="$t('evidence.search.placeholder')"
            :icon-start="Search"
            data-testid="evidence-order-query"
          />
          <Button type="submit" :loading="searching" :disabled="!query.trim()">
            {{ $t("evidence.search.submit") }}
          </Button>
        </form>

        <Loading v-if="searching && orders.length === 0" class="mt-6" />

        <p
          v-else-if="searched && orders.length === 0"
          class="mt-6 text-sm text-muted-foreground"
          data-testid="evidence-empty"
        >
          {{ emptyText }}
        </p>

        <ul v-if="orders.length > 0" class="mt-6 divide-y divide-border">
          <li
            v-for="order in orders"
            :key="orderId(order)"
            class="flex flex-col gap-2 py-3 md:flex-row md:items-center md:gap-4"
            data-testid="evidence-order-row"
          >
            <div class="min-w-0 flex-1 space-y-1">
              <p class="font-medium">
                {{ $t("evidence.order.label", { number: order.orderLabel ?? order.orderKey }) }}
              </p>
              <p class="text-xs text-muted-foreground">
                {{
                  order.platform ??
                  (order.pluginId ? order.pluginId : $t("evidence.order.fromMessages"))
                }}
                ·
                {{
                  $t(
                    "evidence.order.conversations",
                    { count: order.conversationCount },
                    order.conversationCount,
                  )
                }}
                ·
                {{ $t("evidence.order.lastSeen", { at: formatDateTime(order.lastSeenAt) }) }}
              </p>
            </div>
            <Button
              :variant="isSelected(order) ? 'default' : 'outline'"
              size="sm"
              @click="selectOrder(order)"
            >
              {{ isSelected(order) ? $t("evidence.order.selected") : $t("evidence.order.select") }}
            </Button>
          </li>
        </ul>

        <div
          v-if="context?.kind === 'conversation' && searched && !searching"
          class="mt-4 flex flex-col gap-2 border-t border-border pt-4 md:flex-row md:items-center md:gap-4"
        >
          <div class="min-w-0 flex-1">
            <p class="font-medium">{{ $t("evidence.conversationOnly.title") }}</p>
            <p class="text-xs text-muted-foreground">
              {{ $t("evidence.conversationOnly.description") }}
            </p>
          </div>
          <Button
            :variant="selection?.kind === 'conversation' ? 'default' : 'outline'"
            size="sm"
            data-testid="evidence-conversation-only"
            @click="selection = { kind: 'conversation', conversationId: context.id }"
          >
            {{
              selection?.kind === "conversation"
                ? $t("evidence.order.selected")
                : $t("evidence.order.select")
            }}
          </Button>
        </div>
      </CardContent>
    </Card>

    <Card v-if="selection">
      <CardHeader>
        <CardTitle class="text-base">{{ $t("evidence.options.title") }}</CardTitle>
        <CardDescription>{{ selectionLabel }}</CardDescription>
      </CardHeader>
      <CardContent class="space-y-4">
        <div>
          <Input
            v-model="template"
            type="select"
            :label="$t('evidence.options.template')"
            :options="templateOptions"
            data-testid="evidence-template"
          />
          <p class="mt-1 text-xs text-muted-foreground">
            {{ $t("evidence.options.templateHelp") }}
          </p>
        </div>
        <div class="flex flex-wrap gap-2">
          <Button
            :loading="generating === 'pdf'"
            :disabled="generating !== null"
            @click="generate('pdf')"
          >
            <FileText class="mr-2 h-4 w-4" />
            {{ $t("evidence.options.pdf") }}
          </Button>
          <Button
            variant="outline"
            :loading="generating === 'zip'"
            :disabled="generating !== null"
            @click="generate('zip')"
          >
            <FileArchive class="mr-2 h-4 w-4" />
            {{ $t("evidence.options.zip") }}
          </Button>
        </div>
        <p class="text-xs text-muted-foreground">{{ $t("evidence.options.zipHelp") }}</p>
        <Alert v-if="lastResult?.imagesOmitted" variant="info">
          <AlertDescription>{{ $t("evidence.options.imagesOmitted") }}</AlertDescription>
        </Alert>
        <Alert v-if="lastResult?.overCap" variant="warning">
          <AlertDescription>{{ $t("evidence.options.overCap") }}</AlertDescription>
        </Alert>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle class="text-base">{{ $t("evidence.notes.title") }}</CardTitle>
      </CardHeader>
      <CardContent class="space-y-3 text-sm text-muted-foreground">
        <p>{{ $t("evidence.notes.honest") }}</p>
        <p data-testid="evidence-retention-note">
          {{
            retentionDays
              ? $t("evidence.notes.retention", { days: retentionDays })
              : $t("evidence.notes.retentionOff")
          }}
          <NuxtLink to="/settings/general" class="font-medium text-primary hover:underline">
            {{ $t("evidence.notes.retentionLink") }}
          </NuxtLink>
        </p>
      </CardContent>
    </Card>
  </Page>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { FileArchive, FileText, Search } from "lucide-vue-next";
import { Hay } from "@/utils/api";
import { useToast } from "@/composables/useToast";
import type { RouterOutputs } from "@/types/trpc";

/**
 * Evidence packs (D2-5): find an order (by number, or from a conversation or
 * customer), pick a dispute reason and download the PDF or the ZIP.
 */
type Order = RouterOutputs["evidencePacks"]["searchOrders"]["orders"][number];
type Template = "generic" | "item_not_received" | "not_as_described" | "cancelled_credit";
type Selection = { kind: "order"; order: Order } | { kind: "conversation"; conversationId: string };

const TEMPLATES: Template[] = [
  "generic",
  "item_not_received",
  "not_as_described",
  "cancelled_credit",
];

const { t } = useI18n();
const toast = useToast();
const route = useRoute();
const router = useRouter();
const { formatDateTime } = useOrgDateTime();

useHead({ title: t("evidence.headTitle") });

const query = ref(typeof route.query.order === "string" ? route.query.order : "");
const orders = ref<Order[]>([]);
const retentionDays = ref<number | null>(null);
const searching = ref(false);
const searched = ref(false);
const selection = ref<Selection | null>(null);
const template = ref<Template>("generic");
const generating = ref<"pdf" | "zip" | null>(null);
const lastResult = ref<{ imagesOmitted: boolean; overCap: boolean } | null>(null);

const context = computed(() => {
  if (typeof route.query.conversation === "string") {
    return { kind: "conversation" as const, id: route.query.conversation };
  }
  if (typeof route.query.customer === "string") {
    return { kind: "customer" as const, id: route.query.customer };
  }
  return null;
});

const templateOptions = computed(() =>
  TEMPLATES.map((value) => ({ value, label: t(`evidence.options.templates.${value}`) })),
);

const emptyText = computed(() => {
  if (context.value?.kind === "conversation") return t("evidence.search.emptyConversation");
  if (context.value?.kind === "customer") return t("evidence.search.emptyCustomer");
  return t("evidence.search.empty");
});

const selectionLabel = computed(() => {
  const current = selection.value;
  if (!current) return "";
  if (current.kind === "conversation") return t("evidence.options.forConversation");
  const count = current.order.conversationCount;
  return t(
    "evidence.options.forOrder",
    { number: current.order.orderLabel ?? current.order.orderKey, count },
    count,
  );
});

const orderId = (order: Order) => `${order.pluginId ?? ""}|${order.orderKey}`;
const isSelected = (order: Order) =>
  selection.value?.kind === "order" && orderId(selection.value.order) === orderId(order);

function selectOrder(order: Order) {
  selection.value = { kind: "order", order };
  lastResult.value = null;
}

async function load(filter: { query?: string; conversationId?: string; customerId?: string }) {
  searching.value = true;
  try {
    const result = await Hay.evidencePacks.searchOrders.query(filter);
    orders.value = result.orders;
    retentionDays.value = result.retentionDays;
    searched.value = Boolean(filter.query || filter.conversationId || filter.customerId);
    // One match: select it straight away.
    const only = result.orders.length === 1 ? result.orders[0] : undefined;
    selection.value = only ? { kind: "order", order: only } : null;
  } catch {
    toast.error(t("common.error"), t("evidence.options.failed"));
  } finally {
    searching.value = false;
  }
}

function search() {
  const value = query.value.trim();
  if (!value) return;
  router.replace({ query: { order: value } });
  load({ query: value });
}

function clearContext() {
  orders.value = [];
  searched.value = false;
  selection.value = null;
  router.replace({ query: {} });
}

function download(base64Data: string, fileName: string, mimeType: string) {
  const binary = atob(base64Data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const url = window.URL.createObjectURL(new Blob([bytes], { type: mimeType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}

async function generate(format: "pdf" | "zip") {
  const current = selection.value;
  if (!current) return;
  generating.value = format;
  try {
    const result = await Hay.evidencePacks.generate.mutate({
      template: template.value,
      format,
      ...(current.kind === "order"
        ? { orderKey: current.order.orderKey, pluginId: current.order.pluginId }
        : { conversationId: current.conversationId }),
    });
    download(result.base64Data, result.fileName, result.mimeType);
    lastResult.value = { imagesOmitted: result.imagesOmitted, overCap: result.overCap };
    toast.success(t("evidence.options.downloaded"));
  } catch {
    toast.error(t("common.error"), t("evidence.options.failed"));
  } finally {
    generating.value = null;
  }
}

function loadFromRoute() {
  if (context.value?.kind === "conversation") load({ conversationId: context.value.id });
  else if (context.value?.kind === "customer") load({ customerId: context.value.id });
  else if (query.value.trim()) load({ query: query.value.trim() });
  else load({});
}

watch(
  () => [route.query.conversation, route.query.customer],
  () => loadFromRoute(),
);
onMounted(loadFromRoute);
</script>
