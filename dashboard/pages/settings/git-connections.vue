<template>
  <Page :title="$t('gitConnections.title')" :description="$t('gitConnections.description')">
    <template #header>
      <Button
        v-if="isConfigured"
        variant="default"
        size="sm"
        :loading="connecting"
        @click="connectGitHub"
      >
        <Github class="h-4 w-4 mr-2" />
        {{ $t("gitConnections.connectGitHub") }}
      </Button>
    </template>

    <!-- Page-level loading -->
    <Loading v-if="loading" />

    <!-- Not Configured Warning (only shown after loading completes) -->
    <Card v-else-if="!isConfigured">
      <CardContent class="py-12 text-center">
        <AlertTriangle class="h-12 w-12 text-neutral-muted mx-auto mb-4" />
        <h3 class="text-lg font-medium mb-2">{{ $t("gitConnections.notConfigured") }}</h3>
        <p class="text-sm text-neutral-muted">
          {{ $t("gitConnections.notConfiguredDescription") }}
        </p>
      </CardContent>
    </Card>

    <!-- Connections List -->
    <Card v-else>
      <CardHeader>
        <CardTitle>{{ $t("gitConnections.connections") }}</CardTitle>
        <CardDescription>{{ $t("gitConnections.connectionsDescription") }}</CardDescription>
      </CardHeader>
      <CardContent>
        <!-- Empty State -->
        <div
          v-if="connections.length === 0"
          class="text-center py-12 border-2 border-dashed border-muted rounded-lg"
        >
          <Github class="h-12 w-12 text-neutral-muted mx-auto mb-4" />
          <h3 class="text-lg font-medium mb-2">{{ $t("gitConnections.noConnections") }}</h3>
          <p class="text-sm text-neutral-muted mb-4">
            {{ $t("gitConnections.noConnectionsDescription") }}
          </p>
          <Button :loading="connecting" @click="connectGitHub">
            <Github class="h-4 w-4 mr-2" />
            {{ $t("gitConnections.connectGitHub") }}
          </Button>
        </div>

        <!-- Connection Items -->
        <div v-else class="space-y-3">
          <div
            v-for="connection in connections"
            :key="connection.id"
            class="flex items-center justify-between p-4 border rounded-lg hover:bg-background-secondary transition-colors"
          >
            <div class="flex items-center gap-4">
              <div
                class="flex items-center justify-center w-10 h-10 bg-background-tertiary rounded-lg"
              >
                <Github class="h-5 w-5" />
              </div>
              <div>
                <div class="flex items-center gap-2">
                  <h4 class="font-medium">{{ connection.accountLogin }}</h4>
                  <Badge variant="success">{{ connection.status }}</Badge>
                  <Badge variant="outline">{{
                    connection.repositorySelection === "all"
                      ? $t("gitConnections.allRepos")
                      : $t("gitConnections.selectedRepos")
                  }}</Badge>
                </div>
                <p class="text-sm text-neutral-muted">
                  {{ connection.accountType }} &middot; {{ $t("gitConnections.connectedPrefix") }}
                  {{ formatDate(connection.createdAt) }}
                </p>
              </div>
            </div>

            <div class="flex items-center gap-2">
              <Button variant="outline" size="sm" @click="openRepoDialog(connection)">
                <FolderGit2 class="h-4 w-4 mr-2" />
                {{ $t("gitConnections.browseRepos") }}
              </Button>
              <Button variant="outline" size="sm" @click="manageInstallation(connection)">
                <Settings class="h-4 w-4 mr-2" />
                {{ $t("gitConnections.manage") }}
              </Button>
              <Button variant="ghost" size="sm" @click="disconnectConnection(connection)">
                <Trash2 class="h-4 w-4 text-destructive" />
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>

    <!-- Git Plugins -->
    <Card v-if="!loading && isConfigured && gitPlugins.length > 0" class="mt-6">
      <CardHeader>
        <CardTitle>{{ $t("gitConnections.gitPlugins") }}</CardTitle>
        <CardDescription>{{ $t("gitConnections.gitPluginsDescription") }}</CardDescription>
      </CardHeader>
      <CardContent>
        <div class="space-y-3">
          <div
            v-for="plugin in gitPlugins"
            :key="plugin.id"
            class="flex items-center justify-between p-4 border rounded-lg hover:bg-background-secondary transition-colors"
          >
            <div class="flex-1">
              <div class="flex items-center gap-2 mb-1">
                <h4 class="font-medium">{{ plugin.name }}</h4>
                <Badge variant="outline">v{{ plugin.version }}</Badge>
                <Badge v-if="plugin.gitSyncError" variant="destructive">
                  {{ $t("gitConnections.syncError") }}
                </Badge>
              </div>
              <div class="flex items-center gap-4 text-sm text-neutral-muted">
                <span class="flex items-center gap-1">
                  <FolderGit2 class="h-3.5 w-3.5" />
                  {{ plugin.gitRepoFullName }}
                </span>
                <span class="flex items-center gap-1">
                  <GitBranch class="h-3.5 w-3.5" />
                  {{ plugin.gitBranch }}
                </span>
                <span v-if="plugin.gitLastCommitSha" class="font-mono text-xs">
                  {{ plugin.gitLastCommitSha?.substring(0, 7) }}
                </span>
                <span v-if="plugin.gitLastSyncAt">
                  {{ $t("gitConnections.lastSync") }}: {{ formatDate(plugin.gitLastSyncAt) }}
                </span>
              </div>
              <p v-if="plugin.gitSyncError" class="text-sm text-destructive mt-1">
                {{ plugin.gitSyncError }}
              </p>
            </div>

            <div class="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                :loading="syncingPlugins[plugin.id]"
                @click="syncPlugin(plugin)"
              >
                <RefreshCcw class="h-4 w-4 mr-2" />
                {{ $t("gitConnections.syncNow") }}
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>

    <!-- Browse Repos Dialog -->
    <Dialog v-model:open="repoDialogOpen">
      <DialogContent class="max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>{{ $t("gitConnections.repos") }}</DialogTitle>
          <DialogDescription>{{ $t("gitConnections.reposDescription") }}</DialogDescription>
        </DialogHeader>

        <Loading v-if="loadingRepos" />

        <div v-else-if="repos.length === 0" class="text-center py-8">
          <FolderGit2 class="h-10 w-10 text-neutral-muted mx-auto mb-3" />
          <p class="text-sm text-neutral-muted">{{ $t("gitConnections.noRepos") }}</p>
          <p class="text-xs text-neutral-muted mt-1">
            {{ $t("gitConnections.noReposDescription") }}
          </p>
        </div>

        <div v-else class="space-y-2 overflow-y-auto max-h-[50vh]">
          <div
            v-for="repo in repos"
            :key="repo.fullName"
            class="flex items-center justify-between p-3 border rounded-lg hover:bg-background-secondary transition-colors"
          >
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2">
                <h4 class="font-medium truncate">{{ repo.name }}</h4>
                <Badge :variant="repo.private ? 'secondary' : 'outline'" class="text-xs shrink-0">
                  {{ repo.private ? $t("gitConnections.private") : $t("gitConnections.public") }}
                </Badge>
              </div>
              <p v-if="repo.description" class="text-sm text-neutral-muted truncate">
                {{ repo.description }}
              </p>
              <p class="text-xs text-neutral-muted mt-1">
                <GitBranch class="h-3 w-3 inline" /> {{ repo.defaultBranch }}
              </p>
            </div>
            <Button
              size="sm"
              :loading="installingRepo === repo.fullName"
              :disabled="!!installingRepo"
              @click="installFromRepo(repo)"
            >
              {{ $t("gitConnections.installPlugin") }}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  </Page>
