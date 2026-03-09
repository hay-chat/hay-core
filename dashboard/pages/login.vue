<template>
  <NuxtLayout name="auth">
    <div class="space-y-6">
      <!-- Invitation Context Banner -->
      <div
        v-if="invitationContext"
        class="p-4 bg-primary/10 border border-primary/20 rounded-lg space-y-2"
      >
        <p class="font-semibold text-primary">
          Login to join <strong>{{ invitationContext.organization.name }}</strong> as
          <strong class="capitalize">{{ invitationContext.role }}</strong>
        </p>
        <div v-if="invitationContext.invitedBy" class="text-sm text-gray-600">
          Invited by {{ invitationContext.invitedBy.name }}
          <span class="text-gray-500">({{ invitationContext.invitedBy.email }})</span>
        </div>
        <p v-if="invitationContext.message" class="text-sm text-gray-700 italic">
          "{{ invitationContext.message }}"
        </p>
      </div>

      <!-- Header -->
      <div class="text-center">
        <CardTitle class="text-2xl"> {{ $t("login.title") }} </CardTitle>
        <CardDescription class="mt-2"> {{ $t("login.description") }} </CardDescription>
      </div>

      <!-- Social Login -->
      <!-- <div class="space-y-3">
        <SocialButton
          provider="google"
          action="login"
          :loading="socialLoading.google"
          @click="handleSocialLogin"
        />
        <SocialButton
          provider="github"
          action="login"
          :loading="socialLoading.github"
          @click="handleSocialLogin"
        />
        <SocialButton
          provider="microsoft"
          action="login"
          :loading="socialLoading.microsoft"
          @click="handleSocialLogin"
        />
      </div> -->

      <!-- Divider -->
      <!-- <div class="relative">
        <div class="absolute inset-0 flex items-center">
          <span class="w-full border-t" />
        </div>
        <div class="relative flex justify-center text-xs uppercase">
          <span class="bg-white px-2 text-neutral-muted"> Or continue with email </span>
        </div>
      </div> -->

      <!-- Login Form -->
      <form class="space-y-4" @submit.prevent="handleSubmit">
        <div class="space-y-2">
          <Input
            id="email"
            v-model="form.email"
            :label="$t('login.emailLabel')"
            type="email"
            :placeholder="$t('login.emailPlaceholder')"
            required
            :class="errors.email ? 'border-red-500' : ''"
            @blur="validateField('email')"
          />
          <p v-if="errors.email" class="text-sm text-red-600">
            {{ errors.email }}
          </p>
        </div>

        <div class="space-y-2">
          <Input
            id="password"
            v-model="form.password"
            :label="$t('login.passwordLabel')"
            type="password"
            :placeholder="$t('login.passwordPlaceholder')"
            required
            :class="errors.password ? 'border-red-500' : ''"
            @blur="validateField('password')"
          />
          <p v-if="errors.password" class="text-sm text-red-600">
            {{ errors.password }}
          </p>
        </div>

        <!-- Forgot password -->
        <div class="flex items-center justify-end">
          <NuxtLink
            to="/forgot-password"
            class="text-sm text-primary hover:text-primary/80 font-medium"
          >
            {{ $t("login.forgotPassword") }}
          </NuxtLink>
        </div>

        <!-- Submit Button -->
        <Button type="submit" size="lg" class="w-full" :loading="loading" :disabled="!isFormValid">
          {{ $t("login.submit") }}
        </Button>

        <!-- Error Message -->
        <div
          v-if="error && !emailNotVerified"
          class="p-3 rounded-md bg-red-50 border border-red-200"
        >
          <p class="text-sm text-red-800">
            {{ error }}
          </p>
        </div>

        <!-- Email Not Verified -->
        <div
          v-if="emailNotVerified"
          class="p-4 rounded-md bg-amber-50 border border-amber-200 space-y-3"
        >
          <p class="text-sm text-amber-800 font-medium">
            {{ $t("login.emailNotVerified") }}
          </p>
          <p class="text-sm text-amber-700">
            {{ $t("login.emailNotVerifiedDescription") }}
          </p>
          <Button
            variant="outline"
            size="sm"
            class="w-full"
            :loading="resendingVerification"
            :disabled="verificationResent"
            @click="handleResendVerification"
          >
            {{ verificationResent ? $t("login.verificationSent") : $t("login.resendVerification") }}
          </Button>
        </div>
      </form>
    </div>
  </NuxtLayout>
