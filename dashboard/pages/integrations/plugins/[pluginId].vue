<template>
  <Page width="max">
    <div>
      <Button variant="ghost" size="sm" @click="router.push('/integrations/marketplace')">
        <ArrowLeft class="h-4 w-4 mr-2" />
        {{ $t("pluginSettings.backToMarketplace") }}
      </Button>
    </div>

    <ConfirmDialog
      v-model:open="showDisableConfirm"
      :title="$t('pluginSettings.disableConfirm.title')"
      :description="$t('pluginSettings.disableConfirm.description', { name: displayName })"
      :confirm-text="$t('pluginSettings.disableConfirm.confirm')"
      destructive
      @confirm="handleDisablePlugin"
    />

    <!-- Loading State -->
    <div v-if="loading" class="space-y-4" aria-busy="true">
      <div class="flex items-center gap-4">
        <div class="h-12 w-12 rounded-lg bg-muted animate-pulse"></div>
        <div class="flex-1 space-y-2">
          <div class="h-5 w-1/3 rounded bg-muted animate-pulse"></div>
          <div class="h-4 w-2/3 rounded bg-muted animate-pulse"></div>
        </div>
      </div>
      <div class="h-40 rounded-lg bg-muted animate-pulse"></div>
    </div>

    <!-- Error State -->
    <div v-else-if="error" class="text-center py-12">
      <AlertCircle class="h-12 w-12 text-destructive mx-auto mb-4" />
      <h3 class="text-lg font-medium mb-2">{{ $t("pluginSettings.error.loadFailed") }}</h3>
      <p class="text-neutral-muted mb-4">{{ error }}</p>
      <Button @click="router.push('/integrations/marketplace')">
        {{ $t("pluginSettings.error.returnToMarketplace") }}
      </Button>
    </div>

    <div v-else-if="plugin" class="space-y-6">
      <!-- Status header: identity, status, one primary action, ⋯ menu -->
      <header class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div class="flex items-start gap-4 min-w-0">
          <div class="w-12 h-12 min-w-12 rounded-lg overflow-hidden bg-background-tertiary">
            <img
              v-if="!thumbnailFailed"
              :src="getPluginThumbnail(plugin.id)"
              alt=""
              class="w-full h-full object-cover"
              @error="thumbnailFailed = true"
            />
            <div
              v-else
              :class="[
                'w-full h-full flex items-center justify-center',
                getPluginIconBg(plugin.type),
              ]"
            >
              <component :is="getPluginIcon(plugin.type)" class="h-6 w-6 text-white" />
            </div>
          </div>
          <div class="min-w-0 space-y-1">
            <div class="flex flex-wrap items-center gap-2">
              <h1 class="text-xl font-semibold leading-tight">{{ displayName }}</h1>
              <Badge :variant="statusBadge.variant" data-testid="plugin-status">
                <span
                  :class="['mr-1.5 inline-block h-1.5 w-1.5 rounded-full', statusBadge.dot]"
                  aria-hidden="true"
                ></span>
                {{ $t(`pluginSettings.status.${setupState}`) }}
              </Badge>
            </div>
            <p v-if="pluginDescription" class="text-sm text-neutral-muted max-w-prose">
              {{ pluginDescription }}
            </p>
            <p v-if="reportedStatus?.account" class="text-sm" data-testid="plugin-account">
              {{ $t("pluginSettings.oauth.connectedAs", { account: reportedStatus.account }) }}
            </p>
          </div>
        </div>

        <div class="flex items-center gap-2 sm:shrink-0">
          <Button
            v-if="setupState === 'not_set_up'"
            class="flex-1 sm:flex-none"
            :loading="enabling"
            data-testid="plugin-connect"
            @click="handleConnect"
          >
            {{ $t("pluginSettings.actions.connect") }}
          </Button>
          <Button
            v-else-if="setupState === 'needs_action' || setupState === 'error'"
            class="flex-1 sm:flex-none"
            :variant="setupState === 'error' ? 'outline' : 'default'"
            @click="openSetup"
          >
            {{
              setupState === "error"
                ? $t("pluginSettings.actions.reviewSetup")
                : $t("pluginSettings.actions.finishSetup")
            }}
          </Button>

          <!-- DropdownMenu's root is w-full; the wrapper keeps it to the icon's width. -->
          <div v-if="enabled" class="shrink-0">
            <DropdownMenu>
              <DropdownMenuTrigger as-child>
                <Button
                  variant="outline"
                  size="icon"
                  :aria-label="$t('pluginSettings.actions.more')"
                  data-testid="plugin-more-menu"
                >
                  <MoreHorizontal class="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem data-testid="advanced-mode-toggle" @click="toggleAdvancedMode">
                  <Check v-if="advancedMode" class="h-4 w-4 mr-2" />
                  <span v-else class="w-4 mr-2" aria-hidden="true"></span>
                  {{ $t("pluginSettings.actions.advancedMode") }}
                </DropdownMenuItem>
                <template v-if="advancedMode">
                  <DropdownMenuItem :disabled="restarting" @click="handleRestartPlugin">
                    <RotateCw class="h-4 w-4 mr-2" />
                    {{
                      restarting
                        ? $t("pluginSettings.restarting")
                        : $t("pluginSettings.restartWorker")
                    }}
                  </DropdownMenuItem>
                  <DropdownMenuLabel>
                    {{ $t("pluginSettings.actions.version", { version: plugin.version }) }}
                  </DropdownMenuLabel>
                </template>
                <DropdownMenuSeparator />
                <DropdownMenuItem class="text-destructive" @click="showDisableConfirm = true">
                  <Power class="h-4 w-4 mr-2" />
                  {{ $t("pluginSettings.disablePlugin") }}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <!-- Channel health (D13-11): generic "channel failing" signal -->
      <Alert
        v-if="plugin.channelHealth?.status === 'failing'"
        variant="danger"
        :icon="AlertTriangle"
        data-testid="channel-health-alert"
      >
        <AlertTitle>{{ $t("pluginSettings.channelHealth.failingTitle") }}</AlertTitle>
        <AlertDescription>
          <p>
            {{
              $t(
                `pluginSettings.channelHealth.reasons.${plugin.channelHealth.reason ?? "delivery_failures"}`,
                { detail: plugin.channelHealth.detail ?? "" },
              )
            }}
          </p>
          <p class="text-xs mt-1">
            {{
              $t("pluginSettings.channelHealth.since", {
                time: new Date(plugin.channelHealth.since).toLocaleString(locale),
              })
            }}
            · {{ $t("pluginSettings.channelHealth.alerted") }}
          </p>
        </AlertDescription>
      </Alert>

      <!-- Not connected yet: a plugin's own pre-connect UI -->
      <template v-if="!enabled">
        <Card v-for="ext in beforeSettingsExtensions" :key="ext.id">
          <CardContent>
            <PluginPageSlot
              :plugin-id="plugin.id"
              :plugin-path="plugin.pluginPath"
              :component-name="ext.componentName"
              :plugin="plugin"
              :config="slotConfig"
              :api-base-url="apiBaseUrl"
            />
          </CardContent>
        </Card>
      </template>

      <!-- Tabs: Setup | What it can do | Advanced (Advanced mode only) -->
      <div
        v-if="enabled"
        role="tablist"
        :aria-label="$t('pluginSettings.tabs.label')"
        :class="[
          'grid gap-1 rounded-lg bg-muted p-1',
          tabs.length === 3 ? 'grid-cols-3' : 'grid-cols-2',
          'sm:flex sm:gap-0 sm:rounded-none sm:bg-transparent sm:p-0 sm:border-b',
        ]"
        @keydown="onTabKeydown"
      >
        <button
          v-for="tab in tabs"
          :id="`plugin-tab-${tab}`"
          :key="tab"
          type="button"
          role="tab"
          :aria-selected="activeTab === tab"
          :aria-controls="`plugin-panel-${tab}`"
          :tabindex="activeTab === tab ? 0 : -1"
          :data-testid="`plugin-tab-${tab}`"
          :class="[
            'whitespace-nowrap rounded-md px-2 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
            'sm:-mb-px sm:rounded-none sm:border-b-2 sm:px-4 sm:py-2',
            activeTab === tab
              ? 'bg-background text-foreground shadow-sm sm:bg-transparent sm:shadow-none sm:border-primary sm:text-primary'
              : 'text-neutral-muted hover:text-foreground sm:border-transparent',
          ]"
          @click="activeTab = tab"
        >
          {{ $t(`pluginSettings.tabs.${tab}`) }}
        </button>
      </div>

      <!-- Setup -->
      <section
        v-if="enabled && activeTab === 'setup'"
        id="plugin-panel-setup"
        ref="setupPanel"
        role="tabpanel"
        aria-labelledby="plugin-tab-setup"
        class="space-y-4"
      >
        <Card v-for="ext in checklistExtras.before" :key="ext.id">
          <CardContent>
            <PluginPageSlot
              :plugin-id="plugin.id"
              :plugin-path="plugin.pluginPath"
              :component-name="ext.componentName"
              :plugin="plugin"
              :config="slotConfig"
              :api-base-url="apiBaseUrl"
              @update:config="onSlotConfig"
            />
          </CardContent>
        </Card>

        <!-- The setup checklist: declared by the plugin (register.setup) or core's standard steps -->
        <ol :aria-label="$t('pluginSettings.setup.stepsLabel')" data-testid="setup-checklist">
          <li
            v-for="(step, index) in checklistSteps"
            :key="step.id"
            class="flex gap-3 sm:gap-4"
            :data-testid="`setup-step-${step.id}`"
          >
            <div class="flex flex-col items-center">
              <span
                :class="[
                  'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-medium',
                  step.done
                    ? 'bg-primary text-primary-foreground'
                    : 'border border-border bg-background text-neutral-muted',
                ]"
              >
                <Check v-if="step.done" class="h-4 w-4" aria-hidden="true" />
                <span v-else aria-hidden="true">{{ index + 1 }}</span>
                <span v-if="step.done" class="sr-only">{{
                  $t("pluginSettings.setup.stepDone")
                }}</span>
              </span>
              <span
                v-if="index < checklistSteps.length - 1"
                class="mt-2 w-px flex-1 bg-border"
                aria-hidden="true"
              ></span>
            </div>

            <div class="min-w-0 flex-1 space-y-3 pb-8">
              <div v-if="step.title || step.description" class="space-y-1 pt-0.5">
                <h3
                  v-if="step.title"
                  class="flex flex-wrap items-center gap-2 font-medium leading-6"
                >
                  {{ step.title }}
                  <Badge v-if="step.optional" variant="secondary">
                    {{ $t("pluginSettings.setup.optional") }}
                  </Badge>
                </h3>
                <p v-if="step.description" class="text-sm text-neutral-muted">
                  {{ step.description }}
                </p>
                <p v-if="step.message" class="text-sm text-neutral-muted">{{ step.message }}</p>
              </div>

              <Card v-if="step.kind === 'fields'">
                <CardContent class="pt-6">
                  <PluginConfigForm
                    v-model:formData="formData"
                    v-model:editingEncryptedFields="editingEncryptedFields"
                    v-model:editingEnvFields="editingEnvFields"
                    :plugin-id="plugin.id"
                    :configSchema="pickSchema(step.fields)"
                    :originalFormData="originalFormData"
                    :configMetadata="configMetadata"
                    :saving="saving"
                    @submit="saveConfiguration"
                    @reset="resetForm"
                    @reset-to-env="handleResetToEnv"
                  />
                </CardContent>
              </Card>

              <template v-else-if="step.kind === 'connect'">
                <!-- OAuth client ID/secret not set: Connect cannot work, say why -->
                <Alert v-if="!oauthConfigured" :icon="Info" data-testid="oauth-unavailable-alert">
                  <AlertTitle>{{
                    $t("pluginSettings.connection.oauthUnavailableTitle")
                  }}</AlertTitle>
                  <AlertDescription>
                    {{ $t("pluginSettings.connection.oauthUnavailable", { name: displayName }) }}
                  </AlertDescription>
                </Alert>
                <PluginOAuthConnection
                  v-else
                  :plugin="plugin"
                  :config="slotConfig"
                  :api-base-url="apiBaseUrl"
                  :oauth-available="oauthAvailable"
                  :oauth-configured="oauthConfigured"
                  hide-header
                />
              </template>

              <Card v-else-if="step.kind === 'component' && step.extension">
                <CardContent>
                  <PluginPageSlot
                    :plugin-id="plugin.id"
                    :plugin-path="plugin.pluginPath"
                    :component-name="step.extension.componentName"
                    :plugin="plugin"
                    :config="slotConfig"
                    :api-base-url="apiBaseUrl"
                    @update:config="onSlotConfig"
                  />
                </CardContent>
              </Card>

              <Button
                v-else-if="step.kind === 'external' && step.url"
                variant="outline"
                :href="step.url"
                target="_blank"
              >
                <ExternalLink class="h-4 w-4 mr-2" aria-hidden="true" />
                {{ $t("pluginSettings.setup.openExternal") }}
              </Button>

              <div v-else-if="step.kind === 'verify'" class="space-y-3" data-testid="setup-verify">
                <PluginTestResult v-if="testResult" :result="testResult" />
                <Button variant="outline" :loading="testing" @click="testConnection">
                  <Zap v-if="!testing" class="h-4 w-4 mr-2" />
                  {{ $t("pluginSettings.connectionTest.testConnection") }}
                </Button>
              </div>
            </div>
          </li>
        </ol>

        <Card v-for="ext in checklistExtras.after" :key="ext.id">
          <CardContent>
            <PluginPageSlot
              :plugin-id="plugin.id"
              :plugin-path="plugin.pluginPath"
              :component-name="ext.componentName"
              :plugin="plugin"
              :config="slotConfig"
              :api-base-url="apiBaseUrl"
              @update:config="onSlotConfig"
            />
          </CardContent>
        </Card>
      </section>

      <!-- What it can do (also what a not-yet-connected plugin shows) -->
      <section
        v-if="!enabled || activeTab === 'capabilities'"
        id="plugin-panel-capabilities"
        :role="enabled ? 'tabpanel' : undefined"
        :aria-labelledby="enabled ? 'plugin-tab-capabilities' : undefined"
        class="space-y-4"
      >
        <Card v-if="capabilities.length > 0" data-testid="plugin-capabilities">
          <CardHeader>
            <CardTitle>{{ $t("pluginSettings.capabilities.title") }}</CardTitle>
            <CardDescription>{{ $t("pluginSettings.capabilities.description") }}</CardDescription>
          </CardHeader>
          <CardContent>
            <ul class="space-y-3">
              <li v-for="capability in capabilities" :key="capability" class="flex gap-3">
                <component
                  :is="CAPABILITY_ICONS[capability]"
                  class="h-5 w-5 text-primary flex-shrink-0 mt-0.5"
                  aria-hidden="true"
                />
                <div>
                  <p class="font-medium text-sm">
                    {{ $t(`pluginSettings.capabilities.items.${capability}.title`) }}
                  </p>
                  <p class="text-sm text-neutral-muted">
                    {{ $t(`pluginSettings.capabilities.items.${capability}.description`) }}
                  </p>
                </div>
              </li>
            </ul>
          </CardContent>
        </Card>

        <!-- Actions the agent gets. Live tools from the worker, else the manifest's. -->
        <Card v-if="availableTools.length > 0">
          <CardHeader>
            <CardTitle>{{ $t("pluginSettings.availableActions.title") }}</CardTitle>
            <CardDescription>{{
              $t("pluginSettings.availableActions.toolsAvailable", {
                count: availableTools.length,
              })
            }}</CardDescription>
          </CardHeader>
          <CardContent>
            <div class="relative">
              <div class="grid gap-2">
                <div
                  v-for="tool in displayedTools"
                  :key="tool.name"
                  class="rounded-lg border border-border overflow-hidden"
                >
                  <button
                    type="button"
                    class="w-full flex items-center gap-3 p-3 text-left hover:bg-muted/40 transition-colors"
                    :aria-expanded="expandedTools.has(tool.name)"
                    @click="toggleTool(tool.name)"
                  >
                    <Badge :variant="getToolBadgeVariant(tool)" class="flex-shrink-0">
                      {{ getToolBadgeLabel(tool) }}
                    </Badge>
                    <h4 class="font-medium text-sm flex-1 min-w-0 truncate">
                      {{ getToolLabel(pluginId, tool.name) }}
                    </h4>
                    <ChevronDown
                      class="h-4 w-4 text-neutral-muted flex-shrink-0 transition-transform"
                      :class="{ 'rotate-180': expandedTools.has(tool.name) }"
                    />
                  </button>
                  <div v-if="expandedTools.has(tool.name)" class="p-4 pt-1 space-y-2">
                    <p v-if="tool.description" class="text-xs text-neutral-muted">
                      {{ getToolDescription(pluginId, tool.name, tool.description) }}
                    </p>
                    <div v-if="tool.input_schema">
                      <p class="text-[11px] font-medium uppercase text-neutral-muted mb-2">
                        {{ $t("pluginSettings.availableActions.parameters") }}
                      </p>
                      <McpToolInputSchema :schema="tool.input_schema" />
                    </div>
                  </div>
                </div>
              </div>

              <div
                v-if="!showAllTools && availableTools.length > COLLAPSED_TOOL_LIMIT"
                class="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-center pt-32 pb-2 bg-gradient-to-t from-background to-transparent"
              >
                <Button
                  variant="outline"
                  size="sm"
                  class="pointer-events-auto shadow-sm"
                  @click="showAllTools = true"
                >
                  {{
                    $t("pluginSettings.availableActions.showAll", { count: availableTools.length })
                  }}
                </Button>
              </div>
            </div>

            <div
              v-if="showAllTools && availableTools.length > COLLAPSED_TOOL_LIMIT"
              class="mt-3 flex justify-center"
            >
              <Button variant="ghost" size="sm" @click="showAllTools = false">
                {{ $t("pluginSettings.availableActions.hide") }}
              </Button>
            </div>
          </CardContent>
        </Card>

        <p
          v-if="capabilities.length === 0 && availableTools.length === 0"
          class="text-sm text-neutral-muted"
        >
          {{ $t("pluginSettings.capabilities.empty") }}
        </p>
      </section>

      <!-- Advanced: managed and technical values -->
      <section
        v-if="enabled && activeTab === 'advanced'"
        id="plugin-panel-advanced"
        role="tabpanel"
        aria-labelledby="plugin-tab-advanced"
        class="space-y-4"
      >
        <Card data-testid="advanced-fields">
          <CardHeader>
            <CardTitle>{{ $t("pluginSettings.advanced.title") }}</CardTitle>
            <CardDescription>
              {{
                hasEditableAdvancedFields
                  ? $t("pluginSettings.advanced.description")
                  : $t("pluginSettings.advanced.readOnlyDescription")
              }}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <PluginConfigForm
              v-model:formData="formData"
              v-model:editingEncryptedFields="editingEncryptedFields"
              v-model:editingEnvFields="editingEnvFields"
              :plugin-id="plugin.id"
              :configSchema="advancedSchema"
              :originalFormData="originalFormData"
              :configMetadata="configMetadata"
              :saving="saving"
              :hide-actions="!hasEditableAdvancedFields"
              advanced-view
              @submit="saveConfiguration"
              @reset="resetForm"
              @reset-to-env="handleResetToEnv"
            />
          </CardContent>
        </Card>
      </section>
    </div>
  </Page>
