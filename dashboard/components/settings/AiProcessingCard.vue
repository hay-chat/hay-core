<template>
  <!-- Where the org's AI calls run (D14-5). Read-only; the switch lives in AI Models. -->
  <Card>
    <CardHeader>
      <CardTitle>{{ $t("customerPrivacy.aiProcessing.title") }}</CardTitle>
      <CardDescription>{{ $t("customerPrivacy.aiProcessing.description") }}</CardDescription>
    </CardHeader>
    <CardContent v-if="info" class="space-y-3">
      <dl class="grid gap-2 text-sm sm:grid-cols-[8rem_1fr]">
        <dt class="text-muted-foreground">{{ $t("customerPrivacy.aiProcessing.regionLabel") }}</dt>
        <dd class="font-medium" data-testid="ai-processing-region">
          {{
            info.region === "eu"
              ? $t("customerPrivacy.aiProcessing.regionEu")
              : $t("customerPrivacy.aiProcessing.regionDefault")
          }}
        </dd>
        <dt class="text-muted-foreground">
          {{ $t("customerPrivacy.aiProcessing.providerLabel") }}
        </dt>
        <dd class="font-medium" data-testid="ai-processing-provider">
          {{ info.provider.name }}
          <span v-if="info.provider.name !== info.provider.host" class="text-muted-foreground">
            ({{ info.provider.host }})
          </span>
        </dd>
      </dl>
      <Button variant="outline" size="sm" @click="router.push('/settings/llm')">
        {{ $t("customerPrivacy.aiProcessing.change") }}
      </Button>
    </CardContent>
  </Card>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useRouter } from "vue-router";
import { Hay } from "@/utils/api";
import type { RouterOutputs } from "@/types/trpc";
import { useToast } from "@/composables/useToast";

const { t } = useI18n();
const toast = useToast();
const router = useRouter();

const info = ref<RouterOutputs["organizations"]["getAiRegion"] | null>(null);

onMounted(async () => {
  try {
    info.value = await Hay.organizations.getAiRegion.query();
  } catch (error) {
    console.error("Failed to load AI processing details:", error);
    toast.error(t("customerPrivacy.aiProcessing.loadFailed"));
  }
});
</script>
