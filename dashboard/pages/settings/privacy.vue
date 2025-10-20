<template>
  <Page
    title="Privacy & Data"
    description="
          Manage your personal data and exercise your privacy rights under GDPR"
  >
    <!-- Privacy Overview -->
    <Card>
      <CardHeader>
        <CardTitle>Your Privacy Rights</CardTitle>
        <CardDescription>
          Under GDPR, you have the right to access, export, and delete your personal data
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div class="grid gap-4 md:grid-cols-3">
          <div class="flex items-center space-x-3 p-3 border rounded-lg">
            <div class="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
              <Download class="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <div class="font-medium">Data Export</div>
              <div class="text-sm text-neutral-muted">Download your data</div>
            </div>
          </div>

          <div class="flex items-center space-x-3 p-3 border rounded-lg">
            <div class="w-10 h-10 bg-orange-100 rounded-full flex items-center justify-center">
              <Trash2 class="h-5 w-5 text-orange-600" />
            </div>
            <div>
              <div class="font-medium">Data Deletion</div>
              <div class="text-sm text-neutral-muted">Delete your account</div>
            </div>
          </div>

          <div class="flex items-center space-x-3 p-3 border rounded-lg">
            <div class="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
              <Shield class="h-5 w-5 text-green-600" />
            </div>
            <div>
              <div class="font-medium">Privacy Protected</div>
              <div class="text-sm text-neutral-muted">GDPR compliant</div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>

    <!-- Active Privacy Requests -->
    <Card v-if="activeRequests.length > 0">
      <CardHeader>
        <CardTitle>Active Privacy Requests</CardTitle>
        <CardDescription>Track the status of your privacy requests</CardDescription>
      </CardHeader>
      <CardContent>
        <div class="space-y-3">
          <div
            v-for="request in activeRequests"
            :key="request.id"
            class="flex items-center justify-between p-4 border rounded-lg"
          >
            <div class="flex items-center space-x-4">
              <div
                :class="{
                  'bg-blue-100': request.type === 'export',
                  'bg-red-100': request.type === 'deletion',
                }"
                class="w-10 h-10 rounded-full flex items-center justify-center"
              >
                <Download v-if="request.type === 'export'" class="h-5 w-5 text-blue-600" />
                <Trash2 v-else class="h-5 w-5 text-red-600" />
              </div>
              <div>
                <div class="font-medium capitalize">{{ request.type }} Request</div>
                <div class="text-sm text-neutral-muted">
                  {{ formatStatus(request.status) }} •
                  {{ formatDate(request.createdAt) }}
                </div>
              </div>
            </div>
            <div class="flex items-center space-x-2">
              <Badge :variant="getStatusVariant(request.status)">
                {{ request.status }}
              </Badge>
              <Button
                v-if="request.status === 'completed' && request.type === 'export'"
                variant="outline"
                size="sm"
                @click="downloadExport(request.id)"
              >
                <Download class="h-4 w-4 mr-2" />
                Download
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>

    <!-- Data Export Section -->
    <Card>
      <CardHeader>
        <CardTitle>Export Your Data</CardTitle>
        <CardDescription>
          Download a copy of all your personal data in JSON format
        </CardDescription>
      </CardHeader>
      <CardContent class="space-y-4">
        <div class="space-y-2">
          <h4 class="font-medium">What's included in your export:</h4>
          <ul class="list-disc list-inside text-sm text-neutral-muted space-y-1">
            <li>Profile information (email, name, account settings)</li>
            <li>Organization memberships and roles</li>
            <li>API keys metadata (no secrets included)</li>
            <li>Audit logs (last 1000 events)</li>
            <li>Documents and content you've created</li>
          </ul>
        </div>

        <Alert>
          <AlertTitle>Processing Time</AlertTitle>
          <AlertDescription>
            Your data export typically takes less than 5 minutes to generate. You'll receive an
            email with a download link when it's ready.
          </AlertDescription>
        </Alert>

        <Button :loading="exportLoading" class="w-full sm:w-auto" @click="requestExport">
          <Download class="h-4 w-4 mr-2" />
          Request Data Export
        </Button>
      </CardContent>
    </Card>

    <!-- Data Deletion Section -->
    <Card>
      <CardHeader>
        <CardTitle>Delete Your Account</CardTitle>
        <CardDescription> Permanently delete your account and all associated data </CardDescription>
      </CardHeader>
      <CardContent class="space-y-4">
        <Alert variant="destructive">
          <AlertTitle>Warning: This action is irreversible</AlertTitle>
          <AlertDescription>
            Deleting your account will permanently remove all your data. This cannot be undone.
          </AlertDescription>
        </Alert>

        <div class="space-y-2">
          <h4 class="font-medium">What will be deleted:</h4>
          <ul class="list-disc list-inside text-sm text-neutral-muted space-y-1">
            <li>Your account will be permanently deactivated</li>
            <li>All API keys will be revoked</li>
            <li>Personal information will be removed or anonymized</li>
            <li>Some audit logs may be retained (anonymized) for compliance</li>
          </ul>
        </div>

        <Button
          variant="destructive"
          :loading="deleteLoading"
          class="w-full sm:w-auto"
          @click="showDeleteConfirmation = true"
        >
          <Trash2 class="h-4 w-4 mr-2" />
          Delete My Account
        </Button>
      </CardContent>
    </Card>

    <!-- Privacy Policy Link -->
    <Card>
      <CardHeader>
        <CardTitle>Privacy Information</CardTitle>
        <CardDescription>Learn more about how we handle your data</CardDescription>
      </CardHeader>
      <CardContent class="space-y-3">
        <div class="flex items-center justify-between p-3 border rounded-lg">
          <div class="flex items-center space-x-3">
            <FileText class="h-5 w-5 text-neutral-muted" />
            <div>
              <div class="font-medium">Privacy Policy</div>
              <div class="text-sm text-neutral-muted">
                How we collect, use, and protect your data
              </div>
            </div>
          </div>
          <Button variant="ghost" size="sm" as="a" href="/privacy-policy" target="_blank">
            <ExternalLink class="h-4 w-4" />
          </Button>
        </div>

        <div class="flex items-center justify-between p-3 border rounded-lg">
          <div class="flex items-center space-x-3">
            <Shield class="h-5 w-5 text-neutral-muted" />
            <div>
              <div class="font-medium">Data Retention Policy</div>
              <div class="text-sm text-neutral-muted">How long we keep your data</div>
            </div>
          </div>
          <Button variant="ghost" size="sm" as="a" href="/retention-policy" target="_blank">
            <ExternalLink class="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>

    <!-- Delete Confirmation Dialog -->
    <Dialog v-model:open="showDeleteConfirmation">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Are you absolutely sure?</DialogTitle>
          <DialogDescription>
            This action cannot be undone. This will permanently delete your account and remove all
            your data from our servers.
          </DialogDescription>
        </DialogHeader>

        <div class="space-y-4">
          <Alert variant="destructive" :icon="AlertTriangle">
            <AlertTitle>Final Warning</AlertTitle>
            <AlertDescription>
              You will receive a verification email to confirm this deletion. Click the link in the
              email to complete the process.
            </AlertDescription>
          </Alert>

          <div class="space-y-2">
            <Label>Type "DELETE" to confirm</Label>
            <Input v-model="deleteConfirmation" placeholder="DELETE" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" @click="showDeleteConfirmation = false"> Cancel </Button>
          <Button
            variant="destructive"
            :disabled="deleteConfirmation !== 'DELETE'"
            :loading="deleteLoading"
            @click="confirmDelete"
          >
            Yes, Delete My Account
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- Success Dialog -->
    <Dialog v-model:open="showSuccessDialog">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{{ successTitle }}</DialogTitle>
          <DialogDescription>{{ successMessage }}</DialogDescription>
        </DialogHeader>

        <Alert :icon="Mail">
          <AlertTitle>Check Your Email</AlertTitle>
          <AlertDescription>
            We've sent a verification email to {{ user?.email }}. Click the link in the email to
            complete your request.
          </AlertDescription>
        </Alert>

        <DialogFooter>
          <Button @click="showSuccessDialog = false">OK</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </Page>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { Hay } from "@/utils/api";