</template>

<script setup lang="ts">
import { computed, ref, watch, onUnmounted, nextTick, type Component } from "vue";
import {
  ArrowLeft,
  AlertCircle,
  AlertTriangle,
  Zap,
  MessageSquare,
  Cpu,
  FileText,
  Database,
  Package,
  Info,
  RotateCw,
  ChevronDown,
  Users,
  ShoppingBag,
  ShieldCheck,
  MessageCircle,
  MoreHorizontal,
  Check,
  Power,
  ExternalLink,
  Ticket,
} from "lucide-vue-next";
import { Hay } from "@/utils/api";
import { useUserStore } from "@/stores/user";
import { useAppStore } from "@/stores/app";
import { useToast } from "@/composables/useToast";
import { useDomain } from "@/composables/useDomain";
import { classifyTool } from "@/utils/toolClassification";
import PluginOAuthConnection from "@/components/plugins/PluginOAuthConnection.vue";
import PluginPageSlot from "@/components/plugins/PluginPageSlot.vue";
import PluginTestResult from "@/components/plugins/PluginTestResult.vue";
import McpToolInputSchema from "@/components/plugins/McpToolInputSchema.vue";
import { useToolLabel } from "@/composables/useToolLabel";
import { usePluginTranslations } from "@/composables/usePluginTranslations";
import {
  buildSetupChecklist,
  isStepDone,
  type DeclaredSetupStep,
  deriveSetupState,
  describedCapabilities,
  isShown,
  missingRequiredFields,
  splitConfigFields,
  type ConfigFieldMeta,
  type DescribedCapability,
  type SetupState,
} from "@/utils/pluginSetup";

