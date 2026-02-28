<template>
  <div class="space-y-1">
    <template v-for="item in items" :key="item.title">
      <a
        v-if="!item.items && item.url && item.external"
        href="#"
        class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
        @click.prevent="handleExternalClick(item.url!)"
      >
        <component :is="item.icon" class="h-4 w-4" />
        <span>{{ item.title }}</span>
        <ExternalLink class="ml-auto h-4 w-4 text-muted-foreground" />
      </a>
      <NuxtLink
        v-else-if="!item.items && item.url"
        :to="item.url"
        class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
        :class="{
          'bg-accent text-accent-foreground': item.isActive,
        }"
      >
        <component :is="item.icon" class="h-4 w-4" />
        <span>{{ item.title }}</span>
        <Badge v-if="item.badge" class="ml-auto">
          {{ item.badge }}
        </Badge>
      </NuxtLink>

      <div v-else>
        <button
          class="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
          @click="toggleExpanded(item.title)"
        >
          <component :is="item.icon" class="h-4 w-4" />
          <span>{{ item.title }}</span>
          <ChevronRight
            class="ml-auto h-4 w-4 transition-transform"
            :class="{ 'rotate-90': expanded[item.title] }"
          />
        </button>
        <div v-if="expanded[item.title]" class="ml-7 space-y-1">
          <NuxtLink
            v-for="subItem in item.items"
            :key="subItem.title"
            :to="subItem.url"
            class="block rounded-lg px-3 py-2 text-sm text-neutral-muted transition-colors hover:bg-accent hover:text-accent-foreground"
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
import { reactive, watchEffect, type Component } from "vue";
import { ChevronRight, ExternalLink } from "lucide-vue-next";
import { Hay } from "@/utils/api";

interface NavItem {
  title: string;
  url?: string;
  icon?: Component;
  badge?: string;
  isActive?: boolean;
  external?: boolean;
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

async function handleExternalClick(url: string) {
  try {
    const result = await Hay.auth.generateAuthCode.mutate();
    const separator = url.includes("?") ? "&" : "?";
    window.open(`${url}${separator}code=${result.code}`, "_blank");
  } catch (error) {
    console.error("Failed to generate auth code:", error);
    window.open(url, "_blank");
  }
}
</script>
