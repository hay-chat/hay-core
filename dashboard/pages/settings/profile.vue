<template>
  <Page
    title="Profile Settings"
    description="Manage your personal information and account security"
  >
    <!-- Header -->
    <template #header>
      <div class="flex items-center space-x-2">
        <Button :disabled="!hasProfileChanges" @click="saveProfile">
          <Save class="h-4 w-4 mr-2" />
          Save Changes
        </Button>
      </div>
    </template>

    <!-- Profile Information -->
    <Card>
      <CardHeader>
        <CardTitle>Profile Information</CardTitle>
        <CardDescription>Update your name and personal details</CardDescription>
      </CardHeader>
      <CardContent class="space-y-4">
        <div class="grid gap-4 md:grid-cols-2">
          <div class="space-y-2">
            <Label for="firstName">First Name</Label>
            <Input
              id="firstName"
              v-model="profileForm.firstName"
              placeholder="Enter your first name"
            />
          </div>

          <div class="space-y-2">
            <Label for="lastName">Last Name</Label>
            <Input
              id="lastName"
              v-model="profileForm.lastName"
              placeholder="Enter your last name"
            />
          </div>
        </div>
      </CardContent>
    </Card>

    <!-- Email Management -->
    <Card>
      <CardHeader>
        <CardTitle>Email Address</CardTitle>
        <CardDescription>
          Manage your email address used for login and notifications
        </CardDescription>
      </CardHeader>
      <CardContent class="space-y-4">
        <div class="space-y-2">
          <Label for="currentEmail">Current Email</Label>
          <div class="flex items-center space-x-2">
            <Input id="currentEmail" :value="currentUser?.email" disabled class="flex-1" />
            <Badge variant="secondary">Verified</Badge>
          </div>
        </div>

        <!-- Pending Email Change Notice -->
        <Alert v-if="currentUser?.pendingEmail" variant="warning">
          <AlertTriangle class="h-4 w-4" />
          <AlertTitle>Email Change Pending Verification</AlertTitle>
          <AlertDescription>
            <p>
              A verification email has been sent to <strong>{{ currentUser.pendingEmail }}</strong
              >.
            </p>
            <p class="mt-2 text-sm">
              Please check your new email inbox and click the verification link to complete the
              change. The link will expire in 24 hours.
            </p>
            <div class="mt-3">
              <Button variant="outline" size="sm" @click="cancelEmailChange">
                Cancel Change
              </Button>
            </div>
          </AlertDescription>
        </Alert>

        <Separator />

        <div v-if="!currentUser?.pendingEmail" class="space-y-2">
          <Label for="newEmail">New Email Address</Label>
          <Input
            id="newEmail"
            v-model="emailForm.newEmail"
            type="email"
            placeholder="Enter new email address"
            @input="validateEmail"
          />
          <p v-if="emailError" class="text-sm text-destructive">
            {{ emailError }}
          </p>
        </div>

        <Alert
          v-if="emailForm.newEmail && !emailError && !currentUser?.pendingEmail"
          variant="default"
        >
          <AlertTitle>Verification Required</AlertTitle>
          <AlertDescription>
            You will need to verify the new email address before the change takes effect. A
            verification link will be sent to your new email address.
          </AlertDescription>
        </Alert>

        <Button
          v-if="!currentUser?.pendingEmail"
          :disabled="
            !emailForm.newEmail || !!emailError || emailForm.newEmail === currentUser?.email
          "
          @click="initiateEmailChange"
        >
          <Mail class="h-4 w-4 mr-2" />
          Change Email
        </Button>
      </CardContent>
    </Card>

    <!-- Password Management -->
    <Card>
      <CardHeader>
        <CardTitle>Change Password</CardTitle>
        <CardDescription> Update your password to keep your account secure </CardDescription>
      </CardHeader>
      <CardContent class="space-y-4">
        <div class="space-y-2">
          <Label for="currentPassword">Current Password</Label>
          <Input
            id="currentPassword"
            v-model="passwordForm.currentPassword"
            type="password"
            placeholder="Enter current password"
            autocomplete="current-password"
          />
        </div>

        <div class="space-y-2">
          <Label for="newPassword">New Password</Label>
          <Input
            id="newPassword"
            v-model="passwordForm.newPassword"
            type="password"
            placeholder="Enter new password"
            autocomplete="new-password"
          />
        </div>

        <PasswordStrength v-if="passwordForm.newPassword" :password="passwordForm.newPassword" />

        <div class="space-y-2">
          <Label for="confirmPassword">Confirm New Password</Label>
          <Input
            id="confirmPassword"
            v-model="passwordForm.confirmPassword"
            type="password"
            placeholder="Confirm new password"
            autocomplete="new-password"
          />
          <p
            v-if="
              passwordForm.confirmPassword &&
              passwordForm.newPassword !== passwordForm.confirmPassword
            "
            class="text-sm text-destructive"
          >
            Passwords do not match
          </p>
        </div>

        <Alert variant="info">
          <Shield class="h-4 w-4" />
          <AlertTitle>Password Requirements</AlertTitle>
          <AlertDescription>
            Your password must be at least 8 characters and include uppercase, lowercase, number,
            and special character.
          </AlertDescription>
        </Alert>

        <Button @click="changePassword" :disabled="!canChangePassword">
          <Lock class="h-4 w-4 mr-2" />
          Update Password
        </Button>
      </CardContent>
    </Card>

    <!-- Recent Security Activity -->
    <Card>
      <CardHeader>
        <CardTitle>Recent Security Activity</CardTitle>
        <CardDescription>Monitor recent changes to your account</CardDescription>
      </CardHeader>
      <CardContent>
        <div v-if="loadingEvents" class="text-center py-8 text-neutral-muted">
          Loading security events...
        </div>
        <div v-else-if="securityEvents.length === 0" class="text-center py-8 text-neutral-muted">
          No recent security events
        </div>
        <div v-else class="space-y-3">
          <div
            v-for="event in securityEvents"
            :key="event.id"
            class="flex items-start space-x-3 p-3 border rounded-lg"
          >
            <component
              :is="getEventIcon(event.action)"
              :class="['h-4 w-4 mt-0.5', getEventColor(event.action)]"
            />
            <div class="flex-1">
              <div class="font-medium">
                {{ formatEventAction(event.action) }}
              </div>
              <div class="text-sm text-neutral-muted">
                {{ formatDate(event.createdAt) }}
                <span v-if="event.ipAddress"> • {{ event.ipAddress }}</span>
              </div>
            </div>
            <Badge :variant="event.status === 'success' ? 'success' : 'destructive'">
              {{ event.status }}
            </Badge>
          </div>
        </div>
      </CardContent>
    </Card>

    <!-- Re-authentication Modal -->
    <ReauthModal v-model:open="showReauthModal" @confirmed="handleReauthConfirmed" />
  </Page>
