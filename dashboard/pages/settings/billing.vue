<template>
  <div class="space-y-6">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-3xl font-bold tracking-tight">Billing</h1>
        <p class="text-muted-foreground">Manage your subscription, usage, and payment methods</p>
      </div>
      <div class="flex items-center space-x-2">
        <Button variant="outline" @click="downloadInvoice">
          <Download class="h-4 w-4 mr-2" />
          Download Invoice
        </Button>
        <Button @click="viewPlans">
          <CreditCard class="h-4 w-4 mr-2" />
          View Plans
        </Button>
      </div>
    </div>

    <!-- Current Plan -->
    <Card>
      <CardHeader>
        <CardTitle>Current Plan</CardTitle>
        <CardDescription>Your active subscription and billing details</CardDescription>
      </CardHeader>
      <CardContent>
        <div class="grid gap-6 lg:grid-cols-2">
          <!-- Plan Details -->
          <div class="space-y-4">
            <div class="flex items-center justify-between p-4 border rounded-lg">
              <div>
                <h3 class="font-semibold text-lg">{{ currentPlan.name }}</h3>
                <p class="text-muted-foreground">{{ currentPlan.description }}</p>
                <div class="flex items-center space-x-4 mt-2 text-sm text-muted-foreground">
                  <span>{{ formatNumber(currentPlan.conversations) }} conversations/month</span>
                  <span>{{ formatNumber(currentPlan.agents) }} agents</span>
                  <span>{{ currentPlan.support }} support</span>
                </div>
              </div>
              <div class="text-right">
                <div class="text-2xl font-bold">${{ currentPlan.price }}</div>
                <div class="text-sm text-muted-foreground">{{ currentPlan.period }}</div>
                <Badge v-if="currentPlan.discount" variant="success" class="mt-1">
                  {{ currentPlan.discount }}% off
                </Badge>
              </div>
            </div>

            <div class="grid gap-3 text-sm">
              <div class="flex justify-between">
                <span class="text-muted-foreground">Billing Cycle:</span>
                <span class="font-medium">{{ currentPlan.billingCycle }}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-muted-foreground">Next Billing Date:</span>
                <span class="font-medium">{{ formatDate(currentPlan.nextBillingDate) }}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-muted-foreground">Auto-Renewal:</span>
                <div class="flex items-center space-x-2">
                  <span class="font-medium">{{
                    currentPlan.autoRenewal ? 'Enabled' : 'Disabled'
                  }}</span>
                  <Checkbox v-model="currentPlan.autoRenewal" />
                </div>
              </div>
            </div>

            <div class="flex space-x-2">
              <Button variant="outline" @click="changePlan">
                <ArrowUpCircle class="h-4 w-4 mr-2" />
                Change Plan
              </Button>
              <Button variant="outline" @click="cancelSubscription">
                <XCircle class="h-4 w-4 mr-2" />
                Cancel Subscription
              </Button>
            </div>
          </div>

          <!-- Usage Overview -->
          <div class="space-y-4">
            <h3 class="font-medium">Current Usage</h3>

            <div class="space-y-3">
              <div class="space-y-2">
                <div class="flex justify-between text-sm">
                  <span>Conversations This Month</span>
                  <span class="font-medium"
                    >{{ formatNumber(usage.conversations) }} /
                    {{ formatNumber(currentPlan.conversations) }}</span
                  >
                </div>
                <div class="w-full bg-muted rounded-full h-2">
                  <div
                    class="bg-primary h-2 rounded-full transition-all duration-300"
                    :style="{
                      width: `${Math.min((usage.conversations / currentPlan.conversations) * 100, 100)}%`,
                    }"
                  ></div>
                </div>
                <div class="text-xs text-muted-foreground">
                  {{ Math.round((usage.conversations / currentPlan.conversations) * 100) }}% used
                </div>
              </div>

              <div class="space-y-2">
                <div class="flex justify-between text-sm">
                  <span>Active Agents</span>
                  <span class="font-medium"
                    >{{ usage.agents }} /
                    {{ currentPlan.agents === -1 ? 'Unlimited' : currentPlan.agents }}</span
                  >
                </div>
                <div v-if="currentPlan.agents !== -1" class="w-full bg-muted rounded-full h-2">
                  <div
                    class="bg-primary h-2 rounded-full transition-all duration-300"
                    :style="{
                      width: `${Math.min((usage.agents / currentPlan.agents) * 100, 100)}%`,
                    }"
                  ></div>
                </div>
              </div>

              <div class="space-y-2">
                <div class="flex justify-between text-sm">
                  <span>Storage Used</span>
                  <span class="font-medium"
                    >{{ formatBytes(usage.storage) }} / {{ formatBytes(currentPlan.storage) }}</span
                  >
                </div>
                <div class="w-full bg-muted rounded-full h-2">
                  <div
                    class="bg-primary h-2 rounded-full transition-all duration-300"
                    :style="{
                      width: `${Math.min((usage.storage / currentPlan.storage) * 100, 100)}%`,
                    }"
                  ></div>
                </div>
              </div>

              <div class="space-y-2">
                <div class="flex justify-between text-sm">
                  <span>API Calls This Month</span>
                  <span class="font-medium"
                    >{{ formatNumber(usage.apiCalls) }} /
                    {{ formatNumber(currentPlan.apiCalls) }}</span
                  >
                </div>
                <div class="w-full bg-muted rounded-full h-2">
                  <div
                    class="bg-primary h-2 rounded-full transition-all duration-300"
                    :style="{
                      width: `${Math.min((usage.apiCalls / currentPlan.apiCalls) * 100, 100)}%`,
                    }"
                  ></div>
                </div>
              </div>
            </div>

            <!-- Usage Alerts -->
            <div v-if="usageAlerts.length > 0" class="space-y-2">
              <div
                v-for="alert in usageAlerts"
                :key="alert.type"
                class="flex items-start space-x-2 p-3 bg-yellow-50 border border-yellow-200 rounded-lg"
              >
                <AlertTriangle class="h-4 w-4 text-yellow-600 mt-0.5" />
                <div class="text-sm">
                  <div class="font-medium text-yellow-800">{{ alert.title }}</div>
                  <div class="text-yellow-700">{{ alert.description }}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>

    <!-- Payment Method -->
    <Card>
      <CardHeader>
        <CardTitle>Payment Method</CardTitle>
        <CardDescription>Manage your payment information</CardDescription>
      </CardHeader>
      <CardContent>
        <div v-if="paymentMethod" class="flex items-center justify-between p-4 border rounded-lg">
          <div class="flex items-center space-x-4">
            <div class="w-12 h-8 bg-gray-200 rounded flex items-center justify-center">
              <CreditCard class="h-4 w-4 text-gray-600" />
            </div>
            <div>
              <div class="font-medium">**** **** **** {{ paymentMethod.last4 }}</div>
              <div class="text-sm text-muted-foreground">
                {{ paymentMethod.brand }} • Expires {{ paymentMethod.expMonth }}/{{
                  paymentMethod.expYear
                }}
              </div>
            </div>
          </div>
          <div class="flex items-center space-x-2">
            <Badge :variant="paymentMethod.status === 'valid' ? 'success' : 'destructive'">
              {{ paymentMethod.status }}
            </Badge>
            <Button variant="outline" size="sm" @click="updatePaymentMethod"> Update </Button>
            <Button variant="ghost" size="sm" @click="removePaymentMethod">
              <Trash2 class="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div v-else class="text-center py-8 border-2 border-dashed border-muted rounded-lg">
          <CreditCard class="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p class="text-sm text-muted-foreground mb-4">No payment method on file</p>
          <Button @click="addPaymentMethod">
            <Plus class="h-4 w-4 mr-2" />
            Add Payment Method
          </Button>
        </div>
      </CardContent>
    </Card>

    <!-- Billing History -->
    <Card>
      <CardHeader>
        <div class="flex items-center justify-between">
          <div>
            <CardTitle>Billing History</CardTitle>
            <CardDescription>Your past invoices and payments</CardDescription>
          </div>
          <Button variant="outline" size="sm" @click="viewAllInvoices"> View All </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div class="overflow-x-auto">
          <table class="w-full">
            <thead>
              <tr class="border-b">
                <th class="text-left py-3 px-4 font-medium">Invoice</th>
                <th class="text-left py-3 px-4 font-medium">Date</th>
                <th class="text-left py-3 px-4 font-medium">Amount</th>
                <th class="text-left py-3 px-4 font-medium">Status</th>
                <th class="text-left py-3 px-4 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="invoice in invoices" :key="invoice.id" class="border-b hover:bg-muted/50">
                <td class="py-3 px-4">
                  <div class="font-medium">{{ invoice.number }}</div>
                  <div class="text-sm text-muted-foreground">{{ invoice.description }}</div>
                </td>
                <td class="py-3 px-4 text-sm">{{ formatDate(invoice.date) }}</td>
                <td class="py-3 px-4">
                  <div class="font-medium">${{ invoice.amount.toFixed(2) }}</div>
                  <div class="text-sm text-muted-foreground">
                    {{ invoice.currency.toUpperCase() }}
                  </div>
                </td>
                <td class="py-3 px-4">
                  <Badge :variant="getInvoiceStatusVariant(invoice.status)">
                    {{ invoice.status }}
                  </Badge>
                </td>
                <td class="py-3 px-4">
                  <div class="flex items-center space-x-2">
                    <Button variant="ghost" size="sm" @click="downloadInvoice(invoice.id)">
                      <Download class="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="sm" @click="viewInvoice(invoice.id)">
                      <Eye class="h-4 w-4" />
                    </Button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>

    <!-- Usage Analytics -->
    <Card>
      <CardHeader>
        <CardTitle>Usage Analytics</CardTitle>
        <CardDescription>Track your usage patterns over time</CardDescription>
      </CardHeader>
      <CardContent>
        <div
          class="h-80 flex items-center justify-center border-2 border-dashed border-muted rounded-lg"
        >
          <div class="text-center">
            <BarChart3 class="h-12 w-12 text-muted-foreground mx-auto mb-2" />
            <p class="text-sm text-muted-foreground">Usage chart will be rendered here</p>
            <p class="text-xs text-muted-foreground">
              TODO: Integrate Chart.js/vue-chartjs for usage analytics
            </p>
          </div>
        </div>
      </CardContent>
    </Card>

    <!-- Upcoming Changes -->
    <Card v-if="upcomingChanges.length > 0">
      <CardHeader>
        <CardTitle>Upcoming Changes</CardTitle>
        <CardDescription>Scheduled plan changes and updates</CardDescription>
      </CardHeader>
      <CardContent>
        <div class="space-y-3">
          <div
            v-for="change in upcomingChanges"
            :key="change.id"
            class="flex items-center justify-between p-4 border rounded-lg"
          >
            <div>
              <div class="font-medium">{{ change.title }}</div>
              <div class="text-sm text-muted-foreground">{{ change.description }}</div>
              <div class="text-xs text-muted-foreground">
                Effective {{ formatDate(change.effectiveDate) }}
              </div>
            </div>
            <div class="flex items-center space-x-2">
              <Badge variant="outline">{{ change.type }}</Badge>
              <Button variant="ghost" size="sm" @click="cancelChange(change.id)"> Cancel </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  </div>