const { t } = useI18n();
const { locale } = useI18n({ useScope: "global" });
const { getToolLabel, getToolDescription, getPluginName, getPluginDescription, getSetupStepText } =
  useToolLabel();
const { loadTranslations: loadPluginTranslations } = usePluginTranslations();

const route = useRoute();
const router = useRouter();
const userStore = useUserStore();
const appStore = useAppStore();
const toast = useToast();

// Plugin ID from route (decode in case it contains special characters like /)
const pluginId = computed(() => decodeURIComponent(route.params.pluginId as string));

const apiBaseUrl = computed(() => {
  const { getApiUrl } = useDomain();
  return getApiUrl();
});

// State
const loading = ref(true);
const error = ref<string | null>(null);
const plugin = ref<any>(null);
const enabled = ref(false);
const saving = ref(false);
const testing = ref(false);
const enabling = ref(false);
const disabling = ref(false);
const restarting = ref(false);
const showDisableConfirm = ref(false);
const thumbnailFailed = ref(false);
const testResult = ref<{
  success: boolean;
  message?: string;
  error?: string;
  status?: string;
} | null>(null);
const instanceId = ref<string | null>(null);

// Cleanup tracking for the auto-test race condition fix
const autoTestTimeout = ref<NodeJS.Timeout | null>(null);
const testAbortController = ref<AbortController | null>(null);
const oauthAvailable = ref(false); // Plugin has OAuth2 registered
const oauthConfigured = ref(false); // OAuth credentials configured
const oauthConnected = ref(false); // OAuth flow completed and access token exists