</template>

<script setup lang="ts">
import { Save, Mail, Lock, Shield, AlertTriangle, Key, UserX } from "lucide-vue-next";
import { Hay } from "@/utils/api";
import { useToast } from "@/composables/useToast";
import { useUserStore } from "@/stores/user";
import { validateEmail as validateEmailUtil, validatePassword } from "@/lib/utils";
import PasswordStrength from "@/components/auth/PasswordStrength.vue";
import ReauthModal from "@/components/auth/ReauthModal.vue";

const toast = useToast();
const userStore = useUserStore();
const currentUser = computed(() => userStore.user);

// Profile form
const profileForm = reactive({
  firstName: "",
  lastName: "",
});

const originalProfile = reactive({
  firstName: "",
  lastName: "",
});

const hasProfileChanges = computed(() => {
  return (
    profileForm.firstName !== originalProfile.firstName ||
    profileForm.lastName !== originalProfile.lastName
  );
});

// Email form
const emailForm = reactive({
  newEmail: "",
});

const emailError = ref("");

const validateEmail = () => {
  if (!emailForm.newEmail) {
    emailError.value = "";
    return;
  }

  if (!validateEmailUtil(emailForm.newEmail)) {
    emailError.value = "Please enter a valid email address";
    return;
  }

  emailError.value = "";
};

// Password form
const passwordForm = reactive({
  currentPassword: "",
  newPassword: "",
  confirmPassword: "",
});

const canChangePassword = computed(() => {
  const passwordValidation = validatePassword(passwordForm.newPassword);
  return (
    passwordForm.currentPassword &&
    passwordForm.newPassword &&
    passwordForm.confirmPassword &&
    passwordForm.newPassword === passwordForm.confirmPassword &&
    passwordValidation.isValid
  );
});

// Security events
const securityEvents = ref<any[]>([]);
const loadingEvents = ref(false);

// Re-authentication
const showReauthModal = ref(false);
const pendingAction = ref<"email" | null>(null);

// Load user data
onMounted(async () => {
  if (currentUser.value) {
    profileForm.firstName = currentUser.value.firstName || "";
    profileForm.lastName = currentUser.value.lastName || "";
    originalProfile.firstName = currentUser.value.firstName || "";
    originalProfile.lastName = currentUser.value.lastName || "";
  }

  await loadSecurityEvents();
});

