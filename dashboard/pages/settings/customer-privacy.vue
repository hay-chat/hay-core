<template>
  <Page
    title="Customer Privacy"
    description="Manage GDPR data requests for your customers"
  >
    <!-- Info Alert -->
    <Alert class="mb-6">
      <InfoIcon class="h-4 w-4" />
      <AlertTitle>Customer Privacy Management</AlertTitle>
      <AlertDescription>
        Organizations can initiate GDPR data export or deletion requests on behalf of their
        customers. The customer will receive a verification email to confirm the request.
      </AlertDescription>
    </Alert>

    <!-- Initiate Request Form -->
    <Card>
      <CardHeader>
        <CardTitle>Initiate Privacy Request</CardTitle>
        <CardDescription>
          Start a GDPR data export or deletion request for one of your customers
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form @submit.prevent="initiateRequest" class="space-y-4">
          <!-- Identifier Type Selector -->
          <div class="space-y-2">
            <Label for="identifierType">Identify Customer By</Label>
            <Select v-model="identifierType" id="identifierType">
              <SelectTrigger>
                <SelectValue placeholder="Select identifier type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="email">Email Address</SelectItem>
                <SelectItem value="phone">Phone Number</SelectItem>
                <SelectItem value="externalId">External Customer ID</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <!-- Identifier Value Input -->
          <div class="space-y-2">
            <Label for="identifierValue">{{ identifierLabel }}</Label>
            <Input
              id="identifierValue"
              v-model="identifierValue"
              :placeholder="identifierPlaceholder"
              :type="identifierType === 'email' ? 'email' : 'text'"
              required
            />
          </div>

          <!-- Request Type Buttons -->
          <div class="flex gap-3">
            <Button
              type="submit"
              :disabled="isLoading || !identifierValue"
              @click="requestType = 'export'"
              class="flex-1"
            >
              <Download class="h-4 w-4 mr-2" />
              Request Data Export
            </Button>
            <Button
              type="submit"
              variant="destructive"
              :disabled="isLoading || !identifierValue"
              @click="requestType = 'deletion'"
              class="flex-1"
            >
              <Trash2 class="h-4 w-4 mr-2" />
              Request Data Deletion
            </Button>
          </div>

          <!-- Loading State -->
          <div v-if="isLoading" class="flex items-center justify-center py-4">
            <Loader2 class="h-6 w-6 animate-spin text-neutral-muted" />
            <span class="ml-2 text-sm text-neutral-muted">Processing request...</span>
          </div>

          <!-- Success/Error Messages -->
          <Alert v-if="successMessage" variant="default" class="border-green-200 bg-green-50">
            <CheckCircle class="h-4 w-4 text-green-600" />
            <AlertDescription class="text-green-800">
              {{ successMessage }}
            </AlertDescription>
          </Alert>

          <Alert v-if="errorMessage" variant="destructive">
            <AlertCircle class="h-4 w-4" />
            <AlertDescription>{{ errorMessage }}</AlertDescription>
          </Alert>
        </form>
      </CardContent>
    </Card>

    <!-- Request History -->
    <Card>
      <CardHeader>
        <CardTitle>Request History</CardTitle>
        <CardDescription>
          View and track all customer privacy requests initiated by your organization
        </CardDescription>
      </CardHeader>
      <CardContent>
        <CustomerPrivacyRequestsTable
          :requests="requests"
          :loading="tableLoading"
          @refresh="fetchRequests"
        />
      </CardContent>
    </Card>
  </Page>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { Hay } from '@/utils/api';
import { Download, Trash2, InfoIcon, AlertCircle, CheckCircle, Loader2 } from 'lucide-vue-next';
import CustomerPrivacyRequestsTable from '@/components/CustomerPrivacyRequestsTable.vue';

// Form state
const identifierType = ref<'email' | 'phone' | 'externalId'>('email');
const identifierValue = ref('');
const requestType = ref<'export' | 'deletion'>('export');
const isLoading = ref(false);
const successMessage = ref('');
const errorMessage = ref('');

// Table state
const requests = ref<any[]>([]);
const tableLoading = ref(false);

// Computed properties
const identifierLabel = computed(() => {
  switch (identifierType.value) {
    case 'email':
      return 'Customer Email Address';
    case 'phone':
      return 'Customer Phone Number';
    case 'externalId':
      return 'External Customer ID';
    default:
      return 'Customer Identifier';
  }
});

const identifierPlaceholder = computed(() => {
  switch (identifierType.value) {
    case 'email':
      return 'customer@example.com';
    case 'phone':
      return '+1234567890';
    case 'externalId':
      return 'cust_abc123';
    default:
      return 'Enter customer identifier';
  }
});

// Methods
const initiateRequest = async () => {
  if (!identifierValue.value) return;

  isLoading.value = true;
  successMessage.value = '';
  errorMessage.value = '';

  try {
    if (requestType.value === 'export') {
      const result = await Hay.customerPrivacy.requestExport.mutate({
        identifier: {
          type: identifierType.value,
          value: identifierValue.value,
        },
      });

      successMessage.value = result.message;
    } else {
      const result = await Hay.customerPrivacy.requestDeletion.mutate({
        identifier: {
          type: identifierType.value,
          value: identifierValue.value,
        },
      });

      successMessage.value = result.message;
    }

    // Clear form
    identifierValue.value = '';

    // Refresh request list
    await fetchRequests();
  } catch (error: any) {
    console.error('Privacy request error:', error);
    errorMessage.value = error.message || 'Failed to initiate privacy request. Please try again.';
  } finally {
    isLoading.value = false;
  }
};

const fetchRequests = async () => {
  tableLoading.value = true;
  try {
    const result = await Hay.customerPrivacy.listRequests.query({
      page: 1,
      limit: 50,
    });

    requests.value = result.requests;
  } catch (error) {
    console.error('Failed to fetch privacy requests:', error);
  } finally {
    tableLoading.value = false;
  }
};

// Lifecycle
onMounted(() => {
  fetchRequests();
});
</script>
