<template>
  <div
    v-if="status !== 'online'"
    role="alert"
    class="fixed inset-x-0 top-0 z-[60] flex items-center justify-center gap-3 px-4 py-2 text-sm font-medium text-white shadow-md"
    :class="status === 'offline' ? 'bg-red-600' : 'bg-green-600'"
  >
    <template v-if="status === 'offline'">
      <WifiOff class="h-4 w-4 shrink-0" />
      <span>Can't reach the server. Trying to reconnect…</span>
      <Button
        size="sm"
        :loading="retrying"
        class="ml-1 !bg-white !text-red-700 hover:!bg-red-50"
        @click="retryNow"
      >
        Retry now
      </Button>
    </template>

    <template v-else>
      <CheckCircle2 class="h-4 w-4 shrink-0" />
      <span>Back online.</span>
      <Button size="sm" class="ml-1 !bg-white !text-green-700 hover:!bg-green-50" @click="reload"
        >Reload page</Button
      >
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { WifiOff, CheckCircle2 } from "lucide-vue-next";
import { useServerStatus } from "@/composables/useServerStatus";

const { status, checkHealth, reload } = useServerStatus();

const retrying = ref(false);

const retryNow = async () => {
  retrying.value = true;
  try {
    await checkHealth();
  } finally {
    retrying.value = false;
  }
};
</script>
