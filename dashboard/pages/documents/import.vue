<template>
  <Page
    :title="$t('documents.import.page.title')"
    :description="$t('documents.import.page.description')"
  >
    <!-- Global Drop Overlay for Step 1 -->
    <div
      v-if="currentStep === 1 && isDragging"
      class="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center"
      @drop="handleGlobalDrop"
      @dragover.prevent="handleGlobalDragOver"
      @dragleave.prevent="handleGlobalDragLeave"
    >
      <div
        class="bg-primary/10 border-4 border-dashed border-primary rounded-lg p-12 max-w-lg text-center pointer-events-none"
      >
        <Upload class="mx-auto h-20 w-20 text-primary mb-4 animate-pulse" />
        <h3 class="text-2xl font-bold mb-2">{{ $t("documents.import.dropOverlay.title") }}</h3>
        <p class="text-neutral-muted">{{ $t("documents.import.dropOverlay.description") }}</p>
      </div>
    </div>

    <!-- Page Header -->
    <template #header>
      <Button variant="outline" size="sm" @click="startTutorial">
        <HelpCircle class="h-4 w-4 mr-2" />
        {{ $t("documents.import.tutorial") }}
      </Button>
    </template>

    <!-- Import Steps Progress -->
    <div class="flex items-center justify-between mb-8" data-tour="progress-steps">
      <template v-for="(step, index) in steps" :key="index">
        <div class="flex items-center gap-2">
          <div
            :class="[
              'flex items-center justify-center w-8 h-8 rounded-full',
              currentStep >= index + 1
                ? 'bg-primary text-primary-foreground'
                : 'bg-background-tertiary text-neutral-muted',
            ]"
          >
            {{ index + 1 }}
          </div>
          <span :class="currentStep >= index + 1 ? 'text-foreground' : 'text-neutral-muted'">
            {{ step }}
          </span>
        </div>
        <div v-if="index < steps.length - 1" class="flex-1 mx-4 h-px bg-border" />
      </template>
    </div>

    <!-- Step 1: Select Import Source -->
    <Card v-if="currentStep === 1">
      <CardHeader>
        <CardTitle>{{ $t("documents.import.source.title") }}</CardTitle>
        <CardDescription>
          {{ $t("documents.import.source.description") }}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div class="grid gap-4" data-tour="import-sources">
          <!-- Upload Files Option -->
          <div
            class="p-6 border-2 rounded-lg cursor-pointer hover:border-primary transition-colors"
            :class="{ 'border-primary bg-primary/5': importType === 'upload' }"
            data-tour="upload-option"
            @click="selectImportType('upload')"
          >
            <div class="flex items-start gap-4">
              <div
                class="p-3 rounded-lg"
                :class="importType === 'upload' ? 'bg-white' : 'bg-background-tertiary'"
              >
                <Upload class="h-6 w-6 text-neutral-muted" />
              </div>
              <div class="flex-1">
                <h3 class="mb-1">{{ $t("documents.import.source.uploadFiles") }}</h3>
                <p class="text-sm text-neutral-muted mb-2">
                  {{ $t("documents.import.source.uploadFilesDesc") }}
                </p>
                <div class="flex flex-wrap gap-2">
                  <Badge v-for="format in uploadFormats" :key="format" variant="outline">
                    {{ format }}
                  </Badge>
                </div>
              </div>
            </div>
          </div>

          <!-- Import from Website Option -->
          <div
            class="p-6 border-2 rounded-lg cursor-pointer hover:border-primary transition-colors"
            :class="{ 'border-primary bg-primary/5': importType === 'web' }"
            data-tour="web-option"
            @click="selectImportType('web')"
          >
            <div class="flex items-start gap-4">
              <div
                class="p-3 rounded-lg"
                :class="importType === 'web' ? 'bg-white' : 'bg-background-tertiary'"
              >
                <Globe class="h-6 w-6 text-neutral-muted" />
              </div>
              <div class="flex-1">
                <h3 class="mb-1">{{ $t("documents.import.source.importFromWebsite") }}</h3>
                <p class="text-sm text-neutral-muted mb-2">
                  {{ $t("documents.import.source.importFromWebsiteDesc") }}
                </p>
                <div class="flex flex-wrap gap-2">
                  <Badge variant="outline"> HTML </Badge>
                  <Badge variant="outline"> {{ $t("documents.import.source.autoCrawl") }} </Badge>
                  <Badge variant="outline"> {{ $t("documents.import.source.sitemap") }} </Badge>
                </div>
              </div>
            </div>
          </div>

          <!-- Plugin Importers (if available) -->
          <template v-if="pluginImporters.length > 0">
            <div
              v-for="plugin in pluginImporters"
              :key="plugin.id"
              :data-testid="`importer-card-${plugin.id}`"
              class="p-6 border-2 rounded-lg cursor-pointer hover:border-primary transition-colors"
              :class="{
                'border-primary bg-primary/5': importType === `plugin:${plugin.id}`,
              }"
              @click="selectImportType(`plugin:${plugin.id}`)"
            >
              <div class="flex items-start gap-4">
                <div
                  class="p-3 rounded-lg flex items-center justify-center w-12 h-12 overflow-hidden"
                  :class="
                    importType === `plugin:${plugin.id}` ? 'bg-white' : 'bg-background-tertiary'
                  "
                >
                  <img
                    v-if="!pluginThumbFailed[plugin.pluginId]"
                    :src="pluginThumbUrl(plugin.pluginId)"
                    :alt="plugin.name"
                    class="w-full h-full object-cover rounded"
                    @error="pluginThumbFailed[plugin.pluginId] = true"
                  />
                  <Package v-else class="h-6 w-6 text-neutral-muted" />
                </div>
                <div class="flex-1">
                  <h3 class="mb-1">
                    {{ plugin.name }}
                  </h3>
                  <p class="text-sm text-neutral-muted">
                    {{ plugin.description }}
                  </p>
                  <div
                    v-if="plugin.supportedFormats && plugin.supportedFormats.length > 0"
                    class="flex items-center gap-2"
                  >
                    <Badge
                      v-for="format in plugin.supportedFormats"
                      :key="format"
                      variant="outline"
                    >
                      {{ format }}
                    </Badge>
                  </div>
                </div>
              </div>
            </div>
          </template>
        </div>

        <div class="mt-6 flex justify-end">
          <Button
            :disabled="!importType || proceedingToNext"
            :loading="proceedingToNext"
            @click="proceedToNextStep"
          >
            {{ $t("documents.import.source.next") }}
            <ChevronRight class="ml-2 h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>

    <!-- Step 2a: File Selection (for Upload) -->
    <Card v-if="currentStep === 2 && importType === 'upload'">
      <CardHeader>
        <CardTitle>{{ $t("documents.import.fileSelection.title") }}</CardTitle>
        <CardDescription>
          {{ $t("documents.import.fileSelection.description") }}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div
          class="border-2 border-dashed border-neutral-muted/25 rounded-lg p-12 text-center hover:border-neutral-muted/50 transition-colors cursor-pointer"
          :class="{ 'border-primary bg-primary/5': isDragging }"
          @click="selectFiles"
          @drop="handleDrop"
          @dragover.prevent="isDragging = true"
          @dragleave.prevent="isDragging = false"
          @dragenter.prevent
        >
          <Upload class="mx-auto h-16 w-16 text-neutral-muted mb-4" />
          <h3 class="text-lg mb-2">
            {{
              isDragging
                ? $t("documents.import.fileSelection.dropHere")
                : $t("documents.import.fileSelection.clickToUpload")
            }}
          </h3>
          <p class="text-sm text-neutral-muted mb-4">
            {{ $t("documents.import.fileSelection.fileSizeLimit") }}
          </p>
          <Button variant="outline">
            <Upload class="mr-2 h-4 w-4" />
            {{ $t("documents.import.fileSelection.browseFiles") }}
          </Button>
        </div>

        <!-- Selected Files List -->
        <div v-if="selectedFiles.length > 0" class="mt-6 space-y-2">
          <h4 class="font-medium mb-2">
            {{
              $t("documents.import.fileSelection.selectedFiles", { count: selectedFiles.length })
            }}
          </h4>
          <div
            v-for="(file, index) in selectedFiles"
            :key="index"
            class="flex items-center gap-3 p-3 bg-background-tertiary rounded-lg"
          >
            <component
              :is="getFileIcon(file.type)"
              class="h-5 w-5 text-neutral-muted flex-shrink-0"
            />
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium truncate">
                {{ file.name }}
              </p>
              <p class="text-xs text-neutral-muted">
                {{ formatFileSize(file.size) }}
              </p>
            </div>
            <Badge variant="outline">
              {{ getFileExtension(file.name) }}
            </Badge>
            <Button variant="ghost" size="sm" @click="removeFile(index)">
              <X class="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div class="mt-6 flex justify-between">
          <Button variant="outline" @click="currentStep = 1">
            <ChevronLeft class="mr-2 h-4 w-4" />
            {{ $t("documents.import.fileSelection.back") }}
          </Button>
          <Button :disabled="selectedFiles.length === 0" @click="proceedToNextStep">
            {{ $t("documents.import.fileSelection.nextAddDetails") }}
            <ChevronRight class="ml-2 h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>

    <!-- Step 2b: URL Input (for Web Import) -->
    <Card v-if="currentStep === 2 && importType === 'web'">
      <CardHeader>
        <CardTitle>{{ $t("documents.import.webUrl.title") }}</CardTitle>
        <CardDescription>
          {{ $t("documents.import.webUrl.description") }}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div class="space-y-4">
          <div>
            <Label for="website-url">{{ $t("documents.import.webUrl.label") }}</Label>
            <Input
              id="website-url"
              v-model="websiteUrl"
              type="url"
              :placeholder="$t('documents.import.webUrl.placeholder')"
              class="mt-2"
              @blur="normalizeWebsiteUrl"
            />
            <p class="text-xs text-neutral-muted mt-2">
              {{ $t("documents.import.webUrl.hint") }}
            </p>
          </div>

          <Alert>
            <AlertTitle>{{ $t("documents.import.webUrl.howItWorks") }}</AlertTitle>
            <AlertDescription>
              <ul class="list-disc list-inside mt-2 space-y-1 text-sm">
                <li>{{ $t("documents.import.webUrl.howItWorksList.sitemap") }}</li>
                <li>{{ $t("documents.import.webUrl.howItWorksList.crawl") }}</li>
                <li>{{ $t("documents.import.webUrl.howItWorksList.sameDomain") }}</li>
                <li>{{ $t("documents.import.webUrl.howItWorksList.markdown") }}</li>
              </ul>
            </AlertDescription>
          </Alert>
        </div>

        <div class="mt-6 flex justify-between">
          <Button variant="outline" @click="currentStep = 1">
            <ChevronLeft class="mr-2 h-4 w-4" />
            {{ $t("documents.import.fileSelection.back") }}
          </Button>
          <Button
            :loading="isProcessing"
            :disabled="!isValidUrl(websiteUrl)"
            @click="connectWebsite"
          >
            {{ $t("documents.import.webUrl.connectWebsite") }}
            <ChevronRight class="ml-2 h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>

    <!-- Step 3: Document Details (for Upload) -->
    <Card v-if="currentStep === 3 && importType === 'upload'">
      <CardHeader>
        <CardTitle>{{ $t("documents.import.details.title") }}</CardTitle>
        <CardDescription>
          {{ $t("documents.import.details.description") }}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div class="space-y-6">
          <!-- Document Details Form -->
          <div
            v-for="(file, index) in selectedFiles"
            :key="index"
            class="p-4 border rounded-lg space-y-4"
          >
            <div class="flex items-center gap-3 mb-4">
              <component :is="getFileIcon(file.type)" class="h-5 w-5 text-neutral-muted" />
              <span class="font-medium">{{ file.name }}</span>
              <Badge variant="outline">
                {{ getFileExtension(file.name) }}
              </Badge>
            </div>

            <div class="grid gap-4">
              <div>
                <Label :for="`name-${index}`">{{
                  $t("documents.import.details.documentName")
                }}</Label>
                <Input
                  :id="`name-${index}`"
                  v-model="file.documentName"
                  :placeholder="$t('documents.import.details.documentNamePlaceholder')"
                />
              </div>

              <div>
                <Label :for="`category-${index}`">{{
                  $t("documents.import.details.category")
                }}</Label>
                <Select v-model="file.category">
                  <SelectTrigger :id="`category-${index}`" class="w-full">
                    <SelectValue :placeholder="$t('documents.import.details.selectCategory')" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="product">
                      {{ $t("documents.import.details.categories.product") }}
                    </SelectItem>
                    <SelectItem value="api">{{
                      $t("documents.import.details.categories.api")
                    }}</SelectItem>
                    <SelectItem value="faq">{{
                      $t("documents.import.details.categories.faq")
                    }}</SelectItem>
                    <SelectItem value="legal">
                      {{ $t("documents.import.details.categories.legal") }}
                    </SelectItem>
                    <SelectItem value="training">
                      {{ $t("documents.import.details.categories.training") }}
                    </SelectItem>
                    <SelectItem value="technical">
                      {{ $t("documents.import.details.categories.technical") }}
                    </SelectItem>
                    <SelectItem value="other">
                      {{ $t("documents.import.details.categories.other") }}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label :for="`description-${index}`">{{
                  $t("documents.import.details.descriptionLabel")
                }}</Label>
                <Textarea
                  :id="`description-${index}`"
                  :model-value="file.description || ''"
                  :placeholder="$t('documents.import.details.descriptionPlaceholder')"
                  :rows="2"
                  @update:model-value="file.description = $event"
                />
              </div>

              <div class="flex items-center space-x-2">
                <Checkbox :id="`active-${index}`" v-model="file.isActive" />
                <Label :for="`active-${index}`" class="text-sm font-normal">
                  {{ $t("documents.import.details.makeAvailable") }}
                </Label>
              </div>
            </div>
          </div>
        </div>

        <div class="mt-6 flex justify-between">
          <Button variant="outline" @click="currentStep = 2">
            <ChevronLeft class="mr-2 h-4 w-4" />
            {{ $t("documents.import.fileSelection.back") }}
          </Button>
          <Button :loading="isProcessing" @click="startUpload">
            <Upload class="mr-2 h-4 w-4" />
            {{ $t("documents.import.details.startUpload") }}
          </Button>
        </div>
      </CardContent>
    </Card>

    <!-- Step 2: Plugin Connect -->
    <Card v-if="currentStep === 2 && importType.startsWith('plugin:') && activePluginImporter">
      <CardHeader>
        <CardTitle>Connect {{ activePluginImporter.name }}</CardTitle>
        <CardDescription>
          Provide the credentials this plugin needs to access your data.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <PluginImportConnect :plugin="activePluginImporter" @connected="handlePluginConnected" />
        <div class="mt-6 flex justify-between">
          <Button variant="outline" @click="currentStep = 1">
            <ChevronLeft class="mr-2 h-4 w-4" />
            {{ $t("documents.import.fileSelection.back") }}
          </Button>
        </div>
      </CardContent>
    </Card>

    <!-- Step 3: Plugin Source Picker -->
    <Card
      v-if="
        currentStep === 3 &&
        importType.startsWith('plugin:') &&
        activePluginImporter &&
        pluginInstanceId
      "
    >
      <CardHeader>
        <CardTitle>Pick a source</CardTitle>
        <CardDescription>
          Choose which {{ activePluginImporter.name }} content to keep in sync.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <PluginSpacePicker
          :plugin="activePluginImporter"
          :instance-id="pluginInstanceId"
          @source-created="handlePluginSourceCreated"
        />
        <div class="mt-6 flex justify-between">
          <Button variant="outline" @click="currentStep = 2">
            <ChevronLeft class="mr-2 h-4 w-4" />
            {{ $t("documents.import.fileSelection.back") }}
          </Button>
        </div>
      </CardContent>
    </Card>

    <!-- Step 4: Processing (Upload) -->
    <Card v-if="currentStep === 4 && importType === 'upload'">
      <CardHeader>
        <CardTitle>{{ $t("documents.import.processing.uploadingDocuments") }}</CardTitle>
        <CardDescription>
          {{ $t("documents.import.processing.documentsBeingProcessed") }}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <!-- Upload Progress -->
        <div class="space-y-4">
          <!-- Overall Progress -->
          <div class="mb-6">
            <div class="flex justify-between text-sm mb-2">
              <span>{{ $t("documents.import.processing.overallProgress") }}</span>
              <span>{{
                $t("documents.import.processing.files", {
                  uploaded: uploadedCount,
                  total: selectedFiles.length,
                })
              }}</span>
            </div>
            <Progress :value="(uploadedCount / selectedFiles.length) * 100" class="h-2" />
          </div>

          <!-- Individual File Progress -->
          <div v-for="(file, index) in selectedFiles" :key="index" class="p-4 border rounded-lg">
            <div class="flex items-center justify-between mb-2">
              <div class="flex items-center gap-2">
                <component :is="getFileIcon(file.type)" class="h-4 w-4 text-neutral-muted" />
                <span class="text-sm font-medium">{{ file.documentName || file.name }}</span>
              </div>
              <div class="flex items-center gap-2">
                <Badge
                  v-if="file.uploadStatus === 'completed'"
                  variant="default"
                  class="bg-green-600"
                >
                  <CheckCircle class="mr-1 h-3 w-3" />
                  {{ $t("documents.import.processing.completed") }}
                </Badge>
                <Badge v-else-if="file.uploadStatus === 'uploading'" variant="secondary">
                  <Loader2 class="mr-1 h-3 w-3 animate-spin" />
                  {{ $t("documents.import.processing.uploading") }}
                </Badge>
                <Badge v-else-if="file.uploadStatus === 'processing'" variant="secondary">
                  <Loader2 class="mr-1 h-3 w-3 animate-spin" />
                  {{ $t("documents.filters.processing") }}
                </Badge>
                <Badge v-else-if="file.uploadStatus === 'error'" variant="destructive">
                  <AlertCircle class="mr-1 h-3 w-3" />
                  {{ $t("documents.filters.error") }}
                </Badge>
                <Badge v-else variant="outline">
                  {{ $t("documents.import.processing.pending") }}
                </Badge>
              </div>
            </div>

            <Progress
              :value="
                file.uploadStatus === 'completed'
                  ? 100
                  : file.uploadStatus === 'processing'
                    ? 50
                    : file.uploadStatus === 'uploading'
                      ? 25
                      : 0
              "
              class="h-1"
            />

            <div
              v-if="file.uploadStatus === 'error'"
              class="mt-2 p-2 bg-destructive/10 rounded text-sm text-destructive"
            >
              {{ file.errorMessage || $t("documents.import.processing.uploadFailed") }}
            </div>
          </div>
        </div>

        <div class="mt-6 flex justify-between">
          <Button variant="outline" :disabled="isProcessing" @click="resetImport">
            {{ $t("documents.import.processing.importMoreDocuments") }}
          </Button>
          <Button
            :disabled="isProcessing"
            @click="
              () => {
                const redirectPath = route.query.redirect as string;
                router.push(redirectPath || '/documents');
              }
            "
          >
            <CheckCircle class="mr-2 h-4 w-4" />
            {{
              route.query.redirect
                ? $t("documents.import.processing.continue")
                : $t("documents.import.processing.viewDocuments")
            }}
          </Button>
        </div>
      </CardContent>
    </Card>
  </Page>