const displayName = computed(() =>
  plugin.value ? getPluginName(plugin.value.id, plugin.value.name) : "",
);
const pluginDescription = computed(() =>
  plugin.value ? getPluginDescription(plugin.value.id, plugin.value.manifest?.description) : "",
);

// Connection testing only applies to MCP plugins
const isMcpPlugin = computed(() =>
  describedCapabilities(plugin.value?.manifest?.capabilities).includes("mcp"),
);

// Configuration
const configSchema = ref<Record<string, any>>({});
const formData = ref<Record<string, any>>({});
const originalFormData = ref<Record<string, any>>({});
const configMetadata = ref<Record<string, ConfigFieldMeta>>({});
// Encrypted / managed fields the merchant is currently editing
const editingEncryptedFields = ref<Set<string>>(new Set());
const editingEnvFields = ref<Set<string>>(new Set());

const slotConfig = computed(() => ({
  ...formData.value,
  instanceId: instanceId.value,
  organizationId: userStore.activeOrganizationId,
}));
const onSlotConfig = (newConfig: Record<string, unknown>) => {
  formData.value = { ...formData.value, ...newConfig };
};

// Setup fields vs Advanced fields (managed by the server, or declared technical)
const fieldSplit = computed(() =>
  splitConfigFields(configSchema.value, configMetadata.value, formData.value),
);
const pickSchema = (keys: string[]) =>
  Object.fromEntries(keys.map((key) => [key, configSchema.value[key]]));