import { useUserStore } from "@/stores/user";
import {
  Download,
  Trash2,
  Shield,
  AlertTriangle,
  FileText,
  ExternalLink,
  Mail,
} from "lucide-vue-next";

import { useToast } from "@/composables/useToast";

const userStore = useUserStore();
const { toast } = useToast();

const user = computed(() => userStore.user);
const exportLoading = ref(false);
const deleteLoading = ref(false);
const showDeleteConfirmation = ref(false);
const showSuccessDialog = ref(false);
const deleteConfirmation = ref("");
const successTitle = ref("");
const successMessage = ref("");
const activeRequests = ref<any[]>([]);

// Request data export
const requestExport = async () => {
  if (!user.value?.email) {
    toast.error("Error", "User email not found");
    return;
  }

  try {
    exportLoading.value = true;
    const result = await Hay.privacy.requestExport.mutate({
      email: user.value.email,
    });

    successTitle.value = "Data Export Requested";
    successMessage.value = result.message;
    showSuccessDialog.value = true;

    // Refresh active requests
    await loadActiveRequests();
  } catch (error: any) {
    console.error("Export request error:", error);
    // Extract message from tRPC error structure
    const errorMessage = error.message || error.error?.message || "Failed to request data export";
    toast.error("Error", errorMessage);
  } finally {
    exportLoading.value = false;
  }
};

// Show delete confirmation dialog
const confirmDelete = async () => {
  if (!user.value?.email || deleteConfirmation.value !== "DELETE") {
    return;
  }

  try {
    deleteLoading.value = true;
    const result = await Hay.privacy.requestDeletion.mutate({
      email: user.value.email,
    });

    showDeleteConfirmation.value = false;
    deleteConfirmation.value = "";

    successTitle.value = "Account Deletion Requested";
    successMessage.value = result.message;
    showSuccessDialog.value = true;

    // Refresh active requests
    await loadActiveRequests();
  } catch (error: any) {
    console.error("Deletion request error:", error);
    // Extract message from tRPC error structure
    const errorMessage =
      error.message || error.error?.message || "Failed to request account deletion";
    toast.error("Error", errorMessage);
  } finally {
    deleteLoading.value = false;
  }
};

// Download completed export
const downloadExport = async (requestId: string) => {
  try {
    // In a real implementation, you would get the download token from the email
    // For now, we'll show a message
    toast.info("Download Ready", "Please check your email for the download link");
  } catch (error: any) {
    toast.error("Error", error.message || "Failed to download export");
  }
};

// Load active privacy requests (mock for now)
const loadActiveRequests = async () => {
  // In a real implementation, you would fetch from the backend
  // For now, we'll use an empty array
  activeRequests.value = [];
};

// Format status text
const formatStatus = (status: string) => {
  return status.replace(/_/g, " ");
};

// Get status badge variant
const getStatusVariant = (status: string) => {
  switch (status) {
    case "completed":
      return "success";
    case "processing":
      return "default";
    case "failed":
      return "destructive";
    default:
      return "secondary";
  }
};

// Format date
const formatDate = (date: string | Date) => {
  return new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
};

onMounted(() => {
  loadActiveRequests();
});
</script>
