<template>
  <div v-if="!decided" class="mt-2 rounded-md border border-dashed p-3 text-sm space-y-2">
    <p class="font-medium">{{ t("conversations.pendingAction.title") }}</p>
    <p class="text-muted-foreground">{{ t("conversations.pendingAction.description") }}</p>

    <div v-if="rejecting" class="space-y-2">
      <Input
        v-model="reason"
        :label="t('conversations.pendingAction.reasonLabel')"
        :placeholder="t('conversations.pendingAction.reasonPlaceholder')"
      />
      <div class="flex flex-wrap gap-2">
        <Button size="sm" variant="destructive" :loading="busy === 'reject'" @click="reject">
          {{ t("conversations.pendingAction.confirmReject") }}
        </Button>
        <Button size="sm" variant="ghost" :disabled="!!busy" @click="rejecting = false">
          {{ t("common.cancel") }}
        </Button>
      </div>
    </div>

    <div v-else class="flex flex-wrap gap-2">
      <Button size="sm" :loading="busy === 'approve'" :disabled="!!busy" @click="approve">
        {{ t("conversations.pendingAction.approve") }}
      </Button>
      <Button size="sm" variant="outline" :disabled="!!busy" @click="rejecting = true">
        {{ t("conversations.pendingAction.reject") }}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        :loading="busy === 'reply'"
        :disabled="!!busy"
        @click="replyMyself"
      >
        {{ t("conversations.pendingAction.replyMyself") }}
      </Button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { HayApi } from "@/utils/api";
import { useToast } from "@/composables/useToast";

/**
 * Approve / reject / "I'll reply myself" for an AI action held for approval
 * (D4-5). Shown under the TOOL message while it is PENDING_APPROVAL.
 */
const props = defineProps<{ pendingActionId: string; conversationId?: string }>();

const { t } = useI18n();
const toast = useToast();

const decided = ref(false);
const rejecting = ref(false);
const reason = ref("");
const busy = ref<"approve" | "reject" | "reply" | null>(null);

async function decide(kind: "approve" | "reject" | "reply", run: () => Promise<unknown>) {
  busy.value = kind;
  try {
    await run();
    decided.value = true;
    toast.success(t(`conversations.pendingAction.done.${kind}`));
  } catch (error) {
    toast.error(
      t("conversations.pendingAction.failed"),
      error instanceof Error ? error.message : undefined,
    );
  } finally {
    busy.value = null;
  }
}

const approve = () =>
  decide("approve", () => HayApi.actions.approve.mutate({ id: props.pendingActionId }));

const reject = () =>
  decide("reject", () =>
    HayApi.actions.reject.mutate({ id: props.pendingActionId, reason: reason.value || null }),
  );

const replyMyself = () =>
  decide("reply", async () => {
    await HayApi.actions.replyMyself.mutate({ id: props.pendingActionId });
    if (props.conversationId) {
      await HayApi.conversations.takeover.mutate({ conversationId: props.conversationId });
    }
  });
</script>