const advancedSchema = computed(() => pickSchema(fieldSplit.value.advanced));

// What the plugin reports about itself (register.setup({ status })), when it does
type ReportedStatus = {
  state: SetupState;
  account?: string;
  steps: Record<string, { done: boolean; message?: string }>;
};
const reportedStatus = ref<ReportedStatus | null>(null);
const fetchReportedStatus = async () => {
  if (!enabled.value || !plugin.value?.metadata?.setup?.hasStatus) {
    reportedStatus.value = null;
    return;
  }
  try {
    reportedStatus.value = await Hay.plugins.setupStatus.query({ pluginId: pluginId.value });
  } catch {
    reportedStatus.value = null; // core judges the status itself
  }
};

// The setup checklist (D20-5)
const extensionByName = (name?: string) =>
  [...beforeSettingsExtensions.value, ...afterSettingsExtensions.value].find(
    (ext) => ext.componentName === name,
  );
const checklist = computed(() =>
  buildSetupChecklist({
    declared: plugin.value?.metadata?.setup?.steps as DeclaredSetupStep[] | undefined,
    setupFields: fieldSplit.value.setup,
    before: beforeSettingsExtensions.value.map((ext) => ext.componentName),
    after: afterSettingsExtensions.value.map((ext) => ext.componentName),
    hasConnect: oauthAvailable.value,
    hasVerify: isMcpPlugin.value,
  }),
);
const checklistExtras = computed(() => ({
  before: checklist.value.extraBefore.map(extensionByName).filter((ext) => !!ext),
  after: checklist.value.extraAfter.map(extensionByName).filter((ext) => !!ext),
}));
const urlHost = (url?: string) => {
  try {
    return url ? new URL(url).host : "";
  } catch {
    return "";
  }
};
// Titles core uses when the plugin ships no setupSteps.<id> translation
const defaultStepText = (kind: DeclaredSetupStep["kind"], title?: string) => {
  const name = displayName.value;
  if (kind === "fields") {
    return {
      title: t("pluginSettings.setup.fieldsTitle"),
      description: t("pluginSettings.setup.fieldsDescription", { name }),
    };
  }
  if (kind === "connect") {
    return {
      title: t("pluginSettings.oauth.title", { name }),
      description: t("pluginSettings.oauth.description", { name }),
    };
  }
  if (kind === "verify") {
    return {
      title: t("pluginSettings.connectionTest.title"),
      description: t("pluginSettings.connectionTest.description", { name }),
    };
  }
  return { title: title ?? "", description: "" };
};
const checklistSteps = computed(() => {
  const signals = {
    missingRequired: missingRequiredFields(
      configSchema.value,
      configMetadata.value,
      formData.value,
    ),
    oauthConnected: oauthConnected.value,
    testSuccess: testResult.value ? testResult.value.success : null,
    reported: reportedStatus.value?.steps,
  };
  return checklist.value.steps
    .filter(
      (step) =>
        step.kind !== "fields" ||
        step.fields.some((key) => isShown(configSchema.value[key], formData.value)),
    )
    .map((step) => {
      const extension = step.kind === "component" ? extensionByName(step.component) : undefined;
      const fallback = defaultStepText(step.kind, extension?.title ?? urlHost(step.url));
      return {
        ...step,
        extension,
        title: getSetupStepText(plugin.value!.id, step.id, "title", fallback.title),
        description: getSetupStepText(
          plugin.value!.id,
          step.id,
          "description",
          fallback.description,
        ),
        message: reportedStatus.value?.steps[step.id]?.message,
        done: isStepDone(step, signals) === true,
      };
    });
});
// Advanced fields hidden by showWhen (e.g. self-hosted credentials in managed mode) don't count.
const visibleAdvancedFields = computed(() =>
  fieldSplit.value.advanced.filter((key) => isShown(configSchema.value[key], formData.value)),
);
const hasEditableAdvancedFields = computed(() =>
  visibleAdvancedFields.value.some((key) => {
    const meta = configMetadata.value[key];
    return !(meta?.source === "env" && !meta.canOverride);
  }),
);

