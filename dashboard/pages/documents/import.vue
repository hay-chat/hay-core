<template>
  <div class="max-w-4xl mx-auto space-y-8 relative">
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
        <h3 class="text-2xl font-bold mb-2">Drop files to upload</h3>
        <p class="text-neutral-muted">Release to start importing your documents</p>
      </div>
    </div>

    <!-- Page Header -->
    <div>
      <div class="flex items-center gap-2 text-sm text-neutral-muted mb-4">
        <NuxtLink to="/documents" class="hover:text-foreground"> Documents </NuxtLink>
        <ChevronRight class="h-4 w-4" />
        <span>Import</span>
      </div>
      <h1 class="text-3xl font-bold text-foreground">Import Document</h1>
      <p class="mt-2 text-neutral-muted">
        Add new documents to your knowledge base from various sources.
      </p>
    </div>

    <!-- Import Steps Progress -->
    <div class="flex items-center justify-between mb-8">
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
        <CardTitle>Select Import Source</CardTitle>
        <CardDescription>
          Choose how you want to import documents into your knowledge base.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div class="grid gap-4">
          <!-- Upload Files Option -->
          <div
            class="p-6 border-2 rounded-lg cursor-pointer hover:border-primary transition-colors"
            :class="{ 'border-primary bg-primary/5': importType === 'upload' }"
            @click="selectImportType('upload')"
          >
            <div class="flex items-start gap-4">
              <div class="p-3 bg-background-tertiary rounded-lg">
                <Upload class="h-6 w-6 text-neutral-muted" />
              </div>
              <div class="flex-1">
                <h3 class="font-semibold mb-1">Upload Files</h3>
                <p class="text-sm text-neutral-muted mb-2">Upload documents from your computer</p>
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
            @click="selectImportType('web')"
          >
            <div class="flex items-start gap-4">
              <div class="p-3 bg-background-tertiary rounded-lg">
                <Globe class="h-6 w-6 text-neutral-muted" />
              </div>
              <div class="flex-1">
                <h3 class="font-semibold mb-1">Import from Website</h3>
                <p class="text-sm text-neutral-muted mb-2">
                  Crawl and import documentation from any website
                </p>
                <div class="flex flex-wrap gap-2">
                  <Badge variant="outline"> HTML </Badge>
                  <Badge variant="outline"> Auto-crawl </Badge>
                  <Badge variant="outline"> Sitemap </Badge>
                </div>
              </div>
            </div>
          </div>

          <!-- Plugin Importers (if available) -->
          <template v-if="pluginImporters.length > 0">
            <div
              v-for="plugin in pluginImporters"
              :key="plugin.id"
              class="p-6 border-2 rounded-lg cursor-pointer hover:border-primary transition-colors"
              :class="{
                'border-primary bg-primary/5': importType === `plugin:${plugin.id}`,
              }"
              @click="selectImportType(`plugin:${plugin.id}`)"
            >
              <div class="flex items-start gap-4">
                <div class="p-3 bg-background-tertiary rounded-lg">
                  <Package class="h-6 w-6 text-neutral-muted" />
                </div>
                <div class="flex-1">
                  <h3 class="font-semibold mb-1">
                    {{ plugin.name }}
                  </h3>
                  <p class="text-sm text-neutral-muted mb-2">
                    {{ plugin.description }}
                  </p>
                  <div class="flex items-center gap-2">
                    <Badge variant="secondary"> Plugin </Badge>
                    <template v-if="plugin.supportedFormats">
                      <Badge
                        v-for="format in plugin.supportedFormats"
                        :key="format"
                        variant="outline"
                      >
                        {{ format }}
                      </Badge>
                    </template>
                  </div>
                </div>
              </div>
            </div>
          </template>
        </div>

        <div class="mt-6 flex justify-end">
          <Button :disabled="!importType" @click="proceedToNextStep">
            Next
            <ChevronRight class="ml-2 h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>

    <!-- Step 2a: File Selection (for Upload) -->
    <Card v-if="currentStep === 2 && importType === 'upload'">
      <CardHeader>
        <CardTitle>Select Files</CardTitle>
        <CardDescription>
          Choose one or more documents to upload. Supported formats: PDF, TXT, MD, DOC, DOCX, HTML,
          JSON, CSV
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
          <h3 class="text-lg font-semibold mb-2">
            {{ isDragging ? "Drop files here" : "Click to upload or drag and drop" }}
          </h3>
          <p class="text-sm text-neutral-muted mb-4">Support for multiple files up to 10MB each</p>
          <Button variant="outline">
            <Upload class="mr-2 h-4 w-4" />
            Browse Files
          </Button>
        </div>

        <!-- Selected Files List -->
        <div v-if="selectedFiles.length > 0" class="mt-6 space-y-2">
          <h4 class="font-medium mb-2">Selected Files ({{ selectedFiles.length }})</h4>
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
            Back
          </Button>
          <Button :disabled="selectedFiles.length === 0" @click="proceedToNextStep">
            Next: Add Details
            <ChevronRight class="ml-2 h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>

    <!-- Step 2b: URL Input (for Web Import) -->
    <Card v-if="currentStep === 2 && importType === 'web'">
      <CardHeader>
        <CardTitle>Enter Website URL</CardTitle>
        <CardDescription>
          Provide the URL of the documentation website you want to import.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div class="space-y-4">
          <div>
            <Label for="website-url">Documentation URL</Label>
            <Input
              id="website-url"
              v-model="websiteUrl"
              type="url"
              placeholder="https://docs.example.com"
              class="mt-2"
            />
            <p class="text-xs text-neutral-muted mt-2">
              We'll crawl this website and import all documentation pages automatically.
            </p>
          </div>

          <Alert>
            <AlertTitle>How it works</AlertTitle>
            <AlertDescription>
              <ul class="list-disc list-inside mt-2 space-y-1 text-sm">
                <li>We'll check for a sitemap.xml file first</li>
                <li>If no sitemap is found, we'll crawl all internal links</li>
                <li>Only pages from the same domain will be imported</li>
                <li>Content will be converted to clean markdown format</li>
              </ul>
            </AlertDescription>
          </Alert>
        </div>

        <div class="mt-6 flex justify-between">
          <Button variant="outline" @click="currentStep = 1">
            <ChevronLeft class="mr-2 h-4 w-4" />
            Back
          </Button>
          <Button :disabled="!isValidUrl(websiteUrl) || isDiscovering" @click="discoverPages">
            {{ isDiscovering ? "Discovering..." : "Discover Pages" }}
            <ChevronRight class="ml-2 h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>

    <!-- Step 3: Page Discovery/Selection (for Web Import) -->
    <Card v-if="currentStep === 3 && importType === 'web'">
      <CardHeader>
        <CardTitle>
          {{ isDiscovering ? "Discovering Pages" : "Select Pages to Import" }}
        </CardTitle>
        <CardDescription>
          {{
            isDiscovering
              ? "Scanning website for documentation pages. This may take a few minutes..."
              : `Found ${discoveredPages.length} pages. Select which ones to import to your knowledge base.`
          }}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <!-- Loading State -->
        <div v-if="isDiscovering" class="space-y-6 py-8">
          <div class="flex flex-col items-center justify-center">
            <div class="relative">
              <!-- Pulsing background circle -->
              <div class="absolute inset-0 w-20 h-20 bg-primary/20 rounded-full animate-pulse" />
              <!-- Static outer ring -->
              <div class="w-20 h-20 border-4 border-muted rounded-full" />
              <!-- Spinning ring -->
              <div
                class="absolute top-0 left-0 w-20 h-20 border-4 border-primary border-t-transparent rounded-full animate-spin"
              />
              <!-- Globe icon with subtle bounce -->
              <Globe
                class="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 h-8 w-8 text-primary animate-pulse"
              />
            </div>

            <div class="mt-6 text-center space-y-2">
              <p class="text-lg font-medium">
                {{ getDiscoveryStatusText() }}
              </p>

              <!-- Total URLs found (main info) -->
              <p class="text-base font-medium text-foreground">
                {{
                  discoveryProgress && discoveryProgress.found > 0
                    ? `Found ${discoveryProgress.found} URLs`
                    : "Starting discovery..."
                }}
              </p>

              <!-- Successfully processed pages (in green below) -->
              <div
                v-if="discoveryProgress && discoveryProgress.processed > 0"
                class="flex items-center justify-center gap-1 mt-2"
              >
                <CheckCircle class="h-4 w-4 text-green-600" />
                <span class="text-sm text-green-600 font-medium"
                  >{{ discoveryProgress.processed }} pages validated</span
                >
              </div>
            </div>

            <div class="mt-6 w-full max-w-md">
              <Progress
                :value="
                  discoveryProgress
                    ? (discoveryProgress.processed / Math.max(discoveryProgress.total, 1)) * 100
                    : 0
                "
                class="h-2"
              />
              <p
                v-if="discoveryProgress?.currentUrl"
                class="mt-2 text-xs text-neutral-muted text-center truncate"
              >
                Scanning: {{ discoveryProgress.currentUrl }}
              </p>
            </div>

            <Alert class="mt-6 max-w-md">
              <AlertTitle>Please wait</AlertTitle>
              <AlertDescription>
                <ul class="list-disc list-inside mt-2 space-y-1 text-sm">
                  <li>Stay on this page while we discover all documentation</li>
                  <li>This process typically takes 1-3 minutes</li>
                  <li>We're checking for sitemaps and crawling internal links</li>
                </ul>
              </AlertDescription>
            </Alert>

            <Button variant="outline" class="mt-4" @click="cancelDiscovery">
              Cancel Discovery
            </Button>
          </div>
        </div>

        <!-- Page Selection (shown after discovery) -->
        <div v-else class="space-y-4">
          <!-- Select/Deselect All -->
          <div class="flex items-center justify-between p-3 bg-background-tertiary rounded-lg">
            <div class="flex items-center space-x-2">
              <Checkbox
                :checked="discoveredPages.every((p) => p.selected)"
                @update:checked="
                  (checked) => discoveredPages.forEach((p) => (p.selected = checked))
                "
              />
              <Label class="text-sm font-medium">
                Select All ({{ discoveredPages.filter((p) => p.selected).length }}
                selected)
              </Label>
            </div>
            <Badge variant="outline">
              {{ discoveredPages.filter((p) => p.selected).length }} /
              {{ discoveredPages.length }} pages
            </Badge>
          </div>

          <!-- Page List -->
          <div class="max-h-96 overflow-y-auto space-y-2 border rounded-lg p-2">
            <div
              v-for="(page, index) in discoveredPages"
              :key="index"
              class="flex items-start gap-3 p-3 hover:bg-background-secondary rounded-lg transition-colors"
            >
              <Checkbox v-model="page.selected" class="mt-1" />
              <div class="flex-1 min-w-0">
                <p class="font-medium text-sm truncate">
                  {{ page.title || "Untitled Page" }}
                </p>
                <p class="text-xs text-neutral-muted truncate">
                  {{ page.url }}
                </p>
                <p v-if="page.description" class="text-xs text-neutral-muted mt-1 line-clamp-2">
                  {{ page.description }}
                </p>
              </div>
              <Button variant="ghost" size="sm" @click="() => openExternalLink(page.url)">
                <ExternalLink class="h-3 w-3" />
              </Button>
            </div>
          </div>

          <Alert>
            <AlertTitle>Tip</AlertTitle>
            <AlertDescription>
              Review the pages carefully. You can deselect any pages that aren't relevant
              documentation.
            </AlertDescription>
          </Alert>
        </div>
        <!-- End of page selection div -->

        <div class="mt-6 flex justify-between">
          <Button variant="outline" @click="currentStep = 2">
            <ChevronLeft class="mr-2 h-4 w-4" />
            Back
          </Button>
          <Button :disabled="!discoveredPages.some((p) => p.selected)" @click="currentStep = 4">
            Next: Add Metadata
            <ChevronRight class="ml-2 h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>

    <!-- Step 4: Metadata (for Web Import) -->
    <Card v-if="currentStep === 4 && importType === 'web'">
      <CardHeader>
        <CardTitle>Document Metadata</CardTitle>
        <CardDescription>
          Configure how these
          {{ discoveredPages.filter((p) => p.selected).length }} pages will be stored in your
          knowledge base.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div class="space-y-6">
          <div>
            <Label for="web-doc-type">Document Type</Label>
            <select
              id="web-doc-type"
              v-model="webMetadata.type"
              class="w-full mt-2 px-3 py-2 border border-input bg-background rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="article">Article</option>
              <option value="guide">Guide</option>
              <option value="faq">FAQ</option>
              <option value="tutorial">Tutorial</option>
              <option value="reference">Reference</option>
              <option value="policy">Policy</option>
            </select>
          </div>

          <div>
            <Label for="web-doc-status">Status</Label>
            <select
              id="web-doc-status"
              v-model="webMetadata.status"
              class="w-full mt-2 px-3 py-2 border border-input bg-background rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="published">Published</option>
              <option value="draft">Draft</option>
              <option value="under_review">Under Review</option>
            </select>
          </div>

          <div>
            <Label for="web-doc-visibility">Visibility</Label>
            <select
              id="web-doc-visibility"
              v-model="webMetadata.visibility"
              class="w-full mt-2 px-3 py-2 border border-input bg-background rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="private">Private</option>
              <option value="internal">Internal</option>
              <option value="public">Public</option>
            </select>
          </div>

          <div>
            <Label for="web-doc-tags">Tags</Label>
            <Input
              id="web-doc-tags"
              v-model="webMetadata.tagsString"
              placeholder="Enter tags separated by commas"
              class="mt-2"
              @input="
                webMetadata.tags = ($event.target as HTMLInputElement).value
                  .split(',')
                  .map((t) => t.trim())
                  .filter((t) => t)
              "
            />
            <p class="text-xs text-neutral-muted mt-1">e.g., documentation, api, reference</p>
          </div>

          <div>
            <Label for="web-doc-categories">Categories</Label>
            <Input
              id="web-doc-categories"
              v-model="webMetadata.categoriesString"
              placeholder="Enter categories separated by commas"
              class="mt-2"
              @input="
                webMetadata.categories = ($event.target as HTMLInputElement).value
                  .split(',')
                  .map((c) => c.trim())
                  .filter((c) => c)
              "
            />
          </div>

          <!-- Preview of selected pages -->
          <div class="border-t pt-4">
            <h4 class="text-sm font-medium mb-2">Selected Pages Summary</h4>
            <div class="text-sm text-neutral-muted space-y-1">
              <p>• {{ discoveredPages.filter((p) => p.selected).length }} pages will be imported</p>
              <p>• Each page will be converted to markdown format</p>
              <p>• Content will be chunked and vectorized for AI search</p>
            </div>
          </div>
        </div>

        <div class="mt-6 flex justify-between">
          <Button variant="outline" @click="currentStep = 3">
            <ChevronLeft class="mr-2 h-4 w-4" />
            Back
          </Button>
          <Button @click="startWebImport">
            <Upload class="mr-2 h-4 w-4" />
            Start Import
          </Button>
        </div>
      </CardContent>
    </Card>

    <!-- Step 3: Document Details (for Upload) -->
    <Card v-if="currentStep === 3 && importType === 'upload'">
      <CardHeader>
        <CardTitle>Document Details</CardTitle>
        <CardDescription>
          Provide metadata for your documents to help with organization and searchability.
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
                <Label :for="`name-${index}`">Document Name</Label>
                <Input
                  :id="`name-${index}`"
                  v-model="file.documentName"
                  placeholder="Enter a descriptive name"
                />
              </div>

              <div>
                <Label :for="`category-${index}`">Category</Label>
                <select
                  :id="`category-${index}`"
                  v-model="file.category"
                  class="w-full px-3 py-2 border border-input bg-background rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">Select a category</option>
                  <option value="product">Product Documentation</option>
                  <option value="api">API Reference</option>
                  <option value="faq">FAQs</option>
                  <option value="legal">Legal Documents</option>
                  <option value="training">Training Materials</option>
                  <option value="technical">Technical Specs</option>
                  <option value="other">Other</option>
                </select>
              </div>

              <div>
                <Label :for="`description-${index}`">Description</Label>
                <Textarea
                  :id="`description-${index}`"
                  :model-value="file.description || ''"
                  placeholder="Brief description of the document's contents"
                  :rows="2"
                  @update:model-value="file.description = $event"
                />
              </div>

              <div>
                <Label :for="`tags-${index}`">Tags</Label>
                <Input
                  :id="`tags-${index}`"
                  v-model="file.tags"
                  placeholder="Enter tags separated by commas"
                />
                <p class="text-xs text-neutral-muted mt-1">e.g., customer-support, billing, api</p>
              </div>

              <div class="flex items-center space-x-2">
                <Checkbox :id="`active-${index}`" v-model="file.isActive" />
                <Label :for="`active-${index}`" class="text-sm font-normal">
                  Make this document immediately available to AI agents
                </Label>
              </div>
            </div>
          </div>
        </div>

        <div class="mt-6 flex justify-between">
          <Button variant="outline" @click="currentStep = 2">
            <ChevronLeft class="mr-2 h-4 w-4" />
            Back
          </Button>
          <Button @click="startUpload">
            <Upload class="mr-2 h-4 w-4" />
            Start Upload
          </Button>
        </div>
      </CardContent>
    </Card>

    <!-- Step 5/4: Processing -->
    <Card
      v-if="
        (currentStep === 5 && importType === 'web') ||
        (currentStep === 4 && importType === 'upload')
      "
    >
      <CardHeader>
        <CardTitle>
          {{ importType === "web" ? "Importing from Website" : "Uploading Documents" }}
        </CardTitle>
        <CardDescription>
          {{
            importType === "web"
              ? "Your website is being crawled and processed."
              : "Your documents are being processed and added to the knowledge base."
          }}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <!-- Web Import Progress -->
        <div v-if="importType === 'web' && webImportJob" class="space-y-4">
          <div class="p-4 bg-background-tertiary rounded-lg">
            <div class="flex items-center justify-between mb-2">
              <span class="text-sm font-medium">Import Status</span>
              <Badge
                v-if="webImportJob.status === 'completed'"
                variant="default"
                class="bg-green-600"
              >
                <CheckCircle class="mr-1 h-3 w-3" />
                Completed
              </Badge>
              <Badge v-else-if="webImportJob.status === 'processing'" variant="secondary">
                <Loader2 class="mr-1 h-3 w-3 animate-spin" />
                Processing
              </Badge>
              <Badge v-else-if="webImportJob.status === 'failed'" variant="destructive">
                <AlertCircle class="mr-1 h-3 w-3" />
                Failed
              </Badge>
              <Badge v-else variant="outline"> Queued </Badge>
            </div>

            <div v-if="webImportProgress" class="space-y-2">
              <div class="flex justify-between text-sm">
                <span>Progress</span>
                <span
                  >{{ webImportProgress?.processedPages }}/{{
                    webImportProgress?.totalPages
                  }}
                  pages</span
                >
              </div>
              <Progress
                :value="
                  ((webImportProgress?.processedPages || 0) /
                    Math.max(webImportProgress?.totalPages || 1, 1)) *
                  100
                "
                class="h-2"
              />
              <p v-if="webImportProgress?.currentUrl" class="text-xs text-neutral-muted truncate">
                Processing: {{ webImportProgress.currentUrl }}
              </p>
            </div>
          </div>
        </div>

        <!-- Upload Progress -->
        <div v-else class="space-y-4">
          <!-- Overall Progress -->
          <div class="mb-6">
            <div class="flex justify-between text-sm mb-2">
              <span>Overall Progress</span>
              <span>{{ uploadedCount }}/{{ selectedFiles.length }} files</span>
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
                  Completed
                </Badge>
                <Badge v-else-if="file.uploadStatus === 'uploading'" variant="secondary">
                  <Loader2 class="mr-1 h-3 w-3 animate-spin" />
                  Uploading
                </Badge>
                <Badge v-else-if="file.uploadStatus === 'processing'" variant="secondary">
                  <Loader2 class="mr-1 h-3 w-3 animate-spin" />
                  Processing
                </Badge>
                <Badge v-else-if="file.uploadStatus === 'error'" variant="destructive">
                  <AlertCircle class="mr-1 h-3 w-3" />
                  Error
                </Badge>
                <Badge v-else variant="outline"> Pending </Badge>
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
              {{ file.errorMessage || "Upload failed. Please try again." }}
            </div>
          </div>
        </div>

        <div class="mt-6 flex justify-between">
          <Button variant="outline" :disabled="isProcessing" @click="resetImport">
            Import More Documents
          </Button>
          <Button :disabled="isProcessing" @click="router.push('/documents')">
            <CheckCircle class="mr-2 h-4 w-4" />
            View Documents
          </Button>
        </div>
      </CardContent>
    </Card>
  </div>
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
  ExternalLink,
} from "lucide-vue-next";
import { Hay } from "@/utils/api";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

