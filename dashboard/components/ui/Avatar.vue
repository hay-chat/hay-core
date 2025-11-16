<template>
  <div :class="cn('relative', className, sizeClasses)" class="relative">
    <div
      :class="
        cn(
          'relative inline-flex items-center justify-center overflow-hidden aspect-square rounded-full',
          sizeClasses,
        )
      "
    >
      <!-- Show image if URL exists -->
      <img
        v-if="url"
        :src="url"
        :alt="name"
        class="h-full w-full object-cover aspect-square"
        @error="handleImageError"
      />
      <!-- Show initials if no URL or image failed to load -->
      <span
        v-else
        :class="
          cn(
            'font-medium text-white flex items-center justify-center absolute top-0 left-0 w-full h-full',
            textSizeClasses,
          )
        "
        :style="{ backgroundColor: fallbackColor }"
      >
        {{ initials }}
      </span>
    </div>
    <!-- Optional status indicator -->
    <span
      v-if="showStatus && status"
      :class="
        cn(
          'absolute bottom-0 right-0 block  ring-2 ring-white aspect-square rounded-full',
          statusSizeClasses,
          statusColorClasses,
        )
      "
    ></span>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { cn } from "@/lib/utils";

interface Props {
  name: string;
  url?: string | null;
  size?: "xs" | "sm" | "md" | "lg" | "xl" | "2xl";
  status?: "online" | "away" | "offline";
  showStatus?: boolean;
  className?: string;
}

const props = withDefaults(defineProps<Props>(), {
  url: null,
  size: "md",
  status: undefined,
  showStatus: false,
  className: "",
});

const imageError = ref(false);

// Generate initials from name
const initials = computed(() => {
  if (!props.name) return "?";

  const words = props.name.trim().split(/\s+/);

  if (words.length === 1) {
    // Single word: use first character
    return words[0].charAt(0).toUpperCase();
  } else {
    // Multiple words: use first character of first and last word
    const firstInitial = words[0].charAt(0).toUpperCase();
    const lastInitial = words[words.length - 1].charAt(0).toUpperCase();
    return firstInitial + lastInitial;
  }
});

// Generate consistent color based on name
const fallbackColor = computed(() => {
  if (!props.name) return "#94a3b8"; // slate-400

  // Generate a hash from the name
  let hash = 0;
  for (let i = 0; i < props.name.length; i++) {
    hash = props.name.charCodeAt(i) + ((hash << 5) - hash);
  }

  // Use a palette of pleasant colors
  const colors = [
    "#3b82f6", // blue-500
    "#8b5cf6", // violet-500
    "#ec4899", // pink-500
    "#f59e0b", // amber-500
    "#10b981", // emerald-500
    "#06b6d4", // cyan-500
    "#6366f1", // indigo-500
    "#d946ef", // fuchsia-500
  ];

  return colors[Math.abs(hash) % colors.length];
});

// Size classes for the avatar container
const sizeClasses = computed(() => {
  const sizes = {
    xs: "h-6 w-6 ",
    sm: "h-8 w-8 ",
    md: "h-10 w-10 ",
    lg: "h-12 w-12 ",
    xl: "h-16 w-16 ",
    "2xl": "h-20 w-20 ",
  };
  return sizes[props.size];
});

// Text size classes for initials
const textSizeClasses = computed(() => {
  const sizes = {
    xs: "text-xs",
    sm: "text-sm",
    md: "text-base",
    lg: "text-lg",
    xl: "text-xl",
    "2xl": "text-2xl",
  };
  return sizes[props.size];
});

// Status indicator size
const statusSizeClasses = computed(() => {
  const sizes = {
    xs: "h-1.5 w-1.5",
    sm: "h-2 w-2",
    md: "h-2.5 w-2.5",
    lg: "h-3 w-3",
    xl: "h-3.5 w-3.5",
    "2xl": "h-4 w-4",
  };
  return sizes[props.size];
});

// Status indicator color
const statusColorClasses = computed(() => {
  if (!props.status) return "";

  const colors = {
    online: "bg-green-500",
    away: "bg-yellow-500",
    offline: "bg-gray-400",
  };
  return colors[props.status];
});

// Handle image load error
const handleImageError = () => {
  imageError.value = true;
};
</script>
