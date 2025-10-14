<template>
  <Page
    title="Getting Started"
    description="You’re just a few steps away from having Hay handle your repetitive support tasks so your team can focus on what truly matters — helping customers and growing your business."
    width="max"
  >
    <Loading v-if="loading" />
    <div v-else-if="progress" class="space-y-6">
      <!-- Progress Overview -->
      <Card>
        <CardHeader>
          <CardTitle>Onboarding Progress</CardTitle>
          <CardDescription>
            {{ progress.completedSteps }} of {{ progress.totalSteps }} steps completed
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div class="space-y-2">
            <div class="flex items-center justify-between text-sm">
              <span>{{ progress.progressPercentage }}% Complete</span>
            </div>
            <div class="w-full bg-muted rounded-full h-2.5">
              <div
                class="bg-primary h-2.5 rounded-full transition-all duration-300"
                :style="{ width: `${progress.progressPercentage}%` }"
              ></div>
            </div>
          </div>

          <div
            v-if="progress.allCompleted"
            class="mt-4 p-4 bg-green-50 dark:bg-green-950 rounded-lg"
          >
            <div class="flex items-center gap-2 text-green-700 dark:text-green-300">
              <CheckCircle2 class="w-5 h-5" />
              <span class="font-medium">
                Congratulations! You've completed all onboarding steps.
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      <!-- Onboarding Steps -->
      <div class="space-y-4">
        <!-- Step 1: Choose Integrations -->
        <Card variant="accordion" :default-open="isStepOpen('integrations')">
          <CardHeader>
            <div class="flex items-center gap-3 flex-1">
              <div class="onboarding-check" :class="{ checked: integrations?.completed }">
                <Check v-if="integrations?.completed" class="w-3 h-3 text-white" />
              </div>
              <div class="flex-1">
                <CardTitle class="text-lg" :class="{ 'line-through': integrations?.completed }">
                  Choose integrations
                </CardTitle>
                <p class="text-sm text-neutral-muted">
                  Connect your favorite tools and platforms to Hay
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent class="!pt-0">
            <div class="space-y-4">
              <p>
                Hay works where your team already does — plug in apps like <strong>Zendesk</strong>,
                <strong>Shopify</strong>, or <strong>WhatsApp</strong> in just a few clicks to start
                syncing conversations automatically.
              </p>

              <div v-if="integrations && integrations.count > 0" class="text-sm">
                <span class="font-medium">{{ integrations.count }}</span>
                integrations connected
              </div>

              <!-- Integration List -->
              <div
                v-if="!integrations?.completed && marketplacePlugins.length > 0"
                class="grid grid-cols-2 md:grid-cols-3 gap-3"
              >
                <button
                  v-for="plugin in marketplacePlugins"
                  :key="plugin.id"
                  class="flex items-center gap-2 p-3 rounded-lg border border-border hover:border-primary hover:bg-accent transition-colors"
                  @click="navigateTo(`/integrations/plugins/${plugin.id}`)"
                >
                  <div
                    class="w-12 h-12 rounded-lg bg-muted flex items-center justify-center overflow-hidden"
                  >
                    <img
                      :src="getPluginThumbnail(plugin.id)"
                      :alt="plugin.name"
                      class="w-full h-full object-cover"
                      @error="handleThumbnailError($event)"
                    />
                    <div class="hidden w-full h-full items-center justify-center bg-muted">
                      <span class="text-lg font-semibold">
                        {{ plugin.name.charAt(0) }}
                      </span>
                    </div>
                  </div>
                  <span class="text-xs font-medium line-clamp-2">{{ plugin.name }}</span>
                </button>
              </div>

              <div class="flex gap-2">
                <Button
                  :variant="!integrations?.completed ? 'primary' : 'outline'"
                  @click="navigateTo('/integrations/marketplace')"
                >
                  Browse All Integrations
                  <ArrowRight class="w-3 h-3 ml-2" />
                </Button>
                <Button href="https://hay.canny.io/" target="_blank" variant="outline">
                  <Lightbulb class="w-3 h-3 mr-2" />
                  Suggest an Integration
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <!-- Step 2: Create an Agent -->
        <Card variant="accordion" :default-open="isStepOpen('agent')">
          <CardHeader>
            <div class="flex items-center gap-3 flex-1">
              <div class="onboarding-check" :class="{ checked: agent?.completed }">
                <Check v-if="agent?.completed" class="w-3 h-3 text-white" />
              </div>
              <div class="flex-1">
                <CardTitle class="text-lg" :class="{ 'line-through': agent?.completed }">
                  Create an agent
                </CardTitle>
                <p class="text-sm text-neutral-muted">Your AI teammate starts here.</p>
              </div>
            </div>
          </CardHeader>
          <CardContent class="!pt-0">
            <div class="space-y-4">
              <p>
                Define your first Hay agent — give it a name, choose its tone, and decide which
                channels it should handle.
              </p>

              <div v-if="agent && agent.count > 0" class="text-sm">
                <span class="font-medium">{{ agent.count }}</span>
                {{ agent.count === 1 ? "agent" : "agents" }} created
              </div>

              <div v-if="!agent?.completed">
                <Button @click="navigateTo('/agents/new?redirect=/getting-started')">
                  Create Agent
                  <ArrowRight class="w-3 h-3 ml-2" />
                </Button>
              </div>
              <div v-else>
                <Button variant="outline" @click="navigateTo('/agents')">
                  View Agents
                  <ArrowRight class="w-3 h-3 ml-2" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <!-- Step 3: Upload Training Documents -->
        <Card
          variant="accordion"
          :default-open="isStepOpen('documents')"
          :disabled="isStepLocked('documents')"
          class="transition-opacity"
        >
          <CardHeader>
            <div class="flex items-center gap-3 flex-1">
              <div
                class="onboarding-check"
                :class="{ checked: documents?.completed, locked: isStepLocked('documents') }"
              >
                <Check v-if="documents?.completed" class="w-3 h-3 text-white" />
                <Lock v-else-if="isStepLocked('documents')" class="w-3 h-3" />
              </div>
              <div class="flex-1" :class="{ 'opacity-70': isStepLocked('documents') }">
                <CardTitle class="text-lg" :class="{ 'line-through': documents?.completed }">
                  Upload training documents
                </CardTitle>
                <p class="text-sm text-neutral-muted">
                  Teach Hay just like you'd train a new team member.
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent class="!pt-0">
            <div class="space-y-4">
              <p>
                Upload your existing playbooks, FAQs, or process docs — Hay learns instantly and
                never forgets.
              </p>

              <div v-if="documents && documents.count > 0" class="text-sm">
                <span class="font-medium">{{ documents.count }}</span>
                {{ documents.count === 1 ? "document" : "documents" }} uploaded
              </div>

              <div v-if="!documents?.completed">
                <Button
                  :disabled="isStepLocked('documents')"
                  @click="navigateTo('/documents/import?redirect=/getting-started')"
                >
                  Upload Documents
                  <ArrowRight class="w-3 h-3 ml-2" />
                </Button>
                <p v-if="isStepLocked('documents')" class="text-sm text-neutral-muted mt-2">
                  Finish the previous steps before doing this. Hay will work better this way.
                </p>
              </div>
              <div v-else>
                <Button variant="outline" @click="navigateTo('/documents')">
                  View Documents
                  <ArrowRight class="w-3 h-3 ml-2" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <!-- Step 4: Create a Playbook -->
        <Card
          variant="accordion"
          :default-open="isStepOpen('playbook')"
          :disabled="isStepLocked('playbook')"
          class="transition-opacity"
        >
          <CardHeader>
            <div class="flex items-center gap-3 flex-1">
              <div
                class="onboarding-check"
                :class="{ checked: playbook?.completed, locked: isStepLocked('playbook') }"
              >
                <Check v-if="playbook?.completed" class="w-3 h-3 text-white" />
                <Lock v-else-if="isStepLocked('playbook')" class="w-3 h-3" />
              </div>
              <div class="flex-1" :class="{ 'opacity-70': isStepLocked('playbook') }">
                <CardTitle class="text-lg" :class="{ 'line-through': playbook?.completed }">
                  Create a playbook
                </CardTitle>
                <p class="text-sm text-neutral-muted">Automate common workflows and actions.</p>
              </div>
            </div>
          </CardHeader>
          <CardContent class="!pt-0">
            <div class="space-y-4">
              <p>
                Playbooks let you design how Hay should respond, escalate, or perform tasks (like
                refunds or order lookups) — all without code.
              </p>

              <div v-if="playbook && playbook.count > 0" class="text-sm">
                <span class="font-medium">{{ playbook.count }}</span>
                {{ playbook.count === 1 ? "playbook" : "playbooks" }} created
              </div>

              <div v-if="!playbook?.completed">
                <Button
                  :disabled="isStepLocked('playbook')"
                  @click="navigateTo('/playbooks/new?redirect=/getting-started')"
                >
                  Create Playbook
                  <ArrowRight class="w-3 h-3 ml-2" />
                </Button>
                <p v-if="isStepLocked('playbook')" class="text-sm text-neutral-muted mt-2">
                  Finish the previous steps before doing this. Hay will work better this way.
                </p>
              </div>
              <div v-else>
                <Button variant="outline" @click="navigateTo('/playbooks')">
                  View Playbooks
                  <ArrowRight class="w-3 h-3 ml-2" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <!-- Step 5: Test in Playground Chat -->
        <Card
          variant="accordion"
          :default-open="isStepOpen('playground')"
          :disabled="isStepLocked('playground')"
          class="transition-opacity"
        >
          <CardHeader>
            <div class="flex items-center gap-3 flex-1">
              <div
                class="onboarding-check"
                :class="{ checked: playground?.completed, locked: isStepLocked('playground') }"
              >
                <Check v-if="playground?.completed" class="w-3 h-3 text-white" />
                <Lock v-else-if="isStepLocked('playground')" class="w-3 h-3" />
              </div>
              <div class="flex-1" :class="{ 'opacity-70': isStepLocked('playground') }">
                <CardTitle class="text-lg" :class="{ 'line-through': playground?.completed }">
                  Test the agent in a playground chat
                </CardTitle>
                <p class="text-sm text-neutral-muted">
                  See your agent in action before going live.
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent class="!pt-0">
            <div class="space-y-4">
              <p>
                Use the built-in playground to test how Hay responds, tweak instructions, and
                perfect the experience before connecting to real customers.
              </p>

              <div v-if="playground && playground.count > 0" class="text-sm">
                <span class="font-medium">{{ playground.count }}</span>
                {{ playground.count === 1 ? "conversation" : "conversations" }} started
              </div>

              <div v-if="!playground?.completed">
                <Button
                  :disabled="isStepLocked('playground')"
                  @click="navigateTo('/conversations')"
                >
                  Start Playground Chat
                  <ArrowRight class="w-3 h-3 ml-2" />
                </Button>
                <p v-if="isStepLocked('playground')" class="text-sm text-neutral-muted mt-2">
                  Finish the previous steps before doing this. Hay will work better this way.
                </p>
              </div>
              <div v-else>
                <Button variant="outline" @click="navigateTo('/conversations')">
                  View Conversations
                  <ArrowRight class="w-3 h-3 ml-2" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  </Page>
