<template>
  <div class="tool-execution-viewer">
    <!-- Tool Header (Always visible, clickable to expand/collapse) -->
    <div class="tool-header" @click="toggleExpanded">
      <div class="tool-header__left">
        <Zap class="tool-header__icon" />
        <span class="font-bold">{{ formattedToolName }}</span>
      </div>
      <div class="tool-header__right">
        <Badge :variant="httpStatus ? httpStatusVariant : statusVariant" class="text-xs font-mono">
          <component
            :is="httpStatus ? httpStatusIcon : statusIcon"
            :class="['h-3 w-3 mr-1', { 'animate-spin': toolStatus === 'RUNNING' && !httpStatus }]"
          />
          {{ httpStatus ? `${httpStatus}: ${httpStatusText}` : statusText }}
        </Badge>
        <ChevronDown v-if="!isExpanded" class="h-3 w-3 chevron" />
        <ChevronUp v-else class="h-3 w-3 chevron" />
      </div>
    </div>

    <!-- Collapsible Details -->
    <div v-show="isExpanded" class="tool-details">
      <!-- Inputs Section -->
      <div v-if="hasInputs" class="tool-section">
        <button class="tool-section__header" @click.stop="toggleInputs">
          <span class="tool-section__label">Inputs</span>
          <ChevronDown v-if="!inputsExpanded" class="h-3 w-3" />
          <ChevronUp v-else class="h-3 w-3" />
        </button>
        <div v-show="inputsExpanded" class="tool-section__content">
          <VueJsonPretty :data="toolInput" :deep="2" :show-length="true" :show-line="false" />
        </div>
      </div>

      <!-- Outputs Section -->
      <div v-if="hasOutputs" class="tool-section">
        <button class="tool-section__header" @click.stop="toggleOutputs">
          <span class="tool-section__label">Outputs</span>
          <ChevronDown v-if="!outputsExpanded" class="h-3 w-3" />
          <ChevronUp v-else class="h-3 w-3" />
        </button>
        <div v-show="outputsExpanded" class="tool-section__content">
          <VueJsonPretty :data="formattedOutput" :deep="2" :show-length="true" :show-line="false" />
        </div>
      </div>

      <!-- Metadata Section (at bottom) -->
      <div class="tool-metadata">
        <div v-if="latency" class="tool-metadata__item">
          <Clock class="h-3 w-3" />
          <span>{{ latency }}ms</span>
        </div>
        <div v-if="executedAt" class="tool-metadata__item">
          <CalendarClock class="h-3 w-3" />
          <span>{{ formattedExecutedAt }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import VueJsonPretty from "vue-json-pretty";
import "vue-json-pretty/lib/styles.css";
import {
  Zap,
  ChevronDown,
  ChevronUp,
  CheckCircle,
  XCircle,
  Clock,
  Loader2,
  CalendarClock,
  AlertCircle,
} from "lucide-vue-next";

interface Props {
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolOutput?: Record<string, unknown> | string | number | boolean | null;
  toolStatus?: string;
  httpStatus?: number;
  latency?: number;
  executedAt?: string;
}

const props = withDefaults(defineProps<Props>(), {
  toolStatus: "UNKNOWN",
});

const isExpanded = ref(false);
const inputsExpanded = ref(false);
const outputsExpanded = ref(true); // Outputs expanded by default

const toggleExpanded = () => {
  isExpanded.value = !isExpanded.value;
};

const toggleInputs = () => {
  inputsExpanded.value = !inputsExpanded.value;
};

const toggleOutputs = () => {
  outputsExpanded.value = !outputsExpanded.value;
};

// Format tool name to be more user-friendly
const formattedToolName = computed(() => {
  if (!props.toolName) return "Unknown Tool";

  // Extract the tool name from the full ID (e.g., "hay-plugin-top-santiago:list_addresses" -> "list_addresses")
  const parts = props.toolName.split(":");
  const toolName = parts.length > 1 ? parts[1] : props.toolName;

  // Convert snake_case or kebab-case to Title Case
  return toolName
    .replace(/[_-]/g, " ")
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
});

// Parse and format the tool output
const formattedOutput = computed(() => {
  if (!props.toolOutput) return null;

  // Check if output has the MCP format with content array
  if (
    typeof props.toolOutput === "object" &&
    props.toolOutput !== null &&
    "content" in props.toolOutput &&
    Array.isArray(props.toolOutput.content)
  ) {
    // Extract text from content array
    const content = props.toolOutput.content as Array<{ text?: string; type?: string }>;
    if (content.length > 0 && content[0].text) {
      try {
        // Try to parse the text as JSON
        return JSON.parse(content[0].text);
      } catch {
        // If it's not valid JSON, return the text as-is
        return content[0].text;
      }
    }
  }

  // Return the output as-is if it's not in MCP format
  return props.toolOutput;
});

const hasInputs = computed(() => {
  return props.toolInput && Object.keys(props.toolInput).length > 0;
});

const hasOutputs = computed(() => {
  return props.toolOutput !== undefined && props.toolOutput !== null;
});

const statusVariant = computed(() => {
  switch (props.toolStatus) {
    case "SUCCESS":
      return "success";
    case "ERROR":
      return "destructive";
    case "RUNNING":
      return "secondary";
    default:
      return "outline";
  }
});

const statusIcon = computed(() => {
  switch (props.toolStatus) {
    case "SUCCESS":
      return CheckCircle;
    case "ERROR":
      return XCircle;
    case "RUNNING":
      return Loader2;
    default:
      return AlertCircle;
  }
});

const statusText = computed(() => {
  switch (props.toolStatus) {
    case "SUCCESS":
      return "Success";
    case "ERROR":
      return "Failed";
    case "RUNNING":
      return "Running";
    default:
      return "Unknown";
  }
});

const httpStatusVariant = computed(() => {
  if (!props.httpStatus) return "outline";
  if (props.httpStatus >= 200 && props.httpStatus < 300) return "success";
  if (props.httpStatus >= 400) return "destructive";
  return "secondary";
});

const httpStatusIcon = computed(() => {
  if (!props.httpStatus) return AlertCircle;
  if (props.httpStatus >= 200 && props.httpStatus < 300) return CheckCircle;
  if (props.httpStatus >= 400) return XCircle;
  return AlertCircle;
});

const httpStatusText = computed(() => {
  if (!props.httpStatus) return "Unknown";
  const statusMessages: Record<number, string> = {
    200: "OK",
    201: "Created",
    204: "No Content",
    400: "Bad Request",
    401: "Unauthorized",
    403: "Forbidden",
    404: "Not Found",
    500: "Internal Server Error",
    502: "Bad Gateway",
    503: "Service Unavailable",
  };
  return statusMessages[props.httpStatus] || "Unknown Status";
});

const formattedExecutedAt = computed(() => {
  if (!props.executedAt) return "";
  const date = new Date(props.executedAt);
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
});
</script>

<style lang="scss" scoped>
.tool-execution-viewer {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  font-size: 0.875rem;
  min-width: 50ch;
}

.tool-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
  transition: opacity 0.2s;

  &:hover {
    opacity: 0.8;
  }
}

