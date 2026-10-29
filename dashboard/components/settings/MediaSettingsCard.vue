<template>
  <!-- Customer photos and PDFs: whether the AI reads them (D8-11) and ID documents (D8-12). -->
  <Card>
    <CardHeader>
      <CardTitle>{{ $t("customerPrivacy.media.title") }}</CardTitle>
      <CardDescription>{{ $t("customerPrivacy.media.description") }}</CardDescription>
    </CardHeader>
    <CardContent v-if="loaded" class="space-y-6">
      <div class="space-y-1">
        <Input v-model="readImages" type="switch" :label="$t('customerPrivacy.media.readImages')" />
        <p class="text-sm text-muted-foreground">
          {{ $t("customerPrivacy.media.readImagesHint") }}
        </p>
      </div>

      <div class="space-y-1">
        <Input
          v-model="allowIdDocuments"
          type="switch"
          :label="$t('customerPrivacy.media.allowIdDocuments')"
          :disabled="!userStore.isOwner"
        />
        <p class="text-sm text-muted-foreground">
          {{ $t("customerPrivacy.media.allowIdDocumentsHint") }}
        </p>
        <p v-if="!userStore.isOwner" class="text-sm text-muted-foreground">
          {{ $t("customerPrivacy.media.ownerOnly") }}
        </p>
      </div>

      <div class="space-y-1">
        <Input
          v-model="caseEmail"
          type="email"
          :label="$t('customerPrivacy.media.caseEmail')"
          :placeholder="$t('customerPrivacy.media.caseEmailPlaceholder')"
        />
        <p class="text-sm text-muted-foreground">
          {{ $t("customerPrivacy.media.caseEmailHint") }}
        </p>
      </div>

      <Button :loading="isSaving" @click="save">
        {{ $t("customerPrivacy.media.save") }}
      </Button>
    </CardContent>
  </Card>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { Hay } from "@/utils/api";
import { useToast } from "@/composables/useToast";
import { useUserStore } from "@/stores/user";
import { TRPCClientError } from "@trpc/client";

const { t } = useI18n();
const toast = useToast();
const userStore = useUserStore();

const loaded = ref(false);
const isSaving = ref(false);
const readImages = ref(true);
const allowIdDocuments = ref(false);
const caseEmail = ref("");

async function load() {
  try {
    const result = await Hay.organizations.getMediaSettings.query();
    readImages.value = result.readImages;
    allowIdDocuments.value = result.allowIdDocuments;
    caseEmail.value = result.caseEmail ?? "";
    loaded.value = true;
  } catch (error) {
    console.error("Failed to load media settings:", error);
    toast.error(t("customerPrivacy.media.loadFailed"));
  }
}

async function save() {
  isSaving.value = true;
  try {
    await Hay.organizations.updateMediaSettings.mutate({
      readImages: readImages.value,
      caseEmail: caseEmail.value.trim() || null,
      // Only the owner may change it; others leave it as it is.
      ...(userStore.isOwner ? { allowIdDocuments: allowIdDocuments.value } : {}),
    });
    toast.success(t("customerPrivacy.media.saveSuccess"));
  } catch (error) {
    console.error("Failed to save media settings:", error);
    const invalidEmail = error instanceof TRPCClientError && error.data?.code === "BAD_REQUEST";
    toast.error(
      t(
        invalidEmail
          ? "customerPrivacy.media.caseEmailInvalid"
          : "customerPrivacy.media.saveFailed",
      ),
    );
  } finally {
    isSaving.value = false;
  }
}

onMounted(load);
</script>