</template>

<script setup lang="ts">
import {
  Github,
  Trash2,
  FolderGit2,
  GitBranch,
  RefreshCcw,
  AlertTriangle,
  Settings,
} from "lucide-vue-next";
import { Hay } from "@/utils/api";

const { t } = useI18n();
const toast = useToast();

// State
const loading = ref(true);
const connecting = ref(false);
const isConfigured = ref(false);
const connections = ref<any[]>([]);
const gitPlugins = ref<any[]>([]);
const syncingPlugins = ref<Record<string, boolean>>({});

// Repo dialog
const repoDialogOpen = ref(false);
const loadingRepos = ref(false);
const repos = ref<any[]>([]);
const selectedConnectionId = ref("");
const installingRepo = ref("");

// Methods
const loadData = async () => {
  loading.value = true;
  try {
    const [installUrlResult, connectionsResult] = await Promise.all([
      Hay.gitConnections.getInstallUrl.query(),
      Hay.gitConnections.list.query().catch(() => []),
    ]);

    isConfigured.value = installUrlResult.configured;
    connections.value = connectionsResult;

    // Load git plugins from the main plugin list
    await loadGitPlugins();
  } catch (error) {
    console.error("Failed to load git connections:", error);
  } finally {
    loading.value = false;
  }
};

