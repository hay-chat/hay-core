<template>
  <div class="space-y-6">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-3xl font-bold tracking-tight">Custom Reports</h1>
        <p class="text-neutral-muted">Build and schedule custom analytics reports</p>
      </div>
      <div class="flex items-center space-x-2">
        <Button variant="outline" size="sm" @click="viewScheduledReports">
          <Calendar class="h-4 w-4 mr-2" />
          Scheduled Reports
        </Button>
        <Button @click="createNewReport">
          <Plus class="h-4 w-4 mr-2" />
          New Report
        </Button>
      </div>
    </div>

    <!-- Report Builder -->
    <div class="grid gap-6 lg:grid-cols-3">
      <!-- Left Panel: Configuration -->
      <div class="lg:col-span-2 space-y-6">
        <!-- Basic Information -->
        <Card>
          <CardHeader>
            <CardTitle>Report Configuration</CardTitle>
            <CardDescription> Set up your custom report parameters </CardDescription>
          </CardHeader>
          <CardContent class="space-y-4">
            <div>
              <Label for="report-name">Report Name</Label>
              <Input
                id="report-name"
                v-model="reportConfig.name"
                placeholder="Enter report name"
                class="mt-1"
              />
            </div>

            <div>
              <Label for="report-description">Description</Label>
              <textarea
                id="report-description"
                v-model="reportConfig.description"
                placeholder="Describe what this report covers"
                rows="3"
                class="w-full px-3 py-2 text-sm border border-input rounded-md mt-1"
              />
            </div>

            <div class="grid gap-4 md:grid-cols-2">
              <div>
                <Label for="report-type">Report Type</Label>
                <select
                  id="report-type"
                  v-model="reportConfig.type"
                  class="w-full px-3 py-2 text-sm border border-input rounded-md mt-1"
                >
                  <option value="summary">Summary Report</option>
                  <option value="detailed">Detailed Analysis</option>
                  <option value="performance">Performance Report</option>
                  <option value="trends">Trends Analysis</option>
                </select>
              </div>

              <div>
                <Label for="report-format">Output Format</Label>
                <select
                  id="report-format"
                  v-model="reportConfig.format"
                  class="w-full px-3 py-2 text-sm border border-input rounded-md mt-1"
                >
                  <option value="pdf">PDF Document</option>
                  <option value="csv">CSV Export</option>
                  <option value="excel">Excel Spreadsheet</option>
                  <option value="dashboard">Interactive Dashboard</option>
                </select>
              </div>
            </div>
          </CardContent>
        </Card>

        <!-- Metrics Selection -->
        <Card>
          <CardHeader>
            <CardTitle>Metrics Selection</CardTitle>
            <CardDescription> Choose the metrics to include in your report </CardDescription>
          </CardHeader>
          <CardContent>
            <div class="space-y-4">
              <div v-for="category in metricCategories" :key="category.name" class="space-y-3">
                <h3 class="font-medium flex items-center space-x-2">
                  <component :is="category.icon" class="h-4 w-4" />
                  <span>{{ category.name }}</span>
                </h3>
                <div class="grid gap-2 md:grid-cols-2">
                  <div
                    v-for="metric in category.metrics"
                    :key="metric.id"
                    class="flex items-center space-x-2"
                  >
                    <Checkbox
                      :id="metric.id"
                      :checked="reportConfig.metrics.includes(metric.id)"
                      @update:checked="toggleMetric(metric.id)"
                    />
                    <Label :for="metric.id" class="text-sm">
                      {{ metric.name }}
                    </Label>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <!-- Grouping and Filtering -->
        <Card>
          <CardHeader>
            <CardTitle>Grouping & Filters</CardTitle>
            <CardDescription> Configure how to group and filter your data </CardDescription>
          </CardHeader>
          <CardContent class="space-y-4">
            <div>
              <Label>Group By</Label>
              <div class="grid gap-2 mt-2 md:grid-cols-3">
                <div
                  v-for="group in groupingOptions"
                  :key="group.id"
                  class="flex items-center space-x-2"
                >
                  <Checkbox
                    :id="group.id"
                    :checked="reportConfig.groupBy.includes(group.id)"
                    @update:checked="toggleGroupBy(group.id)"
                  />
                  <Label :for="group.id" class="text-sm">{{ group.name }}</Label>
                </div>
              </div>
            </div>

            <div class="grid gap-4 md:grid-cols-2">
              <div>
                <Label for="date-range">Date Range</Label>
                <select
                  id="date-range"
                  v-model="reportConfig.dateRange"
                  class="w-full px-3 py-2 text-sm border border-input rounded-md mt-1"
                >
                  <option value="7d">Last 7 days</option>
                  <option value="30d">Last 30 days</option>
                  <option value="90d">Last 90 days</option>
                  <option value="custom">Custom Range</option>
                </select>
              </div>

              <div>
                <Label for="agent-filter">Agent Filter</Label>
                <select
                  id="agent-filter"
                  v-model="reportConfig.agentFilter"
                  class="w-full px-3 py-2 text-sm border border-input rounded-md mt-1"
                >
                  <option value="">All Agents</option>
                  <option v-for="agent in agents" :key="agent.id" :value="agent.id">
                    {{ agent.name }}
                  </option>
                </select>
              </div>
            </div>

            <div class="grid gap-4 md:grid-cols-2">
              <div>
                <Label for="channel-filter">Channel Filter</Label>
                <select
                  id="channel-filter"
                  v-model="reportConfig.channelFilter"
                  class="w-full px-3 py-2 text-sm border border-input rounded-md mt-1"
                >
                  <option value="">All Channels</option>
                  <option value="web">Web Chat</option>
                  <option value="email">Email</option>
                  <option value="slack">Slack</option>
                  <option value="whatsapp">WhatsApp</option>
                </select>
              </div>

              <div>
                <Label for="status-filter">Status Filter</Label>
                <select
                  id="status-filter"
                  v-model="reportConfig.statusFilter"
                  class="w-full px-3 py-2 text-sm border border-input rounded-md mt-1"
                >
                  <option value="">All Status</option>
                  <option value="resolved">Resolved</option>
                  <option value="escalated">Escalated</option>
                  <option value="closed">Closed</option>
                </select>
              </div>
            </div>
          </CardContent>
        </Card>

        <!-- Visualization Options -->
        <Card>
          <CardHeader>
            <CardTitle>Visualization</CardTitle>
            <CardDescription>Choose how to visualize your data</CardDescription>
          </CardHeader>
          <CardContent>
            <div class="grid gap-4 md:grid-cols-3">
              <div
                v-for="viz in visualizationTypes"
                :key="viz.id"
                :class="[
                  'p-4 border rounded-lg cursor-pointer transition-colors hover:bg-background-secondary',
                  reportConfig.visualizations.includes(viz.id)
                    ? 'ring-2 ring-primary bg-background-secondary'
                    : '',
                ]"
                @click="toggleVisualization(viz.id)"
              >
                <div class="text-center">
                  <component :is="viz.icon" class="h-8 w-8 mx-auto text-primary mb-2" />
                  <h3 class="font-medium text-sm">
                    {{ viz.name }}
                  </h3>
                  <p class="text-xs text-neutral-muted">
                    {{ viz.description }}
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <!-- Right Panel: Preview & Actions -->
      <div class="space-y-6">
        <!-- Report Preview -->
        <Card>
          <CardHeader>
            <CardTitle>Preview</CardTitle>
            <CardDescription>See how your report will look</CardDescription>
          </CardHeader>
          <CardContent>
            <div class="space-y-4">
              <div class="p-4 border rounded-lg bg-background-secondary">
                <h3 class="font-medium mb-2">
                  {{ reportConfig.name || "Untitled Report" }}
                </h3>
                <p class="text-sm text-neutral-muted mb-3">
                  {{ reportConfig.description || "No description provided" }}
                </p>

                <div class="space-y-2 text-xs">
                  <div><strong>Type:</strong> {{ reportConfig.type }}</div>
                  <div><strong>Format:</strong> {{ reportConfig.format }}</div>
                  <div>
                    <strong>Metrics:</strong>
                    {{ reportConfig.metrics.length }} selected
                  </div>
                  <div>
                    <strong>Group By:</strong>
                    {{ reportConfig.groupBy.join(", ") || "None" }}
                  </div>
                  <div><strong>Date Range:</strong> {{ reportConfig.dateRange }}</div>
                </div>
              </div>

              <div class="space-y-2">
                <Button class="w-full" :disabled="!canGenerate" @click="generateReport">
                  <FileText class="h-4 w-4 mr-2" />
                  Generate Report
                </Button>
                <Button
                  variant="outline"
                  class="w-full"
                  :disabled="!canSave"
                  @click="saveReportTemplate"
                >
                  <Save class="h-4 w-4 mr-2" />
                  Save Template
                </Button>
                <Button
                  variant="outline"
                  class="w-full"
                  :disabled="!canSchedule"
                  @click="scheduleReport"
                >
                  <Calendar class="h-4 w-4 mr-2" />
                  Schedule Report
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <!-- Quick Templates -->
        <Card>
          <CardHeader>
            <CardTitle>Quick Templates</CardTitle>
            <CardDescription>Start with a pre-built template</CardDescription>
          </CardHeader>
          <CardContent>
            <div class="space-y-2">
              <Button
                v-for="template in quickTemplates"
                :key="template.id"
                variant="outline"
                size="sm"
                class="w-full justify-start"
                @click="loadTemplate(template)"
              >
                <component :is="template.icon" class="h-4 w-4 mr-2" />
                {{ template.name }}
              </Button>
            </div>
          </CardContent>
        </Card>

        <!-- Recent Reports -->
        <Card>
          <CardHeader>
            <CardTitle>Recent Reports</CardTitle>
          </CardHeader>
          <CardContent>
            <div v-if="recentReports.length === 0" class="text-sm text-neutral-muted">
              No recent reports
            </div>
            <div v-else class="space-y-3">
              <div
                v-for="report in recentReports"
                :key="report.id"
                class="p-3 border rounded-lg hover:bg-background-secondary cursor-pointer"
                @click="viewReport(report.id)"
              >
                <div class="font-medium text-sm">
                  {{ report.name }}
                </div>
                <div class="text-xs text-neutral-muted">
                  Generated {{ formatDate(report.createdAt) }}
                </div>
                <div class="flex items-center justify-between mt-2">
                  <Badge variant="outline" class="text-xs">
                    {{ report.format }}
                  </Badge>
                  <Button variant="ghost" size="sm" @click.stop="downloadReport(report.id)">
                    <Download class="h-3 w-3" />
                  </Button>
                </div>
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
  Plus,
  Calendar,
  FileText,
  Save,
  Download,
  BarChart3,
  PieChart,
  LineChart,
  Activity,
  MessageSquare,
  Users,
  Clock,
  TrendingUp,
} from "lucide-vue-next";