</template>

<script setup lang="ts">
import { validateEmail } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth";
import { Hay } from "@/utils/api";

const { t } = useI18n();

definePageMeta({
  layout: false,
  public: true,
});

// Navigation
const router = useRouter();
const route = useRoute();

// Auth store
const authStore = useAuthStore();

// Get redirect URL from query params
const redirectUrl = computed(() => (route.query.redirect as string) || "/");

// Invitation context
interface InvitationContext {
  email: string;
  role: string;
  organization: {
    name: string;
  };
  invitedBy?: {
    name: string;
    email: string;
  };
  message?: string;
}

const invitationContext = ref<InvitationContext | null>(null);

// Extract token from redirect URL
const extractTokenFromRedirect = (redirectUrl: string): string | null => {
  try {
    const url = new URL(redirectUrl, window.location.origin);
    return url.searchParams.get("token");
  } catch {
    return null;
  }
};

// Load invitation context if present
const loadInvitationContext = async () => {
  const token = extractTokenFromRedirect(redirectUrl.value);
  if (!token) return;

  try {
    const invitation = await Hay.invitations.getInvitationByToken.query({ token });
    invitationContext.value = {
      email: invitation.email,
      role: invitation.role,
      organization: {
        name: invitation.organization.name,
      },
      invitedBy: invitation.invitedBy || undefined,
      message: invitation.message,
    };

    // Pre-fill email if we have invitation context
    form.email = invitation.email;
  } catch (err) {
    console.error("Failed to load invitation context:", err);
  }
};

// Redirect to home if already logged in
onMounted(() => {
  if (authStore.isAuthenticated) {
    router.push(redirectUrl.value);
  } else {
    loadInvitationContext();
  }
});

// Form state
const form = reactive({
  email: "",
  password: "",
});

const errors = reactive({
  email: "",
  password: "",
});

const error = ref("");
const emailNotVerified = ref(false);
const resendingVerification = ref(false);
const verificationResent = ref(false);

// Computed
const loading = computed(() => authStore.isLoading);

const isFormValid = computed(() => {
  return (
    form.email && form.password && validateEmail(form.email) && !errors.email && !errors.password
  );
});

// Methods
const validateField = (field: keyof typeof errors) => {
  switch (field) {
    case "email":
      if (!form.email) {
        errors.email = t("login.errors.emailRequired");
      } else if (!validateEmail(form.email)) {
        errors.email = t("login.errors.emailInvalid");
      } else {
        errors.email = "";
      }
      break;
    case "password":
      if (!form.password) {
        errors.password = t("login.errors.passwordRequired");
      } else if (form.password.length < 8) {
        errors.password = t("login.errors.passwordMinLength");
      } else {
        errors.password = "";
      }
      break;
  }
};

const handleSubmit = async () => {
  // Validate all fields
  validateField("email");
  validateField("password");

  if (!isFormValid.value) {
    return;
  }

  error.value = "";
  emailNotVerified.value = false;
  verificationResent.value = false;

  try {
    await authStore.login(form.email, form.password);

    // Successful login - redirect to the intended page or dashboard
    await router.push(redirectUrl.value);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    // Handle different types of authentication errors
    if (err.message.includes("not verified")) {
      emailNotVerified.value = true;
    } else if (err.message.includes("Invalid credentials")) {
      error.value = t("login.errors.invalidCredentials");
    } else if (err.message.includes("locked")) {
      error.value = t("login.errors.accountLocked");
    } else if (err.message.includes("suspended")) {
      error.value = t("login.errors.accountSuspended");
    } else {
      error.value = t("login.errors.networkError");
    }
    console.error("Login error:", err);
  }
};

const handleResendVerification = async () => {
  resendingVerification.value = true;
  try {
    await Hay.auth.resendSignupVerification.mutate({ email: form.email });
    verificationResent.value = true;
  } catch (err: any) {
    if (err.message.includes("Too many requests")) {
      error.value = t("login.errors.tooManyRequests");
    } else {
      error.value = t("login.errors.resendFailed");
    }
  } finally {
    resendingVerification.value = false;
  }
};

// SEO
useHead({
  title: t("login.pageTitle"),
  meta: [{ name: "description", content: t("login.pageDescription") }],
});
</script>
