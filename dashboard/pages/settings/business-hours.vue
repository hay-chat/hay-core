<template>
  <Page :title="$t('businessHours.title')" :description="$t('businessHours.description')">
    <SettingsTabs />
    <template #header>
      <Button v-if="!draft" size="sm" @click="startDraft">
        {{ $t("businessHours.addSchedule") }}
      </Button>
    </template>

    <Loading v-if="loading" />

    <div v-else class="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{{ $t("businessHours.rightNow") }}</CardTitle>
          <CardDescription>{{ $t("businessHours.rightNowHint") }}</CardDescription>
        </CardHeader>
        <CardContent class="space-y-2">
          <div
            v-for="ch in channels"
            :key="ch.channel"
            class="flex flex-wrap items-center justify-between gap-2 text-sm"
          >
            <span class="font-medium">{{ ch.name }}</span>
            <span class="text-muted-foreground">{{ availabilityLabel(ch.channel) }}</span>
          </div>
        </CardContent>
      </Card>

      <QuickCheckSettingsCard />

      <p v-if="schedules.length === 0 && !draft" class="text-sm text-muted-foreground">
        {{ $t("businessHours.empty") }}
      </p>

      <BusinessHoursScheduleCard
        v-for="schedule in schedules"
        :key="schedule.id"
        :schedule="schedule"
        :channels="channels"
        :taken-channels="takenBy(schedule.id)"
        @saved="load"
        @deleted="load"
      />

      <BusinessHoursScheduleCard
        v-if="draft"
        :schedule="draft"
        :channels="channels"
        :taken-channels="takenBy(undefined)"
        @saved="onDraftSaved"
        @cancel="draft = null"
      />
    </div>
  </Page>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { Hay } from "@/utils/api";
import { useAppStore } from "@/stores/app";
import { useToast } from "@/composables/useToast";
import type { ScheduleForm } from "@/components/settings/BusinessHoursScheduleCard.vue";

type Availability = Awaited<ReturnType<typeof Hay.businessHours.availability.query>>;

const { t, locale } = useI18n();
const toast = useToast();
const appStore = useAppStore();

const loading = ref(true);
const schedules = ref<ScheduleForm[]>([]);
const draft = ref<ScheduleForm | null>(null);
const availability = ref<Record<string, Availability>>({});

// Web Chat plus every enabled channel plugin, keyed by channel id (never plugin id).
const channels = computed(() => [
  { channel: "web", name: t("businessHours.webChat") },
  ...appStore.plugins
    .filter((p) => p.enabled && p.type?.includes("channel") && p.channel)
    .map((p) => ({ channel: p.channel as string, name: p.name })),
]);

function takenBy(exceptId: string | undefined): string[] {
  return schedules.value.filter((s) => s.id !== exceptId).flatMap((s) => s.channels);
}

function startDraft() {
  const hasDefault = schedules.value.some((s) => s.channels.length === 0);
  draft.value = {
    name: hasDefault ? "" : t("businessHours.defaultName"),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    channels: [],
    weeklyHours: [1, 2, 3, 4, 5].map((day) => ({ day, start: "09:00", end: "18:00" })),
    closures: [],
  };
}

async function onDraftSaved() {
  draft.value = null;
  await load();
}

function availabilityLabel(channel: string): string {
  const a = availability.value[channel];
  if (!a) return "";
  if (!a.hasSchedule) {
    return a.state === "open"
      ? t("businessHours.stateAlwaysOpen")
      : t("businessHours.stateAlwaysOpenNobody");
  }
  if (a.state === "open") return t("businessHours.stateOpen");
  if (a.state === "open_nobody_online") return t("businessHours.stateOpenNobody");
  if (!a.nextOpening) return t("businessHours.stateClosed");
  const when = new Intl.DateTimeFormat(locale.value, {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: a.timezone,
  }).format(new Date(a.nextOpening));
  return t("businessHours.stateClosedUntil", { when, timezone: a.timezone });
}

async function load() {
  try {
    const rows = await Hay.businessHours.list.query();
    schedules.value = rows.map((row) => ({
      ...row,
      // The time input has no "24:00"; midnight shows as 00:00.
      weeklyHours: row.weeklyHours.map((i) => ({ ...i, end: i.end === "24:00" ? "00:00" : i.end })),
      closures: row.closures.map((c) => ({
        date: c.date,
        endDate: c.endDate ?? "",
        label: c.label ?? "",
      })),
    }));
    const entries = await Promise.all(
      channels.value.map(
        async (ch) =>
          [
            ch.channel,
            await Hay.businessHours.availability.query({ channel: ch.channel }),
          ] as const,
      ),
    );
    availability.value = Object.fromEntries(entries);
  } catch (error) {
    console.error("Failed to load business hours:", error);
    toast.error(t("businessHours.loadFailed"));
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  if (!appStore.plugins.length) await appStore.fetchPlugins();
  await load();
});
</script>