.tool-header__left {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.tool-header__right {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.tool-header__icon {
  height: 1rem;
  width: 1rem;
}

.tool-metadata {
  display: flex;
  gap: 1rem;
  font-size: 0.75rem;
  opacity: 0.7;
  padding-bottom: 0.25rem;
}

.tool-metadata__item {
  display: flex;
  align-items: center;
  gap: 0.375rem;
}

.chevron {
  flex-shrink: 0;
}

.tool-details {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding-top: 0.5rem;
}

.tool-section {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.tool-section__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  opacity: 0.7;
  transition: opacity 0.2s;

  &:hover {
    opacity: 1;
  }
}

.tool-section__label {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  opacity: 0.7;
}

.tool-section__content {
  background: rgba(255, 255, 255, 0.75);
  color: var(--color-neutral-700);
  border-radius: 0.375rem;
  padding: 0.5rem;
  overflow: auto;
  max-height: 400px;

  :deep(.vjs-tree) {
    font-size: 0.75rem;
    font-family:
      "SF Mono", Monaco, "Cascadia Code", "Roboto Mono", Consolas, "Courier New", monospace;
    line-height: 1.4;
  }

  :deep(.vjs-tree .vjs-tree-node) {
    padding: 0.125rem 0;
  }
}

:deep(.vjs-value-string) {
  color: var(--color-green-600);
}
:deep(.vjs-value-boolean),
:deep(.vjs-value-number) {
  color: var(--color-primary-600);
}
</style>
