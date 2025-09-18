<template>
  <div class="px-3">
    <div class="mb-2 flex items-center justify-between px-3">
      <h2 class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
Projects
</h2>
      <button class="text-muted-foreground hover:text-foreground">
        <Plus class="h-4 w-4" />
      </button>
    </div>
    <div class="space-y-1">
      <NuxtLink
        v-for="project in projects"
        :key="project.name"
        :to="project.url"
        class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
      >
        <component :is="project.icon"
class="h-4 w-4" />
        <span>{{ project.name }}</span>
      </NuxtLink>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Plus } from "lucide-vue-next";

interface Project {
  name: string;
  url: string;
  icon: any;
}

interface Props {
  projects: Project[];
}

defineProps<Props>();
</script>
