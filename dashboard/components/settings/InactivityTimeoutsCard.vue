<template>
  <Card v-if="rows" data-testid="inactivity-settings">
    <CardHeader>
      <CardTitle>{{ $t("businessHours.inactivity.title") }}</CardTitle>
      <CardDescription>{{ $t("businessHours.inactivity.description") }}</CardDescription>
    </CardHeader>
    <CardContent class="space-y-4">
      <div
        v-for="row in rows"
        :key="row.channel"
        class="grid gap-3 sm:grid-cols-[minmax(0,1fr)_7rem_7rem_8rem] sm:items-end"
        :data-testid="`inactivity-row-${row.channel}`"
      >
        <p class="text-sm font-medium sm:pb-2">{{ row.name }}</p>
        <Input
          v-model.number="row.warning"
          type="number"
          :min="1"
          :label="$t('businessHours.inactivity.warnAfter')"
          :placeholder="$t('businessHours.inactivity.noCheckIn')"
        />
        <Input
          v-model.number="row.close"
          type="number"
          :min="1"
          :label="$t('businessHours.inactivity.closeAfter')"
        />
        <Input
          v-model="row.unit"
          type="select"
          :label="$t('businessHours.inactivity.unit')"
          :options="unitOptions"
        />
      </div>
      <p class="text-sm text-neutral-muted">{{ $t("businessHours.inactivity.hint") }}</p>
      <p v-if="!valid" class="text-sm text-destructive">
        {{ $t("businessHours.inactivity.invalid", { max: limits.max / 1440 }) }}
      </p>
      <Button
        size="sm"
        class="min-h-11 sm:min-h-0"
        :loading="saving"
        :disabled="!valid"
        data-testid="inactivity-save"
        @click="save"
      >
        {{ $t("common.save") }}
      </Button>
    </CardContent>
  </Card>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { Hay } from "@/utils/api";
import { useToast } from "@/composables/useToast";

/**
 * Per-channel inactivity timing: how long a customer can stay silent before
 * the AI nudges them, and before it closes the conversation. Channels are
 * keyed by channel id (never plugin id); the server falls back to the
 * built-in default and then to the env interval.
 */
interface Props {
  channels: Array<{ channel: string; name: string }>;
}
const props = defineProps<Props>();

type Unit = "minutes" | "hours" | "days";
const UNIT_MINUTES: Record<Unit, number> = { minutes: 1, hours: 60, days: 1440 };

interface Row {
  channel: string;
  name: string;
  /** Empty = no check-in before the close. */
  warning: number | "" | null;
  close: number;
  unit: Unit;
}
interface Timeout {
  warningMinutes: number | null;
  closeMinutes: number;
}

const { t } = useI18n();
const toast = useToast();
const rows = ref<Row[] | null>(null);
const saving = ref(false);
const limits = ref({ min: 1, max: 14 * 1440 });
// Server-side defaults, to store only the rows the user changed.
const effectiveDefaults = ref<Record<string, Timeout>>({});

const unitOptions = computed(() =>
  (Object.keys(UNIT_MINUTES) as Unit[]).map((unit) => ({
    label: t(`businessHours.inactivity.units.${unit}`),
    value: unit,
  })),
);

function pickUnit(warningMinutes: number | null, closeMinutes: number): Unit {
  const fits = (size: number) =>
    closeMinutes % size === 0 && (warningMinutes === null || warningMinutes % size === 0);
  if (fits(1440)) return "days";
  if (fits(60)) return "hours";
  return "minutes";
}

function toRow(channel: string, name: string, timeout: Timeout): Row {
  const unit = pickUnit(timeout.warningMinutes, timeout.closeMinutes);
  return {
    channel,
    name,
    unit,
    warning: timeout.warningMinutes === null ? "" : timeout.warningMinutes / UNIT_MINUTES[unit],
    close: timeout.closeMinutes / UNIT_MINUTES[unit],
  };
}

function toMinutes(row: Row): Timeout {
  return {
    warningMinutes:
      row.warning === "" || row.warning === null
        ? null
        : Math.round(row.warning * UNIT_MINUTES[row.unit]),
    closeMinutes: Math.round(row.close * UNIT_MINUTES[row.unit]),
  };
}

const valid = computed(() =>
  (rows.value ?? []).every((row) => {
    const { warningMinutes, closeMinutes } = toMinutes(row);
    const ok = (n: number) => Number.isInteger(n) && n >= limits.value.min && n <= limits.value.max;
    if (!ok(closeMinutes)) return false;
    return warningMinutes === null || (ok(warningMinutes) && warningMinutes < closeMinutes);
  }),
);

async function load() {
  try {
    const data = await Hay.organizations.getInactivityTimeouts.query();
    limits.value = data.limits;
    effectiveDefaults.value = Object.fromEntries(
      props.channels.map(({ channel }) => [channel, data.defaults[channel] ?? data.fallback]),
    );
    rows.value = props.channels.map(({ channel, name }) =>
      toRow(channel, name, data.overrides[channel] ?? effectiveDefaults.value[channel]),
    );
  } catch {
    // Members without settings access don't see the card.
    rows.value = null;
  }
}

onMounted(load);

async function save() {
  if (!rows.value || !valid.value) return;
  saving.value = true;
  try {
    const timeouts: Record<string, Timeout> = {};
    for (const row of rows.value) {
      const minutes = toMinutes(row);
      const base = effectiveDefaults.value[row.channel];
      if (
        minutes.warningMinutes !== base.warningMinutes ||
        minutes.closeMinutes !== base.closeMinutes
      ) {
        timeouts[row.channel] = minutes;
      }
    }
    await Hay.organizations.updateInactivityTimeouts.mutate({ timeouts });
    toast.success(t("businessHours.inactivity.saved"));
  } catch (error) {
    toast.error(
      error instanceof Error
        ? error.message
        : t("businessHours.inactivity.invalid", { max: limits.value.max / 1440 }),
    );
  } finally {
    saving.value = false;
  }
}
</script>
