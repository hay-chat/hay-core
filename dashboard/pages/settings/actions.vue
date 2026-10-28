<template>
  <Page :title="$t('aiActions.settings.title')" :description="$t('aiActions.settings.description')">
    <Loading v-if="loading" />

    <template v-else-if="form">
      <Alert v-if="!userStore.isOwner" class="mb-2">
        <AlertDescription>{{ $t("aiActions.settings.ownerOnly") }}</AlertDescription>
      </Alert>

      <!-- Approval: master switch, categories, auto-approve amount -->
      <Card>
        <CardHeader>
          <CardTitle>{{ $t("aiActions.settings.approval.title") }}</CardTitle>
          <CardDescription>{{ $t("aiActions.settings.approval.description") }}</CardDescription>
        </CardHeader>
        <CardContent class="space-y-6">
          <Input
            v-model="form.moneyMovesNeedApproval"
            type="switch"
            :label="$t('aiActions.settings.approval.master')"
            :disabled="locked(saved?.moneyMovesNeedApproval)"
            data-testid="actions-master"
          />
          <p v-if="!form.moneyMovesNeedApproval" class="text-sm text-amber-700">
            {{ $t("aiActions.settings.approval.masterOffHint") }}
          </p>

          <fieldset :disabled="!form.moneyMovesNeedApproval" class="space-y-3">
            <legend class="mb-2 text-sm font-medium">
              {{ $t("aiActions.settings.approval.categoriesLabel") }}
            </legend>
            <div
              v-for="category in CATEGORIES"
              :key="category"
              class="flex min-h-11 items-center justify-between gap-3 border-b border-border pb-2 last:border-0"
            >
              <span class="flex items-center gap-2 text-sm">
                {{ $t(`aiActions.categories.${category}`) }}
                <Badge v-if="MONEY.has(category)" variant="outline" class="text-xs">
                  {{ $t("aiActions.settings.approval.moneyBadge") }}
                </Badge>
              </span>
              <Switch
                :model-value="form.categories[category]"
                :disabled="!form.moneyMovesNeedApproval || locked(savedCategory(category))"
                :aria-label="$t(`aiActions.categories.${category}`)"
                @update:model-value="(value: boolean) => (form!.categories[category] = value)"
              />
            </div>
            <p class="text-sm text-muted-foreground">
              {{ $t("aiActions.settings.approval.unclassifiedNote") }}
            </p>
          </fieldset>

          <div class="max-w-xs">
            <Input
              v-model.number="form.thresholdAmount"
              type="number"
              min="0"
              step="0.01"
              :label="$t('aiActions.settings.threshold.label')"
              :disabled="!form.moneyMovesNeedApproval"
              data-testid="actions-threshold"
            />
          </div>
          <p class="text-sm text-muted-foreground">{{ $t("aiActions.settings.threshold.help") }}</p>
        </CardContent>
      </Card>

      <!-- Customer confirmation (D4-10) -->
      <Card>
        <CardHeader>
          <CardTitle>{{ $t("aiActions.settings.confirmation.title") }}</CardTitle>
          <CardDescription>{{ $t("aiActions.settings.confirmation.description") }}</CardDescription>
        </CardHeader>
        <CardContent class="space-y-2">
          <Input
            v-model="form.customerConfirmation"
            type="switch"
            :label="$t('aiActions.settings.confirmation.label')"
            :disabled="locked(saved?.customerConfirmation)"
          />
          <p class="text-sm text-muted-foreground">
            {{ $t("aiActions.settings.confirmation.cancelNote") }}
          </p>
        </CardContent>
      </Card>

      <!-- Approvers -->
      <Card>
        <CardHeader>
          <CardTitle>{{ $t("aiActions.settings.approvers.title") }}</CardTitle>
          <CardDescription>{{ $t("aiActions.settings.approvers.description") }}</CardDescription>
        </CardHeader>
        <CardContent class="space-y-2">
          <Input
            v-for="role in APPROVER_ROLES"
            :key="role"
            type="checkbox"
            :model-value="form.approverRoles.includes(role)"
            :label="$t(`aiActions.settings.approvers.${role}`)"
            :disabled="!userStore.isOwner"
            @update:model-value="(checked: unknown) => toggleApprover(role, Boolean(checked))"
          />
        </CardContent>
      </Card>

      <div class="flex justify-end">
        <Button :loading="saving" :disabled="!dirty" data-testid="actions-save" @click="save">
          {{ $t("aiActions.settings.save") }}
        </Button>
      </div>
    </template>

    <!-- Typed confirmation before approval is switched off for money moves -->
    <Dialog v-model:open="confirmOpen">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{{ $t("aiActions.settings.typedConfirm.title") }}</DialogTitle>
          <DialogDescription>
            {{ $t("aiActions.settings.typedConfirm.description", { list: switchedOffList }) }}
          </DialogDescription>
        </DialogHeader>
        <Input
          v-model="typedWord"
          :label="$t('aiActions.settings.typedConfirm.instruction', { word: confirmWord })"
          autocomplete="off"
          data-testid="actions-typed-confirm"
        />
        <DialogFooter>
          <Button variant="outline" :disabled="saving" @click="confirmOpen = false">
            {{ $t("common.cancel") }}
          </Button>
          <Button
            variant="destructive"
            :loading="saving"
            :disabled="typedWord.trim().toUpperCase() !== confirmWord.toUpperCase()"
            @click="persist"
          >
            {{ $t("aiActions.settings.typedConfirm.confirm") }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </Page>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { Hay } from "@/utils/api";
import { useUserStore } from "@/stores/user";
import { useToast } from "@/composables/useToast";
import {
  APPROVAL_CATEGORIES as CATEGORIES,
  MONEY_CATEGORIES as MONEY,
  type ApprovalCategory,
} from "@/utils/action-categories";

/**
 * Settings > Actions (D4-9): which AI write actions wait for a person, the
 * refund/discount auto-approve amount, the customer confirmation step (D4-10)
 * and who approves. Switching approval off for money moves needs a typed
 * confirmation; the server only lets the owner loosen any of it.
 */
const { t } = useI18n();
const userStore = useUserStore();
const toast = useToast();

const APPROVER_ROLES = ["admin", "member", "contributor"] as const;
type ApproverRole = (typeof APPROVER_ROLES)[number];

interface ActionsForm {
  moneyMovesNeedApproval: boolean;
  thresholdAmount: number;
  categories: Record<ApprovalCategory, boolean>;
  customerConfirmation: boolean;
  approverRoles: ApproverRole[];
}

const loading = ref(true);
const saving = ref(false);
const saved = ref<ActionsForm | null>(null);
const form = ref<ActionsForm | null>(null);
const confirmOpen = ref(false);
const typedWord = ref("");
const confirmWord = computed(() => t("aiActions.settings.typedConfirm.word"));

/** Non-owners may switch things on but not off (the server enforces it too). */
const locked = (savedValue: boolean | undefined) => !userStore.isOwner && savedValue === true;
const savedCategory = (category: ApprovalCategory) => saved.value?.categories[category];

function toForm(config: {
  moneyMovesNeedApproval: boolean;
  thresholdAmount: number;
  categories?: Partial<Record<string, boolean>>;
  customerConfirmation?: boolean;
  approverRoles: string[];
}): ActionsForm {
  const categories = {} as Record<ApprovalCategory, boolean>;
  for (const category of CATEGORIES) {
    categories[category] = config.categories?.[category] ?? MONEY.has(category);
  }
  return {
    moneyMovesNeedApproval: config.moneyMovesNeedApproval,
    thresholdAmount: Number(config.thresholdAmount) || 0,
    categories,
    customerConfirmation: config.customerConfirmation ?? true,
    approverRoles: config.approverRoles.filter((role): role is ApproverRole =>
      (APPROVER_ROLES as readonly string[]).includes(role),
    ),
  };
}

const dirty = computed(() => JSON.stringify(form.value) !== JSON.stringify(saved.value));

/** Money categories (or the master switch) going from "needs approval" to not. */
const switchedOff = computed<string[]>(() => {
  if (!form.value || !saved.value) return [];
  const before = saved.value;
  const after = form.value;
  const wasHeld = (c: ApprovalCategory) => before.moneyMovesNeedApproval && before.categories[c];
  const isHeld = (c: ApprovalCategory) => after.moneyMovesNeedApproval && after.categories[c];
  return CATEGORIES.filter((c) => MONEY.has(c) && wasHeld(c) && !isHeld(c));
});
const switchedOffList = computed(() =>
  switchedOff.value.map((c) => t(`aiActions.categories.${c}`)).join(", "),
);

function toggleApprover(role: ApproverRole, checked: boolean) {
  if (!form.value) return;
  const roles = form.value.approverRoles.filter((r) => r !== role);
  form.value.approverRoles = checked ? [...roles, role] : roles;
}

function save() {
  if (switchedOff.value.length > 0) {
    typedWord.value = "";
    confirmOpen.value = true;
    return;
  }
  void persist();
}

async function persist() {
  if (!form.value || !saved.value) return;
  saving.value = true;
  try {
    const before = saved.value;
    const after = form.value;
    const approverRolesChanged =
      [...before.approverRoles].sort().join() !== [...after.approverRoles].sort().join();
    const result = await Hay.organizations.updateSettings.mutate({
      actionApproval: {
        moneyMovesNeedApproval: after.moneyMovesNeedApproval,
        thresholdAmount: Math.max(0, Number(after.thresholdAmount) || 0),
        categories: after.categories,
        customerConfirmation: after.customerConfirmation,
        // Only sent when changed: changing approvers is owner-only.
        ...(approverRolesChanged && { approverRoles: after.approverRoles }),
      },
    });
    saved.value = toForm(result.data.actionApproval);
    form.value = toForm(result.data.actionApproval);
    confirmOpen.value = false;
    toast.success(t("aiActions.settings.saved"));
  } catch (error) {
    toast.error(
      t("aiActions.settings.saveFailed"),
      error instanceof Error ? error.message : undefined,
    );
  } finally {
    saving.value = false;
  }
}

onMounted(async () => {
  try {
    const settings = await Hay.organizations.getSettings.query();
    saved.value = toForm(settings.actionApproval);
    form.value = toForm(settings.actionApproval);
  } catch (error) {
    toast.error(
      t("aiActions.settings.loadFailed"),
      error instanceof Error ? error.message : undefined,
    );
  } finally {
    loading.value = false;
  }
});

useHead({ title: t("aiActions.settings.headTitle") });
</script>
