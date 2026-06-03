<template>
  <NuxtLayout name="auth">
    <div class="space-y-6">
      <!-- Loading State (Verifying Token) -->
      <div v-if="isVerifyingToken" class="text-center space-y-4">
        <div class="mx-auto flex items-center justify-center w-12 h-12 rounded-full bg-blue-100">
          <KeyRound class="w-6 h-6 text-blue-600 animate-pulse" />
        </div>
        <div>
          <CardTitle class="text-2xl">{{ $t("resetPassword.verifyingTitle") }}</CardTitle>
          <CardDescription class="mt-2">
            {{ $t("resetPassword.verifyingDescription") }}
          </CardDescription>
        </div>
      </div>

      <!-- Success State (Password Reset) -->
      <div v-else-if="resetSuccess" class="text-center space-y-4">
        <div class="mx-auto flex items-center justify-center w-12 h-12 rounded-full bg-green-100">
          <CheckCircle class="w-6 h-6 text-green-600" />
        </div>

        <div>
          <CardTitle class="text-2xl">{{ $t("resetPassword.successTitle") }}</CardTitle>
          <CardDescription class="mt-2">
            {{ $t("resetPassword.successDescription") }}
          </CardDescription>
        </div>

        <div class="space-y-3">
          <Button size="lg" class="w-full" @click="goToLogin">
            {{ $t("resetPassword.goToLogin") }}
          </Button>
        </div>
      </div>

      <!-- Error State (Invalid/Expired Token) -->
      <div v-else-if="tokenError" class="text-center space-y-4">
        <div class="mx-auto flex items-center justify-center w-12 h-12 rounded-full bg-red-100">
          <XCircle class="w-6 h-6 text-red-600" />
        </div>

        <div>
          <CardTitle class="text-2xl">{{ $t("resetPassword.errorTitle") }}</CardTitle>
          <CardDescription class="mt-2">
            {{ tokenError }}
          </CardDescription>
        </div>

        <div class="space-y-3">
          <Button variant="outline" size="lg" class="w-full" @click="goToForgotPassword">
            {{ $t("resetPassword.requestNewLink") }}
          </Button>

          <Button variant="ghost" size="lg" class="w-full" @click="goToLogin">
            {{ $t("resetPassword.backToLogin") }}
          </Button>
        </div>
      </div>

      <!-- Password Reset Form -->
      <div v-else class="space-y-6">
        <!-- Header -->
        <div class="text-center">
          <CardTitle class="text-2xl">{{ $t("resetPassword.formTitle") }}</CardTitle>
          <CardDescription class="mt-2">
            {{ $t("resetPassword.formDescription") }}
          </CardDescription>
        </div>

        <!-- Reset Form -->
        <form class="space-y-4" @submit.prevent="handleSubmit">
          <div class="space-y-2">
            <Input
              id="password"
              v-model="form.password"
              :label="$t('resetPassword.newPasswordLabel')"
              type="password"
              :placeholder="$t('resetPassword.newPasswordPlaceholder')"
              required
              :class="errors.password ? 'border-red-500' : ''"
              @blur="validateField('password')"
            />
            <p v-if="errors.password" class="text-sm text-red-600">
              {{ errors.password }}
            </p>
            <p v-else class="text-sm text-gray-500">{{ $t("resetPassword.newPasswordHelper") }}</p>
          </div>

          <div class="space-y-2">
            <Input
              id="confirmPassword"
              v-model="form.confirmPassword"
              :label="$t('resetPassword.confirmLabel')"
              type="password"
              :placeholder="$t('resetPassword.confirmPlaceholder')"
              required
              :class="errors.confirmPassword ? 'border-red-500' : ''"
              @blur="validateField('confirmPassword')"
            />
            <p v-if="errors.confirmPassword" class="text-sm text-red-600">
              {{ errors.confirmPassword }}
            </p>
          </div>

          <!-- Password Strength Indicator -->
          <PasswordStrength :password="form.password" />

          <!-- Submit Button -->
          <Button
            type="submit"
            size="lg"
            class="w-full"
            :loading="loading"
            :disabled="!isFormValid"
          >
            {{ $t("resetPassword.submit") }}
          </Button>

          <!-- Error Message -->
          <div v-if="error" class="p-3 rounded-md bg-red-50 border border-red-200">
            <p class="text-sm text-red-800">
              {{ error }}
            </p>
          </div>
        </form>

        <!-- Back to login -->
        <div class="text-center">
          <NuxtLink
            to="/login"
            class="text-sm text-primary hover:text-primary/80 font-medium flex items-center justify-center space-x-1"
          >
            <ArrowLeft class="w-4 h-4" />
            <span>{{ $t("resetPassword.backToLogin") }}</span>
          </NuxtLink>
        </div>
      </div>
    </div>
  </NuxtLayout>