</template>

<script setup lang="ts">
import {
  Upload,
  ChevronRight,
  ChevronLeft,
  X,
  FileText,
  FileCode,
  FileJson,
  File,
  CheckCircle,
  AlertCircle,
  Loader2,
  Globe,
  Package,
  HelpCircle,
} from "lucide-vue-next";
import { Hay } from "@/utils/api";
import { useDocumentImportTour } from "@/composables/useDocumentImportTour";
import { useToast } from "@/composables/useToast";

const router = useRouter();
const route = useRoute();
const toast = useToast();
const { t } = useI18n();
const { startTour, shouldShowTour } = useDocumentImportTour();

interface UploadFile extends File {
  documentName?: string;
  category?: string;
  description?: string;
  tags?: string;
  isActive?: boolean;
  uploadStatus?: "pending" | "uploading" | "processing" | "completed" | "error";
  errorMessage?: string;
}

// State
const currentStep = ref(1);
const importType = ref<string>("");
const selectedFiles = ref<UploadFile[]>([]);
const isDragging = ref(false);
const isProcessing = ref(false);
const uploadedCount = ref(0);
const websiteUrl = ref("");

interface PluginImporter {
  id: string;
  pluginId: string;
  name: string;
  description: string;
  icon?: string;
  thumbnail?: string | null;
  connected: boolean;
  sourceIds?: string[];
  supportedFormats?: string[];
}

