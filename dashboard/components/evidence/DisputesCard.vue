<template>
  <Card v-if="disputes.length > 0" data-testid="disputes-card">
    <CardHeader>
      <CardTitle class="text-base">{{ $t("evidence.disputes.title") }}</CardTitle>
      <CardDescription>{{ $t("evidence.disputes.description") }}</CardDescription>
    </CardHeader>
    <CardContent>
      <ul class="divide-y divide-border">
        <li
          v-for="dispute in disputes"
          :key="dispute.id"
          class="flex flex-col gap-3 py-3 md:flex-row md:items-center md:gap-4"
          :class="{ 'rounded-md bg-muted/50 px-2': dispute.id === highlightId }"
          data-testid="dispute-row"
        >
          <div class="min-w-0 flex-1 space-y-1">
            <p class="flex flex-wrap items-center gap-2 font-medium">
              <span>
                {{
                  dispute.orderLabel
                    ? $t("evidence.disputes.order", { order: dispute.orderLabel })
                    : $t("evidence.disputes.noOrderLabel")
                }}
              </span>
              <Badge :variant="statusVariant(dispute)">
                {{ $t(`evidence.disputes.status.${dispute.status}`) }}
              </Badge>
              <Badge v-if="dispute.evidenceStatus === 'drafted'" variant="success">
                {{ $t("evidence.disputes.drafted") }}
              </Badge>
            </p>
            <p class="text-xs text-muted-foreground">
              {{ dispute.platform }}
              <template v-if="dispute.amount">
                · {{ dispute.amount }} {{ dispute.currency ?? "" }}
              </template>
              <template v-if="dispute.reason"> · {{ reasonLabel(dispute.reason) }} </template>
              <template v-if="dispute.evidenceDueBy && dispute.status === 'needs_response'">
                · {{ $t("evidence.disputes.dueBy", { at: formatDateTime(dispute.evidenceDueBy) }) }}
              </template>
            </p>
            <p
              v-if="dispute.status === 'needs_response' && !dispute.orderKey"
              class="text-xs text-muted-foreground"
            >
              {{ $t("evidence.disputes.noOrder") }}
            </p>
            <p
              v-if="dispute.evidenceStatus === 'failed' && dispute.evidenceError"
              class="text-xs text-destructive"
            >
              {{ errorText(dispute.evidenceError) }}
            </p>
          </div>
          <div class="flex flex-wrap gap-2">
            <Button
              v-if="dispute.orderKey"
              variant="outline"
              size="sm"
              @click="emit('select-order', dispute.orderKey, dispute.orderPluginId)"
            >
              {{ $t("evidence.disputes.download") }}
            </Button>
            <Button
              v-if="dispute.status === 'needs_response' && dispute.orderKey"
              size="sm"
              data-testid="dispute-attach"
              @click="openConfirm(dispute)"
            >
              <Paperclip class="mr-2 h-4 w-4" />
              {{
                dispute.evidenceStatus === "drafted"
                  ? $t("evidence.disputes.attachAgain")
                  : $t("evidence.disputes.attach")
              }}
            </Button>
            <Button
              v-if="dispute.providerUrl"
              variant="ghost"
              size="sm"
              as="a"
              :href="dispute.providerUrl"
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink class="mr-2 h-4 w-4" />
              {{ $t("evidence.disputes.open", { platform: dispute.platform }) }}
            </Button>
          </div>
        </li>
      </ul>
    </CardContent>

    <ConfirmDialog
      :open="confirming !== null"
      :title="$t('evidence.disputes.confirmTitle')"
      :description="
        $t('evidence.disputes.confirmDescription', { platform: confirmPlatform })
      "
      :confirm-text="$t('evidence.disputes.confirm')"
      :loading="attaching"
      @update:open="(open) => !open && (confirming = null)"
      @confirm="attach"
    />
  </Card>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { ExternalLink, Paperclip } from "lucide-vue-next";
import { Hay } from "@/utils/api";
import { useToast } from "@/composables/useToast";
import type { RouterOutputs } from "@/types/trpc";

/**
 * Payment disputes reported by connected payment platforms (D2-7 / D2-8).
 * "Attach as draft" puts the evidence pack on the dispute without submitting;
 * the merchant reviews and submits on the platform.
 */
type Dispute = RouterOutputs["disputes"]["list"]["disputes"][number];

const props = defineProps<{ highlightId?: string | null }>();
const emit = defineEmits<{ "select-order": [orderKey: string, pluginId: string | null] }>();

const { t, te } = useI18n();
const toast = useToast();
const { formatDateTime } = useOrgDateTime();

const disputes = ref<Dispute[]>([]);
const confirming = ref<Dispute | null>(null);
// Kept after closing so the description does not go blank while the dialog fades out.
const confirmPlatform = ref("");
const openConfirm = (dispute: Dispute) => {
  confirmPlatform.value = dispute.platform ?? "";
  confirming.value = dispute;
};
const attaching = ref(false);
const highlightId = props.highlightId;

const ERROR_CODES = [
  "NOT_EDITABLE",
  "SLOT_TAKEN",
  "SCOPE_MISSING",
  "NOT_FOUND",
  "NOT_CONNECTED",
  "PROVIDER_ERROR",
  "NO_ORDER",
  "NO_CONVERSATIONS",
  "TOO_LARGE",
];

const statusVariant = (dispute: Dispute) => {
  if (dispute.status === "needs_response") return "warning" as const;
  if (dispute.status === "won") return "success" as const;
  if (dispute.status === "lost") return "destructive" as const;
  return "secondary" as const;
};

const reasonLabel = (reason: string) =>
  te(`evidence.disputes.reasons.${reason}`) ? t(`evidence.disputes.reasons.${reason}`) : reason;

const errorText = (code: string) =>
  t(`evidence.disputes.errors.${ERROR_CODES.includes(code) ? code : "PROVIDER_ERROR"}`);

async function load() {
  try {
    const result = await Hay.disputes.list.query();
    disputes.value = result.disputes;
  } catch {
    // The rest of the page works without the dispute list.
    disputes.value = [];
  }
}

async function attach() {
  const dispute = confirming.value;
  if (!dispute) return;
  attaching.value = true;
  try {
    const result = await Hay.disputes.attachEvidence.mutate({ disputeId: dispute.id });
    if (result.ok) {
      toast.success(
        t("evidence.disputes.attached", { platform: dispute.platform }),
        t("evidence.disputes.attachedHelp", { platform: dispute.platform }),
      );
    } else {
      toast.error(t("common.error"), errorText(result.code));
    }
    await load();
  } catch {
    toast.error(t("common.error"), t("evidence.disputes.errors.PROVIDER_ERROR"));
  } finally {
    attaching.value = false;
    confirming.value = null;
  }
}

onMounted(load);
</script>
