<template>
  <!-- Held as spam (D9-6 / D9-7): the AI stays quiet and it never bills. -->
  <div class="border-b bg-amber-50 px-4 py-3" data-testid="spam-banner">
    <div class="flex flex-col gap-3 sm:flex-row sm:items-start">
      <ShieldAlert class="mt-0.5 hidden h-5 w-5 flex-shrink-0 text-amber-700 sm:block" />
      <div class="min-w-0 flex-1 space-y-1">
        <p class="text-sm font-medium text-amber-900">{{ t("home.spam.banner.title") }}</p>
        <p class="text-sm text-amber-900/80">{{ t("home.spam.banner.description") }}</p>
        <div class="flex flex-wrap gap-1 pt-1">
          <Badge v-for="key in reasonKeys" :key="key" variant="outline">{{ t(key) }}</Badge>
        </div>
        <p v-if="classifierReason" class="text-xs text-amber-900/70">
          {{ t("home.spam.classifier", { reason: classifierReason }) }}
        </p>
      </div>
      <Button size="sm" variant="outline" :loading="clearing" @click="notSpam">
        {{ t("home.spam.notSpam") }}
      </Button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { ShieldAlert } from "lucide-vue-next";
import { Hay } from "@/utils/api";
import { useToast } from "@/composables/useToast";
import { spamReasonKeys, spamSourceOf } from "@/utils/spam";

const props = defineProps<{
  conversationId: string;
  spamReason: string | null;
  metadata: Record<string, unknown> | null | undefined;
}>();
const emit = defineEmits<{ cleared: [] }>();

const { t } = useI18n();
const toast = useToast();
const clearing = ref(false);

const spamCheck = computed(
  () =>
    (props.metadata?.spamCheck ?? null) as {
      signals?: string[];
      classifier?: { reason?: string };
    } | null,
);
const reasonKeys = computed(() => {
  const source = spamSourceOf(props.spamReason);
  return spamReasonKeys(source, source === "detector" ? (spamCheck.value?.signals ?? []) : []);
});
const classifierReason = computed(() => spamCheck.value?.classifier?.reason || null);

async function notSpam() {
  clearing.value = true;
  try {
    const { reengaged } = await Hay.conversations.notSpam.mutate({
      conversationId: props.conversationId,
    });
    toast.success(reengaged ? t("home.spam.notSpamReengaged") : t("home.spam.notSpamDone"));
    emit("cleared");
  } catch {
    toast.error(t("home.spam.actionFailed"));
  } finally {
    clearing.value = false;
  }
}
</script>