const pluginImporters = ref<PluginImporter[]>([]);
const pluginThumbFailed = reactive<Record<string, boolean>>({});
const { getApiUrl: getApiBase } = useDomain();
const pluginThumbUrl = (pluginId: string) =>
  `${getApiBase()}/plugins/thumbnails/${encodeURIComponent(pluginId)}`;

// Import from server types (these would normally come from generated tRPC types)
enum DocumentationType {
  ARTICLE = "article",
  GUIDE = "guide",
  FAQ = "faq",
  TUTORIAL = "tutorial",
  REFERENCE = "reference",
  POLICY = "policy",
}

enum DocumentationStatus {
  DRAFT = "draft",
  PUBLISHED = "published",
  ARCHIVED = "archived",
  UNDER_REVIEW = "under_review",
}

enum DocumentVisibility {
  PUBLIC = "public",
  PRIVATE = "private",
  INTERNAL = "internal",
}

// Computed steps based on import type
const steps = computed(() => {
  if (importType.value === "web") {
    return [t("documents.import.steps.selectSource"), t("documents.import.steps.enterUrl")];
  } else if (importType.value === "upload") {
    return [
      t("documents.import.steps.selectSource"),
      t("documents.import.steps.selectFiles"),
      t("documents.import.steps.addDetails"),
      t("documents.import.steps.upload"),
    ];
  } else if (importType.value.startsWith("plugin:")) {
    return [t("documents.import.steps.selectSource"), "Connect", "Pick source"];
  } else {
    return [t("documents.import.steps.selectSource")];
  }
});

