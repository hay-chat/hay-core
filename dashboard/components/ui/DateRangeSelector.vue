<template>
  <div class="flex items-center space-x-2">
    <Calendar class="h-4 w-4 text-muted-foreground" />

    <!-- Preset Options Dropdown -->
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" class="w-auto">
          {{ displayText }}
          <ChevronDown class="ml-2 h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" class="w-48">
        <DropdownMenuItem @click="selectPreset('last7')"> Last 7 days </DropdownMenuItem>
        <DropdownMenuItem @click="selectPreset('last30')"> Last 30 days </DropdownMenuItem>
        <DropdownMenuItem @click="selectPreset('last90')"> Last 90 days </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem @click="selectPreset('thisWeek')"> This week </DropdownMenuItem>
        <DropdownMenuItem @click="selectPreset('thisMonth')"> This month </DropdownMenuItem>
        <DropdownMenuItem @click="selectPreset('thisYear')"> This year </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem @click="selectPreset('custom')"> Custom range... </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>

    <!-- Custom Date Pickers (only shown when custom is selected) -->
    <template v-if="selectedPreset === 'custom'">
      <Input
        :value="customDates.startDate"
        type="date"
        class="w-36"
        @input="updateCustomDate('startDate', $event.target.value)"
      />
      <span class="text-muted-foreground">to</span>
      <Input
        :value="customDates.endDate"
        type="date"
        class="w-36"
        @input="updateCustomDate('endDate', $event.target.value)"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { Calendar, ChevronDown } from "lucide-vue-next";

interface DateRange {
  startDate: string;
  endDate: string;
}

const props = defineProps<{
  modelValue?: DateRange;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: DateRange];
  change: [value: DateRange];
}>();

type PresetType = "last7" | "last30" | "last90" | "thisWeek" | "thisMonth" | "thisYear" | "custom";

const selectedPreset = ref<PresetType>("last7");
const customDates = ref<DateRange>({
  startDate: "",
  endDate: "",
});

const presetLabels: Record<PresetType, string> = {
  last7: "Last 7 days",
  last30: "Last 30 days",
  last90: "Last 90 days",
  thisWeek: "This week",
  thisMonth: "This month",
  thisYear: "This year",
  custom: "Custom range",
};

const displayText = computed(() => {
  return presetLabels[selectedPreset.value];
});

const calculateDatesForPreset = (preset: PresetType): DateRange => {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let startDate: Date;
  let endDate: Date = today;

  switch (preset) {
    case "last7":
      startDate = new Date(today);
      startDate.setDate(startDate.getDate() - 6);
      break;
    case "last30":
      startDate = new Date(today);
      startDate.setDate(startDate.getDate() - 29);
      break;
    case "last90":
      startDate = new Date(today);
      startDate.setDate(startDate.getDate() - 89);
      break;
    case "thisWeek":
      const dayOfWeek = today.getDay();
      const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      startDate = new Date(today);
      startDate.setDate(today.getDate() - daysToMonday);
      break;
    case "thisMonth":
      startDate = new Date(today.getFullYear(), today.getMonth(), 1);
      break;
    case "thisYear":
      startDate = new Date(today.getFullYear(), 0, 1);
      break;
    case "custom":
      return customDates.value;
    default:
      startDate = new Date(today);
      startDate.setDate(startDate.getDate() - 29);
  }

  return {
    startDate: startDate.toISOString().split("T")[0],
    endDate: endDate.toISOString().split("T")[0],
  };
};

const selectPreset = (preset: PresetType) => {
  selectedPreset.value = preset;

  if (preset !== "custom") {
    const dates = calculateDatesForPreset(preset);
    emit("update:modelValue", dates);
    emit("change", dates);
  }
};

const updateCustomDate = (field: "startDate" | "endDate", value: string) => {
  customDates.value[field] = value;

  if (customDates.value.startDate && customDates.value.endDate) {
    emit("update:modelValue", customDates.value);
    emit("change", customDates.value);
  }
};

// Initialize with last 7 days
onMounted(() => {
  if (!props.modelValue) {
    selectPreset("last7");
  } else {
    // Try to detect which preset matches the current dates
    customDates.value = props.modelValue;
    selectedPreset.value = "custom";
  }
});

// Watch for external changes to modelValue
watch(
  () => props.modelValue,
  (newValue) => {
    if (newValue && selectedPreset.value === "custom") {
      customDates.value = newValue;
    }
  },
  { deep: true },
);
</script>
