<template>
  <Card v-if="readiness" data-testid="agent-readiness">
    <CardHeader>
      <CardTitle>{{ $t("tests.readiness.title") }}</CardTitle>
      <CardDescription>{{ $t("tests.readiness.description") }}</CardDescription>
    </CardHeader>
    <CardContent class="space-y-4 text-sm">
      <p v-if="!readiness.requireApproval" class="text-muted-foreground">
        {{ $t("tests.readiness.approvalOff") }}
      </p>

      <template v-else>
        <p v-if="readiness.weeks.length === 0" class="text-muted-foreground">
          {{ $t("tests.readiness.noWeeks") }}
        </p>
        <table v-else class="w-full text-left">
          <thead class="text-xs text-muted-foreground">
            <tr>
              <th class="py-1 font-medium" />
              <th class="py-1 font-medium">{{ $t("tests.readiness.approved") }}</th>
              <th class="py-1 font-medium">{{ $t("tests.readiness.edited") }}</th>
              <th class="py-1 font-medium">{{ $t("tests.readiness.blocked") }}</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-border">
            <tr v-for="week in readiness.weeks" :key="week.weekStart">
              <td class="py-1">
                {{ $t("tests.readiness.week", { date: formatDate(week.weekStart) }) }}
              </td>
              <td class="py-1">{{ week.approved }}</td>
              <td class="py-1">{{ week.edited }}</td>
              <td class="py-1">{{ week.blocked }}</td>
            </tr>
          </tbody>
        </table>

        <p class="text-muted-foreground">{{ $t("tests.readiness.window", readiness.window) }}</p>
        <p v-if="readiness.window.waiting > 0" class="text-muted-foreground">
          {{ $t("tests.readiness.waiting", { count: readiness.window.waiting }) }}
        </p>
        <p class="font-medium" :data-testid="`readiness-hint-${readiness.hint}`">
          {{
            $t(`tests.readiness.hints.${readiness.hint}`, {
              days: readiness.window.days,
              min: readiness.window.minReviewed,
            })
          }}
        </p>
      </template>
    </CardContent>
  </Card>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from "vue";
import { Hay } from "@/utils/api";
import type { RouterOutputs } from "@/types/trpc";

/**
 * Soft-launch readiness (D7-13): weekly approve / edit / block counts for an
 * agent under Require Approval, and a hint on when Auto-Send may be safe.
 * Require Approval holds replies only, never actions. No percentages.
 */
type Readiness = RouterOutputs["agents"]["readiness"][number];

const props = defineProps<{ agentId: string }>();

const readiness = ref<Readiness | null>(null);

function formatDate(isoDate: string) {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString(undefined, { timeZone: "UTC" });
}

async function load() {
  try {
    const [result] = await Hay.agents.readiness.query({ agentId: props.agentId });
    readiness.value = result ?? null;
  } catch {
    // Readiness is advisory; the agent page works without it.
    readiness.value = null;
  }
}

onMounted(load);
watch(() => props.agentId, load);
</script>