// Plugin import state. Resolved from the importType when it starts with
// "plugin:<id>", letting us look up the matching importer entry.
const activePluginImporter = computed<PluginImporter | null>(() => {
  if (!importType.value.startsWith("plugin:")) return null;
  const id = importType.value.slice("plugin:".length);
  return pluginImporters.value.find((p) => p.id === id) ?? null;
});

// Once the user has finished the connect step (or the plugin was already
// connected when the page loaded) we hold the instance id here so the picker
// can call listRoots and create a source against it.
const pluginInstanceId = ref<string | null>(null);

const handlePluginConnected = (payload: { instanceId: string }) => {
  pluginInstanceId.value = payload.instanceId;
  currentStep.value = 3;
};

const handlePluginSourceCreated = (payload: { sourceId: string }) => {
  const redirectPath = route.query.redirect as string;
  if (redirectPath) {
    router.push(redirectPath);
    return;
  }
  // Land on the source detail page, which polls sync status live and shows
  // per-page progress as the importer creates placeholder documents.
  router.push(`/documents/sources/${payload.sourceId}`);
};

const uploadFormats = ["PDF", "TXT", "MD", "DOC", "DOCX", "PPT", "PPTX", "HTML", "JSON", "CSV"];

// Load available importers
onMounted(async () => {
  try {
    const importers = await Hay.documents.getImporters.query();
    pluginImporters.value = (importers as { plugins?: PluginImporter[] }).plugins || [];
  } catch (error) {
    console.error("Failed to load importers:", error);
  }

  // Add global drag and drop listeners for step 1
  document.addEventListener("dragover", handleGlobalDragOver);
  document.addEventListener("dragleave", handleGlobalDragLeave);
  document.addEventListener("drop", handleGlobalDrop);

  // Auto-start tutorial if first time
  if (shouldShowTour()) {
    setTimeout(() => startTour(), 500);
  }
});

