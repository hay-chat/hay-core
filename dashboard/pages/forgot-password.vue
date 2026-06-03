<template>
  <NuxtLayout name="auth">
    <div class="space-y-6">
      <!-- Success State -->
      <div v-if="emailSent" class="text-center space-y-4">
        <div class="mx-auto flex items-center justify-center w-12 h-12 rounded-full bg-green-100">
          <CheckCircle class="w-6 h-6 text-green-600" />
        </div>

        <div>
          <CardTitle class="text-2xl"> {{ $t("forgotPassword.successTitle") }} </CardTitle>
          <CardDescription class="mt-2">
            {{ $t("forgotPassword.successDescription") }}
            <strong>{{ form.email }}</strong>
          </CardDescription>
        </div>

        <div class="space-y-4">
          <div class="p-4 bg-blue-50 rounded-lg border border-blue-200">
            <p class="text-sm text-blue-800">
              <strong>{{ $t("forgotPassword.didntReceive") }}</strong
              ><br />
              {{ $t("forgotPassword.checkSpam") }}
            </p>
          </div>

          <div class="space-y-3">
            <Button
              variant="outline"
              size="lg"
              class="w-full"
              :loading="resendLoading"
              :disabled="resendCooldown > 0"
              @click="resendEmail"
            >
              <span v-if="resendCooldown > 0">{{
                $t("forgotPassword.resendCooldown", { seconds: resendCooldown })
              }}</span>
              <span v-else>{{ $t("forgotPassword.resendEmail") }}</span>
            </Button>

            <Button variant="ghost" size="lg" class="w-full" @click="goBack">
              {{ $t("forgotPassword.backToSignIn") }}
            </Button>
          </div>
        </div>
      </div>

      <!-- Request Form -->
      <div v-else class="space-y-6">
        <!-- Header -->
        <div class="text-center">
          <CardTitle class="text-2xl"> {{ $t("forgotPassword.title") }} </CardTitle>
          <CardDescription class="mt-2">
            {{ $t("forgotPassword.description") }}
          </CardDescription>
        </div>

        <!-- Reset Form -->
        <form class="space-y-4" @submit.prevent="handleSubmit">
          <div class="space-y-2">
            <Input
              id="email"
              v-model="form.email"
              :label="$t('forgotPassword.emailLabel')"
              type="email"
              :placeholder="$t('forgotPassword.emailPlaceholder')"
              required
              :class="errors.email ? 'border-red-500' : ''"
              @blur="validateField('email')"
            />
            <p v-if="errors.email" class="text-sm text-red-600">
              {{ errors.email }}
            </p>
            <p v-else class="text-sm text-gray-500">
              {{ $t("forgotPassword.emailHelper") }}
            </p>
          </div>

          <!-- Submit Button -->
          <Button
            type="submit"
            size="lg"
            class="w-full"
            :loading="loading"
            :disabled="!isFormValid"
          >
            {{ $t("forgotPassword.submit") }}
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
            <span>{{ $t("forgotPassword.backToSignIn") }}</span>
          </NuxtLink>
        </div>
      </div>
    </div>
  </NuxtLayout>
</template>

<script setup lang="ts">
import { CheckCircle, ArrowLeft } from "lucide-vue-next";
import { validateEmail } from "@/lib/utils";
import { Hay } from "@/utils/api";
import { useToast } from "@/composables/useToast";

const { t } = useI18n();
const router = useRouter();
const toast = useToast();

definePageMeta({
  layout: false,
  public: true,
});

// Form state
const form = reactive({
  email: "",
});

const errors = reactive({
  email: "",
});

const loading = ref(false);
const error = ref("");
const emailSent = ref(false);
const resendLoading = ref(false);
const resendCooldown = ref(0);

// Computed
const isFormValid = computed(() => {
  return form.email && validateEmail(form.email) && !errors.email;
});

// Methods
const validateField = (field: keyof typeof errors) => {
  switch (field) {
    case "email":
      if (!form.email) {
        errors.email = t("forgotPassword.errors.emailRequired");
      } else if (!validateEmail(form.email)) {
        errors.email = t("forgotPassword.errors.emailInvalid");
      } else {
        errors.email = "";
      }
      break;
  }
};

const handleSubmit = async () => {
  validateField("email");

  if (!isFormValid.value) {
    return;
  }

  loading.value = true;
  error.value = "";

  try {
    const response = await Hay.auth.requestPasswordReset.mutate({
      email: form.email,
    });

    if (response.success) {
      emailSent.value = true;
      toast.success(t("forgotPassword.toast.sent"));
    }
  } catch (err: unknown) {
    console.error("Password reset error:", err);
    error.value = err instanceof Error ? err.message : t("forgotPassword.toast.sendFailed");
    toast.error(t("forgotPassword.toast.sendFailedTitle"));
  } finally {
    loading.value = false;
  }
};

const resendEmail = async () => {
  resendLoading.value = true;
  error.value = "";

  try {
    const response = await Hay.auth.requestPasswordReset.mutate({
      email: form.email,
    });

    if (response.success) {
      toast.success(t("forgotPassword.toast.resent"));
      // Start cooldown timer
      startResendCooldown();
    }
  } catch (err: unknown) {
    console.error("Resend error:", err);
    error.value = err instanceof Error ? err.message : t("forgotPassword.toast.resendFailed");
    toast.error(t("forgotPassword.toast.resendFailedTitle"));
  } finally {
    resendLoading.value = false;
  }
};

const startResendCooldown = () => {
  resendCooldown.value = 60; // 60 seconds cooldown

  const interval = setInterval(() => {
    resendCooldown.value--;

    if (resendCooldown.value <= 0) {
      clearInterval(interval);
    }
  }, 1000);
};

const goBack = () => {
  router.push("/login");
};

// Auto-focus email input when component mounts
onMounted(() => {
  const emailInput = document.getElementById("email");
  if (emailInput && !emailSent.value) {
    emailInput.focus();
  }
});

// SEO
useHead({
  title: t("forgotPassword.pageTitle"),
  meta: [
    {
      name: "description",
      content: t("forgotPassword.pageDescription"),
    },
  ],
});
</script>
