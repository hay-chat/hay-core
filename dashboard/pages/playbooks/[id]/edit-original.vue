<template>
  <div class="space-y-6">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div class="flex items-center space-x-4">
        <Button variant="ghost" @click="goBack">
          <ArrowLeft class="h-4 w-4 mr-2" />
          Back to Playbooks
        </Button>
        <div>
          <h1 class="text-3xl font-bold tracking-tight">
            {{ isNewPlaybook ? "Create Playbook" : "Edit Playbook" }}
          </h1>
          <p class="text-muted-foreground">
            Configure automated conversation flows and responses
          </p>
        </div>
      </div>
      <div class="flex items-center space-x-2">
        <Button variant="outline" :disabled="!canTest" @click="testPlaybook">
          <Play class="h-4 w-4 mr-2" />
          Test
        </Button>
        <Button variant="outline" :disabled="loading" @click="saveAsDraft">
          <Save class="h-4 w-4 mr-2" />
          Save Draft
        </Button>
        <Button :disabled="loading || !isValid" @click="savePlaybook">
          <Check class="h-4 w-4 mr-2" />
          {{ isNewPlaybook ? "Create" : "Save" }}
        </Button>
      </div>
    </div>

    <!-- Main Content -->
    <div class="grid gap-6 lg:grid-cols-3">
      <!-- Left Panel: Configuration -->
      <div class="lg:col-span-2 space-y-6">
        <!-- Basic Information -->
        <Card>
          <CardHeader>
            <CardTitle>Basic Information</CardTitle>
            <CardDescription
              >Set up the fundamental details of your playbook</CardDescription
            >
          </CardHeader>
          <CardContent class="space-y-4">
            <div>
              <Label for="name">Playbook Name</Label>
              <Input
                id="name"
                v-model="playbook.name"
                placeholder="Enter playbook name"
                class="mt-1"
              />
            </div>

            <div>
              <Label for="description">Description</Label>
              <textarea
                id="description"
                v-model="playbook.description"
                placeholder="Describe what this playbook does"
                rows="3"
                class="w-full px-3 py-2 text-sm border border-input rounded-md"
              />
            </div>

            <div class="grid gap-4 md:grid-cols-2">
              <div>
                <Label for="category">Category</Label>
                <select
                  id="category"
                  v-model="playbook.category"
                  class="w-full px-3 py-2 text-sm border border-input rounded-md mt-1"
                >
                  <option value="">Select category</option>
                  <option value="customer-support">Customer Support</option>
                  <option value="sales">Sales</option>
                  <option value="technical">Technical</option>
                  <option value="custom">Custom</option>
                </select>
              </div>

              <div>
                <Label for="priority">Priority</Label>
                <select
                  id="priority"
                  v-model="playbook.priority"
                  class="w-full px-3 py-2 text-sm border border-input rounded-md mt-1"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </div>
            </div>
          </CardContent>
        </Card>

        <!-- Trigger Configuration -->
        <Card>
          <CardHeader>
            <CardTitle>Trigger Configuration</CardTitle>
            <CardDescription
              >Define when this playbook should be activated</CardDescription
            >
          </CardHeader>
          <CardContent class="space-y-4">
            <div>
              <Label>Trigger Type</Label>
              <div class="grid gap-3 mt-2 md:grid-cols-3">
                <Card
                  v-for="trigger in triggerTypes"
                  :key="trigger.id"
                  :class="[
                    'cursor-pointer transition-colors hover:bg-muted/50',
                    playbook.triggerType === trigger.id
                      ? 'ring-2 ring-primary'
                      : '',
                  ]"
                  @click="playbook.triggerType = trigger.id"
                >
                  <CardContent class="p-3 text-center">
                    <component
                      :is="trigger.icon"
                      class="h-6 w-6 mx-auto text-primary mb-1"
                    />
                    <div class="font-medium text-sm">{{ trigger.name }}</div>
                    <div class="text-xs text-muted-foreground">
                      {{ trigger.description }}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>

            <div v-if="playbook.triggerType === 'keywords'">
              <Label for="keywords">Keywords/Phrases</Label>
              <div class="space-y-2">
                <Input
                  v-model="newKeyword"
                  placeholder="Enter keywords or phrases"
                  class="mt-1"
                  @keyup.enter="addKeyword"
                />
                <div class="flex flex-wrap gap-2">
                  <Badge
                    v-for="(keyword, index) in playbook.keywords"
                    :key="index"
                    variant="secondary"
                    class="cursor-pointer"
                    @click="removeKeyword(index)"
                  >
                    {{ keyword }}
                    <X class="h-3 w-3 ml-1" />
                  </Badge>
                </div>
              </div>
            </div>

            <div v-if="playbook.triggerType === 'intent'">
              <Label for="intent">Intent</Label>
              <select
                id="intent"
                v-model="playbook.intent"
                class="w-full px-3 py-2 text-sm border border-input rounded-md mt-1"
              >
                <option value="">Select intent</option>
                <option value="billing-inquiry">Billing Inquiry</option>
                <option value="product-question">Product Question</option>
                <option value="technical-support">Technical Support</option>
                <option value="sales-inquiry">Sales Inquiry</option>
                <option value="complaint">Complaint</option>
              </select>
            </div>

            <div v-if="playbook.triggerType === 'conditions'">
              <Label>Conditions</Label>
              <div class="space-y-3 mt-2">
                <div
                  v-for="(condition, index) in playbook.conditions"
                  :key="index"
                  class="flex items-center space-x-2 p-3 border rounded-md"
                >
                  <select
                    v-model="condition.field"
                    class="px-2 py-1 text-sm border rounded"
                  >
                    <option value="user_type">User Type</option>
                    <option value="conversation_count">
                      Conversation Count
                    </option>
                    <option value="time_of_day">Time of Day</option>
                    <option value="channel">Channel</option>
                  </select>
                  <select
                    v-model="condition.operator"
                    class="px-2 py-1 text-sm border rounded"
                  >
                    <option value="equals">Equals</option>
                    <option value="not_equals">Not Equals</option>
                    <option value="greater_than">Greater Than</option>
                    <option value="less_than">Less Than</option>
                    <option value="contains">Contains</option>
                  </select>
                  <Input
                    v-model="condition.value"
                    placeholder="Value"
                    class="flex-1"
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    @click="removeCondition(index)"
                  >
                    <X class="h-4 w-4" />
                  </Button>
                </div>
                <Button variant="outline" size="sm" @click="addCondition">
                  <Plus class="h-4 w-4 mr-2" />
                  Add Condition
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <!-- Response Flow -->
        <Card>
          <CardHeader>
            <CardTitle>Response Flow</CardTitle>
            <CardDescription
              >Design the conversation flow and responses</CardDescription
            >
          </CardHeader>
          <CardContent>
            <!-- Flow Builder -->
            <div
              class="min-h-[400px] border-2 border-dashed border-muted rounded-lg p-6"
            >
              <div v-if="playbook.flow.length === 0" class="text-center py-12">
                <MessageSquare
                  class="h-12 w-12 text-muted-foreground mx-auto mb-4"
                />
                <h3 class="text-lg font-medium mb-2">Build Your Flow</h3>
                <p class="text-muted-foreground mb-4">
                  Add response nodes to create your conversation flow
                </p>
                <div class="flex justify-center space-x-2">
                  <Button @click="addNode('text')">
                    <MessageSquare class="h-4 w-4 mr-2" />
                    Text Response
                  </Button>
                  <Button variant="outline" @click="addNode('action')">
                    <Zap class="h-4 w-4 mr-2" />
                    Action
                  </Button>
                  <Button variant="outline" @click="addNode('condition')">
                    <GitBranch class="h-4 w-4 mr-2" />
                    Condition
                  </Button>
                </div>
              </div>

              <!-- Flow Nodes -->
              <div v-else class="space-y-4">
                <div
                  v-for="(node, index) in playbook.flow"
                  :key="node.id"
                  class="relative"
                >
                  <!-- Connection Line -->
                  <div
                    v-if="index > 0"
                    class="absolute -top-4 left-1/2 transform -translate-x-1/2 w-px h-4 bg-border"
                  ></div>

                  <!-- Node -->
                  <Card :class="['relative', getNodeClass(node.type)]">
                    <CardHeader class="pb-3">
                      <div class="flex items-center justify-between">
                        <div class="flex items-center space-x-2">
                          <component
                            :is="getNodeIcon(node.type)"
                            class="h-4 w-4"
                          />
                          <span class="font-medium">{{
                            getNodeLabel(node.type)
                          }}</span>
                        </div>
                        <div class="flex items-center space-x-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            :disabled="index === 0"
                            @click="moveNodeUp(index)"
                          >
                            <ChevronUp class="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            :disabled="index === playbook.flow.length - 1"
                            @click="moveNodeDown(index)"
                          >
                            <ChevronDown class="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            @click="removeNode(index)"
                          >
                            <X class="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <!-- Text Response Node -->
                      <div v-if="node.type === 'text'">
                        <Label>Response Text</Label>
                        <textarea
                          v-model="node.content"
                          placeholder="Enter response text..."
                          rows="3"
                          class="w-full px-3 py-2 text-sm border border-input rounded-md mt-1"
                        />
                      </div>

                      <!-- Action Node -->
                      <div v-if="node.type === 'action'" class="space-y-3">
                        <div>
                          <Label>Action Type</Label>
                          <select
                            v-model="node.action"
                            class="w-full px-3 py-2 text-sm border border-input rounded-md mt-1"
                          >
                            <option value="">Select action</option>
                            <option value="create-ticket">
                              Create Support Ticket
                            </option>
                            <option value="escalate">Escalate to Human</option>
                            <option value="collect-info">
                              Collect Information
                            </option>
                            <option value="api-call">API Call</option>
                          </select>
                        </div>
                        <div v-if="node.action">
                          <Label>Parameters</Label>
                          <div class="mt-1 p-3 bg-muted rounded-md">
                            <pre class="text-sm">{{
                              JSON.stringify(node.parameters || {}, null, 2)
                            }}</pre>
                          </div>
                        </div>
                      </div>

                      <!-- Condition Node -->
                      <div v-if="node.type === 'condition'" class="space-y-3">
                        <div>
                          <Label>Condition</Label>
                          <Input
                            v-model="node.condition"
                            placeholder="Enter condition..."
                            class="mt-1"
                          />
                        </div>
                        <div class="grid gap-3 md:grid-cols-2">
                          <div>
                            <Label>If True</Label>
                            <select
                              v-model="node.trueAction"
                              class="w-full px-3 py-2 text-sm border border-input rounded-md mt-1"
                            >
                              <option value="">Select action</option>
                              <option value="continue">Continue Flow</option>
                              <option value="jump">Jump to Node</option>
                              <option value="end">End Conversation</option>
                            </select>
                          </div>
                          <div>
                            <Label>If False</Label>
                            <select
                              v-model="node.falseAction"
                              class="w-full px-3 py-2 text-sm border border-input rounded-md mt-1"
                            >
                              <option value="">Select action</option>
                              <option value="continue">Continue Flow</option>
                              <option value="jump">Jump to Node</option>
                              <option value="end">End Conversation</option>
                            </select>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                <!-- Add Node Button -->
                <div class="flex justify-center">
                  <div class="flex space-x-2">
                    <Button
                      variant="outline"
                      size="sm"
                      @click="addNode('text')"
                    >
                      <MessageSquare class="h-4 w-4 mr-2" />
                      Text
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      @click="addNode('action')"
                    >
                      <Zap class="h-4 w-4 mr-2" />
                      Action
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      @click="addNode('condition')"
                    >
                      <GitBranch class="h-4 w-4 mr-2" />
                      Condition
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <!-- Right Panel: Preview & Actions -->
      <div class="space-y-6">
        <!-- Playbook Status -->
        <Card>
          <CardHeader>
            <CardTitle>Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div class="space-y-3">
              <div class="flex items-center justify-between">
                <span class="text-sm">Status:</span>
                <Badge :variant="getStatusVariant(playbook.status)">
                  {{ playbook.status }}
                </Badge>
              </div>
              <div class="flex items-center justify-between">
                <span class="text-sm">Created:</span>
                <span class="text-sm text-muted-foreground">
                  {{ formatDate(playbook.createdAt) }}
                </span>
              </div>
              <div class="flex items-center justify-between">
                <span class="text-sm">Modified:</span>
                <span class="text-sm text-muted-foreground">
                  {{ formatDate(playbook.updatedAt) }}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        <!-- Available Actions -->
        <Card>
          <CardHeader>
            <CardTitle>Available Actions</CardTitle>
            <CardDescription
              >MCP actions you can use in this playbook</CardDescription
            >
          </CardHeader>
          <CardContent>
            <div class="space-y-2">
              <div
                v-for="action in availableActions"
                :key="action.id"
                class="flex items-center justify-between p-2 border rounded cursor-pointer hover:bg-muted/50"
                @click="addActionToFlow(action)"
              >
                <div>
                  <div class="font-medium text-sm">{{ action.name }}</div>
                  <div class="text-xs text-muted-foreground">
                    {{ action.description }}
                  </div>
                </div>
                <Plus class="h-4 w-4 text-muted-foreground" />
              </div>
            </div>
          </CardContent>
        </Card>

        <!-- Test Panel -->
        <Card>
          <CardHeader>
            <CardTitle>Test Playbook</CardTitle>
            <CardDescription
              >Test your playbook with sample inputs</CardDescription
            >
          </CardHeader>
          <CardContent>
            <div class="space-y-3">
              <div>
                <Label for="test-input">Test Message</Label>
                <textarea
                  id="test-input"
                  v-model="testInput"
                  placeholder="Enter a test message..."
                  rows="3"
                  class="w-full px-3 py-2 text-sm border border-input rounded-md mt-1"
                />
              </div>
              <Button
                class="w-full"
                :disabled="!testInput.trim()"
                @click="runTest"
              >
                <Play class="h-4 w-4 mr-2" />
                Run Test
              </Button>

              <div v-if="testResult" class="mt-4 p-3 bg-muted rounded-md">
                <div class="text-sm font-medium mb-2">Test Result:</div>
                <div class="text-sm">{{ testResult }}</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  ArrowLeft,
  Save,
  Check,
  Play,
  MessageSquare,
  Zap,
  GitBranch,
  Plus,
  X,
  ChevronUp,
  ChevronDown,
  Target,
  Brain,
  Filter,
} from "lucide-vue-next";