</template>

<script setup lang="ts">
import {
  Download,
  CreditCard,
  ArrowUpCircle,
  XCircle,
  Plus,
  Trash2,
  Eye,
  AlertTriangle,
  BarChart3,
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

// Mock data - TODO: Replace with actual API calls
const currentPlan = ref({
  name: 'Professional',
  description: 'Perfect for growing businesses',
  price: 99,
  period: 'per month',
  billingCycle: 'Monthly',
  conversations: 10000,
  agents: 5,
  storage: 100 * 1024 * 1024 * 1024, // 100GB in bytes
  apiCalls: 100000,
  support: '24/7',
  discount: null,
  autoRenewal: true,
  nextBillingDate: new Date('2024-02-15'),
});

const usage = ref({
  conversations: 7234,
  agents: 3,
  storage: 45 * 1024 * 1024 * 1024, // 45GB in bytes
  apiCalls: 67891,
});

const usageAlerts = computed(() => {
  const alerts = [];

  if (usage.value.conversations / currentPlan.value.conversations > 0.8) {
    alerts.push({
      type: 'conversations',
      title: 'High Conversation Usage',
      description: "You've used 80% of your monthly conversation limit.",
    });
  }

  if (usage.value.apiCalls / currentPlan.value.apiCalls > 0.9) {
    alerts.push({
      type: 'api',
      title: 'API Limit Warning',
      description: "You've used 90% of your monthly API calls.",
    });
  }

  return alerts;
});

const paymentMethod = ref<{
  id: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  status: string;
} | null>({
  id: '1',
  brand: 'Visa',
  last4: '4242',
  expMonth: 12,
  expYear: 2025,
  status: 'valid',
});

const invoices = ref([
  {
    id: 'inv_001',
    number: 'INV-2024-001',
    description: 'Professional Plan - January 2024',
    date: new Date('2024-01-01'),
    amount: 99.0,
    currency: 'usd',
    status: 'paid',
  },
  {
    id: 'inv_002',
    number: 'INV-2023-012',
    description: 'Professional Plan - December 2023',
    date: new Date('2023-12-01'),
    amount: 99.0,
    currency: 'usd',
    status: 'paid',
  },
  {
    id: 'inv_003',
    number: 'INV-2023-011',
    description: 'Professional Plan - November 2023',
    date: new Date('2023-11-01'),
    amount: 89.0,
    currency: 'usd',
    status: 'paid',
  },
  {
    id: 'inv_004',
    number: 'INV-2023-010',
    description: 'Starter Plan - October 2023',
    date: new Date('2023-10-01'),
    amount: 29.0,
    currency: 'usd',
    status: 'paid',
  },
]);

const upcomingChanges = ref<Array<{
  id: string;
  title: string;
  description: string;
  effectiveDate: Date;
  type: string;
}>>([]);

// Methods
const formatNumber = (num: number) => {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + 'M';
  } else if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'K';
  }
  return num.toString();
};