// Clean up on unmount
onBeforeUnmount(async () => {
  // Remove global drag and drop listeners
  document.removeEventListener("dragover", handleGlobalDragOver);
  document.removeEventListener("dragleave", handleGlobalDragLeave);
  document.removeEventListener("drop", handleGlobalDrop);
});

// Methods

const selectImportType = (type: string) => {
  importType.value = type;
};

const proceedingToNext = ref(false);

const proceedToNextStep = () => {
  if (currentStep.value === 1 && importType.value) {
    // Plugin importers that already have a configured instance skip the
    // credentials step and go straight to picking a space.
    if (importType.value.startsWith("plugin:")) {
      const plugin = activePluginImporter.value;
      if (plugin?.connected) {
        // We don't have the instanceId from getImporters yet; fetch it from
        // the plugin detail endpoint before advancing.
        proceedingToNext.value = true;
        Hay.plugins.get
          .query({ pluginId: plugin.pluginId })
          .then((data) => {
            if (data?.instanceId) {
              pluginInstanceId.value = data.instanceId;
              currentStep.value = 3;
            } else {
              // Fall back to the connect step if no instance was found.
              currentStep.value = 2;
            }
          })
          .catch(() => {
            currentStep.value = 2;
          })
          .finally(() => {
            proceedingToNext.value = false;
          });
        return;
      }
    }
    currentStep.value = 2;
  } else if (currentStep.value === 2 && importType.value === "upload") {
    currentStep.value = 3;
  }
};

