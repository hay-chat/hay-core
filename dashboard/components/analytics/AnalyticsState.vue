<template>
  <div v-if="loading" class="space-y-4" data-testid="analytics-loading">
    <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <div
        v-for="i in 4"
        :key="i"
        class="h-[104px] animate-pulse rounded-lg bg-background-tertiary motion-reduce:animate-none"
      />
    </div>
    <div class="h-64 animate-pulse rounded-lg bg-background-tertiary motion-reduce:animate-none" />
  </div>
  <Card v-else-if="failed">
    <CardContent class="py-12 text-center">
      <p class="text-sm text-neutral-muted">{{ $t("analytics.loadFailed") }}</p>
      <Button variant="outline" size="sm" class="mt-4" @click="$emit('retry')">
        {{ $t("analytics.retry") }}
      </Button>
    </CardContent>
  </Card>
  <Card v-else-if="empty">
    <CardContent class="py-12 text-center">
      <p class="font-medium text-foreground">{{ emptyTitle ?? $t("analytics.empty.title") }}</p>
      <p class="mt-2 text-sm text-neutral-muted">
        {{ emptyDescription ?? $t("analytics.empty.description") }}
      </p>
    </CardContent>
  </Card>
  <slot v-else />
</template>

<script setup lang="ts">
/** Loading, error and empty states shared by every analytics tab. */
defineProps<{
  loading: boolean;
  failed: boolean;
  empty: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
}>();
defineEmits<{ retry: [] }>();
</script>
