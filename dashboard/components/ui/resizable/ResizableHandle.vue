<template>
  <div
    :class="cn(
      'relative flex w-px items-center justify-center bg-border after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 data-[panel-group-direction=vertical]:h-px data-[panel-group-direction=vertical]:w-full data-[panel-group-direction=vertical]:after:left-0 data-[panel-group-direction=vertical]:after:h-1 data-[panel-group-direction=vertical]:after:w-full data-[panel-group-direction=vertical]:after:-translate-y-1/2 data-[panel-group-direction=vertical]:after:translate-x-0 [&[data-panel-group-direction=vertical]>div]:rotate-90',
      className
    )"
    :data-resizing="resizing"
  >
    <div v-if="withHandle" class="z-10 flex h-4 w-3 items-center justify-center rounded-sm border bg-border">
      <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
        <path d="M5.5 4.625C6.12132 4.625 6.625 4.12132 6.625 3.5C6.625 2.87868 6.12132 2.375 5.5 2.375C4.87868 2.375 4.375 2.87868 4.375 3.5C4.375 4.12132 4.87868 4.625 5.5 4.625Z" fill="currentColor" />
        <path d="M9.5 4.625C10.1213 4.625 10.625 4.12132 10.625 3.5C10.625 2.87868 10.1213 2.375 9.5 2.375C8.87868 2.375 8.375 2.87868 8.375 3.5C8.375 4.12132 8.87868 4.625 9.5 4.625Z" fill="currentColor" />
        <path d="M5.5 8.625C6.12132 8.625 6.625 8.12132 6.625 7.5C6.625 6.87868 6.12132 6.375 5.5 6.375C4.87868 6.375 4.375 6.87868 4.375 7.5C4.375 8.12132 4.87868 8.625 5.5 8.625Z" fill="currentColor" />
        <path d="M9.5 8.625C10.1213 8.625 10.625 8.12132 10.625 7.5C10.625 6.87868 10.1213 6.375 9.5 6.375C8.87868 6.375 8.375 6.87868 8.375 7.5C8.375 8.12132 8.87868 8.625 9.5 8.625Z" fill="currentColor" />
        <path d="M5.5 12.625C6.12132 12.625 6.625 12.1213 6.625 11.5C6.625 10.8787 6.12132 10.375 5.5 10.375C4.87868 10.375 4.375 10.8787 4.375 11.5C4.375 12.1213 4.87868 12.625 5.5 12.625Z" fill="currentColor" />
        <path d="M9.5 12.625C10.1213 12.625 10.625 12.1213 10.625 11.5C10.625 10.8787 10.1213 10.375 9.5 10.375C8.87868 10.375 8.375 10.8787 8.375 11.5C8.375 12.1213 8.87868 12.625 9.5 12.625Z" fill="currentColor" />
      </svg>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { cn } from '@/lib/utils'

interface ResizableHandleProps {
  withHandle?: boolean
  class?: any
}

const props = withDefaults(defineProps<ResizableHandleProps>(), {
  withHandle: true
})

const resizing = ref(false)
const className = computed(() => props.class)
</script>