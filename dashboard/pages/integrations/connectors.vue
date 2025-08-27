<template>
  <div class="space-y-6">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-3xl font-bold tracking-tight">Connectors</h1>
        <p class="text-muted-foreground">Connect your agents to various platforms and channels</p>
      </div>
      <div class="flex items-center space-x-2">
        <Button variant="outline" size="sm">
          <FileText class="h-4 w-4 mr-2" />
          Documentation
        </Button>
        <Button variant="outline" size="sm" @click="refreshConnectors">
          <RefreshCcw class="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>
    </div>

    <!-- Stats Cards -->
    <div class="grid gap-4 md:grid-cols-4">
      <Card>
        <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
          <span class="text-sm font-medium">Total Connectors</span>
          <Plug class="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div class="text-2xl font-bold">{{ stats.total }}</div>
          <p class="text-xs text-muted-foreground">Available integrations</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
          <span class="text-sm font-medium">Connected</span>
          <CheckCircle class="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div class="text-2xl font-bold">{{ stats.connected }}</div>
          <p class="text-xs text-green-600">
            {{ Math.round((stats.connected / stats.total) * 100) }}% active
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
          <span class="text-sm font-medium">Messages Today</span>
          <MessageSquare class="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div class="text-2xl font-bold">{{ stats.messagesToday }}</div>
          <p class="text-xs text-muted-foreground">Across all channels</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
          <span class="text-sm font-medium">Uptime</span>
          <Activity class="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div class="text-2xl font-bold">{{ stats.uptime }}%</div>
          <p class="text-xs text-green-600">Last 30 days</p>
        </CardContent>
      </Card>
    </div>

    <!-- Categories -->
    <div class="flex items-center space-x-2">
      <span class="text-sm font-medium">Categories:</span>
      <div class="flex space-x-2">
        <Button
          v-for="category in categories"
          :key="category.id"
          :variant="selectedCategory === category.id ? 'default' : 'outline'"
          size="sm"
          @click="selectedCategory = category.id"
        >
          <component :is="category.icon" class="h-4 w-4 mr-2" />
          {{ category.name }}
        </Button>
      </div>
    </div>

    <!-- Web Chat Widget Section -->
    <Card v-if="selectedCategory === 'all' || selectedCategory === 'web'">
      <CardHeader>
        <CardTitle>Web Chat Widget</CardTitle>
        <CardDescription>Embed a chat widget on your website</CardDescription>
      </CardHeader>
      <CardContent>
        <div class="grid gap-6 lg:grid-cols-2">
          <!-- Configuration -->
          <div class="space-y-4">
            <div>
              <Label for="widget-title">Widget Title</Label>
              <Input
                id="widget-title"
                v-model="widgetConfig.title"
                placeholder="Chat with us"
                class="mt-1"
              />
            </div>

            <div>
              <Label for="widget-subtitle">Subtitle</Label>
              <Input
                id="widget-subtitle"
                v-model="widgetConfig.subtitle"
                placeholder="We're here to help"
                class="mt-1"
              />
            </div>

            <div class="grid gap-4 md:grid-cols-2">
              <div>
                <Label for="widget-position">Position</Label>
                <select
                  id="widget-position"
                  v-model="widgetConfig.position"
                  class="w-full px-3 py-2 text-sm border border-input rounded-md mt-1"
                >
                  <option value="bottom-right">Bottom Right</option>
                  <option value="bottom-left">Bottom Left</option>
                  <option value="top-right">Top Right</option>
                  <option value="top-left">Top Left</option>
                </select>
              </div>

              <div>
                <Label for="widget-theme">Theme</Label>
                <select
                  id="widget-theme"
                  v-model="widgetConfig.theme"
                  class="w-full px-3 py-2 text-sm border border-input rounded-md mt-1"
                >
                  <option value="blue">Blue</option>
                  <option value="green">Green</option>
                  <option value="purple">Purple</option>
                  <option value="dark">Dark</option>
                </select>
              </div>
            </div>

            <div class="flex items-center space-x-2">
              <Checkbox id="widget-greeting" v-model="widgetConfig.showGreeting" />
              <Label for="widget-greeting">Show greeting message</Label>
            </div>

            <div class="flex space-x-2">
              <Button @click="saveWidgetConfig">
                <Save class="h-4 w-4 mr-2" />
                Save Configuration
              </Button>
              <Button variant="outline" @click="showEmbedCode = true">
                <Code class="h-4 w-4 mr-2" />
                Generate Code
              </Button>
            </div>
          </div>

          <!-- Preview -->
          <div class="space-y-4">
            <div>
              <Label>Preview</Label>
              <div class="mt-1 border rounded-lg p-4 bg-gray-50 min-h-[200px] relative">
                <div class="absolute bottom-4 right-4">
                  <div
                    :class="[
                      'w-16 h-16 rounded-full flex items-center justify-center cursor-pointer shadow-lg',
                      getThemeClass(widgetConfig.theme),
                    ]"
                    @click="togglePreviewChat"
                  >
                    <MessageCircle class="h-8 w-8 text-white" />
                  </div>

                  <!-- Chat Preview -->
                  <div
                    v-if="showPreviewChat"
                    class="absolute bottom-20 right-0 w-80 h-96 bg-white border rounded-lg shadow-xl"
                  >
                    <div :class="['p-4 rounded-t-lg', getThemeClass(widgetConfig.theme)]">
                      <h3 class="font-medium text-white">{{ widgetConfig.title }}</h3>
                      <p class="text-sm text-white/80">{{ widgetConfig.subtitle }}</p>
                    </div>
                    <div class="p-4 h-80 overflow-y-auto">
                      <div v-if="widgetConfig.showGreeting" class="mb-4">
                        <div class="bg-gray-100 p-3 rounded-lg text-sm">
                          Hello! How can I help you today?
                        </div>
                      </div>
                      <div class="text-sm text-muted-foreground">
                        Start typing to see the chat in action...
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>

    <!-- Connectors Grid -->
    <div class="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
      <Card
        v-for="connector in filteredConnectors"
        :key="connector.id"
        class="hover:shadow-md transition-shadow"
      >
        <CardHeader>
          <div class="flex items-start justify-between">
            <div class="flex items-center space-x-3">
              <div class="w-12 h-12 rounded-lg border-2 flex items-center justify-center">
                <component :is="connector.icon" :class="['h-6 w-6', connector.iconColor]" />
              </div>
              <div>
                <CardTitle class="text-lg">{{ connector.name }}</CardTitle>
                <CardDescription>{{ connector.description }}</CardDescription>
              </div>
            </div>
            <Badge :variant="connector.status === 'connected' ? 'success' : 'secondary'">
              {{ connector.status }}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div class="space-y-4">
            <!-- Connection Stats -->
            <div v-if="connector.status === 'connected'" class="grid gap-2 text-sm">
              <div class="flex justify-between">
                <span class="text-muted-foreground">Messages today:</span>
                <span class="font-medium">{{ connector.stats?.messagesToday || 0 }}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-muted-foreground">Last activity:</span>
                <span class="font-medium">{{ formatDate(connector.stats?.lastActivity) }}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-muted-foreground">Status:</span>
                <div class="flex items-center space-x-1">
                  <div
                    :class="[
                      'w-2 h-2 rounded-full',
                      connector.stats?.online ? 'bg-green-500' : 'bg-gray-400',
                    ]"
                  ></div>
                  <span class="font-medium">{{
                    connector.stats?.online ? 'Online' : 'Offline'
                  }}</span>
                </div>
              </div>
            </div>

            <!-- Features -->
            <div class="space-y-2">
              <div class="text-sm font-medium">Features:</div>
              <div class="flex flex-wrap gap-1">
                <Badge
                  v-for="feature in connector.features"
                  :key="feature"
                  variant="outline"
                  class="text-xs"
                >
                  {{ feature }}
                </Badge>
              </div>
            </div>

            <!-- Actions -->
            <div class="flex space-x-2">
              <Button
                v-if="connector.status === 'disconnected'"
                size="sm"
                :disabled="connecting === connector.id"
                @click="connectConnector(connector.id)"
              >
                <Plug class="h-3 w-3 mr-1" />
                Connect
              </Button>

              <template v-else>
                <Button variant="outline" size="sm" @click="configureConnector(connector.id)">
                  <Settings class="h-3 w-3 mr-1" />
                  Configure
                </Button>
                <Button variant="outline" size="sm" @click="testConnector(connector.id)">
                  <Zap class="h-3 w-3 mr-1" />
                  Test
                </Button>
                <Button variant="destructive" size="sm" @click="disconnectConnector(connector.id)">
                  <Unplug class="h-3 w-3 mr-1" />
                  Disconnect
                </Button>
              </template>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>

    <!-- Empty State -->
    <div v-if="filteredConnectors.length === 0" class="text-center py-12">
      <Plug class="h-12 w-12 text-muted-foreground mx-auto mb-4" />
      <h3 class="text-lg font-medium mb-2">No connectors found</h3>
      <p class="text-muted-foreground">
        Try adjusting your category filter to see more connectors.
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  Plug,
  CheckCircle,
  MessageSquare,
  Activity,
  FileText,
  RefreshCcw,
  MessageCircle,
  Save,
  Code,
  Settings,
  Zap,
  Unplug,
  Globe,
  Hash,
  Mail,
  Phone,
  Smartphone,
} from 'lucide-vue-next';

