<template>
  <section
    v-if="canApprove && (items.length > 0 || showNudge)"
    aria-labelledby="home-approvals-heading"
    data-testid="home-approvals"
  >
    <h2 id="home-approvals-heading" class="mb-1 flex items-baseline gap-2 text-sm font-semibold">
      {{ $t("aiActions.approvals.title") }}
      <span class="tabular-nums text-neutral-muted">{{ items.length }}</span>
    </h2>
    <p class="mb-2 text-sm text-neutral-muted">{{ $t("aiActions.approvals.description") }}</p>

    <!-- Graduation nudge (D4-11): owner only, applied after a confirmation -->
    <div
      v-if="showNudge && suggestion"
      class="mb-2 flex flex-col gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4"
      data-testid="approvals-graduation"
    >
      <p class="text-sm">{{ nudgeMessage }}</p>
      <div class="flex flex-col gap-2 sm:flex-row">
        <Button class="min-h-11 sm:min-h-0" @click="graduationOpen = true">
          {{ $t("aiActions.graduation.apply", { amount: suggestedAmount }) }}
        </Button>
        <Button variant="ghost" class="min-h-11 sm:min-h-0" @click="dismissNudge">
          {{ $t("aiActions.graduation.dismiss") }}
        </Button>
      </div>
    </div>

    <Dialog v-model:open="graduationOpen">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {{ $t("aiActions.graduation.confirmTitle", { amount: suggestedAmount }) }}
          </DialogTitle>
          <DialogDescription>
            {{ $t("aiActions.graduation.confirmDescription", { amount: suggestedAmount }) }}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" :disabled="applying" @click="graduationOpen = false">
            {{ $t("common.cancel") }}
          </Button>
          <Button :loading="applying" data-testid="approvals-graduation-confirm" @click="applyNudge">
            {{ $t("aiActions.graduation.confirm") }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- Bulk bar: one kind at a time, with the total -->
    <div
      v-if="selectedItems.length > 0"
      class="mb-2 flex flex-col gap-2 rounded-xl border border-border bg-background-secondary p-3 sm:flex-row sm:items-center"
      data-testid="approvals-bulk-bar"
    >
      <p class="flex-1 text-sm">
        <span class="font-medium">
          {{ $t("aiActions.approvals.selected", { count: selectedItems.length }) }}
        </span>
        <span v-if="selectedTotal" class="ml-2 tabular-nums">
          {{ $t("aiActions.approvals.total", { amount: selectedTotal }) }}
        </span>
        <span v-if="selectedWithoutAmount > 0" class="ml-2 text-neutral-muted">
          {{ $t("aiActions.approvals.noAmountCount", { count: selectedWithoutAmount }) }}
        </span>
      </p>
      <Button
        class="min-h-11 w-full sm:min-h-0 sm:w-auto"
        :loading="bulkBusy"
        data-testid="approvals-approve-selected"
        @click="approveSelected"
      >
        {{ $t("aiActions.approvals.approveSelected", { count: selectedItems.length }) }}
      </Button>
    </div>
    <p v-else-if="items.length > 1" class="mb-2 text-xs text-neutral-muted">
      {{ $t("aiActions.approvals.selectHint") }}
    </p>

    <ul
      v-if="items.length > 0"
      class="divide-y divide-border rounded-xl border border-border bg-background shadow-sm"
    >
      <li
        v-for="item in items"
        :key="item.id"
        class="flex flex-col gap-3 p-4"
        :data-testid="`approval-${item.id}`"
      >
        <div class="flex items-start gap-3">
          <label
            class="flex min-h-11 min-w-11 items-start justify-center pt-1 sm:min-h-0 sm:min-w-0"
          >
            <Checkbox
              :model-value="selected.has(item.id)"
              :disabled="!selectable(item) || busyId === item.id"
              :aria-label="$t('aiActions.approvals.select', { name: describe(item) })"
              @update:model-value="(value: boolean) => toggle(item.id, value)"
            />
          </label>
          <div class="min-w-0 flex-1">
            <p class="flex flex-wrap items-baseline gap-x-2">
              <span class="font-medium">{{ categoryLabel(item.category) }}</span>
              <span class="tabular-nums">
                {{
                  item.amount !== null
                    ? formatAmount(item.amount, item.currency)
                    : $t("aiActions.approvals.noAmount")
                }}
              </span>
              <span class="text-xs text-neutral-muted">{{ toolLabel(item.tool_name) }}</span>
            </p>
            <NuxtLink
              :to="`/conversations/${item.conversation_id}`"
              class="mt-0.5 inline-flex min-h-11 items-center text-sm text-primary hover:underline sm:min-h-0"
            >
              {{
                item.customerName || item.conversationTitle || $t("aiActions.approvals.untitled")
              }}
              · {{ $t("aiActions.approvals.open") }}
            </NuxtLink>
          </div>
        </div>

        <!-- Lower the amount, then approve -->
        <div v-if="editingId === item.id" class="space-y-2 sm:pl-8">
          <Input
            v-model.number="editAmount"
            type="number"
            min="0.01"
            step="0.01"
            :max="item.amount ?? undefined"
            :label="
              $t('aiActions.approvals.amountLabel', {
                max: formatAmount(item.amount ?? 0, item.currency),
              })
            "
            :data-testid="`approval-amount-${item.id}`"
          />
          <p class="text-xs text-neutral-muted">{{ $t("aiActions.approvals.amountHelp") }}</p>
        </div>

        <!-- Decline with a reason -->
        <div v-if="rejectingId === item.id" class="space-y-2 sm:pl-8">
          <Label :for="`reason-${item.id}`">{{ $t("aiActions.approvals.rejectReason") }}</Label>
          <Textarea :id="`reason-${item.id}`" v-model="rejectReason" :disabled="!!busyId" />
        </div>

        <div class="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:pl-8">
          <template v-if="rejectingId === item.id">
            <Button
              variant="destructive"
              class="min-h-11 sm:min-h-0"
              :loading="busyId === item.id"
              @click="reject(item)"
            >
              {{ $t("aiActions.approvals.confirmReject") }}
            </Button>
            <Button
              variant="outline"
              class="min-h-11 sm:min-h-0"
              :disabled="busyId === item.id"
              @click="rejectingId = null"
            >
              {{ $t("common.cancel") }}
            </Button>
          </template>
          <template v-else>
            <Button
              class="min-h-11 sm:min-h-0"
              :loading="busyId === item.id"
              :disabled="editingId === item.id && !editValid(item)"
              :data-testid="`approval-approve-${item.id}`"
              @click="approve(item)"
            >
              {{
                editingId === item.id && editValid(item)
                  ? $t("aiActions.approvals.approveAmount", {
                      amount: formatAmount(editAmount ?? 0, item.currency),
                    })
                  : $t("aiActions.approvals.approve")
              }}
            </Button>
            <Button
              v-if="item.amountEditable && editingId !== item.id"
              variant="outline"
              class="min-h-11 sm:min-h-0"
              :disabled="busyId === item.id"
              @click="startEdit(item)"
            >
              {{ $t("aiActions.approvals.editAmount") }}
            </Button>
            <Button
              v-if="editingId === item.id"
              variant="outline"
              class="min-h-11 sm:min-h-0"
              :disabled="busyId === item.id"
              @click="editingId = null"
            >
              {{ $t("common.cancel") }}
            </Button>
            <Button
              variant="ghost"
              class="min-h-11 sm:min-h-0"
              :disabled="busyId === item.id"
              @click="startReject(item)"
            >
              {{ $t("aiActions.approvals.reject") }}
            </Button>
          </template>
        </div>
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import { Hay } from "@/utils/api";
import { useToast } from "@/composables/useToast";
import { useWebSocket } from "@/composables/useWebSocket";
import { useUserStore } from "@/stores/user";

/**
 * The owner's Approvals list (D4-6): every AI action waiting for a person,
 * across conversations. Approve (optionally lowering the amount), decline
 * with a reason, or approve several of one kind at once.
 */
export interface ApprovalItem {
  id: string;
  conversation_id: string;
  tool_name: string;
  category: string;
  amount: number | null;
  conversationTitle: string | null;
  customerName: string | null;
  amountEditable: boolean;
  currency: string | null;
}

const emit = defineEmits<{ changed: [] }>();

const { t, te, locale } = useI18n();
const toast = useToast();
const websocket = useWebSocket();

const canApprove = ref(false);
const items = ref<ApprovalItem[]>([]);
const selected = ref(new Set<string>());
const busyId = ref<string | null>(null);
const bulkBusy = ref(false);
const editingId = ref<string | null>(null);
const editAmount = ref<number | undefined>(undefined);
const rejectingId = ref<string | null>(null);
const rejectReason = ref("");

// Graduation nudge (D4-11). Dismissal is a per-browser convenience only.
interface GraduationSuggestion {
  category: "refund" | "discount";
  approved: number;
  total: number;
  amount: number;
  currency: string;
}
const DISMISS_KEY = "hay-approvals-graduation-dismissed";
const userStore = useUserStore();
const suggestion = ref<GraduationSuggestion | null>(null);
const dismissed = ref<string | null>(null);
const graduationOpen = ref(false);
const applying = ref(false);
const suggestionKey = computed(() =>
  suggestion.value ? `${suggestion.value.category}:${suggestion.value.amount}` : null,
);
const showNudge = computed(
  () => userStore.isOwner && !!suggestion.value && dismissed.value !== suggestionKey.value,
);
const suggestedAmount = computed(() =>
  suggestion.value ? formatAmount(suggestion.value.amount, suggestion.value.currency) : "",
);
const nudgeMessage = computed(() => {
  if (!suggestion.value) return "";
  const { approved, total, category } = suggestion.value;
  return t("aiActions.graduation.message", {
    approved,
    total,
    category: t(`aiActions.graduation.noun.${category}`),
    amount: suggestedAmount.value,
  });
});

async function loadSuggestion() {
  if (!userStore.isOwner) return;
  try {
    suggestion.value = await Hay.actions.graduationSuggestion.query();
  } catch {
    suggestion.value = null;
  }
}

function dismissNudge() {
  dismissed.value = suggestionKey.value;
  try {
    if (dismissed.value) localStorage.setItem(DISMISS_KEY, dismissed.value);
  } catch {
    // Storage blocked: the nudge stays hidden until the page reloads.
  }
}

async function applyNudge() {
  if (!suggestion.value) return;
  applying.value = true;
  try {
    const amount = suggestion.value.amount;
    await Hay.organizations.updateSettings.mutate({ actionApproval: { thresholdAmount: amount } });
    toast.success(t("aiActions.graduation.applied", { amount: suggestedAmount.value }));
    graduationOpen.value = false;
    suggestion.value = null;
  } catch (error) {
    toast.error(
      t("aiActions.graduation.applyFailed"),
      error instanceof Error ? error.message : undefined,
    );
  } finally {
    applying.value = false;
  }
}

defineExpose({ items, canApprove, reload: () => load() });

async function load() {
  try {
    const [permission, list] = await Promise.all([
      Hay.actions.canApprove.query(),
      Hay.actions.listApprovals.query(),
    ]);
    canApprove.value = permission.canApprove;
    // Pending rows come back with numeric amounts as strings from some paths.
    items.value = (list as unknown as ApprovalItem[]).map((item) => ({
      ...item,
      amount: item.amount === null ? null : Number(item.amount),
    }));
    const ids = new Set(items.value.map((item) => item.id));
    selected.value = new Set([...selected.value].filter((id) => ids.has(id)));
  } catch (error) {
    toast.error(
      t("aiActions.approvals.loadFailed"),
      error instanceof Error ? error.message : undefined,
    );
  }
}

const categoryLabel = (category: string) =>
  te(`aiActions.categories.${category}`) ? t(`aiActions.categories.${category}`) : category;

const toolLabel = (toolName: string) => toolName.split(":").pop()?.replace(/[_-]/g, " ") ?? "";

function formatAmount(amount: number, currency: string | null): string {
  try {
    return new Intl.NumberFormat(locale.value, {
      ...(currency ? { style: "currency", currency } : {}),
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return amount.toFixed(2);
  }
}

const describe = (item: ApprovalItem) =>
  `${categoryLabel(item.category)} ${item.amount !== null ? formatAmount(item.amount, item.currency) : ""}`.trim();

const selectedItems = computed(() => items.value.filter((item) => selected.value.has(item.id)));
const selectedCategory = computed(() => selectedItems.value[0]?.category ?? null);
const selectable = (item: ApprovalItem) =>
  selectedCategory.value === null || item.category === selectedCategory.value;

/** Total per currency, e.g. "R$ 40,00 + US$ 10,00"; amounts without a currency count together. */
const selectedTotal = computed(() => {
  const totals = new Map<string | null, number>();
  for (const item of selectedItems.value) {
    if (item.amount === null) continue;
    totals.set(item.currency, (totals.get(item.currency) ?? 0) + item.amount);
  }
  return [...totals.entries()]
    .map(([currency, total]) => formatAmount(total, currency))
    .join(" + ");
});
const selectedWithoutAmount = computed(
  () => selectedItems.value.filter((item) => item.amount === null).length,
);

function toggle(id: string, value: boolean) {
  const next = new Set(selected.value);
  if (value) next.add(id);
  else next.delete(id);
  selected.value = next;
}

function startEdit(item: ApprovalItem) {
  rejectingId.value = null;
  editingId.value = item.id;
  editAmount.value = item.amount ?? undefined;
}

function startReject(item: ApprovalItem) {
  editingId.value = null;
  rejectingId.value = item.id;
  rejectReason.value = "";
}

/** Mirrors the server check: above zero and never above the requested amount. */
const editValid = (item: ApprovalItem) =>
  typeof editAmount.value === "number" &&
  Number.isFinite(editAmount.value) &&
  editAmount.value > 0 &&
  item.amount !== null &&
  editAmount.value <= item.amount;

function failureDetail(error: unknown): string | undefined {
  const code = (error as { data?: { code?: string } } | null)?.data?.code;
  if (code === "PRECONDITION_FAILED") return t("aiActions.approvals.conversationClosed");
  if (code === "BAD_REQUEST") return t("aiActions.approvals.invalidAmount");
  return error instanceof Error ? error.message : undefined;
}

async function decide(item: ApprovalItem, run: () => Promise<string>) {
  busyId.value = item.id;
  try {
    toast.success(await run());
    editingId.value = null;
    rejectingId.value = null;
    await Promise.all([load(), loadSuggestion()]);
    emit("changed");
  } catch (error) {
    toast.error(t("aiActions.approvals.failed"), failureDetail(error));
  } finally {
    busyId.value = null;
  }
}

const approve = (item: ApprovalItem) =>
  decide(item, async () => {
    const lowered =
      editingId.value === item.id && editValid(item) && editAmount.value !== item.amount;
    const { action } = await Hay.actions.approve.mutate({
      id: item.id,
      ...(lowered && editAmount.value !== undefined && { amount: editAmount.value }),
    });
    return action.status === "failed"
      ? t("aiActions.approvals.approvedFailed")
      : t("aiActions.approvals.approvedDone");
  });

const reject = (item: ApprovalItem) =>
  decide(item, async () => {
    await Hay.actions.reject.mutate({ id: item.id, reason: rejectReason.value.trim() || null });
    return t("aiActions.approvals.rejected");
  });

async function approveSelected() {
  bulkBusy.value = true;
  try {
    const { results } = await Hay.actions.approveMany.mutate({
      ids: selectedItems.value.map((item) => item.id),
    });
    const done = results.filter((r) => r.status === "executed").length;
    const notDone = results.length - done;
    if (notDone === 0) toast.success(t("aiActions.approvals.bulkDone", { count: done }));
    else toast.warning(t("aiActions.approvals.bulkPartial", { done, notDone }));
    selected.value = new Set();
    await Promise.all([load(), loadSuggestion()]);
    emit("changed");
  } catch (error) {
    toast.error(t("aiActions.approvals.failed"), failureDetail(error));
  } finally {
    bulkBusy.value = false;
  }
}

// Live updates: a request opened or decided anywhere re-reads the list.
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
const scheduleRefresh = () => {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => void load(), 300);
};
const unsubscribers: Array<() => void> = [];

onMounted(async () => {
  try {
    dismissed.value = localStorage.getItem(DISMISS_KEY);
  } catch {
    dismissed.value = null;
  }
  await Promise.all([load(), loadSuggestion()]);
  for (const event of [
    "action_requested",
    "action_approved",
    "action_rejected",
    "action_executed",
    "action_expired",
  ]) {
    unsubscribers.push(websocket.on(event, scheduleRefresh));
  }
});

onUnmounted(() => {
  unsubscribers.forEach((off) => off());
  if (refreshTimer) clearTimeout(refreshTimer);
});
</script>
