<template>
  <!-- One business-hours schedule (D5-6): channels, timezone, weekly hours, closures. -->
  <Card>
    <CardHeader>
      <CardTitle>{{ form.name || $t("businessHours.untitled") }}</CardTitle>
      <CardDescription>{{ coverage }}</CardDescription>
    </CardHeader>
    <CardContent class="space-y-6">
      <div class="grid gap-4 md:grid-cols-2">
        <Input v-model="form.name" :label="$t('businessHours.name')" :character-limit="120" />
        <Input
          v-model="form.timezone"
          type="select"
          :label="$t('businessHours.timezone')"
          :options="timezoneOptions"
        />
      </div>

      <div class="space-y-2">
        <p class="text-sm font-medium">{{ $t("businessHours.channels") }}</p>
        <p class="text-sm text-muted-foreground">{{ $t("businessHours.channelsHint") }}</p>
        <div class="flex flex-wrap gap-4">
          <Input
            v-for="ch in channels"
            :key="ch.channel"
            type="checkbox"
            :label="ch.name"
            :model-value="form.channels.includes(ch.channel)"
            :disabled="takenChannels.includes(ch.channel)"
            @update:model-value="toggleChannel(ch.channel, Boolean($event))"
          />
        </div>
      </div>

      <div class="space-y-2">
        <p class="text-sm font-medium">{{ $t("businessHours.weeklyHours") }}</p>
        <p class="text-sm text-muted-foreground">{{ $t("businessHours.weeklyHoursHint") }}</p>
        <div
          v-for="day in DAY_ORDER"
          :key="day"
          class="flex flex-wrap items-start gap-3 rounded-lg border p-3"
        >
          <div class="w-36 pt-2">
            <Input
              type="switch"
              :label="dayName(day)"
              :model-value="intervalsFor(day).length > 0"
              @update:model-value="toggleDay(day, Boolean($event))"
            />
          </div>
          <div class="flex flex-1 flex-col gap-2">
            <p v-if="intervalsFor(day).length === 0" class="pt-2 text-sm text-muted-foreground">
              {{ $t("businessHours.closedAllDay") }}
            </p>
            <div
              v-for="interval in intervalsFor(day)"
              :key="form.weeklyHours.indexOf(interval)"
              class="flex flex-wrap items-center gap-2"
            >
              <Input
                v-model="interval.start"
                type="time"
                :aria-label="`${dayName(day)}: ${$t('businessHours.opens')}`"
              />
              <span class="text-sm text-muted-foreground">–</span>
              <Input
                v-model="interval.end"
                type="time"
                :aria-label="`${dayName(day)}: ${$t('businessHours.closes')}`"
              />
              <span v-if="isOvernight(interval)" class="text-xs text-muted-foreground">
                {{ $t("businessHours.nextDay") }}
              </span>
              <Button
                variant="ghost"
                size="sm"
                :aria-label="$t('businessHours.removeInterval')"
                @click="removeInterval(interval)"
              >
                <X class="h-4 w-4" />
              </Button>
            </div>
            <Button
              v-if="intervalsFor(day).length > 0"
              variant="link"
              size="sm"
              class="self-start px-0"
              @click="addInterval(day)"
            >
              {{ $t("businessHours.addInterval") }}
            </Button>
          </div>
        </div>
      </div>

      <div class="space-y-2">
        <p class="text-sm font-medium">{{ $t("businessHours.closures") }}</p>
        <p class="text-sm text-muted-foreground">{{ $t("businessHours.closuresHint") }}</p>
        <div
          v-for="(closure, index) in form.closures"
          :key="index"
          class="flex flex-wrap items-end gap-2 rounded-lg border p-3"
        >
          <Input v-model="closure.date" type="date" :label="$t('businessHours.from')" />
          <Input v-model="closure.endDate" type="date" :label="$t('businessHours.to')" />
          <Input
            v-model="closure.label"
            :label="$t('businessHours.closureLabel')"
            :placeholder="$t('businessHours.closureLabelPlaceholder')"
          />
          <Button
            variant="ghost"
            size="sm"
            :aria-label="$t('businessHours.removeClosure')"
            @click="form.closures.splice(index, 1)"
          >
            <X class="h-4 w-4" />
          </Button>
        </div>
        <Button variant="outline" size="sm" @click="addClosure">
          {{ $t("businessHours.addClosure") }}
        </Button>
      </div>

      <div class="flex flex-wrap gap-2">
        <Button :loading="saving" @click="save">{{ $t("businessHours.save") }}</Button>
        <Button v-if="schedule.id" variant="outline" :loading="deleting" @click="remove">
          {{ $t("businessHours.delete") }}
        </Button>
        <Button v-else variant="ghost" @click="emit('cancel')">
          {{ $t("businessHours.cancel") }}
        </Button>
      </div>
    </CardContent>
  </Card>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { X } from "lucide-vue-next";