// Advanced mode: a remembered per-user preference (Roger's answer 2)
const advancedMode = computed(
  () => !!userStore.user?.id && !!appStore.pluginAdvancedMode[userStore.user.id],
);
const toggleAdvancedMode = () => {
  if (!userStore.user?.id) return;
  appStore.setPluginAdvancedMode(userStore.user.id, !advancedMode.value);
};

type PluginTab = "setup" | "capabilities" | "advanced";
const activeTab = ref<PluginTab>("setup");
const tabs = computed<PluginTab[]>(() =>
  advancedMode.value && visibleAdvancedFields.value.length > 0
    ? ["setup", "capabilities", "advanced"]
    : ["setup", "capabilities"],
);
// A tab can disappear (Advanced mode off, no visible advanced fields): fall back to Setup.
watch(tabs, (available) => {
  if (!available.includes(activeTab.value)) activeTab.value = "setup";
});
const onTabKeydown = (event: KeyboardEvent) => {
  if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
  const index = tabs.value.indexOf(activeTab.value);
  const step = event.key === "ArrowRight" ? 1 : -1;
  const next = tabs.value[(index + step + tabs.value.length) % tabs.value.length];
  activeTab.value = next;
  void nextTick(() => document.getElementById(`plugin-tab-${next}`)?.focus());
};

const setupPanel = ref<HTMLElement | null>(null);
const openSetup = async () => {
  activeTab.value = "setup";
  await nextTick();
  setupPanel.value?.scrollIntoView({ behavior: "smooth", block: "start" });
};

// Status header
const missingRequired = computed(
  () => missingRequiredFields(configSchema.value, configMetadata.value, formData.value).length,
);
const setupState = computed<SetupState>(() =>
  deriveSetupState({
    enabled: enabled.value,
    channelFailing: plugin.value?.channelHealth?.status === "failing",
    missingRequired: missingRequired.value,
    oauth: { available: oauthAvailable.value, connected: oauthConnected.value },
    test: isMcpPlugin.value ? testResult.value : null,
    reported: reportedStatus.value?.state ?? null,
  }),
);
const STATUS_BADGES: Record<
  SetupState,
  { variant: "secondary" | "warning" | "success" | "destructive"; dot: string }
> = {
  not_set_up: { variant: "secondary", dot: "bg-neutral-400" },
  needs_action: { variant: "warning", dot: "bg-amber-500" },
  connected: { variant: "success", dot: "bg-green-600" },
  error: { variant: "destructive", dot: "bg-red-600" },
};
const statusBadge = computed(() => STATUS_BADGES[setupState.value]);

// What it can do
const capabilities = computed(() => describedCapabilities(plugin.value?.manifest?.capabilities));
const CAPABILITY_ICONS: Record<DescribedCapability, Component> = {
  messages: MessageSquare,
  customers: Users,
  mcp: Zap,
  products: ShoppingBag,
  disputes: ShieldCheck,
  tickets: Ticket,
  documents: FileText,
  webchat: MessageCircle,
};

type ToolAnnotations = {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
  title?: string;
};
type DisplayTool = {
  name: string;
  title?: string;
  description?: string;
  input_schema?: Record<string, any>;
  annotations?: ToolAnnotations;
};
const availableTools = computed<DisplayTool[]>(() => {
  const live = plugin.value?.tools;
  if (Array.isArray(live) && live.length > 0) {
    return live;
  }
  const caps = plugin.value?.manifest?.capabilities;
  if (!Array.isArray(caps) && caps?.mcp?.tools?.length) {
    return caps.mcp.tools;
  }
  return [];
});

const showAllTools = ref(false);
const expandedTools = ref<Set<string>>(new Set());
const COLLAPSED_TOOL_LIMIT = 5;
const displayedTools = computed(() =>
  showAllTools.value ? availableTools.value : availableTools.value.slice(0, COLLAPSED_TOOL_LIMIT),
);

function toggleTool(name: string) {
  const next = new Set(expandedTools.value);
  if (next.has(name)) {
    next.delete(name);
  } else {
    next.add(name);
  }
  expandedTools.value = next;
}

// Read/write/destructive classification is shared with the playbook actions
// panel — see utils/toolClassification.ts.
function getToolBadgeVariant(tool: DisplayTool): "success" | "warning" | "destructive" {
  const cls = classifyTool(tool);
  if (cls === "destructive") return "destructive";
  if (cls === "read") return "success";
  return "warning";
}

function getToolBadgeLabel(tool: DisplayTool): string {
  return t(`pluginSettings.availableActions.classification.${classifyTool(tool)}`);
}

// Plugin UI pages (register.ui.page) by slot
type SlotExtension = { id: string; componentName: string; title?: string };
const beforeSettingsExtensions = ref<SlotExtension[]>([]);
const afterSettingsExtensions = ref<SlotExtension[]>([]);

const getPluginIcon = (types: string[] = []) => {
  if (types.includes("channel")) return MessageSquare;
  if (types.includes("mcp-connector")) return Cpu;
  if (types.includes("document_importer")) return FileText;
  if (types.includes("retriever")) return Database;
  return Package;
};

const getPluginIconBg = (types: string[] = []) => {
  if (types.includes("channel")) return "bg-blue-600";
  if (types.includes("mcp-connector")) return "bg-purple-600";
  if (types.includes("document_importer")) return "bg-green-600";
  if (types.includes("retriever")) return "bg-orange-600";
  return "bg-gray-600";
};

const getPluginThumbnail = (id: string) => {
  const { getApiUrl } = useDomain();
  return getApiUrl(`/plugins/thumbnails/${encodeURIComponent(id)}`);
};

