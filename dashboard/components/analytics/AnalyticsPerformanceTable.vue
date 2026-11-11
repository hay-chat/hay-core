<template>
  <Table>
    <TableHeader>
      <TableRow>
        <TableHead>{{ nameLabel }}</TableHead>
        <TableHead class="!text-right">{{ $t("analytics.table.closes") }}</TableHead>
        <TableHead class="!text-right">{{ $t("analytics.table.aiResolutionRate") }}</TableHead>
        <TableHead class="!text-right">{{ $t("analytics.table.handoffRate") }}</TableHead>
        <TableHead class="!text-right">{{ $t("analytics.table.csat") }}</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      <TableRow v-for="row in rows" :key="row.key">
        <TableCell>
          <NuxtLink v-if="row.to" :to="row.to" class="font-medium text-primary hover:underline">
            {{ row.name }}
          </NuxtLink>
          <span v-else :class="row.muted ? 'text-neutral-muted' : 'font-medium text-foreground'">
            {{ row.name }}
          </span>
        </TableCell>
        <TableCell class="text-right tabular-nums">{{ row.closes.toLocaleString() }}</TableCell>
        <TableCell class="text-right tabular-nums">
          {{ formatRate(row.aiResolutionRate) }}
        </TableCell>
        <TableCell class="text-right tabular-nums">{{ formatRate(row.handoffRate) }}</TableCell>
        <TableCell class="text-right tabular-nums">
          {{ formatScore(row.csatAverage) }}
          <span v-if="row.csatRated > 0" class="text-xs text-neutral-muted">
            ({{ row.csatRated }})
          </span>
        </TableCell>
      </TableRow>
    </TableBody>
  </Table>
</template>

<script setup lang="ts">
import { formatRate, formatScore } from "@/utils/analytics";

/** The columns the topics and playbooks reports share. */
export interface PerformanceTableRow {
  key: string;
  name: string;
  /** Where the name links to, when there is something to open. */
  to?: string;
  muted?: boolean;
  closes: number;
  aiResolutionRate: number | null;
  handoffRate: number | null;
  csatRated: number;
  csatAverage: number | null;
}

defineProps<{ nameLabel: string; rows: PerformanceTableRow[] }>();
</script>
