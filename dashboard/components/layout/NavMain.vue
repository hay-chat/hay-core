<template>
  <div class="space-y-1">
    <template v-for="item in items"
:key="item.title">
      <NuxtLink
        v-if="!item.items && item.url"
        :to="item.url"
        class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
        :class="{
          'bg-accent text-accent-foreground': item.isActive,
        }"
      >
        <component :is="item.icon"
class="h-4 w-4" />
        <span>{{ item.title }}</span>
        <Badge v-if="item.badge"
class="ml-auto">
          {{ item.badge }}
        </Badge>
      </NuxtLink>

      <div v-else>
        <button
          class="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
          @click="toggleExpanded(item.title)"
        >
          <component :is="item.icon"
class="h-4 w-4" />
          <span>{{ item.title }}</span>
          <ChevronRight
            class="ml-auto h-4 w-4 transition-transform"
            :class="{ 'rotate-90': expanded[item.title] }"
          />
        </button>
        <div v-if="expanded[item.title]"
class="ml-7 space-y-1">
          <NuxtLink
            v-for="subItem in item.items"
            :key="subItem.title"
            :to="subItem.url"
            class="block rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            :class="{
              'bg-accent text-accent-foreground': subItem.isActive,
            }"
          >
            {{ subItem.title }}
          </NuxtLink>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { reactive, watchEffect } from "vue";
import { ChevronRight } from "lucide-vue-next";

interface NavItem {
  title: string;
  url?: string;
  icon?: any;
  badge?: string;
  isActive?: boolean;
  items?: {
    title: string;
    url: string;
    isActive?: boolean;
  }[];
}

interface Props {
  items: NavItem[];
}

const props = defineProps<Props>();

const expanded = reactive<Record<string, boolean>>({});

// Auto-expand sections with active subitems
watchEffect(() => {
  props.items.forEach((item) => {
    if (item.items) {
      const hasActiveSubitem = item.items.some((subItem) => subItem.isActive);
      if (hasActiveSubitem) {
        expanded[item.title] = true;
      }
    }
  });
});

const toggleExpanded = (title: string) => {
  expanded[title] = !expanded[title];
};
</script>