</template>

<script setup lang="ts">
import { ref, onMounted, computed, watch } from "vue";
import { useRouter } from "vue-router";
import { Hay } from "@/utils/api";
import { CheckCircle2, Check, ArrowRight, Lightbulb, Lock } from "lucide-vue-next";
import { useAppStore } from "@/stores/app";

interface OnboardingStep {
  id: string;
  completed: boolean;
  count: number;
}

interface OnboardingResponse {
  steps: OnboardingStep[];
}

interface Plugin {
  id: string;
  name: string;
  enabled: boolean;
}

const router = useRouter();
const appStore = useAppStore();
const loading = ref(true);
const stepsData = ref<OnboardingResponse | null>(null);
const allPlugins = ref<Plugin[]>([]);

// Individual step refs
const integrations = computed(() => stepsData.value?.steps.find((s) => s.id === "integrations"));

const agent = computed(() => stepsData.value?.steps.find((s) => s.id === "agent"));

const documents = computed(() => stepsData.value?.steps.find((s) => s.id === "documents"));

const playbook = computed(() => stepsData.value?.steps.find((s) => s.id === "playbook"));

const playground = computed(() => stepsData.value?.steps.find((s) => s.id === "playground"));

// Marketplace plugins - show only unenabled ones
const marketplacePlugins = computed(() => {
  return allPlugins.value.filter((p) => !p.enabled).slice(0, 8);
});

