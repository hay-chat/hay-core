<template>
  <Page title="Create Playbook" description="Follow the steps to create a new playbook">
    <template #header>
      <Button variant="ghost" @click="handleCancel">
        <ArrowLeft class="h-4 w-4 mr-2" />
        Back to list
      </Button>
    </template>

    <!-- Stepper Header -->
    <div class="flex items-center justify-center gap-0 mb-2">
      <template v-for="(step, index) in stepsMeta" :key="step.id">
        <!-- Step indicator -->
        <div class="flex items-center gap-2">
          <div
            class="flex items-center justify-center h-8 w-8 rounded-full text-sm font-medium transition-colors"
            :class="stepIndicatorClass(step.id)"
          >
            <Check v-if="stepper.isBefore(step.id)" class="h-4 w-4" />
            <span v-else>{{ index + 1 }}</span>
          </div>
          <span
            class="text-sm hidden sm:inline"
            :class="
              stepper.isCurrent(step.id) ? 'font-medium text-foreground' : 'text-neutral-muted'
            "
          >
            {{ step.label }}
          </span>
        </div>

        <!-- Connecting line -->
        <div
          v-if="index < stepsMeta.length - 1"
          class="w-8 lg:w-12 h-px mx-2"
          :class="
            stepper.isBefore(stepsMeta[index + 1].id) || stepper.isCurrent(stepsMeta[index + 1].id)
              ? 'bg-primary'
              : 'bg-border'
          "
        />
      </template>
    </div>

    <!-- Step Content -->
    <Card>
      <CardContent class="p-6">
        <WizardStepPurpose v-if="stepper.isCurrent('purpose')" v-model="wizardData.purpose" />

        <WizardStepActions
          v-if="stepper.isCurrent('actions')"
          v-model="wizardData.selectedActions"
        />

        <WizardStepDocuments
          v-if="stepper.isCurrent('documents')"
          v-model="wizardData.selectedDocumentIds"
          :purpose="wizardData.purpose"
        />

        <WizardStepBoundaries
          v-if="stepper.isCurrent('boundaries')"
          v-model:escalation-rules="wizardData.escalationRules"
          v-model:boundaries="wizardData.boundaries"
          v-model:acknowledged="wizardData.boundariesAcknowledged"
        />

        <WizardStepGenerate
          v-if="stepper.isCurrent('generate')"
          :wizard-data="wizardData"
          :generated-result="generatedResult"
          :generating="generating"
          @generate="handleGenerate"
        />
      </CardContent>
    </Card>

    <!-- Navigation Bar -->
    <div class="flex items-center justify-between">
      <Button v-if="!stepper.isFirst.value" variant="outline" @click="stepper.goToPrevious()">
        Previous
      </Button>
      <div v-else />

      <Button v-if="!stepper.isLast.value" :disabled="!canProceed" @click="stepper.goToNext()">
        Continue
      </Button>

      <Button v-else :disabled="!canProceed" :loading="creating" @click="handleCreate">
        Create Playbook & Open Editor
      </Button>
    </div>

    <!-- Cancel Confirmation Dialog -->
    <ConfirmDialog
      v-model:open="showCancelDialog"
      title="Leave wizard?"
      description="Your progress will be lost. Are you sure you want to leave?"
      confirm-text="Leave"
      :destructive="true"
      @confirm="confirmCancel"
    />
  </Page>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import { useRouter } from "vue-router";
import { useStepper } from "@vueuse/core";
import { ArrowLeft, Check } from "lucide-vue-next";
import { HayApi } from "@/utils/api";
import { useToast } from "~/composables/useToast";
import { PlaybookStatus } from "~/types/playbook";

type StepId = "purpose" | "actions" | "documents" | "boundaries" | "generate";

const router = useRouter();
const toast = useToast();

// --- Stepper ---
const stepsMeta = [
  { id: "purpose" as const, label: "Purpose" },
  { id: "actions" as const, label: "Actions" },
  { id: "documents" as const, label: "Documents" },
  { id: "boundaries" as const, label: "Boundaries" },
  { id: "generate" as const, label: "Generate" },
];

const stepper = useStepper(["purpose", "actions", "documents", "boundaries", "generate"]);