// TODO: Import actual Badge component when available
const Badge = ({ variant = 'default', ...props }) =>
  h('span', {
    class: `inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
      variant === 'outline'
        ? 'border border-gray-300 text-gray-700'
        : variant === 'secondary'
          ? 'bg-blue-100 text-blue-800'
          : variant === 'destructive'
            ? 'bg-red-100 text-red-800'
            : variant === 'success'
              ? 'bg-green-100 text-green-800'
              : 'bg-gray-100 text-gray-800'
    }`,
    ...props,
  });

// Reactive state
const selectedCategory = ref('all');
const connecting = ref<string | null>(null);
const showPreviewChat = ref(false);
const showEmbedCode = ref(false);

// Widget configuration
const widgetConfig = ref({
  title: 'Chat with us',
  subtitle: "We're here to help",
  position: 'bottom-right',
  theme: 'blue',
  showGreeting: true,
});

// Mock data - TODO: Replace with actual API calls
const stats = ref({
  total: 12,
  connected: 6,
  messagesToday: 342,
  uptime: 99.8,
});

const categories = [
  { id: 'all', name: 'All', icon: Globe },
  { id: 'messaging', name: 'Messaging', icon: MessageSquare },
  { id: 'social', name: 'Social', icon: Hash },
  { id: 'email', name: 'Email', icon: Mail },
  { id: 'voice', name: 'Voice', icon: Phone },
  { id: 'web', name: 'Web', icon: Globe },
  { id: 'mobile', name: 'Mobile', icon: Smartphone },
];