import { Hay } from "@/utils/api";
import { useToast } from "@/composables/useToast";
import { TIMEZONE_GROUPS } from "@/utils/timezones";

export interface ScheduleForm {
  id?: string;
  name: string;
  timezone: string;
  channels: string[];
  weeklyHours: Array<{ day: number; start: string; end: string }>;
  closures: Array<{ date: string; endDate?: string; label?: string }>;
}

const props = defineProps<{
  schedule: ScheduleForm;
  channels: Array<{ channel: string; name: string }>;
  /** Channels another schedule already covers. */
  takenChannels: string[];
}>();

const emit = defineEmits<{ saved: []; deleted: []; cancel: [] }>();

// Monday first; values are JS weekdays (0 = Sunday).
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

const { t, locale } = useI18n();
const toast = useToast();
const saving = ref(false);
const deleting = ref(false);

const form = reactive<ScheduleForm>(JSON.parse(JSON.stringify(props.schedule)));

const timezoneOptions = computed(() =>
  TIMEZONE_GROUPS.flatMap((group) =>
    group.options.map((tz) => ({ label: tz.label, value: tz.value })),
  ),
);

const coverage = computed(() => {
  if (form.channels.length === 0) return t("businessHours.defaultCoverage");
  const names = form.channels.map(
    (channel) => props.channels.find((ch) => ch.channel === channel)?.name ?? channel,
  );
  return t("businessHours.channelCoverage", { channels: names.join(", ") });
});

function dayName(day: number): string {
  // 4 Jan 2026 is a Sunday.
  return new Intl.DateTimeFormat(locale.value, { weekday: "long", timeZone: "UTC" }).format(
    new Date(Date.UTC(2026, 0, 4 + day)),
  );
}

function intervalsFor(day: number) {
  return form.weeklyHours.filter((interval) => interval.day === day);
}

function isOvernight(interval: { start: string; end: string }) {
  return interval.end <= interval.start && interval.end !== "00:00";
}

function toggleDay(day: number, open: boolean) {
  if (open) addInterval(day);
  else form.weeklyHours = form.weeklyHours.filter((interval) => interval.day !== day);
}

function addInterval(day: number) {
  form.weeklyHours.push({ day, start: "09:00", end: "18:00" });
}

function removeInterval(interval: { day: number; start: string; end: string }) {
  form.weeklyHours.splice(form.weeklyHours.indexOf(interval), 1);
}

function toggleChannel(channel: string, checked: boolean) {
  const set = new Set(form.channels);
  if (checked) set.add(channel);
  else set.delete(channel);
  form.channels = [...set];
}

function addClosure() {
  form.closures.push({ date: new Date().toISOString().slice(0, 10), endDate: "", label: "" });
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : t("businessHours.saveFailed");
}

async function save() {
  saving.value = true;
  try {
    const payload = {
      name: form.name.trim(),
      timezone: form.timezone,
      channels: form.channels,
      // An end of "00:00" means midnight; send it as the explicit "24:00".
      weeklyHours: form.weeklyHours.map((interval) => ({
        ...interval,
        end: interval.end === "00:00" ? "24:00" : interval.end,
      })),
      closures: form.closures
        .filter((closure) => closure.date)
        .map((closure) => ({
          date: closure.date,
          endDate: closure.endDate || null,
          label: closure.label || null,
        })),
    };
    if (form.id) await Hay.businessHours.update.mutate({ id: form.id, ...payload });
    else await Hay.businessHours.create.mutate(payload);
    toast.success(t("businessHours.saveSuccess"));
    emit("saved");
  } catch (error) {
    console.error("Failed to save business hours:", error);
    toast.error(errorMessage(error));
  } finally {
    saving.value = false;
  }
}

async function remove() {
  if (!form.id || !window.confirm(t("businessHours.deleteConfirm"))) return;
  deleting.value = true;
  try {
    await Hay.businessHours.delete.mutate({ id: form.id });
    emit("deleted");
  } catch (error) {
    console.error("Failed to delete business hours:", error);
    toast.error(t("businessHours.deleteFailed"));
  } finally {
    deleting.value = false;
  }
}
</script>