// Computed progress
const progress = computed(() => {
  if (!stepsData.value) return null;

  const completedSteps = stepsData.value.steps.filter((step) => step.completed).length;
  const totalSteps = stepsData.value.steps.length;
  const progressPercentage = Math.round((completedSteps / totalSteps) * 100);

  return {
    completedSteps,
    totalSteps,
    progressPercentage,
    allCompleted: completedSteps === totalSteps,
  };
});

// Step dependencies (step 1 is optional, so not in dependencies)
const stepDependencies: Record<string, string> = {
  documents: "agent",
  playbook: "documents",
  playground: "playbook",
};

// Check if a step is locked (previous step not completed)
const isStepLocked = (stepId: string) => {
  const dependency = stepDependencies[stepId];
  if (!dependency) return false; // No dependency, not locked

  const dependentStep = stepsData.value?.steps.find((s) => s.id === dependency);
  return !dependentStep?.completed;
};

// Determine if a step should be open by default
const isStepOpen = (stepId: string) => {
  if (!stepsData.value) return false;

  // Find the first incomplete step
  const steps = ["integrations", "agent", "documents", "playbook", "playground"];
  const firstIncompleteStepId = steps.find((id) => {
    const step = stepsData.value?.steps.find((s) => s.id === id);
    return !step?.completed && !isStepLocked(id);
  });

  return stepId === firstIncompleteStepId;
};