const connectors = ref([
  {
    id: 'slack',
    name: 'Slack',
    description: 'Connect to Slack channels and DMs',
    category: 'messaging',
    status: 'connected',
    icon: Hash,
    iconColor: 'text-purple-600',
    features: ['Channels', 'DMs', 'Bot Commands'],
    stats: {
      messagesToday: 145,
      lastActivity: new Date('2024-01-15T14:20:00'),
      online: true,
    },
  },
  {
    id: 'discord',
    name: 'Discord',
    description: 'Integrate with Discord servers',
    category: 'messaging',
    status: 'connected',
    icon: MessageSquare,
    iconColor: 'text-indigo-600',
    features: ['Servers', 'DMs', 'Voice'],
    stats: {
      messagesToday: 89,
      lastActivity: new Date('2024-01-15T13:45:00'),
      online: true,
    },
  },
  {
    id: 'whatsapp',
    name: 'WhatsApp Business',
    description: 'Connect to WhatsApp Business API',
    category: 'messaging',
    status: 'disconnected',
    icon: MessageCircle,
    iconColor: 'text-green-600',
    features: ['Messages', 'Media', 'Templates'],
  },
  {
    id: 'telegram',
    name: 'Telegram',
    description: 'Integrate with Telegram bots',
    category: 'messaging',
    status: 'connected',
    icon: MessageSquare,
    iconColor: 'text-blue-600',
    features: ['Bots', 'Groups', 'Channels'],
    stats: {
      messagesToday: 67,
      lastActivity: new Date('2024-01-15T12:30:00'),
      online: true,
    },
  },
  {
    id: 'facebook',
    name: 'Facebook Messenger',
    description: 'Connect to Facebook Messenger',
    category: 'social',
    status: 'connected',
    icon: MessageCircle,
    iconColor: 'text-blue-500',
    features: ['Messages', 'Quick Replies', 'Persistent Menu'],
    stats: {
      messagesToday: 23,
      lastActivity: new Date('2024-01-15T11:15:00'),
      online: true,
    },
  },
  {
    id: 'instagram',
    name: 'Instagram',
    description: 'Connect to Instagram Direct Messages',
    category: 'social',
    status: 'disconnected',
    icon: MessageSquare,
    iconColor: 'text-pink-600',
    features: ['DMs', 'Story Replies', 'Comments'],
  },
  {
    id: 'twitter',
    name: 'Twitter/X',
    description: 'Connect to Twitter DMs and mentions',
    category: 'social',
    status: 'disconnected',
    icon: Hash,
    iconColor: 'text-gray-900',
    features: ['DMs', 'Mentions', 'Tweets'],
  },
  {
    id: 'email',
    name: 'Email',
    description: 'Handle email conversations',
    category: 'email',
    status: 'connected',
    icon: Mail,
    iconColor: 'text-gray-600',
    features: ['SMTP', 'IMAP', 'Templates'],
    stats: {
      messagesToday: 18,
      lastActivity: new Date('2024-01-15T10:45:00'),
      online: true,
    },
  },
  {
    id: 'sms',
    name: 'SMS',
    description: 'Send and receive SMS messages',
    category: 'voice',
    status: 'disconnected',
    icon: Smartphone,
    iconColor: 'text-green-600',
    features: ['Two-way SMS', 'Bulk Messages', 'Short Codes'],
  },
  {
    id: 'voice',
    name: 'Voice Calls',
    description: 'Handle voice call interactions',
    category: 'voice',
    status: 'disconnected',
    icon: Phone,
    iconColor: 'text-blue-600',
    features: ['Inbound Calls', 'Call Recording', 'IVR'],
  },
  {
    id: 'webchat',
    name: 'Web Chat',
    description: 'Website chat widget',
    category: 'web',
    status: 'connected',
    icon: Globe,
    iconColor: 'text-orange-600',
    features: ['Live Chat', 'File Sharing', 'Typing Indicators'],
    stats: {
      messagesToday: 0,
      lastActivity: new Date('2024-01-15T09:30:00'),
      online: true,
    },
  },
  {
    id: 'mobile-app',
    name: 'Mobile App',
    description: 'In-app messaging for mobile apps',
    category: 'mobile',
    status: 'disconnected',
    icon: Smartphone,
    iconColor: 'text-purple-600',
    features: ['In-app Chat', 'Push Notifications', 'Rich Media'],
  },
]);

