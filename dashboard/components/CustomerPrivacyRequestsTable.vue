<template>
  <div class="space-y-4">
    <!-- Loading State -->
    <div v-if="loading" class="flex items-center justify-center py-8">
      <Loader2 class="h-6 w-6 animate-spin text-neutral-muted" />
      <span class="ml-2 text-neutral-muted">Loading requests...</span>
    </div>

    <!-- Empty State -->
    <div
      v-else-if="requests.length === 0"
      class="text-center py-12 border border-dashed rounded-lg"
    >
      <Shield class="h-12 w-12 mx-auto text-neutral-muted mb-3" />
      <h3 class="text-lg font-medium mb-1">No Privacy Requests</h3>
      <p class="text-sm text-neutral-muted">
        Customer privacy requests will appear here once initiated
      </p>
    </div>

    <!-- Requests Table -->
    <div v-else class="border rounded-lg overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Type</TableHead>
            <TableHead>Customer</TableHead>
            <TableHead>Identifier</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Created</TableHead>
            <TableHead>Completed</TableHead>
            <TableHead class="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="request in requests" :key="request.id">
            <!-- Type -->
            <TableCell>
              <div class="flex items-center space-x-2">
                <div
                  :class="{
                    'bg-blue-100': request.type === 'export',
                    'bg-red-100': request.type === 'deletion',
                    'bg-yellow-100': request.type === 'rectification',
                  }"
                  class="w-8 h-8 rounded-full flex items-center justify-center"
                >
                  <Download
                    v-if="request.type === 'export'"
                    class="h-4 w-4 text-blue-600"
                  />
                  <Trash2 v-else-if="request.type === 'deletion'" class="h-4 w-4 text-red-600" />
                  <Edit v-else class="h-4 w-4 text-yellow-600" />
                </div>
                <span class="font-medium capitalize">{{ request.type }}</span>
              </div>
            </TableCell>

            <!-- Customer -->
            <TableCell>
              <div>
                <div class="font-medium">{{ request.customerName || 'Unknown' }}</div>
                <div class="text-sm text-neutral-muted">{{ request.email }}</div>
              </div>
            </TableCell>

            <!-- Identifier -->
            <TableCell>
              <div class="text-sm">
                <div class="font-medium capitalize">{{ request.identifierType || 'N/A' }}</div>
                <div class="text-neutral-muted">{{ request.identifierValue || 'N/A' }}</div>
              </div>
            </TableCell>

            <!-- Status -->
            <TableCell>
              <Badge :variant="getStatusVariant(request.status)">
                {{ formatStatus(request.status) }}
              </Badge>
              <div v-if="request.jobStatus" class="text-xs text-neutral-muted mt-1">
                Job: {{ request.jobStatus }}
              </div>
            </TableCell>

            <!-- Created -->
            <TableCell>
              <div class="text-sm">{{ formatDate(request.createdAt) }}</div>
            </TableCell>

            <!-- Completed -->
            <TableCell>
              <div class="text-sm">
                {{ request.completedAt ? formatDate(request.completedAt) : '-' }}
              </div>
            </TableCell>

            <!-- Actions -->
            <TableCell class="text-right">
              <Button
                v-if="request.status === 'completed' && request.type === 'export'"
                variant="ghost"
                size="sm"
                @click="viewDetails(request.id)"
              >
                <Eye class="h-4 w-4 mr-1" />
                View
              </Button>
              <Button
                v-else-if="request.status === 'pending_verification'"
                variant="ghost"
                size="sm"
                disabled
              >
                <Clock class="h-4 w-4 mr-1" />
                Pending
              </Button>
              <Button v-else variant="ghost" size="sm" @click="viewDetails(request.id)">
                <Eye class="h-4 w-4 mr-1" />
                Details
              </Button>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Loader2, Shield, Download, Trash2, Edit, Eye, Clock } from 'lucide-vue-next';

// Props
interface Props {
  requests: any[];
  loading?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  loading: false,
});

// Emits
const emit = defineEmits<{
  refresh: [];
}>();

// Methods
const getStatusVariant = (status: string): 'default' | 'secondary' | 'destructive' | 'outline' => {
  switch (status) {
    case 'completed':
      return 'default';
    case 'processing':
      return 'secondary';
    case 'failed':
    case 'expired':
      return 'destructive';
    case 'pending_verification':
    case 'verified':
      return 'outline';
    default:
      return 'secondary';
  }
};

const formatStatus = (status: string): string => {
  return status
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};

const formatDate = (dateString: string): string => {
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return dateString;
  }
};

const viewDetails = (requestId: string) => {
  // TODO: Implement details modal or navigation
  console.log('View details for request:', requestId);
};
</script>