</template>

<script setup lang="ts">
import { CheckCircle, XCircle, KeyRound, ArrowLeft } from "lucide-vue-next";
import { Hay } from "@/utils/api";
import { useToast } from "@/composables/useToast";
import { validatePassword } from "@/lib/utils";
import PasswordStrength from "@/components/auth/PasswordStrength.vue";

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const toast = useToast();

definePageMeta({
  layout: false,
  public: true,
});

// Extract token from URL
const token = ref((route.query.token as string) || "");

// Form state
const form = reactive({
  password: "",
  confirmPassword: "",
});

const errors = reactive({
  password: "",
  confirmPassword: "",
});

const loading = ref(false);
const error = ref("");
const isVerifyingToken = ref(true);
const tokenError = ref("");
const resetSuccess = ref(false);
const userEmail = ref("");

// Password validation
const passwordValidation = computed(() => validatePassword(form.password));

// Computed
const isFormValid = computed(() => {
  return (
    form.password &&
    form.confirmPassword &&
    form.password === form.confirmPassword &&
    passwordValidation.value.isValid &&
    !errors.password &&
    !errors.confirmPassword
  );
});

// Methods
const validateField = (field: keyof typeof errors) => {
  switch (field) {
    case "password":
      if (!form.password) {
        errors.password = t("resetPassword.errors.passwordRequired");
      } else if (!passwordValidation.value.isValid) {
        errors.password = t("resetPassword.errors.passwordRequirements");
      } else {
        errors.password = "";
      }
      break;
    case "confirmPassword":
      if (!form.confirmPassword) {
        errors.confirmPassword = t("resetPassword.errors.confirmRequired");
      } else if (form.password !== form.confirmPassword) {
        errors.confirmPassword = t("resetPassword.errors.passwordMismatch");
      } else {
        errors.confirmPassword = "";
      }
      break;
  }
};

const verifyToken = async () => {
  if (!token.value) {
    tokenError.value = t("resetPassword.errors.noToken");
    isVerifyingToken.value = false;
    return;
  }

  try {
    const response = await Hay.auth.verifyResetToken.query({ token: token.value });

    if (response.valid) {
      userEmail.value = ("email" in response ? response.email : "") || "";
      isVerifyingToken.value = false;
    } else {
      tokenError.value =
        ("message" in response ? response.message : "") || t("resetPassword.errors.invalidToken");
      isVerifyingToken.value = false;
    }
  } catch (err: unknown) {
    console.error("Token verification error:", err);
    tokenError.value = err instanceof Error ? err.message : t("resetPassword.errors.verifyFailed");
    isVerifyingToken.value = false;
  }
};

const handleSubmit = async () => {
  validateField("password");
  validateField("confirmPassword");

  if (!isFormValid.value) {
    return;
  }

  loading.value = true;
  error.value = "";

  try {
    const response = await Hay.auth.resetPassword.mutate({
      token: token.value,
      newPassword: form.password,
    });

    if (response.success) {
      resetSuccess.value = true;
      toast.success(t("resetPassword.toast.success"));

      // Redirect to login after 3 seconds
      setTimeout(() => {
        router.push("/login");
      }, 3000);
    }
  } catch (err: unknown) {
    console.error("Password reset error:", err);
    error.value = err instanceof Error ? err.message : t("resetPassword.errors.resetFailed");
  } finally {
    loading.value = false;
  }
};

const goToLogin = () => {
  router.push("/login");
};

const goToForgotPassword = () => {
  router.push("/forgot-password");
};

// Verify token on mount
onMounted(async () => {
  await verifyToken();
});

// SEO
useHead({
  title: t("resetPassword.pageTitle"),
  meta: [
    {
      name: "description",
      content: t("resetPassword.pageDescription"),
    },
  ],
});
</script>