const isValidUrl = (url: string) => {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
};

const normalizeWebsiteUrl = () => {
  const value = websiteUrl.value.trim();
  if (value && !/^https?:\/\//i.test(value)) {
    websiteUrl.value = `https://${value}`;
  }
};

/**
 * Connect a website as a document source. Replaces the old discover→select→
 * import wizard: we create a `website` DocumentSource (built-in importer) and
 * land on its detail page, which polls sync status and shows pages appearing
 * as the importer crawls — same UX as plugin sources.
 */
const connectWebsite = async () => {
  if (!isValidUrl(websiteUrl.value)) return;

  isProcessing.value = true;
  try {
    const source = await Hay.documentSources.createWebsite.mutate({
      url: websiteUrl.value,
    });

    const redirectPath = route.query.redirect as string;
    router.push(redirectPath || `/documents/sources/${source.id}`);
  } catch (error) {
    console.error("Failed to connect website:", error);
    toast.error(
      t("documents.import.toast.webConnectFailed"),
      t("documents.import.toast.webConnectFailedMessage"),
    );
    isProcessing.value = false;
  }
};

// pollJobStatus is no longer needed - WebSocket handles real-time updates

const getFileIcon = (type: string) => {
  const mimeType = type.toLowerCase();
  if (
    mimeType.includes("pdf") ||
    mimeType.includes("doc") ||
    mimeType.includes("ppt") ||
    mimeType.includes("presentation")
  )
    return FileText;
  if (mimeType.includes("json")) return FileJson;
  if (mimeType.includes("text") || mimeType.includes("markdown")) return FileCode;
  return File;
};