// Reactive state
const reportConfig = ref({
  name: "",
  description: "",
  type: "summary",
  format: "pdf",
  metrics: [] as string[],
  groupBy: [] as string[],
  dateRange: "30d",
  agentFilter: "",
  channelFilter: "",
  statusFilter: "",
  visualizations: [] as string[],
});

// Mock data - TODO: Replace with actual API calls
const agents = ref([
  { id: "1", name: "Customer Support Agent" },
  { id: "2", name: "Sales Assistant" },
  { id: "3", name: "Technical Support" },
]);

const metricCategories = [
  {
    name: "Conversation Metrics",
    icon: MessageSquare,
    metrics: [
      { id: "total_conversations", name: "Total Conversations" },
      { id: "resolution_rate", name: "Resolution Rate" },
      { id: "escalation_rate", name: "Escalation Rate" },
      { id: "avg_conversation_length", name: "Average Conversation Length" },
    ],
  },
  {
    name: "Performance Metrics",
    icon: Activity,
    metrics: [
      { id: "response_time", name: "Average Response Time" },
      { id: "first_response_time", name: "First Response Time" },
      { id: "customer_satisfaction", name: "Customer Satisfaction" },
      { id: "agent_utilization", name: "Agent Utilization" },
    ],
  },
  {
    name: "User Metrics",
    icon: Users,
    metrics: [
      { id: "active_users", name: "Active Users" },
      { id: "new_users", name: "New Users" },
      { id: "returning_users", name: "Returning Users" },
      { id: "user_satisfaction", name: "User Satisfaction Scores" },
    ],
  },
  {
    name: "Time Metrics",
    icon: Clock,
    metrics: [
      { id: "peak_hours", name: "Peak Usage Hours" },
      { id: "conversation_duration", name: "Conversation Duration" },
      { id: "time_to_resolution", name: "Time to Resolution" },
      { id: "wait_time", name: "Customer Wait Time" },
    ],
  },
];

