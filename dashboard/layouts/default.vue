<template>
  <SidebarProvider>
    <div class="flex h-screen w-full">
      <AppSidebar />
      <div class="flex-1 flex flex-col">
        <SidebarTrigger class="md:hidden" />
        <main class="flex-1 overflow-y-auto p-4 md:p-6">
          <slot />
        </main>
      </div>
    </div>
  </SidebarProvider>
</template>

<script setup lang="ts">
import AppSidebar from "@/components/layout/AppSidebar.vue";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
</script>