// Computed properties
const filteredConnectors = computed(() => {
  if (selectedCategory.value === 'all') {
    return connectors.value;
  }
  return connectors.value.filter((c) => c.category === selectedCategory.value);
});

// Methods
const formatDate = (date: Date | undefined) => {
  if (!date) return 'Never';
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ago`;
  } else if (minutes > 0) {
    return `${minutes}m ago`;
  } else {
    return 'Just now';
  }
};

const getThemeClass = (theme: string) => {
  const themes: Record<string, string> = {
    blue: 'bg-blue-600',
    green: 'bg-green-600',
    purple: 'bg-purple-600',
    dark: 'bg-gray-900',
  };
  return themes[theme as keyof typeof themes] || themes['blue'];
};

const togglePreviewChat = () => {
  showPreviewChat.value = !showPreviewChat.value;
};

const saveWidgetConfig = () => {
  // TODO: Save widget configuration
  console.log('Save widget config:', widgetConfig.value);
};

const connectConnector = async (connectorId: string) => {
  connecting.value = connectorId;
  try {
    // TODO: Implement connector connection
    console.log('Connect connector:', connectorId);

    // Simulate OAuth flow or configuration
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Update connector status
    const connector = connectors.value.find((c) => c.id === connectorId);
    if (connector) {
      connector.status = 'connected';
      connector.stats = {
        messagesToday: 0,
        lastActivity: new Date(),
        online: true,
      };
    }
  } finally {
    connecting.value = null;
  }
};

const disconnectConnector = (connectorId: string) => {
  // TODO: Implement connector disconnection
  console.log('Disconnect connector:', connectorId);

  const connector = connectors.value.find((c) => c.id === connectorId);
  if (connector) {
    connector.status = 'disconnected';
    delete connector.stats;
  }
};

const configureConnector = (connectorId: string) => {
  // TODO: Open connector configuration modal
  console.log('Configure connector:', connectorId);
};

const testConnector = (connectorId: string) => {
  // TODO: Test connector connection
  console.log('Test connector:', connectorId);
};

const refreshConnectors = () => {
  // TODO: Refresh connector status
  console.log('Refresh connectors');
};

// Lifecycle
onMounted(() => {
  // TODO: Fetch connectors from API
});

// Set page meta
definePageMeta({
  layout: 'default',
  middleware: 'auth',
});

// Head management
useHead({
  title: 'Connectors - Hay Dashboard',
  meta: [{ name: 'description', content: 'Connect your agents to various platforms and channels' }],
});
</script>
