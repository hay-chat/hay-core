<template>
  <div
    v-if="assignedUser"
    class="bg-orange-50 border-l-4 border-orange-400 p-4 mb-4"
    :class="isCurrentUser ? 'bg-blue-50 border-blue-400' : 'bg-orange-50 border-orange-400'"
  >
    <div class="flex items-center justify-between">
      <div class="flex items-center space-x-3">
        <div
          class="w-10 h-10 rounded-full flex items-center justify-center text-white font-semibold"
          :class="isCurrentUser ? 'bg-blue-500' : 'bg-orange-500'"
        >
          {{ getUserInitials(assignedUser.name) }}
        </div>
        <div>
          <p class="font-medium" :class="isCurrentUser ? 'text-blue-900' : 'text-orange-900'">
            {{ bannerTitle }}
          </p>
          <p class="text-sm" :class="isCurrentUser ? 'text-blue-700' : 'text-orange-700'">
            {{ bannerSubtitle }}
          </p>
        </div>
      </div>

      <div class="flex items-center space-x-2">
        <Button
          v-if="!isCurrentUser"
          variant="outline"
          size="sm"
          :disabled="loading"
          @click="$emit('takeover')"
        >
          <UserCheck class="h-4 w-4 mr-2" />
          Take Over
        </Button>
        <Button
          v-if="isCurrentUser"
          variant="outline"
          size="sm"
          :disabled="loading"
          @click="$emit('release')"
        >
          <LogOut class="h-4 w-4 mr-2" />
          Release
        </Button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { UserCheck, LogOut } from "lucide-vue-next";
import Button from "@/components/ui/Button.vue";
import { useUserStore } from "@/stores/user";

interface AssignedUser {
  id: string;
  name: string;
  email: string;
  assignedAt: Date | string | null;
}

interface Props {
  assignedUser: AssignedUser | null;
  loading?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  loading: false,
});

defineEmits<{
  takeover: [];
  release: [];
}>();

const userStore = useUserStore();

const isCurrentUser = computed(() => {
  return props.assignedUser?.id === userStore.user?.id;
});

const bannerTitle = computed(() => {
  if (isCurrentUser.value) {
    return "You are handling this conversation";
  }
  return `${props.assignedUser?.name} is handling this conversation`;
});

const bannerSubtitle = computed(() => {
  if (!props.assignedUser?.assignedAt) {
    return "";
  }

  const timeAgo = getTimeAgo(new Date(props.assignedUser.assignedAt));
  if (isCurrentUser.value) {
    return `Taken over ${timeAgo}`;
  }
  return `Taken over ${timeAgo} • Taking over will revoke their access`;
});

const getUserInitials = (name: string): string => {
  const parts = name.split(" ");
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
};

const getTimeAgo = (date: Date): string => {
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};
</script>
