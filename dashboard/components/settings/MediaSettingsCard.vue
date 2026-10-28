<template>
  <!-- Customer photos and PDFs: whether the AI reads them (D8-11). -->
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

const { t } = useI18n();
const toast = useToast();

const loaded = ref(false);
const isSaving = ref(false);
const readImages = ref(true);

async function load() {
  try {
    const result = await Hay.organizations.getMediaSettings.query();
    readImages.value = result.readImages;
    loaded.value = true;
  } catch (error) {
    console.error("Failed to load media settings:", error);
    toast.error(t("customerPrivacy.media.loadFailed"));
  }
}

async function save() {
  isSaving.value = true;
  try {
    await Hay.organizations.updateMediaSettings.mutate({ readImages: readImages.value });
    toast.success(t("customerPrivacy.media.saveSuccess"));
  } catch (error) {
    console.error("Failed to save media settings:", error);
    toast.error(t("customerPrivacy.media.saveFailed"));
  } finally {
    isSaving.value = false;
  }
}

onMounted(load);
</script>