const getFileExtension = (filename: string) => {
  const parts = filename.split(".");
  return parts.length > 1 ? parts.pop()?.toUpperCase() : "FILE";
};

const formatFileSize = (bytes: number) => {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
};

const selectFiles = () => {
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = true;
  input.accept = ".pdf,.txt,.md,.doc,.docx,.ppt,.pptx,.html,.json,.csv";
  input.onchange = (e) => {
    const target = e.target as HTMLInputElement;
    if (target.files) {
      addFiles(Array.from(target.files));
    }
  };
  input.click();
};

const handleDrop = (e: DragEvent) => {
  e.preventDefault();
  isDragging.value = false;

  if (e.dataTransfer?.files) {
    addFiles(Array.from(e.dataTransfer.files));
  }
};

const addFiles = (files: File[]) => {
  const validFiles = files.filter((file) => {
    // Check file size (10MB limit)
    if (file.size > 10 * 1024 * 1024) {
      console.error(`File ${file.name} exceeds 10MB limit`);
      return false;
    }

    // Check file type
    const validTypes = ["pdf", "txt", "md", "doc", "docx", "ppt", "pptx", "html", "json", "csv"];
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (!extension || !validTypes.includes(extension)) {
      console.error(`File ${file.name} has unsupported format`);
      return false;
    }

    return true;
  });

  // Add files with default metadata
  validFiles.forEach((file) => {
    const uploadFile = file as UploadFile;
    uploadFile.documentName = file.name.replace(/\.[^/.]+$/, "");
    uploadFile.category = "";
    uploadFile.description = "";
    uploadFile.tags = "";
    uploadFile.isActive = true;
    uploadFile.uploadStatus = "pending";

    selectedFiles.value.push(uploadFile);
  });
};

// Global drag and drop handlers for step 1
const handleGlobalDragOver = (e: DragEvent) => {
  if (currentStep.value === 1) {
    e.preventDefault();
    e.stopPropagation();
    isDragging.value = true;
  }
};

const handleGlobalDragLeave = (e: DragEvent) => {
  if (currentStep.value === 1) {
    e.preventDefault();
    e.stopPropagation();
    // Only set to false if we're leaving the window
    if (e.clientX === 0 && e.clientY === 0) {
      isDragging.value = false;
    }
  }
};

const handleGlobalDrop = (e: DragEvent) => {
  if (currentStep.value === 1) {
    e.preventDefault();
    e.stopPropagation();
    isDragging.value = false;

    if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
      // Select upload type automatically
      selectImportType("upload");

      // Add the files
      addFiles(Array.from(e.dataTransfer.files));

      // Proceed to file selection step
      currentStep.value = 2;
    }
  }
};