// --- Wizard Data ---
const wizardData = reactive({
  purpose: "",
  selectedActions: [] as { name: string; description: string; pluginName: string }[],
  selectedDocumentIds: [] as string[],
  escalationRules: "",
  boundaries: "",
  boundariesAcknowledged: false,
});

// --- Generation State ---
interface GeneratedResult {
  title: string;
  trigger: string;
  description: string;
  instructions: { id: string; level: number; instructions: string }[];
}

const generatedResult = ref<GeneratedResult | null>(null);
const generating = ref(false);
const creating = ref(false);

// --- Step Validation ---
const canProceed = computed(() => {
  switch (stepper.current.value) {
    case "purpose":
      return wizardData.purpose.trim().length >= 10;
    case "actions":
      return true;
    case "documents":
      return true;
    case "boundaries":
      return wizardData.boundariesAcknowledged === true;
    case "generate":
      return generatedResult.value !== null;
    default:
      return false;
  }
});

// --- Step Indicator Styling ---
function stepIndicatorClass(stepId: StepId) {
  if (stepper.isBefore(stepId)) {
    return "bg-primary text-primary-foreground";
  }
  if (stepper.isCurrent(stepId)) {
    return "bg-primary text-primary-foreground ring-2 ring-primary/30";
  }
  return "bg-muted text-muted-foreground";
}

// --- Generate Instructions ---
async function handleGenerate() {
  generating.value = true;
  generatedResult.value = null;
  try {
    const result = await HayApi.playbooks.generateInstructions.mutate({
      purpose: wizardData.purpose,
      actions: wizardData.selectedActions,
      documentIds: wizardData.selectedDocumentIds,
      escalationRules: wizardData.escalationRules,
      boundaries: wizardData.boundaries,
    });
    generatedResult.value = result as GeneratedResult;
  } catch (error) {
    console.error("Failed to generate instructions:", error);
    toast.error("Failed to generate instructions. Please try again.");
  } finally {
    generating.value = false;
  }
}

// --- Create Playbook ---
async function handleCreate() {
  if (!generatedResult.value) return;

  creating.value = true;
  try {
    const response = await HayApi.playbooks.create.mutate({
      title: generatedResult.value.title,
      trigger: generatedResult.value.trigger,
      description: generatedResult.value.description,
      instructions: generatedResult.value.instructions,
      status: PlaybookStatus.DRAFT,
    });
    toast.success("Playbook created successfully");
    router.push(`/playbooks/${response.id}`);
  } catch (error) {
    console.error("Failed to create playbook:", error);
    toast.error("Failed to create playbook. Please try again.");
  } finally {
    creating.value = false;
  }
}

// --- Cancel / Navigation Guard ---
const showCancelDialog = ref(false);
const hasProgress = computed(() => {
  return (
    wizardData.purpose.trim().length > 0 ||
    wizardData.selectedActions.length > 0 ||
    wizardData.selectedDocumentIds.length > 0 ||
    wizardData.escalationRules.trim().length > 0 ||
    wizardData.boundaries.trim().length > 0
  );
});

function handleCancel() {
  if (hasProgress.value) {
    showCancelDialog.value = true;
  } else {
    router.push("/playbooks");
  }
}

function confirmCancel() {
  showCancelDialog.value = false;
  router.push("/playbooks");
}

// Browser beforeunload guard
onMounted(() => {
  window.addEventListener("beforeunload", onBeforeUnload);
});

onBeforeUnmount(() => {
  window.removeEventListener("beforeunload", onBeforeUnload);
});

function onBeforeUnload(e: BeforeUnloadEvent) {
  if (hasProgress.value) {
    e.preventDefault();
    e.returnValue = "";
  }
}

// Vue Router navigation guard
const unregisterGuard = router.beforeEach((_to, _from, next) => {
  if (hasProgress.value && !showCancelDialog.value) {
    showCancelDialog.value = true;
    next(false);
  } else {
    next();
  }
});

onBeforeUnmount(() => {
  unregisterGuard();
});

// --- Page Meta ---
definePageMeta({
  layout: "default",
});

useHead({
  title: "Create Playbook - Hay Dashboard",
});
</script>