const loadPluginExtensions = () => {
  const pages: Array<{ id: string; component: string; slot: string; title?: string }> =
    plugin.value?.metadata?.pages ?? [];
  // './components/settings/AfterSettings.vue' -> 'AfterSettings'
  const componentName = (path: string) => path.split("/").pop()?.replace(".vue", "") || "";
  const bySlot = (slot: string) =>
    pages
      .filter((page) => page.slot === slot)
      .map((page) => ({
        id: page.id,
        componentName: componentName(page.component),
        title: page.title,
      }));
  beforeSettingsExtensions.value = bySlot("before-settings");
  afterSettingsExtensions.value = bySlot("after-settings");
};

const applyPluginData = (pluginData: any) => {
  plugin.value = pluginData;
  enabled.value = pluginData.enabled;
  instanceId.value = pluginData.instanceId ?? null;
  formData.value = { ...pluginData.configuration };
  originalFormData.value = { ...pluginData.configuration };
  configMetadata.value = pluginData.configMetadata ?? {};
  oauthAvailable.value = !!pluginData.oauthAvailable;
  oauthConfigured.value = !!pluginData.oauthConfigured;
  oauthConnected.value = !!pluginData.oauthConnected;

  const schema = pluginData.metadata?.configSchema || pluginData.manifest?.configSchema || {};
  configSchema.value = schema;
  for (const [key, field] of Object.entries(schema) as Array<[string, any]>) {
    if (formData.value[key] === undefined && field.default !== undefined) {
      formData.value[key] = field.default;
    }
  }
  editingEncryptedFields.value.clear();
  editingEnvFields.value.clear();
  loadPluginExtensions();
};

const fetchPlugin = async () => {
  // Only the first load shows the skeleton; refreshes keep plugin components mounted.
  loading.value = !plugin.value;
  error.value = null;

  try {
    applyPluginData(await Hay.plugins.get.query({ pluginId: pluginId.value }));
    void fetchReportedStatus();
  } catch (err) {
    console.error("Failed to fetch plugin:", err);
    error.value = t("pluginSettings.error.loadFailed");
  } finally {
    loading.value = false;
    // Test the connection in the background (MCP plugins only)
    if (enabled.value && isMcpPlugin.value) {
      scheduleAutoTest();
    }
  }
};

const saveConfiguration = async () => {
  saving.value = true;

  try {
    const cleanedConfig: Record<string, any> = {};

    for (const [key, value] of Object.entries(formData.value)) {
      const field = configSchema.value[key];
      const metadata = configMetadata.value[key];

      // Managed values not being overridden stay with the server
      if (metadata?.source === "env" && !editingEnvFields.value.has(key)) {
        continue;
      }

      if (
        field?.encrypted &&
        originalFormData.value[key] &&
        /^\*+$/.test(originalFormData.value[key])
      ) {
        // Existing secret: send the new value only when the merchant typed one
        cleanedConfig[key] =
          editingEncryptedFields.value.has(key) && value ? value : originalFormData.value[key];
      } else {
        cleanedConfig[key] = value;
      }
    }

    await Hay.plugins.configure.mutate({
      pluginId: pluginId.value,
      configuration: cleanedConfig,
    });

    toast.success(t("pluginSettings.toast.configSaved"));
    await fetchPlugin();
  } catch (err: any) {
    console.error("Failed to save configuration:", err);
    toast.error(err?.message || err?.data?.message || t("pluginSettings.toast.configSaveFailed"));
  } finally {
    saving.value = false;
  }
};

const resetForm = async () => {
  applyPluginData(await Hay.plugins.get.query({ pluginId: pluginId.value }));
};

const handleResetToEnv = async (key: string) => {
  try {
    const newFormData = { ...formData.value };
    delete newFormData[key];

    // Saving without the field lets the managed value apply again
    await Hay.plugins.configure.mutate({
      pluginId: pluginId.value,
      configuration: newFormData,
    });

    toast.success(t("pluginSettings.toast.resetToEnv"));
    await fetchPlugin();
  } catch (err: any) {
    console.error("Failed to reset to the managed value:", err);
    toast.error(err?.message || err?.data?.message || t("pluginSettings.toast.resetToEnvFailed"));
  }
};

/**
 * Check if authentication is properly configured based on auth method type
 */
const isAuthConfigured = (): boolean => {
  const authMethods = plugin.value?.metadata?.authMethods || plugin.value?.manifest?.authMethods;

  if (!authMethods || authMethods.length === 0) {
    return true;
  }

  if (authMethods.some((m: any) => m.type === "oauth2")) {
    return oauthConnected.value;
  }

  const authConfigFields = authMethods
    .filter((m: any) => m.type === "apiKey")
    .map((m: any) => m.configField)
    .filter(Boolean);

  if (authConfigFields.length === 0) {
    return false;
  }

  // Masked values (e.g. '********') count as set
  return authConfigFields.every((field: string) => {
    const value = formData.value[field];
    return value !== null && value !== undefined && value !== "";
  });
};

const scheduleAutoTest = () => {
  if (autoTestTimeout.value) {
    clearTimeout(autoTestTimeout.value);
    autoTestTimeout.value = null;
  }

  autoTestTimeout.value = setTimeout(() => {
    if (!testing.value && isAuthConfigured()) {
      testConnection();
    }
    autoTestTimeout.value = null;
  }, 0);
};

