<template>
  <div class="max-w-4xl mx-auto space-y-8">
    <!-- Page Header -->
    <div>
      <h1 class="text-2xl font-bold text-foreground">Create New Agent</h1>
      <p class="mt-1 text-sm text-neutral-muted">
        Follow the steps below to create and configure your AI agent.
      </p>
    </div>

    <!-- Progress Steps -->
    <div class="bg-background border rounded-lg p-6">
      <nav aria-label="Progress">
        <ol class="flex items-center justify-between">
          <li v-for="(step, index) in steps" :key="step.id" class="relative flex-1">
            <div class="flex items-center">
              <div class="relative flex items-center justify-center">
                <div
                  :class="[
                    'flex h-8 w-8 items-center justify-center rounded-full border-2',
                    currentStep > index
                      ? 'border-primary bg-primary text-white'
                      : currentStep === index
                        ? 'border-primary bg-background text-primary'
                        : 'border-muted bg-background text-neutral-muted',
                  ]"
                >
                  <CheckCircle v-if="currentStep > index" class="h-5 w-5" />
                  <span v-else class="text-sm font-medium">{{ index + 1 }}</span>
                </div>
              </div>
              <div class="ml-4 flex-1">
                <p
                  :class="[
                    'text-sm font-medium',
                    currentStep >= index ? 'text-foreground' : 'text-neutral-muted',
                  ]"
                >
                  {{ step.title }}
                </p>
                <p class="text-xs text-neutral-muted">
                  {{ step.description }}
                </p>
              </div>
            </div>
            <!-- Connecting line -->
            <div
              v-if="index < steps.length - 1"
              :class="[
                'absolute top-4 left-4 h-0.5 w-full',
                currentStep > index ? 'bg-primary' : 'bg-background-tertiary',
              ]"
            />
          </li>
        </ol>
      </nav>
    </div>

    <!-- Step Content -->
    <Card>
      <CardHeader>
        <CardTitle>{{ steps[currentStep]?.title || "" }}</CardTitle>
        <CardDescription>
          {{ steps[currentStep]?.description || "" }}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <!-- Step 1: Basic Information -->
        <div v-if="currentStep === 0" class="space-y-6">
          <div class="grid gap-4 md:grid-cols-2">
            <div>
              <Label html-for="agentName">Agent Name</Label>
              <Input
                id="agentName"
                v-model="agentForm.name"
                placeholder="Customer Support Bot"
                required
              />
              <p class="text-xs text-neutral-muted mt-1">
                Choose a descriptive name for your agent
              </p>
            </div>
            <div>
              <Label html-for="agentType">Agent Type</Label>
              <select
                id="agentType"
                v-model="agentForm.type"
                class="w-full px-3 py-2 border border-input bg-background rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                required
              >
                <option value="">Select type</option>
                <option value="customer-support">Customer Support</option>
                <option value="sales">Sales Assistant</option>
                <option value="technical">Technical Support</option>
                <option value="general">General Assistant</option>
              </select>
            </div>
          </div>

          <Input
            v-model="agentForm.description"
            label="Description"
            type="textarea"
            placeholder="Describe what this agent does and how it helps customers..."
          />

          <div class="grid gap-4 md:grid-cols-2">
            <div>
              <Label html-for="language">Primary Language</Label>
              <select
                id="language"
                v-model="agentForm.language"
                class="w-full px-3 py-2 border border-input bg-background rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                required
              >
                <option value="en">English</option>
                <option value="es">Spanish</option>
                <option value="fr">French</option>
                <option value="de">German</option>
                <option value="pt">Portuguese</option>
              </select>
            </div>
            <div>
              <Label html-for="timezone">Timezone</Label>
              <select
                id="timezone"
                v-model="agentForm.timezone"
                class="w-full px-3 py-2 border border-input bg-background rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="UTC">UTC</option>
                <option value="America/New_York">Eastern Time</option>
                <option value="America/Chicago">Central Time</option>
                <option value="America/Los_Angeles">Pacific Time</option>
                <option value="Europe/London">London</option>
              </select>
            </div>
          </div>

          <!-- Avatar Selection -->
          <div>
            <Label>Agent Avatar</Label>
            <div class="grid grid-cols-6 gap-3 mt-2">
              <button
                v-for="avatar in avatars"
                :key="avatar.id"
                :class="[
                  'aspect-square rounded-lg border-2 p-2 flex items-center justify-center transition-colors',
                  agentForm.avatar === avatar.id
                    ? 'border-primary bg-primary/10'
                    : 'border-muted hover:border-primary/50',
                ]"
                @click="agentForm.avatar = avatar.id"
              >
                <component :is="avatar.icon" class="h-6 w-6 text-primary" />
              </button>
            </div>
          </div>
        </div>

        <!-- Step 2: Knowledge Base -->
        <div v-if="currentStep === 1" class="space-y-6">
          <div class="text-center">
            <p class="text-sm text-neutral-muted mb-6">
              Choose how to populate your agent's knowledge base. You can select multiple sources.
            </p>
          </div>

          <!-- Knowledge Source Options -->
          <div class="grid gap-4 md:grid-cols-2">
            <Card
              :class="[
                'cursor-pointer transition-colors hover:bg-background-secondary',
                agentForm.knowledgeSources.includes('zendesk') ? 'ring-2 ring-primary' : '',
              ]"
              @click="toggleKnowledgeSource('zendesk')"
            >
              <CardContent class="p-4">
                <div class="flex items-start space-x-3">
                  <Checkbox
                    :checked="agentForm.knowledgeSources.includes('zendesk')"
                    @update:checked="toggleKnowledgeSource('zendesk')"
                  />
                  <div class="flex-1">
                    <h4 class="font-medium text-foreground">Import from Zendesk</h4>
                    <p class="text-sm text-neutral-muted">
                      Import articles, FAQs, and support documentation from your Zendesk account.
                    </p>
                  </div>
                  <ExternalLink class="h-5 w-5 text-neutral-muted" />
                </div>
              </CardContent>
            </Card>

            <Card
              :class="[
                'cursor-pointer transition-colors hover:bg-background-secondary',
                agentForm.knowledgeSources.includes('website') ? 'ring-2 ring-primary' : '',
              ]"
              @click="toggleKnowledgeSource('website')"
            >
              <CardContent class="p-4">
                <div class="flex items-start space-x-3">
                  <Checkbox
                    :checked="agentForm.knowledgeSources.includes('website')"
                    @update:checked="toggleKnowledgeSource('website')"
                  />
                  <div class="flex-1">
                    <h4 class="font-medium text-foreground">Scrape Website</h4>
                    <p class="text-sm text-neutral-muted">
                      Automatically extract content from your website pages and documentation.
                    </p>
                  </div>
                  <Globe class="h-5 w-5 text-neutral-muted" />
                </div>
              </CardContent>
            </Card>

            <Card
              :class="[
                'cursor-pointer transition-colors hover:bg-background-secondary',
                agentForm.knowledgeSources.includes('documents') ? 'ring-2 ring-primary' : '',
              ]"
              @click="toggleKnowledgeSource('documents')"
            >
              <CardContent class="p-4">
                <div class="flex items-start space-x-3">
                  <Checkbox
                    :checked="agentForm.knowledgeSources.includes('documents')"
                    @update:checked="toggleKnowledgeSource('documents')"
                  />
                  <div class="flex-1">
                    <h4 class="font-medium text-foreground">Upload Documents</h4>
                    <p class="text-sm text-neutral-muted">
                      Upload PDF, DOCX, TXT files with your knowledge base content.
                    </p>
                  </div>
                  <FileText class="h-5 w-5 text-neutral-muted" />
                </div>
              </CardContent>
            </Card>

            <Card
              :class="[
                'cursor-pointer transition-colors hover:bg-background-secondary',
                agentForm.knowledgeSources.includes('tickets') ? 'ring-2 ring-primary' : '',
              ]"
              @click="toggleKnowledgeSource('tickets')"
            >
              <CardContent class="p-4">
                <div class="flex items-start space-x-3">
                  <Checkbox
                    :checked="agentForm.knowledgeSources.includes('tickets')"
                    @update:checked="toggleKnowledgeSource('tickets')"
                  />
                  <div class="flex-1">
                    <h4 class="font-medium text-foreground">Import Support Tickets</h4>
                    <p class="text-sm text-neutral-muted">
                      Learn from historical support tickets and their resolutions.
                    </p>
                  </div>
                  <MessageSquare class="h-5 w-5 text-neutral-muted" />
                </div>
              </CardContent>
            </Card>
          </div>

          <!-- Configuration for selected sources -->
          <div v-if="agentForm.knowledgeSources.includes('website')" class="space-y-4">
            <Label>Website URLs to scrape</Label>
            <div class="space-y-2">
              <div
                v-for="(url, index) in agentForm.websiteUrls"
                :key="index"
                class="flex space-x-2"
              >
                <Input
                  v-model="agentForm.websiteUrls[index]"
                  placeholder="https://example.com/docs"
                  class="flex-1"
                />
                <Button variant="outline" size="sm" @click="removeWebsiteUrl(index)">
                  <X class="h-4 w-4" />
                </Button>
              </div>
              <Button variant="outline" @click="addWebsiteUrl">
                <Plus class="mr-2 h-4 w-4" />
                Add URL
              </Button>
            </div>
          </div>

          <div v-if="agentForm.knowledgeSources.includes('documents')" class="space-y-4">
            <Label>Upload Documents</Label>
            <div class="border-2 border-dashed border-muted rounded-lg p-6 text-center">
              <Upload class="mx-auto h-12 w-12 text-neutral-muted" />
              <p class="mt-2 text-sm text-neutral-muted">Drop files here or click to upload</p>
              <p class="text-xs text-neutral-muted">
                Supports PDF, DOCX, TXT files up to 10MB each
              </p>
              <Button variant="outline" class="mt-4"> Choose Files </Button>
            </div>
          </div>
        </div>

        <!-- Step 3: Personality & Behavior -->
        <div v-if="currentStep === 2" class="space-y-6">
          <div>
            <Label>Tone of Voice</Label>
            <div class="grid gap-3 mt-2 md:grid-cols-3">
              <Card
                v-for="tone in toneOptions"
                :key="tone.id"
                :class="[
                  'cursor-pointer transition-colors hover:bg-background-secondary',
                  agentForm.tone === tone.id ? 'ring-2 ring-primary' : '',
                ]"
                @click="agentForm.tone = tone.id"
              >
                <CardContent class="p-4 text-center">
                  <component :is="tone.icon" class="h-8 w-8 mx-auto text-primary mb-2" />
                  <h4 class="font-medium text-foreground">
                    {{ tone.name }}
                  </h4>
                  <p class="text-xs text-neutral-muted mt-1">
                    {{ tone.description }}
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>

          <div>
            <Label>Response Style</Label>
            <div class="grid gap-3 mt-2 md:grid-cols-2">
              <div class="flex items-center space-x-2">
                <Checkbox id="detailed" v-model:checked="agentForm.responseStyle.detailed" />
                <Label html-for="detailed">Detailed explanations</Label>
              </div>
              <div class="flex items-center space-x-2">
                <Checkbox id="concise" v-model:checked="agentForm.responseStyle.concise" />
                <Label html-for="concise">Concise answers</Label>
              </div>
              <div class="flex items-center space-x-2">
                <Checkbox id="examples" v-model:checked="agentForm.responseStyle.examples" />
                <Label html-for="examples">Include examples</Label>
              </div>
              <div class="flex items-center space-x-2">
                <Checkbox id="stepByStep" v-model:checked="agentForm.responseStyle.stepByStep" />
                <Label html-for="stepByStep">Step-by-step instructions</Label>
              </div>
            </div>
          </div>

          <Input
            v-model="agentForm.customInstructions"
            label="Custom Instructions"
            type="textarea"
            placeholder="Add specific instructions for how the agent should behave, what it should prioritize, or any special guidelines..."
            helper-text="These instructions will guide the agent's behavior in all conversations."
          />

          <div class="grid gap-4 md:grid-cols-2">
            <div>
              <Label html-for="maxResponseLength">Max Response Length</Label>
              <select
                id="maxResponseLength"
                v-model="agentForm.maxResponseLength"
                class="w-full px-3 py-2 border border-input bg-background rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="short">Short (1-2 sentences)</option>
                <option value="medium">Medium (1-2 paragraphs)</option>
                <option value="long">Long (3+ paragraphs)</option>
              </select>
            </div>
            <div>
              <Label html-for="escalationThreshold">Escalation Threshold</Label>
              <select
                id="escalationThreshold"
                v-model="agentForm.escalationThreshold"
                class="w-full px-3 py-2 border border-input bg-background rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="low">Low - Escalate complex issues</option>
                <option value="medium">Medium - Standard escalation</option>
                <option value="high">High - Handle most issues</option>
              </select>
            </div>
          </div>
        </div>

        <!-- Step 4: Review & Create -->
        <div v-if="currentStep === 3" class="space-y-6">
          <div class="bg-background-secondary rounded-lg p-6">
            <h3 class="font-medium text-foreground mb-4">Agent Configuration Summary</h3>

            <div class="grid gap-4 md:grid-cols-2">
              <div>
                <h4 class="text-sm font-medium text-foreground">Basic Information</h4>
                <ul class="text-sm text-neutral-muted space-y-1 mt-2">
                  <li><strong>Name:</strong> {{ agentForm.name }}</li>
                  <li><strong>Type:</strong> {{ agentForm.type }}</li>
                  <li><strong>Language:</strong> {{ agentForm.language }}</li>
                  <li><strong>Timezone:</strong> {{ agentForm.timezone }}</li>
                </ul>
              </div>

              <div>
                <h4 class="text-sm font-medium text-foreground">Knowledge Sources</h4>
                <ul class="text-sm text-neutral-muted space-y-1 mt-2">
                  <li v-for="source in agentForm.knowledgeSources" :key="source">
                    • {{ getSourceDisplayName(source) }}
                  </li>
                </ul>
              </div>

              <div>
                <h4 class="text-sm font-medium text-foreground">Personality</h4>
                <ul class="text-sm text-neutral-muted space-y-1 mt-2">
                  <li>
                    <strong>Tone:</strong>
                    {{ getToneDisplayName(agentForm.tone) }}
                  </li>
                  <li>
                    <strong>Response Length:</strong>
                    {{ agentForm.maxResponseLength }}
                  </li>
                  <li>
                    <strong>Escalation:</strong>
                    {{ agentForm.escalationThreshold }}
                  </li>
                </ul>
              </div>

              <div>
                <h4 class="text-sm font-medium text-foreground">Description</h4>
                <p class="text-sm text-neutral-muted mt-2">
                  {{ agentForm.description }}
                </p>
              </div>
            </div>
          </div>

          <!-- Test Conversation Preview -->
          <div>
            <h3 class="font-medium text-foreground mb-4">Test Conversation Preview</h3>
            <div class="border rounded-lg p-4 bg-background">
              <div class="space-y-3">
                <div class="flex space-x-3">
                  <div
                    class="h-8 w-8 rounded-full bg-background-tertiary flex items-center justify-center"
                  >
                    <User class="h-4 w-4 text-neutral-muted" />
                  </div>
                  <div class="flex-1">
                    <p class="text-sm text-foreground">Hi, I need help with my account setup.</p>
                  </div>
                </div>
                <div class="flex space-x-3">
                  <div class="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                    <Bot class="h-4 w-4 text-primary" />
                  </div>
                  <div class="flex-1 bg-background-secondary rounded-lg p-3">
                    <p class="text-sm text-foreground">
                      Hello! I'd be happy to help you with your account setup. To get started, could
                      you please let me know what specific part of the setup you're having trouble
                      with?
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>

    <!-- Navigation -->
    <div class="flex justify-between">
      <Button variant="outline" :disabled="currentStep === 0" @click="previousStep">
        <ChevronLeft class="mr-2 h-4 w-4" />
        Previous
      </Button>

      <div class="flex space-x-3">
        <Button variant="outline" :disabled="creating" @click="saveDraft"> Save Draft </Button>

        <Button v-if="currentStep < steps.length - 1" :disabled="!canProceed" @click="nextStep">
          Next
          <ChevronRight class="ml-2 h-4 w-4" />
        </Button>

        <Button v-else :disabled="creating || !canProceed" @click="createAgent">
          <div v-if="creating" class="flex items-center space-x-2">
            <div class="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
            <span>Creating Agent...</span>
          </div>
          <span v-else>Create Agent</span>
        </Button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Bot,
  User,
  Globe,
  FileText,
  MessageSquare,
  ExternalLink,
  Upload,
  Plus,
  X,
  Smile,
  Briefcase,
  Zap,
} from "lucide-vue-next";