const loadGitPlugins = async () => {
  try {
    const allPlugins = await Hay.plugins.getAll.query();
    gitPlugins.value = allPlugins.filter((p: any) => p.sourceType === "git");
  } catch {
    // Plugins may fail to load if not configured
  }
};

const connectGitHub = async () => {
  connecting.value = true;
  try {
    const result = await Hay.gitConnections.getInstallUrl.query();
    if (result.url) {
      window.location.href = result.url;
    }
  } catch (error) {
    console.error("Failed to get install URL:", error);
  } finally {
    connecting.value = false;
  }
};

const manageInstallation = (connection: any) => {
  // GitHub uses different URL paths for org vs personal installations
  const base =
    connection.accountType === "Organization"
      ? `https://github.com/organizations/${connection.accountLogin}/settings/installations/${connection.installationId}`
      : `https://github.com/settings/installations/${connection.installationId}`;
  window.open(base, "_blank");
};

const disconnectConnection = async (connection: any) => {
  if (!confirm(t("gitConnections.disconnectConfirm"))) return;

  try {
    await Hay.gitConnections.remove.mutate({
      connectionId: connection.id,
      removePlugins: false,
    });
    toast.success(t("gitConnections.disconnected"));
    await loadData();
  } catch (error) {
    console.error("Failed to disconnect:", error);
  }
};

const openRepoDialog = async (connection: any) => {
  selectedConnectionId.value = connection.id;
  repoDialogOpen.value = true;
  loadingRepos.value = true;
  repos.value = [];

  try {
    repos.value = await Hay.gitConnections.listRepos.query({
      connectionId: connection.id,
    });
  } catch (error) {
    console.error("Failed to load repos:", error);
  } finally {
    loadingRepos.value = false;
  }
};

const installFromRepo = async (repo: any) => {
  installingRepo.value = repo.fullName;
  try {
    await Hay.gitConnections.installPlugin.mutate({
      connectionId: selectedConnectionId.value,
      repoFullName: repo.fullName,
    });
    toast.success(t("gitConnections.installSuccess"));
    repoDialogOpen.value = false;
    await loadGitPlugins();
  } catch (error) {
    const message = error instanceof Error ? error.message : t("gitConnections.installFailed");
    toast.error(message);
  } finally {
    installingRepo.value = "";
  }
};

const syncPlugin = async (plugin: any) => {
  syncingPlugins.value[plugin.id] = true;
  try {
    const result = await Hay.gitConnections.syncPlugin.mutate({
      pluginId: plugin.id,
    });
    if (result.updated) {
      toast.success(t("gitConnections.syncSuccess"));
    } else {
      toast.success(t("gitConnections.upToDate"));
    }
    await loadGitPlugins();
  } catch (error) {
    const message = error instanceof Error ? error.message : t("gitConnections.syncFailed");
    toast.error(message);
  } finally {
    syncingPlugins.value[plugin.id] = false;
  }
};

const formatDate = (date: Date | string) => {
  const d = new Date(date);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (days === 0) return t("gitConnections.dateToday");
  if (days === 1) return t("gitConnections.dateYesterday");
  if (days < 7) return t("gitConnections.dateDaysAgo", { days });
  if (days < 30) return t("gitConnections.dateWeeksAgo", { weeks: Math.floor(days / 7) });
  return d.toLocaleDateString();
};

// Handle GitHub callback redirect — complete the installation via authenticated tRPC call
const route = useRoute();
const router = useRouter();

const completeGitHubInstallation = async () => {
  const installationId = route.query.installation_id as string;
  if (!installationId) return;

  try {
    const result = await Hay.gitConnections.completeInstallation.mutate({
      installationId,
    });
    toast.success(t("gitConnections.connectedTo", { accountLogin: result.accountLogin }));
  } catch (error) {
    const message = error instanceof Error ? error.message : t("gitConnections.completionFailed");
    toast.error(message);
  }

  // Clean up URL params
  router.replace({ path: route.path });
};

// Lifecycle
onMounted(async () => {
  if (route.query.installation_id) {
    await completeGitHubInstallation();
  }
  await loadData();
});

definePageMeta({ layout: "default" });
useHead({
  title: t("gitConnections.headTitle"),
  meta: [{ name: "description", content: t("gitConnections.headDescription") }],
});
</script>
