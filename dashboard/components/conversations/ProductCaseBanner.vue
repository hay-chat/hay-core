<template>
  <!-- A complete product-problem case (D8-14) and whether it was emailed to the store (D8-15). -->
  <div class="border-b bg-emerald-50 px-4 py-3" data-testid="product-case-banner">
    <div class="flex items-start gap-3">
      <ClipboardCheck class="h-5 w-5 flex-shrink-0 text-emerald-700 mt-0.5" />
      <div class="flex-1 min-w-0 space-y-1">
        <p class="text-sm font-medium text-emerald-900">
          {{ t("conversations.productCase.title") }}
          <span v-if="productCase.product" class="font-normal">· {{ productCase.product }}</span>
        </p>
        <p v-if="productCase.summary" class="text-sm text-emerald-900/80">
          {{ productCase.summary }}
        </p>
        <p class="text-xs text-emerald-900/70">
          {{ t("conversations.productCase.lot", { lot: productCase.evidence.lotNumber }) }}
          <template v-if="productCase.evidence.invoiceNumber">
            ·
            {{
              t("conversations.productCase.invoice", {
                invoice: productCase.evidence.invoiceNumber,
              })
            }}
          </template>
          · {{ forwardText }}
        </p>
      </div>
      <Button
        v-if="productCase.forward?.status !== 'not_configured'"
        size="sm"
        variant="outline"
        :loading="forwarding"
        @click="forwardAgain"
      >
        {{ t("conversations.productCase.forwardAgain") }}
      </Button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { ClipboardCheck } from "lucide-vue-next";
import { HayApi } from "@/utils/api";
import { useToast } from "@/composables/useToast";

export interface ProductCaseForward {
  status: "sent" | "failed" | "not_configured";
  to?: string;
  at: string;
}

export interface ProductCase {
  status: "complete";
  completedAt: string;
  summary: string;
  product: string | null;
  evidence: { lotNumber: string; invoiceNumber: string | null };
  forward?: ProductCaseForward;
}

const props = defineProps<{ conversationId: string; productCase: ProductCase }>();
const emit = defineEmits<{ forwarded: [forward: ProductCaseForward] }>();

const { t } = useI18n();
const toast = useToast();
const forwarding = ref(false);

const forwardText = computed(() => {
  const forward = props.productCase.forward;
  if (!forward) return t("conversations.productCase.forwardPending");
  if (forward.status === "sent")
    return t("conversations.productCase.forwardSent", { to: forward.to });
  if (forward.status === "failed") return t("conversations.productCase.forwardFailed");
  return t("conversations.productCase.forwardNotConfigured");
});

async function forwardAgain() {
  forwarding.value = true;
  try {
    const forward = await HayApi.conversations.forwardProductCase.mutate({
      conversationId: props.conversationId,
    });
    emit("forwarded", forward);
    if (forward.status === "sent") toast.success(t("conversations.productCase.forwardSentToast"));
    else toast.error(t("conversations.productCase.forwardFailed"));
  } catch (error) {
    console.error("Failed to forward the product case:", error);
    toast.error(t("conversations.productCase.forwardFailed"));
  } finally {
    forwarding.value = false;
  }
}
</script>
