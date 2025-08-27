<template>
  <div class="relative">
    <!-- User Menu Button -->
    <div>
      <button
        id="user-menu-button"
        type="button"
        class="relative flex rounded-full bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background"
        aria-expanded="false"
        aria-haspopup="true"
        @click="dropdownOpen = !dropdownOpen"
      >
        <span class="absolute -inset-1.5" />
        <span class="sr-only">Open user menu</span>
        <div class="h-8 w-8 rounded-full bg-primary flex items-center justify-center">
          <span class="text-sm font-medium text-white">
            {{ userInitials }}
          </span>
        </div>
      </button>
    </div>

    <!-- Dropdown Menu -->
    <transition
      enter-active-class="transition ease-out duration-100"
      enter-from-class="transform opacity-0 scale-95"
      enter-to-class="transform opacity-100 scale-100"
      leave-active-class="transition ease-in duration-75"
      leave-from-class="transform opacity-100 scale-100"
      leave-to-class="transform opacity-0 scale-95"
    >
      <div
        v-show="dropdownOpen"
        class="absolute right-0 z-10 mt-2 w-56 origin-top-right rounded-md bg-background py-1 shadow-lg ring-1 ring-border ring-opacity-5 focus:outline-none"
        role="menu"
        aria-orientation="vertical"
        aria-labelledby="user-menu-button"
        tabindex="-1"
        @click.away="dropdownOpen = false"
      >
        <!-- User Info Section -->
        <div class="px-4 py-2 border-b border-border">
          <p class="text-sm font-medium text-foreground">{{ user?.fullName || 'User' }}</p>
          <p class="text-xs text-muted-foreground">{{ user?.email || '' }}</p>
        </div>

        <!-- Navigation Items -->
        <div class="py-1">
          <NuxtLink
            v-for="item in userMenuItems"
            :key="item.name"
            :to="item.href"
            class="flex items-center px-4 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            role="menuitem"
            tabindex="-1"
            @click="dropdownOpen = false"
          >
            <component :is="item.icon" class="mr-3 h-4 w-4" aria-hidden="true" />
            {{ item.name }}
          </NuxtLink>
        </div>

        <!-- Organization Switcher -->
        <div class="border-t border-border">
          <div class="px-4 py-2">
            <p class="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Organization
            </p>
          </div>
          <div class="py-1">
            <button
              class="flex w-full items-center px-4 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              @click="
                showOrgSwitcher = true;
                dropdownOpen = false;
              "
            >
              <Building2 class="mr-3 h-4 w-4" aria-hidden="true" />
              <div class="flex-1 text-left">
                <p class="font-medium">{{ currentOrganization.name }}</p>
                <p class="text-xs text-muted-foreground">Switch organization</p>
              </div>
              <ChevronDown class="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        <!-- Sign Out -->
        <div class="border-t border-border py-1">
          <button
            class="flex w-full items-center px-4 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            role="menuitem"
            tabindex="-1"
            @click="handleSignOut"
          >
            <LogOut class="mr-3 h-4 w-4" aria-hidden="true" />
            Sign out
          </button>
        </div>
      </div>
    </transition>

    <!-- Organization Switcher Modal -->
    <!-- TODO: Implement organization switcher modal -->
    <!-- This should show a list of organizations the user has access to -->
  </div>
</template>

<script setup lang="ts">
import {
  User,
  Settings,
  HelpCircle,
  Building2,
  ChevronDown,
  LogOut,
  UserCog,
} from 'lucide-vue-next';
import { useAuth } from '~/composables/useAuth';

const dropdownOpen = ref(false);
const showOrgSwitcher = ref(false);

// Auth state
const { user: authUser, logout, isLoading: _isLoading } = useAuth();

// User data from auth state
const user = computed(() => authUser);

// Organization data from user state
const currentOrganization = computed(() => ({
  name: authUser?.organizationName || 'No Organization',
  id: authUser?.organizationId || '',
}));

// User menu navigation items
const userMenuItems = [
  { name: 'Your Profile', href: '/profile', icon: User },
  { name: 'Account Settings', href: '/settings/account', icon: UserCog },
  { name: 'Preferences', href: '/settings/preferences', icon: Settings },
  { name: 'Help & Support', href: '/help', icon: HelpCircle },
];

// Computed user initials for avatar
const userInitials = computed(() => {
  if (!user.value?.fullName) return 'U';

  const names = user.value.fullName.split(' ');
  if (names.length === 1) {
    return names[0]?.charAt(0).toUpperCase() || 'U';
  }

  const firstInitial = names[0]?.charAt(0) || '';
  const lastInitial = names[names.length - 1]?.charAt(0) || '';
  return (firstInitial + lastInitial).toUpperCase();
});

// Methods
const handleSignOut = async () => {
  dropdownOpen.value = false;

  try {
    await logout();
    // Logout will clear tokens and auth state
    // Redirect to login page
    await navigateTo('/login');
  } catch (error) {
    console.error('Sign out error:', error);
    // Even if logout API fails, we should still redirect
    // as local state is cleared
    await navigateTo('/login');
  }
};

// Close dropdown when clicking outside
const handleClickOutside = (event: Event) => {
  const target = event.target as HTMLElement;
  const dropdown = document.querySelector('[aria-labelledby="user-menu-button"]');
  const button = document.getElementById('user-menu-button');

  if (dropdown && button && !dropdown.contains(target) && !button.contains(target)) {
    dropdownOpen.value = false;
  }
};

onMounted(() => {
  document.addEventListener('click', handleClickOutside);
});

// eslint-disable-next-line no-undef
onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside);
});

// TODO: Add keyboard navigation support
// TODO: Add organization switching functionality
// TODO: Connect to real user authentication state
// TODO: Add notification indicators
// TODO: Add status indicators (online/offline)
</script>