// Save profile changes
const saveProfile = async () => {
  try {
    const response = await Hay.auth.updateProfile.mutate({
      firstName: profileForm.firstName || undefined,
      lastName: profileForm.lastName || undefined,
    });

    if (response.success && response.user) {
      // Update user in store
      userStore.setUser(response.user);
      originalProfile.firstName = profileForm.firstName;
      originalProfile.lastName = profileForm.lastName;

      toast.success("Profile updated successfully");
    }
  } catch (error: any) {
    console.error("Failed to update profile:", error);
    toast.error(error.message || "Failed to update profile");
  }
};

// Email change flow
const initiateEmailChange = () => {
  pendingAction.value = "email";
  showReauthModal.value = true;
};

const handleReauthConfirmed = async (password: string) => {
  if (pendingAction.value === "email") {
    await executeEmailChange(password);
  }
  pendingAction.value = null;
};

const executeEmailChange = async (password: string) => {
  try {
    const response = await Hay.auth.updateEmail.mutate({
      newEmail: emailForm.newEmail,
      currentPassword: password,
    });

    if (response.success) {
      // Update user in store with pending email
      if (currentUser.value) {
        userStore.setUser({
          ...currentUser.value,
          pendingEmail: response.pendingEmail,
        });
      }
      emailForm.newEmail = "";

      toast.success(response.message || "Verification email sent. Please check your inbox.");
    }
  } catch (error: any) {
    console.error("Failed to update email:", error);
    toast.error(error.message || "Failed to send verification email");
  }
};

// Cancel email change
const cancelEmailChange = async () => {
  try {
    const response = await Hay.auth.cancelEmailChange.mutate();

    if (response.success) {
      // Update user in store to remove pending email
      if (currentUser.value) {
        userStore.setUser({
          ...currentUser.value,
          pendingEmail: undefined,
        });
      }

      toast.success("Email change cancelled successfully");
    }
  } catch (error: any) {
    console.error("Failed to cancel email change:", error);
    toast.error(error.message || "Failed to cancel email change");
  }
};

// Password change
const changePassword = async () => {
  if (!canChangePassword.value) return;

  try {
    await Hay.auth.changePassword.mutate({
      currentPassword: passwordForm.currentPassword,
      newPassword: passwordForm.newPassword,
    });

    // Reset form
    passwordForm.currentPassword = "";
    passwordForm.newPassword = "";
    passwordForm.confirmPassword = "";

    toast.success("Password changed successfully. A confirmation email has been sent.");

    // Reload security events
    await loadSecurityEvents();
  } catch (error: any) {
    console.error("Failed to change password:", error);
    toast.error(error.message || "Failed to change password");
  }
};

// Security events
const loadSecurityEvents = async () => {
  loadingEvents.value = true;
  try {
    const events = await Hay.auth.getRecentSecurityEvents.query({ limit: 5 });
    securityEvents.value = events;
  } catch (error) {
    console.error("Failed to load security events:", error);
  } finally {
    loadingEvents.value = false;
  }
};

const getEventIcon = (action: string) => {
  const icons: Record<string, any> = {
    "email.change": Mail,
    "password.change": Lock,
    "user.login": Key,
    "apikey.create": Key,
    "apikey.revoke": UserX,
  };
  return icons[action] || Shield;
};

const getEventColor = (action: string) => {
  const colors: Record<string, string> = {
    "email.change": "text-blue-600",
    "password.change": "text-green-600",
    "user.login": "text-purple-600",
    "apikey.create": "text-orange-600",
    "apikey.revoke": "text-red-600",
  };
  return colors[action] || "text-gray-600";
};

const formatEventAction = (action: string) => {
  const labels: Record<string, string> = {
    "profile.update": "Profile Updated",
    "email.change": "Email Changed",
    "password.change": "Password Changed",
    "user.login": "User Login",
    "apikey.create": "API Key Created",
    "apikey.revoke": "API Key Revoked",
  };
  return labels[action] || action;
};

const formatDate = (date: string | Date) => {
  const d = new Date(date);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (days === 0) {
    const hours = Math.floor(diff / (1000 * 60 * 60));
    if (hours === 0) {
      const minutes = Math.floor(diff / (1000 * 60));
      return `${minutes} minute${minutes !== 1 ? "s" : ""} ago`;
    }
    return `${hours} hour${hours !== 1 ? "s" : ""} ago`;
  } else if (days === 1) {
    return "Yesterday";
  } else if (days < 7) {
    return `${days} days ago`;
  } else {
    return d.toLocaleDateString();
  }
};

// Set page meta
definePageMeta({
  layout: "default",
  // middleware: 'auth',
});

// Head management
useHead({
  title: "Profile Settings - Hay Dashboard",
  meta: [
    {
      name: "description",
      content: "Manage your profile information and account security",
    },
  ],
});
</script>