const router = useRouter();

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
interface WebImportJob {
  id: string;
  status: string;
}

interface WebImportProgress {
  processedPages: number;
  totalPages: number;
  currentUrl?: string;
}

interface PluginImporter {
  id: string;
  name: string;
  description: string;
  supportedFormats?: string[];
}

interface DiscoveredPage {
  url: string;
  title?: string;
  description?: string;
  selected: boolean;
}

const webImportJob = ref<WebImportJob | null>(null);
const webImportProgress = ref<WebImportProgress | null>(null);
const pluginImporters = ref<PluginImporter[]>([]);
const discoveredPages = ref<DiscoveredPage[]>([]);
const isDiscovering = ref(false);
const discoveryProgress = ref<{
  status?: string;
  found: number;
  processed: number;
  total: number;
  currentUrl?: string;
} | null>(null);
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

const webMetadata = ref({
  type: DocumentationType.ARTICLE,
  status: DocumentationStatus.PUBLISHED,
  visibility: DocumentVisibility.PRIVATE,
  tags: [] as string[],
  categories: [] as string[],
  tagsString: "",
  categoriesString: "",
});

// Computed steps based on import type
const steps = computed(() => {
  if (importType.value === "web") {
    return ["Select Source", "Enter URL", "Select Pages", "Add Metadata", "Processing"];
  } else if (importType.value === "upload") {
    return ["Select Source", "Select Files", "Add Details", "Upload"];
  } else {
    return ["Select Source"];
  }
});

