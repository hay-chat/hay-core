<template>
  <!-- Everything the workspace keeps, as one ZIP (D15-6). Owners and admins only. -->
  <Card>
    <CardHeader>
      <CardTitle>{{ $t("workspaceExport.title") }}</CardTitle>
      <CardDescription>{{ $t("workspaceExport.description") }}</CardDescription>
    </CardHeader>
    <CardContent class="space-y-4">
      <p class="text-sm text-muted-foreground">{{ $t("workspaceExport.includes") }}</p>

      <p v-if="state?.status === 'queued' || state?.status === 'processing'" class="text-sm">
        {{ $t("workspaceExport.preparing") }}
      </p>
      <p v-else-if="state?.status === 'completed' && state.expiresAt" class="text-sm">
        {{
          $t("workspaceExport.ready", {
            date: formatDateTime(state.completedAt ?? state.requestedAt),
            size: formatSize(state.bytes ?? 0),
            expires: formatDate(state.expiresAt),
          })
        }}
      </p>
      <p v-else-if="state?.status === 'failed'" class="text-sm text-destructive">
        {{ $t("workspaceExport.failed") }}
      </p>
      <p v-else-if="state?.status === 'expired'" class="text-sm text-muted-foreground">
        {{ $t("workspaceExport.expired") }}
      </p>

      <div class="flex flex-wrap gap-2">
        <Button v-if="state?.status === 'completed'" :loading="downloading" @click="download">
          <Download class="h-4 w-4 mr-2" />
          {{ $t("workspaceExport.download") }}
        </Button>
        <Button
          :variant="state?.status === 'completed' ? 'outline' : 'default'"
          :loading="requesting || isRunning"
          @click="requestExport"
        >
          {{
            state?.status === "completed"
              ? $t("workspaceExport.requestAgain")
              : $t("workspaceExport.request")
          }}
        </Button>
      </div>
    </CardContent>
  </Card>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { Download } from "lucide-vue-next";
import { Hay } from "@/utils/api";
import { useToast } from "@/composables/useToast";

type ExportState = Awaited<ReturnType<typeof Hay.organizationExport.status.query>>;

const { t } = useI18n();
const toast = useToast();
const { formatDate, formatDateTime } = useOrgDateTime();

const state = ref<ExportState>(null);
const requesting = ref(false);
const downloading = ref(false);
const isRunning = computed(
  () => state.value?.status === "queued" || state.value?.status === "processing",
);

let poll: ReturnType<typeof setTimeout> | null = null;

async function load() {
  try {
    state.value = await Hay.organizationExport.status.query();
  } catch (error) {
    console.error("Failed to load export status:", error);
  }
  if (poll) clearTimeout(poll);
  if (isRunning.value) poll = setTimeout(load, 5000);
}

async function requestExport() {
  requesting.value = true;
  try {
    await Hay.organizationExport.request.mutate();
    toast.success(t("workspaceExport.requested"));
    await load();
  } catch (error) {
    console.error("Failed to request export:", error);
    toast.error(t("workspaceExport.requestFailed"));
  } finally {
    requesting.value = false;
  }
}

async function download() {
  downloading.value = true;
  try {
    const link = await Hay.organizationExport.downloadLink.mutate();
    window.location.href = link.url;
  } catch (error) {
    console.error("Failed to get the download link:", error);
    toast.error(t("workspaceExport.downloadFailed"));
    await load();
  } finally {
    downloading.value = false;
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

onMounted(load);
onUnmounted(() => {
  if (poll) clearTimeout(poll);
});
</script>