// TODO: Import actual Badge component when available
const Badge = ({ variant = "default", ...props }) =>
  h("span", {
    class: `inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
      variant === "outline"
        ? "border border-gray-300 text-gray-700"
        : variant === "secondary"
        ? "bg-blue-100 text-blue-800"
        : variant === "destructive"
        ? "bg-red-100 text-red-800"
        : variant === "success"
        ? "bg-green-100 text-green-800"
        : "bg-gray-100 text-gray-800"
    }`,
    ...props,
  });

// Get route params
const route = useRoute();
const playbookId = route.params["id"] as string;
const isNewPlaybook = playbookId === "new";

// Reactive state
const loading = ref(false);
const newKeyword = ref("");
const testInput = ref("");
const testResult = ref("");

// Playbook data
const playbook = ref({
  id: playbookId,
  name: "",
  description: "",
  category: "",
  priority: "medium",
  status: "draft",
  triggerType: "keywords",
  keywords: [] as string[],
  intent: "",
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  conditions: [] as any[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  flow: [] as any[],
  createdAt: new Date(),
  updatedAt: new Date(),
});

// Configuration options
const triggerTypes = [
  {
    id: "keywords",
    name: "Keywords",
    description: "Trigger on specific words",
    icon: Target,
  },
  {
    id: "intent",
    name: "Intent",
    description: "Trigger on detected intent",
    icon: Brain,
  },
  {
    id: "conditions",
    name: "Conditions",
    description: "Trigger on custom conditions",
    icon: Filter,
  },
];

const availableActions = ref([
  {
    id: "create-ticket",
    name: "Create Support Ticket",
    description: "Create a new support ticket",
  },
  {
    id: "get-user-info",
    name: "Get User Information",
    description: "Retrieve user account details",
  },
  {
    id: "send-email",
    name: "Send Email",
    description: "Send email notification",
  },
  {
    id: "update-crm",
    name: "Update CRM",
    description: "Update customer record",
  },
]);

// Computed properties
const canTest = computed(() => {
  return playbook.value.name && playbook.value.flow.length > 0;
});

const isValid = computed(() => {
  return (
    playbook.value.name &&
    playbook.value.triggerType &&
    playbook.value.flow.length > 0
  );
});

// Methods
const goBack = () => {
  navigateTo("/playbooks");
};

const addKeyword = () => {
  if (newKeyword.value.trim()) {
    playbook.value.keywords.push(newKeyword.value.trim());
    newKeyword.value = "";
  }
};

const removeKeyword = (index: number) => {
  playbook.value.keywords.splice(index, 1);
};

const addCondition = () => {
  playbook.value.conditions.push({
    field: "",
    operator: "",
    value: "",
  });
};

const removeCondition = (index: number) => {
  playbook.value.conditions.splice(index, 1);
};

const addNode = (type: string) => {
  const nodeId = `node_${Date.now()}`;
  const newNode = {
    id: nodeId,
    type,
    content: "",
    action: "",
    parameters: {},
    condition: "",
    trueAction: "",
    falseAction: "",
  };
  playbook.value.flow.push(newNode);
};

const removeNode = (index: number) => {
  playbook.value.flow.splice(index, 1);
};

const moveNodeUp = (index: number) => {
  if (index > 0) {
    const node = playbook.value.flow.splice(index, 1)[0];
    playbook.value.flow.splice(index - 1, 0, node);
  }
};

const moveNodeDown = (index: number) => {
  if (index < playbook.value.flow.length - 1) {
    const node = playbook.value.flow.splice(index, 1)[0];
    playbook.value.flow.splice(index + 1, 0, node);
  }
};

const getNodeClass = (type: string) => {
  const classes = {
    text: "border-blue-200 bg-blue-50/50",
    action: "border-green-200 bg-green-50/50",
    condition: "border-orange-200 bg-orange-50/50",
  };
  return classes[type as keyof typeof classes] || "";
};

const getNodeIcon = (type: string) => {
  const icons = {
    text: MessageSquare,
    action: Zap,
    condition: GitBranch,
  };
  return icons[type as keyof typeof icons] || MessageSquare;
};

const getNodeLabel = (type: string) => {
  const labels = {
    text: "Text Response",
    action: "Action",
    condition: "Condition",
  };
  return labels[type as keyof typeof labels] || type;
};

const getStatusVariant = (status: string) => {
  const variants = {
    active: "success",
    draft: "outline",
    inactive: "secondary",
  };
  return variants[status as keyof typeof variants] || "default";
};

const formatDate = (date: Date) => {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const addActionToFlow = (action: any) => {
  const actionNode = {
    id: `node_${Date.now()}`,
    type: "action",
    action: action.id,
    parameters: {},
    content: "",
    condition: "",
    trueAction: "",
    falseAction: "",
  };
  playbook.value.flow.push(actionNode);
};

const runTest = () => {
  // TODO: Implement actual playbook testing
  testResult.value = `Test completed for input: "${testInput.value}". Flow would trigger ${playbook.value.flow.length} steps.`;
};

const testPlaybook = () => {
  // TODO: Open test modal with conversation simulator
  console.log("Test playbook");
};

const saveAsDraft = async () => {
  loading.value = true;
  try {
    playbook.value.status = "draft";
    playbook.value.updatedAt = new Date();
    // TODO: Save playbook as draft
    console.log("Save as draft:", playbook.value);
  } finally {
    loading.value = false;
  }
};

const savePlaybook = async () => {
  loading.value = true;
  try {
    playbook.value.status = "active";
    playbook.value.updatedAt = new Date();
    // TODO: Save playbook
    console.log("Save playbook:", playbook.value);

    // Navigate back to playbooks list
    navigateTo("/playbooks");
  } finally {
    loading.value = false;
  }
};

// Lifecycle
onMounted(async () => {
  if (!isNewPlaybook) {
    // TODO: Load existing playbook data
    console.log("Loading playbook:", playbookId);

    // Mock data for existing playbook
    playbook.value = {
      id: playbookId,
      name: "Billing Issue Resolution",
      description:
        "Automated flow for common billing questions and payment issues",
      category: "customer-support",
      priority: "high",
      status: "active",
      triggerType: "keywords",
      keywords: ["billing", "payment", "invoice", "charge"],
      intent: "",
      conditions: [],
      flow: [
        {
          id: "node_1",
          type: "text",
          content:
            "I understand you have a billing question. Let me help you with that.",
          action: "",
          parameters: {},
          condition: "",
          trueAction: "",
          falseAction: "",
        },
        {
          id: "node_2",
          type: "action",
          action: "get-user-info",
          parameters: { fields: ["account_status", "billing_info"] },
          content: "",
          condition: "",
          trueAction: "",
          falseAction: "",
        },
      ],
      createdAt: new Date("2024-01-01"),
      updatedAt: new Date("2024-01-15"),
    };
  }
});

// Set page meta
definePageMeta({
  layout: "default",
  // middleware: 'auth',
});

// Head management
useHead({
  title: `${isNewPlaybook ? "Create" : "Edit"} Playbook - Hay Dashboard`,
});
</script>