const uploadFormats = ["PDF", "TXT", "MD", "DOC", "DOCX", "HTML", "JSON", "CSV"];

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
});

// Clean up polling interval on unmount
onBeforeUnmount(() => {
  if ((window as Window & { __discoveryPollInterval?: number }).__discoveryPollInterval) {
    clearInterval(
      (window as Window & { __discoveryPollInterval?: number }).__discoveryPollInterval,
    );
    delete (window as Window & { __discoveryPollInterval?: number }).__discoveryPollInterval;
  }

  // Remove global drag and drop listeners
  document.removeEventListener("dragover", handleGlobalDragOver);
  document.removeEventListener("dragleave", handleGlobalDragLeave);
  document.removeEventListener("drop", handleGlobalDrop);
});

// Methods
const selectImportType = (type: string) => {
  importType.value = type;
};

const proceedToNextStep = () => {
  if (currentStep.value === 1 && importType.value) {
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

const discoverPages = async () => {
  if (!isValidUrl(websiteUrl.value)) return;

  isDiscovering.value = true;
  currentStep.value = 3;
  discoveryProgress.value = {
    found: 0,
    processed: 0,
    total: 0,
    status: "starting",
  };

  try {
    // Start the discovery job
    const { jobId } = await Hay.documents.discoverWebPages.mutate({
      url: websiteUrl.value,
    });

    // Poll for job status every 5 seconds
    const pollInterval = setInterval(async () => {
      try {
        const jobStatus = await Hay.documents.getDiscoveryJob.query({
          jobId: jobId,
        });

        // Update progress based on job status
        if (jobStatus.progress) {
          const progress = jobStatus.progress as any;
          discoveryProgress.value = {
            found: progress.pagesFound || 0,
            processed: progress.pagesProcessed || 0,
            total: progress.totalEstimated || 0,
            status: progress.status || "discovering",
            currentUrl: progress.currentUrl,
          };
        }

        // Check if job is completed or failed
        if (jobStatus.status === "completed") {
          clearInterval(pollInterval);

          // Extract discovered pages from job result
          if (jobStatus.result?.pages) {
            discoveredPages.value = (jobStatus.result.pages as any[]).map(
              (page: DiscoveredPage) => ({
                ...page,
                selected: page.selected !== false, // Default to true unless explicitly false
              }),
            );

            // Final progress update
            discoveryProgress.value = {
              found: discoveredPages.value.length,
              processed: discoveredPages.value.length,
              total: discoveredPages.value.length,
              status: "completed",
            };

            // Small delay to show completion before hiding loading
            await new Promise((resolve) => setTimeout(resolve, 500));
          }

          isDiscovering.value = false;
          discoveryProgress.value = null;
        } else if (jobStatus.status === "failed") {
          clearInterval(pollInterval);
          console.error("Discovery job failed:", jobStatus.error);

          discoveryProgress.value = {
            found: 0,
            processed: 0,
            total: 0,
            status: "error",
          };

          // Small delay before hiding error state
          await new Promise((resolve) => setTimeout(resolve, 2000));

          isDiscovering.value = false;
          discoveryProgress.value = null;
          currentStep.value = 2; // Go back to URL input
        }
      } catch (error) {
        console.error("Failed to poll job status:", error);
      }
    }, 5000); // Poll every 5 seconds

    // Store interval ID for cleanup if needed
    (window as Window & { __discoveryPollInterval?: any }).__discoveryPollInterval = pollInterval;
  } catch (error) {
    console.error("Failed to start page discovery:", error);
    isDiscovering.value = false;
    discoveryProgress.value = null;
    currentStep.value = 2;
  }
};

const cancelDiscovery = () => {
  // Clear any existing polling interval
  if ((window as Window & { __discoveryPollInterval?: number }).__discoveryPollInterval) {
    clearInterval(
      (window as Window & { __discoveryPollInterval?: number }).__discoveryPollInterval,
    );
    delete (window as Window & { __discoveryPollInterval?: number }).__discoveryPollInterval;
  }

  isDiscovering.value = false;
  discoveryProgress.value = null;
  currentStep.value = 2; // Go back to URL input
};

const startWebImport = async () => {
  currentStep.value = 5; // Processing step
  isProcessing.value = true;

  try {
    const response = await Hay.documents.importFromWeb.mutate({
      url: websiteUrl.value,
      pages: discoveredPages.value,
      metadata: webMetadata.value,
    });

    webImportJob.value = {
      id: response.jobId,
      status: "processing",
    };

    // Poll for job status
    pollJobStatus(response.jobId);
  } catch (error) {
    console.error("Failed to start web import:", error);
    webImportJob.value = { id: "", status: "failed" };
    isProcessing.value = false;
  }
};

const pollJobStatus = async (jobId: string) => {
  const checkStatus = async () => {
    try {
      // TODO: Add job status endpoint
      // const job = await Hay.jobs.get.query({ id: jobId });
      // webImportJob.value = job;
      // if (job.data?.progress) {
      //   webImportProgress.value = job.data.progress;
      // }
      // if (job.status === 'completed' || job.status === 'failed') {
      //   isProcessing.value = false;
      // } else {
      //   setTimeout(checkStatus, 2000);
      // }
      console.log("Using jobId:", jobId); // Avoid unused parameter warning

      // For now, simulate completion after some time
      setTimeout(() => {
        webImportJob.value = { id: jobId, status: "completed" };
        webImportProgress.value = { totalPages: 10, processedPages: 10 };
        isProcessing.value = false;
      }, 5000);
    } catch (error) {
      console.error("Failed to check job status:", error);
      isProcessing.value = false;
    }
  };

  checkStatus();
};

const getFileIcon = (type: string) => {
  const mimeType = type.toLowerCase();
  if (mimeType.includes("pdf") || mimeType.includes("doc")) return FileText;
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
  input.accept = ".pdf,.txt,.md,.doc,.docx,.html,.json,.csv";
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
    const validTypes = ["pdf", "txt", "md", "doc", "docx", "html", "json", "csv"];
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
    } else {
      const failedCount = selectedFiles.value.filter((f) => f.uploadStatus === "error").length;

      if (failedCount > 0) {
        console.log(`${uploadedCount.value} succeeded, ${failedCount} failed`);
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

const getDiscoveryStatusText = () => {
  if (!discoveryProgress.value) return "Initializing...";

  const messages = [
    "Discovering pages...",
    "Scanning website structure...",
    "Following internal links...",
    "Analyzing content...",
    "Building page index...",
  ];

  // Cycle through messages based on progress
  const index = Math.min(
    Math.floor(
      (discoveryProgress.value.processed / Math.max(discoveryProgress.value.total, 1)) *
        messages.length,
    ),
    messages.length - 1,
  );

  return messages[index];
};

const openExternalLink = (url: string) => {
  if (typeof window !== "undefined") {
    window.open(url, "_blank");
  }
};

const resetImport = () => {
  currentStep.value = 1;
  importType.value = "";
  selectedFiles.value = [];
  uploadedCount.value = 0;
  websiteUrl.value = "";
  webImportJob.value = null;
  webImportProgress.value = null;
};

// SEO
useHead({
  title: "Import Documents - Hay Dashboard",
  meta: [{ name: "description", content: "Import documents to your knowledge base" }],
});
</script>