const testConnection = async () => {
  if (testing.value) return;

  if (testAbortController.value) {
    testAbortController.value.abort();
  }

  testing.value = true;
  // Keep showing the previous result while testing
  testAbortController.value = new AbortController();
  const currentController = testAbortController.value;

  try {
    const result = await Hay.plugins.testConnection.query({ pluginId: pluginId.value });
    if (currentController.signal.aborted) return;

    testResult.value = {
      success: result.success,
      status: (result as { status?: string }).status,
      message:
        result.message ||
        (result.success
          ? t("pluginSettings.toast.connectionEstablished")
          : t("pluginSettings.connection.connectionFailed")),
      error: result.error,
    };
  } catch (err: any) {
    if (err?.name === "AbortError" || currentController.signal.aborted) return;

    testResult.value = {
      success: false,
      message: err?.message || t("pluginSettings.toast.connectionCheckFailed"),
    };
  } finally {
    if (testAbortController.value === currentController) {
      testing.value = false;
      testAbortController.value = null;
    }
  }
};

/** One verb everywhere (Roger's answer 4): Connect adds the plugin and opens Setup. */
const handleConnect = async () => {
  enabling.value = true;

  try {
    await appStore.enablePlugin(pluginId.value);
    // Plugin translations are served for enabled plugins only: load this one's now.
    void loadPluginTranslations();
    await fetchPlugin();
    await openSetup();
  } catch (err: any) {
    console.error("Failed to connect plugin:", err);
    toast.error(err?.message || err?.data?.message || t("pluginSettings.toast.enableFailed"));
  } finally {
    enabling.value = false;
  }
};

const handleDisablePlugin = async () => {
  disabling.value = true;

  try {
    await Hay.plugins.disable.mutate({ pluginId: pluginId.value });
    toast.success(t("pluginSettings.toast.disabledSuccess"));
    router.push("/integrations/marketplace");
  } catch (err: any) {
    console.error("Failed to disable plugin:", err);
    toast.error(err?.message || err?.data?.message || t("pluginSettings.toast.disableFailed"));
  } finally {
    disabling.value = false;
  }
};

const handleRestartPlugin = async () => {
  restarting.value = true;

  try {
    await Hay.plugins.restart.mutate({ pluginId: pluginId.value });
    toast.success(t("pluginSettings.toast.restartedSuccess"));
    await fetchPlugin();
    // Give the worker a moment to start before testing
    setTimeout(() => testConnection(), 2000);
  } catch (err: any) {
    console.error("Failed to restart plugin:", err);
    toast.error(err?.message || err?.data?.message || t("pluginSettings.toast.restartFailed"));
  } finally {
    restarting.value = false;
  }
};

// Handle OAuth callback redirect
const handleOAuthCallback = () => {
  const oauthStatus = route.query.oauth as string | undefined;

  if (oauthStatus === "success") {
    toast.success(t("pluginSettings.toast.oauthSuccess"));
    router.replace({ path: route.path, query: {} });
    fetchPlugin();
  } else if (oauthStatus === "error") {
    toast.error(t("pluginSettings.toast.oauthFailed"));
    router.replace({ path: route.path, query: {} });
  }
};

// External connect handoff, e.g. the Shopify App Store app deep-links here as
// /integrations/plugins/<id>?connect=1&config.shopDomain=<shop>[&return_to=<allowlisted url>]
// Prefill the given (non-secret) config fields, save — which also enables the
// plugin — and start the OAuth flow, so the merchant never types identifiers.
const handleConnectIntent = async (): Promise<boolean> => {
  if (route.query.connect !== "1") return false;

  const configuration: Record<string, string> = {};
  for (const [key, value] of Object.entries(route.query)) {
    if (!key.startsWith("config.") || typeof value !== "string" || !value) continue;
    const field = key.slice("config.".length);
    const schema = configSchema.value[field];
    // Only plain, declared fields can be set from a link (never secrets).
    if (!schema || schema.encrypted) continue;
    configuration[field] = value;
  }

  try {
    // `enable` (not `configure`) so a never-installed or previously disabled
    // instance is created/re-enabled, installed, and its worker started.
    await Hay.plugins.enable.mutate({ pluginId: pluginId.value, configuration });
    // OAuth availability is only reported once an enabled instance exists.
    if (!oauthAvailable.value) await fetchPlugin();
    if (!oauthAvailable.value) {
      // No OAuth (e.g. a store plugin that connects from its own settings
      // panel): the link only pre-fills the settings, so stay on the page.
      toast.success(t("pluginSettings.toast.configSaved"));
      router.replace({ path: route.path, query: {} });
      return false;
    }
    const returnTo = typeof route.query.return_to === "string" ? route.query.return_to : undefined;
    const { authorizationUrl } = await Hay.plugins.oauth.initiate.mutate({
      pluginId: pluginId.value,
      returnTo,
    });
    window.location.href = authorizationUrl;
    return true;
  } catch (err: any) {
    console.error("Failed to auto-connect plugin:", err);
    toast.error(
      err?.message ||
        err?.data?.message ||
        t("pluginSettings.toast.oauthConnectFailed", { name: displayName.value || pluginId.value }),
    );
    router.replace({ path: route.path, query: {} });
    return false;
  }
};

onMounted(async () => {
  handleOAuthCallback();

  if (!route.query.oauth) {
    await fetchPlugin();
    if (await handleConnectIntent()) return;
  }
});

// Cleanup on unmount to prevent race conditions
onUnmounted(() => {
  if (autoTestTimeout.value) {
    clearTimeout(autoTestTimeout.value);
    autoTestTimeout.value = null;
  }
  if (testAbortController.value) {
    testAbortController.value.abort();
    testAbortController.value = null;
  }
});

definePageMeta({
  layout: "default",
});

useHead({
  title: computed(() =>
    plugin.value
      ? t("pluginSettings.headTitleWithName", { name: displayName.value })
      : t("pluginSettings.headTitle"),
  ),
});
</script>
