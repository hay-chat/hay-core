<template>
  <Button
    variant="ghost"
    size="icon"
    :class="cn('h-10 w-10', className)"
    @click="toggleSidebar"
  >
    <Menu class="h-5 w-5" />
    <span class="sr-only">Toggle Sidebar</span>
  </Button>
</template>

<script setup lang="ts">
import { inject, computed } from 'vue'
import { Menu } from 'lucide-vue-next'
import { cn } from '@/lib/utils'
import Button from '@/components/ui/Button.vue'

interface SidebarTriggerProps {
  class?: any
}

const props = defineProps<SidebarTriggerProps>()

const sidebarProvider = inject<{
  open: Ref<boolean>
  toggleSidebar: () => void
}>('sidebar-provider')

const className = computed(() => props.class)

const toggleSidebar = () => {
  sidebarProvider?.toggleSidebar()
}
</script>