// Helper to get plugin thumbnail from API
const getPluginThumbnail = (pluginId: string) => {
  // Extract plugin name from pluginId (remove 'hay-plugin-' prefix)
  const pluginName = pluginId.replace("hay-plugin-", "");
  return `http://localhost:3001/plugins/thumbnails/${pluginName}`;
};

// Handle thumbnail load error - show fallback
const handleThumbnailError = (event: Event) => {
  const imgElement = event.target as HTMLImageElement;
  const fallbackElement = imgElement.nextElementSibling as HTMLElement;

  imgElement.style.display = "none";
  if (fallbackElement) {
    fallbackElement.style.display = "flex";
  }
};

const navigateTo = (url: string) => {
  router.push(url);
};

const fetchProgress = async () => {
  try {
    loading.value = true;

    // Skip API call if onboarding is already marked as completed
    if (appStore.onboardingCompleted) {
      loading.value = false;
      return;
    }

    const [onboardingData, pluginsData] = await Promise.all([
      Hay.onboarding.getProgress.query(),
      Hay.plugins.getAll.query(),
    ]);
    stepsData.value = onboardingData;
    allPlugins.value = pluginsData;
  } catch (error) {
    console.error("Failed to fetch onboarding progress:", error);
  } finally {
    loading.value = false;
  }
};

// Watch for when onboarding is completed and update the store
watch(
  () => progress.value?.allCompleted,
  (allCompleted) => {
    if (allCompleted) {
      appStore.setOnboardingCompleted(true);
    }
  },
);

onMounted(() => {
  fetchProgress();
});
</script>

<style scoped>
.onboarding-check {
  width: 1.5em;
  height: 1.5em;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: var(--color-neutral-300);
  flex-shrink: 0;
}

.onboarding-check.checked {
  background-color: var(--color-green);
}
</style>