const formatBytes = (bytes: number) => {
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  if (bytes === 0) return '0 Bytes';
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return Math.round((bytes / Math.pow(1024, i)) * 100) / 100 + ' ' + sizes[i];
};

const formatDate = (date: Date) => {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date);
};

const getInvoiceStatusVariant = (status: string) => {
  const variants = {
    paid: 'success',
    pending: 'outline',
    failed: 'destructive',
    draft: 'secondary',
  };
  return variants[status as keyof typeof variants] || 'default';
};

const changePlan = () => {
  // TODO: Navigate to plan selection
  console.log('Change plan');
};

const cancelSubscription = () => {
  // TODO: Open cancellation flow
  if (confirm('Are you sure you want to cancel your subscription?')) {
    console.log('Cancel subscription');
  }
};

const addPaymentMethod = () => {
  // TODO: Open payment method form
  console.log('Add payment method');
};

const updatePaymentMethod = () => {
  // TODO: Open payment method update form
  console.log('Update payment method');
};

const removePaymentMethod = () => {
  // TODO: Remove payment method
  if (confirm('Are you sure you want to remove this payment method?')) {
    paymentMethod.value = null;
  }
};

const downloadInvoice = (invoiceId?: string) => {
  // TODO: Download invoice PDF
  console.log('Download invoice:', invoiceId || 'latest');
};

const viewInvoice = (invoiceId: string) => {
  // TODO: View invoice details
  console.log('View invoice:', invoiceId);
};

const viewAllInvoices = () => {
  // TODO: Navigate to invoices page
  console.log('View all invoices');
};

const viewPlans = () => {
  // TODO: Navigate to plans page
  console.log('View plans');
};

const cancelChange = (changeId: string) => {
  // TODO: Cancel upcoming change
  console.log('Cancel change:', changeId);
  const index = upcomingChanges.value.findIndex((c) => c.id === changeId);
  if (index > -1) {
    upcomingChanges.value.splice(index, 1);
  }
};

// Lifecycle
onMounted(async () => {
  // TODO: Load billing data from API
  // await fetchBillingData()
  // await fetchUsageData()
  // await fetchInvoices()
});

// Set page meta
definePageMeta({
  layout: 'default',
  middleware: 'auth',
});

// Head management
useHead({
  title: 'Billing - Hay Dashboard',
  meta: [{ name: 'description', content: 'Manage your subscription, usage, and payment methods' }],
});
</script>