// TODO: Import agent store/composable
// TODO: Import router for navigation

// State
const currentStep = ref(0);
const creating = ref(false);

// Form data
const agentForm = reactive({
  name: "",
  type: "",
  description: "",
  language: "en",
  timezone: "UTC",
  avatar: "bot",
  knowledgeSources: [] as string[],
  websiteUrls: [""],
  tone: "professional",
  responseStyle: {
    detailed: false,
    concise: true,
    examples: false,
    stepByStep: false,
  },
  customInstructions: "",
  maxResponseLength: "medium",
  escalationThreshold: "medium",
});

// Configuration
const steps = [
  {
    id: "basic",
    title: "Basic Information",
    description: "Set up the basic details for your agent",
  },
  {
    id: "knowledge",
    title: "Knowledge Base",
    description: "Choose your knowledge sources",
  },
  {
    id: "personality",
    title: "Personality & Behavior",
    description: "Configure how your agent responds",
  },
  {
    id: "review",
    title: "Review & Create",
    description: "Review and create your agent",
  },
];

const avatars = [
  { id: "bot", icon: Bot },
  { id: "smile", icon: Smile },
  { id: "briefcase", icon: Briefcase },
  { id: "zap", icon: Zap },
];

const toneOptions = [
  {
    id: "professional",
    name: "Professional",
    description: "Formal and business-like",
    icon: Briefcase,
  },
  {
    id: "friendly",
    name: "Friendly",
    description: "Warm and approachable",
    icon: Smile,
  },
  {
    id: "casual",
    name: "Casual",
    description: "Relaxed and conversational",
    icon: Zap,
  },
];

