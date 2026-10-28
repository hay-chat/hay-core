<template>
  <Card>
    <CardHeader>
      <CardTitle class="text-base">{{ $t("aiActions.playbook.title") }}</CardTitle>
      <CardDescription>{{ $t("aiActions.playbook.description") }}</CardDescription>
    </CardHeader>
    <CardContent class="space-y-2">
      <div v-for="category in APPROVAL_CATEGORIES" :key="category" class="min-h-9">
        <Input
          type="checkbox"
          :model-value="selected.includes(category)"
          :label="$t(`aiActions.categories.${category}`)"
          :disabled="saving"
          @update:model-value="(checked: unknown) => toggle(category, Boolean(checked))"
        />
        <p v-if="orgRequired.has(category)" class="ml-6 text-xs text-muted-foreground">
          {{ $t("aiActions.playbook.orgRequired") }}
        </p>
      </div>
    </CardContent>
  </Card>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from "vue";
import { Hay } from "@/utils/api";
import { useToast } from "@/composables/useToast";
import {
  APPROVAL_CATEGORIES,
  MONEY_CATEGORIES,
  type ApprovalCategory,
} from "@/utils/action-categories";

/**
 * Per-playbook approval override (D4-9). Tighten-only: categories ticked here
 * always wait for a person while this playbook runs; leaving one unticked
 * falls back to Settings > Actions, never loosens it.
 */
const props = defineProps<{ playbookId: string; categories: string[] }>();
const emit = defineEmits<{ saved: [categories: string[]] }>();

const { t } = useI18n();
const toast = useToast();

const selected = ref<string[]>([...props.categories]);
const saving = ref(false);
const orgRequired = ref(new Set<ApprovalCategory>());

watch(
  () => props.categories,
  (next) => (selected.value = [...next]),
);

async function toggle(category: ApprovalCategory, checked: boolean) {
  const previous = selected.value;
  const rest = previous.filter((c) => c !== category);
  selected.value = checked ? [...rest, category] : rest;
  saving.value = true;
  try {
    await Hay.playbooks.update.mutate({
      id: props.playbookId,
      data: {
        approvalCategories: selected.value.filter((c): c is ApprovalCategory =>
          (APPROVAL_CATEGORIES as readonly string[]).includes(c),
        ),
      },
    });
    emit("saved", selected.value);
    toast.success(t("aiActions.playbook.saved"));
  } catch (error) {
    selected.value = previous;
    toast.error(
      t("aiActions.playbook.saveFailed"),
      error instanceof Error ? error.message : undefined,
    );
  } finally {
    saving.value = false;
  }
}

onMounted(async () => {
  // Hint only: the org settings may be unreadable for some roles.
  try {
    const { actionApproval } = await Hay.organizations.getSettings.query();
    if (!actionApproval.moneyMovesNeedApproval) return;
    const categories = actionApproval.categories as Partial<Record<string, boolean>>;
    orgRequired.value = new Set(
      APPROVAL_CATEGORIES.filter((c) => categories?.[c] ?? MONEY_CATEGORIES.has(c)),
    );
  } catch {
    orgRequired.value = new Set();
  }
});
</script>
