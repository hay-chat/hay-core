<template>
  <Sheet :open="open" side="right" size="lg" @update:open="$emit('update:open', $event)">
    <SheetHeader @close="$emit('update:open', false)">
      <SheetTitle>{{ t("versioning.history.title") }}</SheetTitle>
      <SheetDescription>{{ t("versioning.history.description") }}</SheetDescription>
    </SheetHeader>

    <SheetContent>
      <div v-if="loading" class="flex items-center justify-center py-12">
        <Loading />
      </div>

      <div v-else-if="versions.length === 0" class="text-center py-12 text-neutral-muted">
        {{ t("versioning.history.empty") }}
      </div>

      <div v-else class="space-y-3">
        <div
          v-for="version in versions"
          :key="version.id"
          class="border rounded-lg p-4 space-y-2 transition-colors"
          :class="{
            'border-primary/50 bg-primary/5': version.status === 'active',
            'border-amber-300/50 bg-amber-50/50': version.status === 'draft',
          }"
        >
          <!-- Version header -->
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="font-medium text-sm"> v{{ version.version_number }} </span>
              <Badge
                :variant="
                  version.status === 'active'
                    ? 'success'
                    : version.status === 'draft'
                      ? 'warning'
                      : 'secondary'
                "
              >
                {{ t(`versioning.history.status.${version.status}`) }}
              </Badge>
            </div>

            <!-- Rollback button (only for archived versions) -->
            <Button
              v-if="version.status === 'archived'"
              variant="outline"
              size="sm"
              @click="handleRollbackClick(version)"
            >
              <RotateCcw class="h-3 w-3 mr-1.5" />
              {{ t("versioning.history.rollback") }}
            </Button>
          </div>

          <!-- Author & timestamp -->
          <div class="text-xs text-neutral-muted space-y-0.5">
            <div v-if="version.created_by" class="flex items-center gap-1">
              <User2 class="h-3 w-3" />
              <span>{{ getAuthorName(version.created_by) }}</span>
            </div>
            <div class="flex items-center gap-1">
              <Clock class="h-3 w-3" />
              <span>{{
                formatDateTime(
                  version.status === "active" && version.published_at
                    ? version.published_at
                    : version.created_at,
                )
              }}</span>
            </div>
          </div>

          <!-- Publish note -->
          <div
            v-if="version.publish_note"
            class="text-xs text-neutral-muted italic border-l-2 border-neutral-200 pl-2"
          >
            {{ version.publish_note }}
          </div>
        </div>
      </div>
    </SheetContent>
  </Sheet>

  <!-- Rollback Confirmation Dialog -->
  <ConfirmDialog
    v-model:open="showRollbackDialog"
    :title="t('versioning.history.rollbackTitle')"
    :description="
      t('versioning.history.rollbackDescription', {
        version: rollbackTarget?.version_number,
      })
    "
    :confirm-text="t('versioning.history.rollbackConfirm')"
    :loading="isRestoring"
    @confirm="confirmRollback"
  >
    <div class="mt-4">
      <Input
        v-model="rollbackReason"
        :label="t('versioning.history.rollbackReasonLabel')"
        type="textarea"
        :rows="2"
        :placeholder="t('versioning.history.rollbackReasonPlaceholder')"
        :disabled="isRestoring"
      />
    </div>
  </ConfirmDialog>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { RotateCcw, User2, Clock } from "lucide-vue-next";
import type { PlaybookVersion } from "~/types/playbook";
import { useToast } from "~/composables/useToast";
import { HayApi } from "@/utils/api";

const props = defineProps<{
  open: boolean;
  playbookId: string;
}>();

const emit = defineEmits<{
  "update:open": [value: boolean];
  rollback: [];
}>();

const { t } = useI18n();
const toast = useToast();
const { formatDateTime } = useOrgDateTime();

const loading = ref(false);
const versions = ref<PlaybookVersion[]>([]);

// Rollback state
const showRollbackDialog = ref(false);
const rollbackTarget = ref<PlaybookVersion | null>(null);
const rollbackReason = ref("");

const getAuthorName = (user: { firstName?: string; lastName?: string; email: string }) => {
  if (user.firstName || user.lastName) {
    return [user.firstName, user.lastName].filter(Boolean).join(" ");
  }
  return user.email;
};

const fetchVersions = async () => {
  loading.value = true;
  try {
    versions.value = await HayApi.playbooks.versions.list.query({
      playbookId: props.playbookId,
    });
  } catch (error) {
    console.error("Failed to load versions:", error);
    toast.error(t("versioning.history.loadFailed"));
  } finally {
    loading.value = false;
  }
};

// Fetch versions when sheet opens
watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      fetchVersions();
    }
  },
);

const handleRollbackClick = (version: PlaybookVersion) => {
  rollbackTarget.value = version;
  rollbackReason.value = "";
  showRollbackDialog.value = true;
};

const isRestoring = ref(false);

const confirmRollback = async () => {
  if (!rollbackTarget.value) return;

  try {
    isRestoring.value = true;

    await HayApi.playbooks.versions.rollback.mutate({
      playbookId: props.playbookId,
      versionId: rollbackTarget.value.id,
      reason: rollbackReason.value || undefined,
    });

    toast.success(t("versioning.history.rollbackSuccess"));
    showRollbackDialog.value = false;
    emit("update:open", false);
    emit("rollback");
  } catch (error) {
    console.error("Failed to rollback:", error);
    toast.error(t("versioning.history.rollbackFailed"));
  } finally {
    isRestoring.value = false;
  }
};
</script>