const groupingOptions = [
  { id: "agent", name: "Agent" },
  { id: "channel", name: "Channel" },
  { id: "time", name: "Time Period" },
  { id: "status", name: "Status" },
  { id: "topic", name: "Topic" },
  { id: "satisfaction", name: "Satisfaction" },
];

const visualizationTypes = [
  {
    id: "bar_chart",
    name: "Bar Chart",
    description: "Compare values across categories",
    icon: BarChart3,
  },
  {
    id: "line_chart",
    name: "Line Chart",
    description: "Show trends over time",
    icon: LineChart,
  },
  {
    id: "pie_chart",
    name: "Pie Chart",
    description: "Show proportions of a whole",
    icon: PieChart,
  },
  {
    id: "table",
    name: "Data Table",
    description: "Detailed tabular data",
    icon: FileText,
  },
  {
    id: "metrics",
    name: "Key Metrics",
    description: "Important numbers and KPIs",
    icon: TrendingUp,
  },
  {
    id: "heatmap",
    name: "Heat Map",
    description: "Activity patterns",
    icon: Activity,
  },
];

const quickTemplates = [
  {
    id: "weekly_summary",
    name: "Weekly Summary",
    icon: Calendar,
    config: {
      name: "Weekly Performance Summary",
      type: "summary",
      metrics: ["total_conversations", "resolution_rate", "response_time", "customer_satisfaction"],
      groupBy: ["agent", "channel"],
      dateRange: "7d",
      visualizations: ["metrics", "bar_chart"],
    },
  },
  {
    id: "agent_performance",
    name: "Agent Performance",
    icon: Users,
    config: {
      name: "Agent Performance Report",
      type: "performance",
      metrics: ["total_conversations", "resolution_rate", "response_time", "agent_utilization"],
      groupBy: ["agent"],
      dateRange: "30d",
      visualizations: ["table", "bar_chart"],
    },
  },
  {
    id: "trend_analysis",
    name: "Trend Analysis",
    icon: TrendingUp,
    config: {
      name: "Monthly Trends Analysis",
      type: "trends",
      metrics: ["total_conversations", "resolution_rate", "customer_satisfaction"],
      groupBy: ["time"],
      dateRange: "90d",
      visualizations: ["line_chart", "metrics"],
    },
  },
];