const removeFile = (index: number) => {
  selectedFiles.value.splice(index, 1);
};

const startUpload = async () => {
  currentStep.value = 4;
  isProcessing.value = true;
  uploadedCount.value = 0;

  const authToken = useCookie("auth-token");
  const organizationId = authToken.value ? "org_default" : "default";

  try {
    // Upload files sequentially
    for (let i = 0; i < selectedFiles.value.length; i++) {
      const file = selectedFiles.value[i];
      file.uploadStatus = "uploading";

      try {
        // Read file content as base64
        const fileBuffer = await fileToBase64(file as File);

        // Prepare the document data
        const documentData = {
          title: file.documentName || file.name,
          content: file.description || `Document: ${file.name}`,
          fileBuffer: fileBuffer,
          mimeType: file.type,
          fileName: file.name,
          organizationId: organizationId,
          type: mapCategoryToDocumentType(file.category || ""),
          status: file.isActive ? DocumentationStatus.PUBLISHED : DocumentationStatus.DRAFT,
          visibility: DocumentVisibility.PRIVATE,
        };

        file.uploadStatus = "processing";

        // Upload using tRPC
        const response = await Hay.documents.create.mutate(documentData);

        if (response && response.id) {
          file.uploadStatus = "completed";
          uploadedCount.value++;
        } else {
          throw new Error("Invalid response from server");
        }
      } catch (fileError) {
        console.error(`Upload error for ${file.name}:`, fileError);
        file.uploadStatus = "error";
        file.errorMessage = fileError instanceof Error ? fileError.message : "Upload failed";
      }
    }

    // Check if all files uploaded successfully
    const allSuccess = selectedFiles.value.every((f) => f.uploadStatus === "completed");

    if (allSuccess) {
      console.log(`Successfully uploaded ${uploadedCount.value} document(s)`);
      toast.success(
        t(
          "documents.import.toast.uploadSuccess",
          { count: uploadedCount.value },
          uploadedCount.value,
        ),
      );
    } else {
      const failedCount = selectedFiles.value.filter((f) => f.uploadStatus === "error").length;

      if (failedCount > 0) {
        console.log(`${uploadedCount.value} succeeded, ${failedCount} failed`);
        if (uploadedCount.value > 0) {
          toast.warning(
            t(
              "documents.import.toast.uploadPartial",
              { success: uploadedCount.value, failed: failedCount },
              uploadedCount.value,
            ),
          );
        } else {
          toast.error(
            t("documents.import.toast.uploadFailed", { count: failedCount }, failedCount),
          );
        }
      }
    }
  } catch (error) {
    console.error("Upload error:", error);

    // Mark all pending files as error
    for (const file of selectedFiles.value) {
      if (file.uploadStatus === "uploading" || file.uploadStatus === "pending") {
        file.uploadStatus = "error";
        file.errorMessage = error instanceof Error ? error.message : "Upload failed";
      }
    }
  } finally {
    isProcessing.value = false;
  }
};

// Helper function to convert file to base64
const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      // Remove the data:*/*;base64, prefix
      const base64 = (reader.result as string).split(",")[1];
      resolve(base64);
    };
    reader.onerror = (error) => reject(error);
  });
};

// Map UI category to server DocumentationType enum
const mapCategoryToDocumentType = (category: string): DocumentationType => {
  const mapping: Record<string, DocumentationType> = {
    product: DocumentationType.GUIDE,
    api: DocumentationType.REFERENCE,
    faq: DocumentationType.FAQ,
    legal: DocumentationType.POLICY,
    training: DocumentationType.TUTORIAL,
    technical: DocumentationType.REFERENCE,
    other: DocumentationType.ARTICLE,
  };
  return mapping[category] || DocumentationType.ARTICLE;
};

const resetImport = () => {
  currentStep.value = 1;
  importType.value = "";
  selectedFiles.value = [];
  uploadedCount.value = 0;
  websiteUrl.value = "";
};

const startTutorial = () => {
  // Reset to step 1 if needed
  if (currentStep.value !== 1) {
    currentStep.value = 1;
  }
  startTour();
};

// SEO
useHead({
  title: t("documents.import.page.seoTitle"),
  meta: [{ name: "description", content: t("documents.import.page.seoDescription") }],
});
</script>