// Computed
const canProceed = computed(() => {
  switch (currentStep.value) {
    case 0:
      return agentForm.name && agentForm.type && agentForm.description;
    case 1:
      return agentForm.knowledgeSources.length > 0;
    case 2:
      return agentForm.tone;
    case 3:
      return true;
    default:
      return false;
  }
});

// Methods
const nextStep = () => {
  if (currentStep.value < steps.length - 1) {
    currentStep.value++;
  }
};

const previousStep = () => {
  if (currentStep.value > 0) {
    currentStep.value--;
  }
};

const toggleKnowledgeSource = (source: string) => {
  const index = agentForm.knowledgeSources.indexOf(source);
  if (index > -1) {
    agentForm.knowledgeSources.splice(index, 1);
  } else {
    agentForm.knowledgeSources.push(source);
  }
};

const addWebsiteUrl = () => {
  agentForm.websiteUrls.push("");
};

const removeWebsiteUrl = (index: number) => {
  agentForm.websiteUrls.splice(index, 1);
};

const getSourceDisplayName = (source: string) => {
  const names: Record<string, string> = {
    zendesk: "Zendesk Import",
    website: "Website Scraping",
    documents: "Document Upload",
    tickets: "Support Tickets",
  };
  return names[source] || source;
};

const getToneDisplayName = (tone: string) => {
  const option = toneOptions.find((t) => t.id === tone);
  return option?.name || tone;
};

const saveDraft = async () => {
  try {
    // TODO: Save draft to local storage or API
    console.log("Saving draft:", agentForm);

    // TODO: Show success notification
  } catch (error) {
    console.error("Error saving draft:", error);
    // TODO: Show error notification
  }
};

const createAgent = async () => {
  creating.value = true;

  try {
    // TODO: Create agent via API
    console.log("Creating agent:", agentForm);

    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // TODO: Redirect to agent detail page
    // await navigateTo(`/agents/${newAgentId}`)

    console.log("Agent created successfully!");
  } catch (error) {
    console.error("Error creating agent:", error);
    // TODO: Show error notification
  } finally {
    creating.value = false;
  }
};

// TODO: Add form validation
// TODO: Implement file upload for documents
// TODO: Add knowledge source configuration
// TODO: Implement draft saving/loading
// TODO: Add agent preview functionality

// SEO
useHead({
  title: "Create Agent - Hay Dashboard",
  meta: [
    {
      name: "description",
      content: "Create a new AI agent for your organization",
    },
  ],
});
</script>
