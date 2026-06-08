<template>
  <TooltipProvider :delay-duration="200">
    <div class="space-y-3">
      <p class="text-xs text-neutral-muted">{{ t("editor.actionsHint") }}</p>

      <div v-if="loading" class="py-6 text-center text-sm text-neutral-muted">
        {{ t("editor.actionsLoading") }}
      </div>

      <div v-else-if="tools.length === 0" class="py-6 text-center text-sm text-neutral-muted">
        {{ t("editor.actionsEmpty") }}
      </div>

      <!-- Level 1: integrations -->
      <AccordionRoot v-else type="single" collapsible class="space-y-2">
        <AccordionItem
          v-for="group in groups"
          :key="group.pluginId"
          :value="group.pluginId"
          class="overflow-hidden rounded-md border border-border bg-background"
        >
          <AccordionHeader>
            <AccordionTrigger
              class="group flex w-full items-center gap-2 p-2 text-left transition-colors hover:bg-muted"
            >
              <img
                v-if="!failedThumbnails.includes(group.pluginId)"
                :src="thumbnailUrl(group.pluginId)"
                :alt="group.pluginName"
                class="h-5 w-5 shrink-0 rounded object-contain"
                @error="onThumbnailError(group.pluginId)"
              />
              <Puzzle v-else class="h-5 w-5 shrink-0 text-neutral-muted" />
              <span class="flex-1 truncate text-sm font-medium">{{ group.pluginName }}</span>
              <span class="text-xs text-neutral-muted">{{ group.tools.length }}</span>
              <ChevronDown
                class="h-4 w-4 shrink-0 text-neutral-muted transition-transform group-data-[state=open]:rotate-180"
              />
            </AccordionTrigger>
          </AccordionHeader>

          <!-- Level 2: actions within an integration -->
          <AccordionContent class="border-t border-border">
            <AccordionRoot type="single" collapsible>
              <AccordionItem
                v-for="tool in group.tools"
                :key="tool.id"
                :value="tool.id"
                class="border-b border-border last:border-b-0"
              >
                <AccordionHeader>
                  <AccordionTrigger
                    class="group flex w-full items-center gap-1.5 p-2.5 text-left transition-colors hover:bg-muted"
                  >
                    <TooltipRoot>
                      <TooltipTrigger as-child>
                        <component
                          :is="getToolClassificationIcon(classifyTool(tool))"
                          class="h-3.5 w-3.5 shrink-0"
                          :class="classificationIconClass(classifyTool(tool))"
                        />
                      </TooltipTrigger>
                      <TooltipPortal>
                        <TooltipContent
                          :side-offset="4"
                          class="z-50 rounded-md border bg-background px-2 py-1 text-xs font-medium text-foreground shadow-md"
                        >
                          {{ classificationLabel(classifyTool(tool)) }}
                        </TooltipContent>
                      </TooltipPortal>
                    </TooltipRoot>
                    <span class="flex-1 truncate text-sm font-primary">{{ tool.label }}</span>
                    <ChevronDown
                      class="h-3.5 w-3.5 shrink-0 text-neutral-muted transition-transform group-data-[state=open]:rotate-180"
                    />
                  </AccordionTrigger>
                </AccordionHeader>

                <!-- Level 3: full action detail + add control -->
                <AccordionContent class="space-y-2 px-2.5 pb-2.5 pt-1">
                  <p v-if="tool.description" class="text-xs text-neutral-muted">
                    {{ tool.description }}
                  </p>
                  <p v-else class="text-xs italic text-neutral-muted">
                    {{ t("editor.actionsNoDescription") }}
                  </p>
                  <Button size="sm" class="w-full" @click="emit('add', tool)">
                    <Plus class="mr-1.5 h-3.5 w-3.5" />
                    {{ t("editor.actionsAdd") }}
                  </Button>
                </AccordionContent>
              </AccordionItem>
            </AccordionRoot>
          </AccordionContent>
        </AccordionItem>
      </AccordionRoot>
    </div>
  </TooltipProvider>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { ChevronDown, Plus, Puzzle } from "lucide-vue-next";
import {
  AccordionRoot,
  AccordionItem,
  AccordionHeader,
  AccordionTrigger,
  AccordionContent,
  TooltipProvider,
  TooltipRoot,
  TooltipTrigger,
  TooltipPortal,
  TooltipContent,
} from "reka-ui";
import { useI18n } from "vue-i18n";
import { HayApi } from "@/utils/api";
import { useToolLabel } from "@/composables/useToolLabel";
import { useDomain } from "@/composables/useDomain";
import {
  classifyTool,
  getToolClassificationIcon,
  type ToolAnnotations,
  type ToolClassification,
} from "@/utils/toolClassification";

interface PanelTool {
  id: string;
  name: string;
  label: string;
  description: string;
  pluginId: string;
  pluginName: string;
  annotations?: ToolAnnotations;
}

// Color the read/write/destructive icon to match the plugin page's badge intent.
const classificationIconClass = (classification: ToolClassification): string => {
  if (classification === "read") return "text-green-600";
  if (classification === "destructive") return "text-red-600";
  return "text-amber-600";
};

// Human-readable tooltip label for a classification (shared with the plugin page).
const classificationLabel = (classification: ToolClassification): string =>
  t(`pluginSettings.availableActions.classification.${classification}`);

const emit = defineEmits<{
  (e: "add", tool: PanelTool): void;
  (e: "count", value: number): void;
}>();

const { t } = useI18n();
const { getToolLabel, getToolDescription, getPluginName } = useToolLabel();
const { getApiUrl } = useDomain();
const apiBaseUrl = getApiUrl();

const rawTools = ref<PanelTool[]>([]);
const loading = ref(true);
const failedThumbnails = ref<string[]>([]);

const thumbnailUrl = (pluginId: string) =>
  `${apiBaseUrl}/plugins/thumbnails/${encodeURIComponent(pluginId)}`;

const onThumbnailError = (pluginId: string) => {
  if (!failedThumbnails.value.includes(pluginId)) {
    failedThumbnails.value = [...failedThumbnails.value, pluginId];
  }
};

// Resolve human-readable labels/descriptions through plugin translations.
const tools = computed<PanelTool[]>(() =>
  rawTools.value.map((tool) => ({
    ...tool,
    label: getToolLabel(tool.pluginId, tool.name),
    description: getToolDescription(tool.pluginId, tool.name, tool.description),
  })),
);

// Group tools by their owning plugin so the panel mirrors how they appear in the editor.
const groups = computed(() => {
  const byPlugin = new Map<string, { pluginId: string; pluginName: string; tools: PanelTool[] }>();
  for (const tool of tools.value) {
    let group = byPlugin.get(tool.pluginId);
    if (!group) {
      group = {
        pluginId: tool.pluginId,
        pluginName: getPluginName(tool.pluginId, tool.pluginName),
        tools: [],
      };
      byPlugin.set(tool.pluginId, group);
    }
    group.tools.push(tool);
  }
  return Array.from(byPlugin.values());
});

onMounted(async () => {
  try {
    rawTools.value = await HayApi.plugins.getMCPTools.query();
  } catch (error) {
    console.error("Failed to fetch available actions:", error);
    rawTools.value = [];
  } finally {
    loading.value = false;
  }
});
</script>