const recentReports = ref([
  {
    id: "1",
    name: "Weekly Performance Summary",
    format: "PDF",
    createdAt: new Date("2024-01-15T10:30:00"),
  },
  {
    id: "2",
    name: "Agent Performance Report",
    format: "Excel",
    createdAt: new Date("2024-01-14T14:20:00"),
  },
  {
    id: "3",
    name: "Customer Satisfaction Analysis",
    format: "CSV",
    createdAt: new Date("2024-01-13T09:15:00"),
  },
]);

// Computed properties
const canGenerate = computed(() => {
  return reportConfig.value.name && reportConfig.value.metrics.length > 0;
});

const canSave = computed(() => {
  return reportConfig.value.name && reportConfig.value.metrics.length > 0;
});

const canSchedule = computed(() => {
  return reportConfig.value.name && reportConfig.value.metrics.length > 0;
});

// Methods
const toggleMetric = (metricId: string) => {
  const index = reportConfig.value.metrics.indexOf(metricId);
  if (index > -1) {
    reportConfig.value.metrics.splice(index, 1);
  } else {
    reportConfig.value.metrics.push(metricId);
  }
};

const toggleGroupBy = (groupId: string) => {
  const index = reportConfig.value.groupBy.indexOf(groupId);
  if (index > -1) {
    reportConfig.value.groupBy.splice(index, 1);
  } else {
    reportConfig.value.groupBy.push(groupId);
  }
};

const toggleVisualization = (vizId: string) => {
  const index = reportConfig.value.visualizations.indexOf(vizId);
  if (index > -1) {
    reportConfig.value.visualizations.splice(index, 1);
  } else {
    reportConfig.value.visualizations.push(vizId);
  }
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const loadTemplate = (template: any) => {
  Object.assign(reportConfig.value, template.config);
};

const createNewReport = () => {
  // Reset form
  reportConfig.value = {
    name: "",
    description: "",
    type: "summary",
    format: "pdf",
    metrics: [],
    groupBy: [],
    dateRange: "30d",
    agentFilter: "",
    channelFilter: "",
    statusFilter: "",
    visualizations: [],
  };
};

const generateReport = () => {
  // TODO: Generate report
  console.log("Generate report with config:", reportConfig.value);
};

const saveReportTemplate = () => {
  // TODO: Save as template
  console.log("Save report template:", reportConfig.value);
};

const scheduleReport = () => {
  // TODO: Open scheduling modal
  console.log("Schedule report:", reportConfig.value);
};

const viewScheduledReports = () => {
  // TODO: Navigate to scheduled reports page
  console.log("View scheduled reports");
};

const viewReport = (reportId: string) => {
  // TODO: View generated report
  console.log("View report:", reportId);
};

const downloadReport = (reportId: string) => {
  // TODO: Download report
  console.log("Download report:", reportId);
};

const formatDate = (date: Date) => {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
};

// Set page meta
definePageMeta({
  layout: "default",
  // middleware: 'auth',
});

// Head management
useHead({
  title: "Custom Reports - Hay Dashboard",
  meta: [
    {
      name: "description",
      content: "Build and schedule custom analytics reports",
    },
  ],
});
</script>
